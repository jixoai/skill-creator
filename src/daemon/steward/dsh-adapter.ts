/**
 * 用户原始需求 [2026-09-06]（openspec agent-steward task 1.5）：「实现 DSH backend
 * adapter：固定版本、ACP/profile capability matrix、显式配置、缺失或 handshake 失败
 * typed unavailable。」（docs/research/2026-09-05：官方 `@deepseek-ai/dsh-acp` 为
 * automation-only ACP server；本仓 dsh CLI 本体是 profile booter，不含 ACP 入口。）
 * 正交意图：
 *   [1] 显式配置解析：命令只能来自 env 显式指定（默认 dsh-acp），不做任何自动发现。
 *   [2] capability handshake：spawn + initialize + 固定 clientInfo 版本；任何缺失、
 *       spawn 失败、超时、协议不识别都折叠为 typed UNAVAILABLE，不 fallback。
 *   [3] run 映射：ACP session/new + session/prompt 的 sessionUpdate 通知折叠为
 *       规范化事件；最终 agent message 中的 JSON 推荐经上层 safeParse。
 * 妥协声明：DSH 无公开稳定 schema，帧解析只做未知收窄 + 已知方法名分派；
 *   协议演进以 handshake 失败暴露，不在 adapter 内做版本兼容层。
 */
import { DomainError } from "../domain-error.js";
import type { HarnessCapabilities } from "../../shared/contracts/agent-steward.js";
import type { HarnessAdapter, HarnessEventSink, HarnessRunResult } from "./harness-adapter.js";
import { HarnessProcessLostError } from "./harness-adapter.js";
import {
  StdioJsonRpcClient,
  defaultStdioSpawn,
  parseCommandSpec,
  type JsonRpcHandlers,
  type StdioSpawner,
} from "./jsonrpc-stdio.js";

/** 本 adapter 固定声明的 ACP client 版本（handshake 携带）。 */
const DSH_CLIENT_INFO = { name: "skill-creator-steward", version: "1" } as const;

/** DSH adapter 显式配置。 */
export interface DshAdapterOptions {
  /** 覆盖 ACP server 命令（支持引号参数）；默认取 env，再退到 dsh-acp。 */
  commandSpec?: string;
  /** 测试注入 spawn。 */
  spawn?: StdioSpawner;
  /** handshake/请求超时。 */
  timeoutMs?: number;
}

/** 解析显式命令配置：options > env > 默认二进制名。 */
function resolveCommandSpec(options: DshAdapterOptions): { command: string; args: string[] } {
  const spec = options.commandSpec ?? process.env.SKILL_CREATOR_STEWARD_DSH_ACP_CMD ?? "dsh-acp";
  const parsed = parseCommandSpec(spec);
  if (!parsed) {
    throw new DomainError(
      "UNAVAILABLE",
      "DSH backend command configuration is empty. Set SKILL_CREATOR_STEWARD_DSH_ACP_CMD.",
    );
  }
  return parsed;
}

/** 从 initialize 响应（unknown）安全提取版本证据。 */
function extractVersion(result: unknown): string | null {
  if (typeof result !== "object" || result === null) return null;
  const record = result as Record<string, unknown>;
  const version =
    typeof record.protocolVersion === "string"
      ? record.protocolVersion
      : typeof record.serverInfo === "object" && record.serverInfo !== null
        ? (record.serverInfo as Record<string, unknown>).version
        : undefined;
  return typeof version === "string" && version.length > 0 ? version : null;
}

/** ACP sessionUpdate 通知 → 规范化 item 投影。 */
function projectSessionUpdate(sink: HarnessEventSink, params: unknown): void {
  if (typeof params !== "object" || params === null) return;
  const record = params as Record<string, unknown>;
  const update = typeof record.update === "object" && record.update !== null ? record.update : null;
  if (!update) return;
  const updateRecord = update as Record<string, unknown>;
  switch (updateRecord.kind) {
    case "agent_message_chunk": {
      const content = updateRecord.content;
      if (
        typeof content === "object" &&
        content !== null &&
        typeof (content as Record<string, unknown>).text === "string"
      ) {
        sink.emit({ kind: "message", text: (content as Record<string, unknown>).text as string });
      }
      return;
    }
    case "tool_call":
    case "tool_call_update":
      sink.emit({
        kind: "item",
        itemKind: "tool-call",
        text: typeof updateRecord.title === "string" ? updateRecord.title : "",
      });
      return;
    case "plan":
      sink.emit({ kind: "item", itemKind: "reasoning" });
      return;
    default:
      return;
  }
}

