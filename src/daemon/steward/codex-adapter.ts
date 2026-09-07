/**
 * 用户原始需求 [2026-09-06]（openspec agent-steward task 1.6）：「实现 Codex app-server
 * adapter：优先 stdio/Unix socket，thread/turn/item 映射为 normalized RunEvent；不复制
 * Rust 类型。」
 * 协议事实（2026-09-06 实机 `codex app-server generate-json-schema --out` 证据）：
 *   - JSON-RPC over stdio（换行分隔）；client 方法 initialize / thread/start / turn/start /
 *     turn/interrupt；通知 item/started、item/completed、turn/completed、error。
 *   - initialize params {clientInfo:{name,version}}，response 必含 userAgent。
 *   - thread/start {cwd,...} → {thread:{threadId,...}}；turn/start {threadId,input:[...]}。
 *   - item/* 通知携带 item.type（agentMessage / reasoning / commandExecution / fileChange /
 *     mcpToolCall / webSearch / error 等）。
 * 正交意图：
 *   [1] 以运行时未知收窄消费协议帧；只依赖上述已验证方法/字段，不复制 Rust 类型。
 *   [2] thread/turn/item 私有模型折叠为规范 HarnessAgentEvent。
 *   [3] 进程提前退出 / error 通知 → 类型化失败（disconnect / UNAVAILABLE）。
 * 妥协声明：默认 stdio 启动 `codex app-server`；Unix socket 代理模式（proxy 子命令）
 *   需要共享 daemon 生命周期，本期不启用，只保留 commandSpec 显式覆盖入口。
 */
import type { AgentItemKind, HarnessCapabilities } from "../../shared/contracts/agent-steward.js";
import { DomainError } from "../domain-error.js";
import { HarnessProcessLostError } from "./harness-adapter.js";
import type { HarnessAdapter, HarnessRunResult } from "./harness-adapter.js";
import {
  StdioJsonRpcClient,
  defaultStdioSpawn,
  parseCommandSpec,
  type JsonRpcHandlers,
  type StdioSpawner,
} from "./jsonrpc-stdio.js";

/** Codex adapter 显式配置。 */
export interface CodexAdapterOptions {
  /** 覆盖启动命令（默认 "codex app-server"）。 */
  commandSpec?: string;
  /** 测试注入 spawn。 */
  spawn?: StdioSpawner;
  /** handshake/请求超时。 */
  timeoutMs?: number;
}

/** 已验证的 thread item.type → 规范化 item 投影（未知类型折叠为 other）。 */
const ITEM_TYPE_PROJECTION: Record<string, AgentItemKind> = {
  agentMessage: "agent-message",
  reasoning: "reasoning",
  commandExecution: "command",
  fileChange: "file-change",
  mcpToolCall: "tool-call",
  webSearch: "web-search",
  error: "error",
};

/** 安全读取嵌套字符串字段的辅助。 */
function readString(source: unknown, key: string): string | undefined {
  if (typeof source !== "object" || source === null) return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

/** 从 initialize 响应提取版本证据（userAgent 为必回字段）。 */
function extractVersion(result: unknown): string | null {
  const userAgent = readString(result, "userAgent");
  return userAgent && userAgent.length > 0 ? userAgent : null;
}

/** 从 thread/start 响应提取 threadId（thread.threadId 为字符串）。 */
function extractThreadId(result: unknown): string | null {
  if (typeof result !== "object" || result === null) return null;
  const thread = (result as Record<string, unknown>).thread;
  const threadId = readString(thread, "threadId") ?? readString(thread, "id");
  return threadId ?? null;
}

/** item/started、item/completed 通知 → 规范化事件。 */
function projectItemNotification(
  emit: (event: { kind: "item"; itemKind: AgentItemKind; text?: string }) => void,
  params: unknown,
): void {
  if (typeof params !== "object" || params === null) return;
  const record = params as Record<string, unknown>;
  const item = typeof record.item === "object" && record.item !== null ? record.item : null;
  if (!item) return;
  const itemRecord = item as Record<string, unknown>;
  const itemType = typeof itemRecord.type === "string" ? itemRecord.type : "";
  emit({
    kind: "item",
    itemKind: ITEM_TYPE_PROJECTION[itemType] ?? "other",
    text: readString(itemRecord, "text"),
  });
}

/** 创建 Codex app-server backend adapter（无自动 fallback）。 */
export function createCodexAppServerAdapter(options: CodexAdapterOptions = {}): HarnessAdapter {
  const spawnProc = options.spawn ?? defaultStdioSpawn;
  const timeoutMs = options.timeoutMs ?? 15_000;
  let activeClient: StdioJsonRpcClient | null = null;

  const resolveSpec = (): { command: string; args: string[] } => {
    const spec =
      options.commandSpec ?? process.env.SKILL_CREATOR_STEWARD_CODEX_CMD ?? "codex app-server";
    const parsed = parseCommandSpec(spec);
    if (!parsed) {
      throw new DomainError(
        "UNAVAILABLE",
        "Codex backend command configuration is empty. Set SKILL_CREATOR_STEWARD_CODEX_CMD.",
      );
    }
    return parsed;
  };

  /** spawn + initialize；成功返回存活 client 与版本证据。 */
  const startAndInitialize = async (
    cwd: string,
    handlers: JsonRpcHandlers = {},
  ): Promise<{ client: StdioJsonRpcClient; version: string }> => {
    const spec = resolveSpec();
    let proc;
    try {
      proc = spawnProc(spec.command, spec.args, { cwd });
    } catch (error) {
      throw new DomainError(
        "UNAVAILABLE",
        `Codex backend failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const controller = new AbortController();
    const client = new StdioJsonRpcClient(proc, controller.signal, handlers);
    try {
      const result = await client.request(
        "initialize",
        { clientInfo: { name: "skill-creator-steward", version: "1" } },
        timeoutMs,
      );
      const version = extractVersion(result);
      if (!version) {
        await client.kill();
        throw new DomainError("UNAVAILABLE", "Codex backend handshake did not report a userAgent.");
      }
      return { client, version };
    } catch (error) {
      await client.kill();
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        "UNAVAILABLE",
        `Codex backend handshake failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      // 成功路径不 abort：client 由调用方（run finally / handshake）负责 kill。
    }
  };

  return {
    backendId: "codex",
    async handshake(): Promise<HarnessCapabilities> {
      const { client, version } = await startAndInitialize(process.cwd());
      await client.kill();
      return {
        backendId: "codex",
        version,
        streamingEvents: true,
        cancellation: true,
        // 由实际 handler/restriction 决定（4.9）：run 的 onRequest 对全部授权类
        // server request 统一 respondError 拒绝——用户永远不会收到可裁决的
        // permission request，capability 不得宣称 true。
        permissionRequests: false,
        executionRoot: "isolated",
      };
    },
    async run(prompt, sink, signal): Promise<HarnessRunResult> {
      const finalMessage = { text: "" };
      let turnCompleted = false;
      const handlers: JsonRpcHandlers = {
        onNotification: (method, params) => {
          switch (method) {
            case "item/started":
            case "item/completed": {
              projectItemNotification((event) => {
                sink.emit(event);
                if (event.itemKind === "agent-message" && event.text) {
                  finalMessage.text = event.text;
                }
              }, params);
              return;
            }
            case "item/agentMessage/delta": {
              // 只累计增量到 finalMessage 的尾缀缓冲，不逐帧上报（事件流有界）。
              if (typeof params === "object" && params !== null) {
                const delta = readString(params, "delta");
                if (typeof delta === "string") finalMessage.text += delta;
              }
              return;
            }
            case "turn/completed":
              turnCompleted = true;
              return;
            case "error": {
              const message =
                (typeof params === "object" && params !== null
                  ? readString((params as Record<string, unknown>).error, "message")
                  : undefined) ?? "Codex reported a turn error.";
              sink.emit({ kind: "item", itemKind: "error", text: message });
              turnCompleted = true;
              return;
            }
            default:
              return;
          }
        },
        // codex 的授权类 server request（approval）本期统一拒绝：
        // steward 语义下 agent 不需要运行时越权；推荐一律走 Manager 审批。
        onRequest: (request) => {
          request.respondError(-32001, "Steward runs do not grant runtime approvals.");
        },
      };
      const { client } = await startAndInitialize(prompt.executionRoot, handlers);
      activeClient = client;
      // run 取消信号必须级联到子进程：abort → 有界 kill。
      const onAbort = (): void => {
        void client.kill();
      };
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        const threadResult = await client.request(
          "thread/start",
          { cwd: prompt.executionRoot },
          timeoutMs,
        );
        const threadId = extractThreadId(threadResult);
        if (!threadId) {
          throw new DomainError("UNAVAILABLE", "Codex backend did not return a thread id.");
        }
        const promptText = [
          prompt.objective,
          prompt.outputContract,
          `Skills snapshot manifest: ${prompt.skills.length} entries under skills/.`,
          `Findings: ${JSON.stringify(prompt.findings)}`,
        ].join("\n\n");
        // turn/start 响应在 turn 结束后返回；期间 item/turn 通知经 handler 流入。
        await client.request(
          "turn/start",
          {
            threadId,
            input: [{ type: "text", text: promptText }],
          },
          Math.max(timeoutMs, 300_000),
        );
        if (!turnCompleted) {
          throw new HarnessProcessLostError("Codex turn ended without a completion notification.");
        }
        signal.throwIfAborted();
        return { recommendations: [], finalMessage: finalMessage.text };
      } catch (error) {
        if (error instanceof HarnessProcessLostError) throw error;
        if (error instanceof DomainError) throw error;
        if (signal.aborted) throw error;
        throw new DomainError(
          "UNAVAILABLE",
          `Codex backend run failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        signal.removeEventListener("abort", onAbort);
        await client.kill();
        activeClient = null;
      }
    },
    async dispose() {
      await activeClient?.kill();
      activeClient = null;
    },
  };
}