/** 创建 DSH backend adapter（一次 run 一个 ACP session；无自动 fallback）。 */
export function createDshHarnessAdapter(options: DshAdapterOptions = {}): HarnessAdapter {
  const spawnProc = options.spawn ?? defaultStdioSpawn;
  const timeoutMs = options.timeoutMs ?? 15_000;
  let activeClient: StdioJsonRpcClient | null = null;

  /** 启动一个 ACP server 子进程并完成 initialize handshake。 */
  const startSession = async (
    cwd: string,
    handlers: JsonRpcHandlers = {},
  ): Promise<{ client: StdioJsonRpcClient; version: string }> => {
    const spec = resolveCommandSpec(options);
    let proc;
    try {
      proc = spawnProc(spec.command, spec.args, { cwd });
    } catch (error) {
      throw new DomainError(
        "UNAVAILABLE",
        `DSH backend failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const controller = new AbortController();
    const client = new StdioJsonRpcClient(proc, controller.signal, handlers);
    try {
      const result = await client.request("initialize", { clientInfo: DSH_CLIENT_INFO }, timeoutMs);
      const version = extractVersion(result);
      if (!version) {
        await client.kill();
        throw new DomainError(
          "UNAVAILABLE",
          "DSH backend handshake did not report a recognizable protocol version.",
        );
      }
      return { client, version };
    } catch (error) {
      await client.kill();
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        "UNAVAILABLE",
        `DSH backend handshake failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      // 成功路径不 abort：client 由调用方（run finally / handshake）负责 kill。
    }
  };

  return {
    backendId: "dsh",
    async handshake(): Promise<HarnessCapabilities> {
      const { client, version } = await startSession(process.cwd());
      await client.kill();
      return {
        backendId: "dsh",
        version,
        streamingEvents: true,
        cancellation: true,
        permissionRequests: true,
        executionRoot: "isolated",
      };
    },
    async run(prompt, sink, signal): Promise<HarnessRunResult> {
      const finalMessage = { text: "" };
      const handlers: JsonRpcHandlers = {
        onNotification: (method, params) => {
          if (method !== "session/update") return;
          if (typeof params === "object" && params !== null) {
            const update = (params as Record<string, unknown>).update;
            if (
              typeof update === "object" &&
              update !== null &&
              (update as Record<string, unknown>).kind === "agent_message_chunk"
            ) {
              const content = (update as Record<string, unknown>).content;
              if (
                typeof content === "object" &&
                content !== null &&
                typeof (content as Record<string, unknown>).text === "string"
              ) {
                finalMessage.text += (content as Record<string, unknown>).text as string;
              }
            }
          }
          projectSessionUpdate(sink, params);
        },
      };
      const { client } = await startSession(prompt.executionRoot, handlers);
      activeClient = client;
      // run 取消信号必须级联到子进程：abort → 有界 kill。
      const onAbort = (): void => {
        void client.kill();
      };
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        // 会话内提示：agent 在 executionRoot 中工作，最终消息需携带推荐 JSON。
        const promptText = [
          prompt.objective,
          prompt.outputContract,
          `Skills snapshot manifest: ${prompt.skills.length} entries under skills/.`,
          `Findings: ${JSON.stringify(prompt.findings)}`,
        ].join("\n\n");
        const sessionResult = await client.request(
          "session/new",
          { cwd: prompt.executionRoot, mcpServers: [] },
          timeoutMs,
        );
        const sessionId =
          typeof sessionResult === "object" && sessionResult !== null
            ? (sessionResult as Record<string, unknown>).sessionId
            : undefined;
        if (typeof sessionId !== "string") {
          throw new DomainError("UNAVAILABLE", "DSH backend did not return a session id.");
        }
        // ACP 语义：session/prompt 的响应在 turn 结束后返回；期间事件经 handler 流入。
        await client.request(
          "session/prompt",
          { sessionId, prompt: promptText },
          Math.max(timeoutMs, 120_000),
        );
        return { recommendations: [], finalMessage: finalMessage.text };
      } catch (error) {
        if (error instanceof HarnessProcessLostError) throw error;
        if (error instanceof DomainError) throw error;
        if (signal.aborted) throw error;
        throw new DomainError(
          "UNAVAILABLE",
          `DSH backend run failed: ${error instanceof Error ? error.message : String(error)}`,
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
