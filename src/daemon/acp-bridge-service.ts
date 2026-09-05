/**
 * 原始需求 [2026-07-27]：「spawn agent CLI 子进程（stdio ACP）↔ 重新暴露成浏览器可连的 WebSocket ACP 端点……agent 的 writeTextFile / readTextFile 请求路由穿过 Skill Creator 既有的 containment + workspace root 安全模型。」
 * 正交意图：
 *   [1] 子进程池：一个 Creator AI 会话 spawn 一个独立 agent 子进程，sessionId 由 daemon 生成并持有全部 session 状态。
 *   [2] stdio↔WS 帧桥：浏览器 WS 帧 → agent stdin；agent stdout 帧 → 浏览器 WS，帧顺序与 agent 产出一致。
 *   [3] 安全门：拦截 agent 的 fs/read_text_file、fs/write_text_file 请求，由 daemon 代为执行（containment + 原子写），agent 永不获得原始文件句柄。
 *   [4] 生命周期：session.close / daemon stop 有界杀光子进程；异常退出广播 exited 事件。
 * 妥协声明：daemon 是「帧桥 + 方法过滤」，不是 ACP 参与方——不解析 session 内容语义，仅在 fs 方法上做 containment；四项共享同一组子进程句柄与 stdio pipe，必须留在单一服务模块。
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { WebSocket as WsWebSocket } from "ws";
import {
  AcpSessionIdSchema,
  type AcpAgentId,
  type AcpSessionExitedEvent,
  type AcpSessionId,
  type AcpSessionOpenInput,
  type AcpSessionOpenResult,
} from "../shared/contracts/acp.js";
import type { WorkspaceProviderTarget } from "../shared/contracts/workspaces.js";
import { DomainError } from "./domain-error.js";
import { assertPathInside, atomicWriteUtf8 } from "./path-safety.js";
import type { WorkspaceRegistry } from "./workspace-registry/index.js";
import { createAcpAgentDiscovery, type AcpAgentDiscovery } from "./acp-agent-discovery.js";

/** daemon 拥有的 agent 子进程会话条目。 */
interface AcpSessionEntry {
  /** agent 子进程。 */
  proc: ChildProcess;
  /** 会话锁定的工作区根（cwd），整个生命周期不变。 */
  root: string;
  /** 选定的 agent 标识。 */
  agentId: AcpAgentId;
  /** 当前连入的浏览器 WS（同一 sessionId 同时只允许一个；重连先踢旧的）。 */
  ws: WsWebSocket | null;
  /** stdout 行缓冲（ACP 为换行分隔 JSON）。 */
  stdoutBuffer: string;
  /** stderr 累积（诊断/日志，不参与协议）。 */
  stderrBuffer: string;
  /** 标记是否已主动关闭（避免异常退出再触发 exited 事件）。 */
  closing: boolean;
}

/** spawn 适配器；测试可注入 mock 子进程。 */
export type AgentSpawner = (
  binary: string,
  args: string[],
  options: { cwd: string },
) => ChildProcess;

/** 桥接服务依赖注入。 */
export interface AcpBridgeServiceOptions {
  /** agent 探测器；默认创建一个 daemon 生命周期内的实例。 */
  discovery?: AcpAgentDiscovery;
  /** 子进程 spawn 适配器；默认走真实 child_process.spawn。 */
  spawn?: AgentSpawner;
}

/** daemon 停止时给 agent 子进程的有界宽限期。 */
const STOP_GRACE_MS = 2_000;

/** 生成不透明 sessionId（`acp_` + 24 hex）。 */
function generateSessionId(): AcpSessionId {
  return AcpSessionIdSchema.parse(`acp_${randomBytes(12).toString("hex")}`);
}

/** ACP 协议里由 agent 调用、需 daemon 拦截代为执行的 client-side 方法名。 */
const GATED_FS_METHODS = new Set([
  "fs/read_text_file",
  "fs/write_text_file",
  /** 兼容 v2 草案的命名（暂不解析语义，仅占位以便未来扩展）。 */
  "client/readTextFile",
  "client/writeTextFile",
]);

/** JSON-RPC 帧的最小可消费形状（未知字段忽略）。 */
interface JsonRpcFrame {
  jsonrpc?: unknown;
  id?: string | number | null;
  method?: unknown;
  params?: unknown;
}

/** 把一个值当作 JSON-RPC 帧安全收窄；非法结构返回 null。 */
function parseFrame(raw: string): JsonRpcFrame | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const frame = value as Record<string, unknown>;
  if (typeof frame.method !== "string" && !("result" in frame) && !("error" in frame)) {
    return null;
  }
  return frame as unknown as JsonRpcFrame;
}

/** 把 fs 请求的 params 安全解析为 { sessionId, path, content? }。 */
function parseFsParams(params: unknown): {
  sessionId?: string;
  path?: string;
  content?: string;
} {
  if (typeof params !== "object" || params === null) return {};
  const record = params as Record<string, unknown>;
  return {
    sessionId: typeof record.sessionId === "string" ? record.sessionId : undefined,
    path: typeof record.path === "string" ? record.path : undefined,
    content: typeof record.content === "string" ? record.content : undefined,
  };
}

/** 构造一个 JSON-RPC error 响应帧（回给 agent，告知拦截结果）。 */
function errorResponse(
  id: string | number | null | undefined,
  code: number,
  message: string,
): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message },
  });
}

/** 构造一个 JSON-RPC result 响应帧（回给 agent）。 */
function resultResponse(id: string | number | null | undefined, result: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id: id ?? null, result });
}

/**
 * 创建一个 daemon-owned ACP 桥接服务。
 *
 * - `agents()`：返回 daemon 生命周期缓存的 agent 列表。
 * - `openSession()`：spawn agent 子进程（cwd = workspace root），注册到池，返回 sessionId。
 * - `closeSession()`：SIGTERM → 有界宽限 → SIGKILL，从池清理（幂等）。
 * - `attachWebSocket()`：把浏览器 WS 接入指定 session 的双向帧桥（含安全门）。
 * - `dispose()`：daemon stop 时有界杀光全部子进程。
 */
export function createAcpBridgeService(
  workspaces: WorkspaceRegistry,
  options: AcpBridgeServiceOptions = {},
): AcpBridgeService {
  const discovery = options.discovery ?? createAcpAgentDiscovery();
  const spawnProc = options.spawn ?? defaultSpawn;
  const pool = new Map<AcpSessionId, AcpSessionEntry>();
  const exitedListeners = new Set<(event: AcpSessionExitedEvent) => void>();
  let disposing = false;

  /** 解析 workspace target → 锁定的 agent cwd（root）。 */
  const resolveRoot = (target: WorkspaceProviderTarget): string => {
    const scope = workspaces.resolveWritable(target);
    return scope.directory;
  };

  /** 注册子进程退出处理：异常退出广播 exited 事件并清理池。 */
  const wireProcessExit = (sessionId: AcpSessionId): void => {
    const entry = pool.get(sessionId);
    if (!entry?.proc) return;
    entry.proc.once("exit", (code, signal) => {
      const active = pool.get(sessionId);
      if (!active) return;
      // 主动关闭路径已先置 closing=true 并自行清理；这里只处理异常退出。
      if (active.closing) return;
      pool.delete(sessionId);
      detachWebSocket(active, 1011, "agent process exited");
      const event: AcpSessionExitedEvent = {
        type: "exited",
        sessionId,
        code: code ?? (signal ? null : (code ?? null)),
      };
      for (const listener of exitedListeners) {
        try {
          listener(event);
        } catch {
          // 监听者异常不得影响其它会话。
        }
      }
    });
  };

  const openSession = async (input: AcpSessionOpenInput): Promise<AcpSessionOpenResult> => {
    if (disposing) {
      throw new DomainError("UNAVAILABLE", "ACP bridge is shutting down.");
    }
    // 确保探测器已缓存（首次 openSession 触发探测，后续命中缓存）。
    await discovery.list();
    const agent = discovery.lookup(input.agentId);
    if (!agent || !agent.available || !agent.binaryPath) {
      throw new DomainError("UNAVAILABLE", `Agent is not available: ${input.agentId}`);
    }
    const root = resolveRoot(input.target);
    let proc: ChildProcess;
    try {
      proc = spawnProc(agent.binaryPath, [agent.acpFlag], { cwd: root });
    } catch (error) {
      throw new DomainError(
        "UNAVAILABLE",
        `Failed to spawn agent ${input.agentId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    // spawn 返回但立即出错（ENOENT 等）：当作不可用。
    proc.once("error", () => {
      const sessionId = findSessionIdByProc(proc);
      if (!sessionId) return;
      const entry = pool.get(sessionId);
      if (entry) {
        entry.closing = true;
        pool.delete(sessionId);
        detachWebSocket(entry, 1011, "agent failed to start");
      }
    });
    const sessionId = generateSessionId();
    const entry: AcpSessionEntry = {
      proc,
      root,
      agentId: input.agentId,
      ws: null,
      stdoutBuffer: "",
      stderrBuffer: "",
      closing: false,
    };
    pool.set(sessionId, entry);
    wireProcessExit(sessionId);
    wireProcessOutput(sessionId);
    const pid = proc.pid ?? 0;
    if (pid <= 0) {
      // 极少数 spawn 未分配 pid：清理并报不可用。
      entry.closing = true;
      pool.delete(sessionId);
      throw new DomainError("UNAVAILABLE", `Agent ${input.agentId} did not acquire a pid.`);
    }
    return { sessionId, pid };
  };

  /** 反向查找 proc → sessionId。 */
  const findSessionIdByProc = (proc: ChildProcess): AcpSessionId | undefined => {
    for (const [id, entry] of pool) if (entry.proc === proc) return id;
    return undefined;
  };

  /** 接管 stdout：按行解析 JSON-RPC 帧，决定转发给浏览器或由安全门拦截。 */
  const wireProcessOutput = (sessionId: AcpSessionId): void => {
    const entry = pool.get(sessionId);
    if (!entry?.proc?.stdout) return;
    entry.proc.stdout.setEncoding("utf8");
    entry.proc.stdout.on("data", (chunk: string) => {
      const active = pool.get(sessionId);
      if (!active) return;
      active.stdoutBuffer += chunk;
      const lines = active.stdoutBuffer.split("\n");
      // 最后一段可能不完整，保留在缓冲里。
      active.stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        handleAgentFrame(active, trimmed);
      }
    });
  };

  /**
   * 处理 agent → 浏览器方向的一帧：
   * - 若是 fs/read_text_file | fs/write_text_file 请求（client-side method），由安全门代为执行并直接回响应给 agent；不转发给浏览器。
   * - 其余帧（sessionUpdate、prompt 响应、requestPermission 等）原样转发给浏览器 WS。
   */
  const handleAgentFrame = (entry: AcpSessionEntry, rawFrame: string): void => {
    const frame = parseFrame(rawFrame);
    if (!frame) return; // 非 JSON-RPC 帧：忽略，不污染协议流。
    const method = frame.method;
    if (typeof method === "string" && GATED_FS_METHODS.has(method)) {
      void serviceFsRequest(entry, frame).catch(() => {
        // serviceFsRequest 内部已处理错误响应；此处仅兜底防 unhandled。
      });
      return;
    }
    forwardToWebSocket(entry, rawFrame);
  };

  /**
   * 安全门：代为执行 agent 的 fs 请求。
   * - 路径 resolve 到 session.root，过 assertPathInside；越界回错误响应，session 不被终止。
   * - read: fs.readFile(utf8)；write: atomicWriteUtf8（temp 0600 + rename）。
   */
  const serviceFsRequest = async (entry: AcpSessionEntry, frame: JsonRpcFrame): Promise<void> => {
    const method = frame.method;
    const { path: rawPath, content } = parseFsParams(frame.params);
    if (rawPath === undefined) {
      writeAgentResponse(entry, errorResponse(frame.id, -32602, "Missing path."));
      return;
    }
    let resolved: string;
    try {
      resolved = path.resolve(entry.root, rawPath);
      assertPathInside(entry.root, resolved);
    } catch {
      writeAgentResponse(
        entry,
        errorResponse(
          frame.id,
          /* RequestDenied */ -32001,
          "Path escapes the session workspace root.",
        ),
      );
      return;
    }
    try {
      if (method === "fs/write_text_file" || method === "client/writeTextFile") {
        if (content === undefined) {
          writeAgentResponse(entry, errorResponse(frame.id, -32602, "Missing content."));
          return;
        }
        atomicWriteUtf8(resolved, content);
        writeAgentResponse(entry, resultResponse(frame.id, {}));
        return;
      }
      const data = await fs.readFile(resolved, "utf8");
      writeAgentResponse(entry, resultResponse(frame.id, { content: data }));
    } catch (error) {
      writeAgentResponse(
        entry,
        errorResponse(
          frame.id,
          -32603,
          `File operation failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  };

  /** 把响应帧写入 agent stdin。 */
  const writeAgentResponse = (entry: AcpSessionEntry, frame: string): void => {
    if (entry.proc.stdin?.destroyed) return;
    entry.proc.stdin?.write(`${frame}\n`);
  };

  /** 转发一帧到浏览器 WS（若已连接且开启）。 */
  const forwardToWebSocket = (entry: AcpSessionEntry, frame: string): void => {
    if (entry.ws && entry.ws.readyState === entry.ws.OPEN) {
      entry.ws.send(frame);
    }
  };

  /** 把浏览器 WS 接入指定 session：踢旧连接、双向 pipe、安全门已在 agent→浏览器方向生效。 */
  const attachWebSocket = (sessionId: AcpSessionId, ws: WsWebSocket): void => {
    const entry = pool.get(sessionId);
    if (!entry) {
      ws.close(1008, "Unknown ACP session.");
      return;
    }
    if (entry.ws && entry.ws.readyState !== entry.ws.CLOSED) {
      // 同 sessionId 重连先踢旧连接（agent 子进程不重启）。
      detachWebSocket(entry, 1000, "Replaced by a new connection.");
    }
    entry.ws = ws;
    ws.on("message", (data: unknown) => {
      const active = pool.get(sessionId);
      if (!active || active.ws !== ws) return;
      const text = typeof data === "string" ? data : (data as Buffer).toString("utf8");
      // 浏览器 → agent 方向：session/new、session/prompt、session/cancel 等。
      // 这些是 agent-side 方法（agent 处理），daemon 不拦截，直接写入 stdin。
      // 注意：浏览器不会发 fs/read_text_file（那是 client-side，由 agent 发起），
      // 即便误发也不在 GATED 集合外做处理——原样转发由 agent 决定。
      if (active.proc.stdin?.destroyed) return;
      active.proc.stdin?.write(`${text}\n`);
    });
    ws.once("close", () => {
      const active = pool.get(sessionId);
      if (active && active.ws === ws) active.ws = null;
    });
    ws.once("error", () => {
      const active = pool.get(sessionId);
      if (active && active.ws === ws) active.ws = null;
    });
  };

  /** 关闭一个浏览器 WS（不杀 agent 子进程）。 */
  const detachWebSocket = (entry: AcpSessionEntry, code: number, reason: string): void => {
    const ws = entry.ws;
    entry.ws = null;
    if (ws && ws.readyState !== ws.CLOSED) {
      try {
        ws.close(code, reason);
      } catch {
        // 忽略重复关闭。
      }
    }
  };

  const closeSession = async (sessionId: AcpSessionId): Promise<void> => {
    const entry = pool.get(sessionId);
    if (!entry) return; // 幂等：session 不存在直接返回 ok。
    entry.closing = true;
    pool.delete(sessionId);
    detachWebSocket(entry, 1000, "Session closed.");
    await killProcess(entry.proc);
  };

  /** 有界杀子进程：SIGTERM → grace → SIGKILL。 */
  const killProcess = (proc: ChildProcess): Promise<void> => {
    return new Promise<void>((resolve) => {
      if (proc.exitCode !== null || proc.signalCode) {
        resolve();
        return;
      }
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      proc.once("exit", finish);
      try {
        proc.kill("SIGTERM");
      } catch {
        finish();
        return;
      }
      const timer = setTimeout(() => {
        if (proc.exitCode === null && !proc.signalCode) {
          try {
            proc.kill("SIGKILL");
          } catch {
            // 进程可能在此期间已退出。
          }
        }
        finish();
      }, STOP_GRACE_MS);
      timer.unref();
    });
  };

  const dispose = async (): Promise<void> => {
    disposing = true;
    const entries = Array.from(pool.values());
    pool.clear();
    await Promise.all(
      entries.map(async (entry) => {
        entry.closing = true;
        detachWebSocket(entry, 1001, "Daemon shutting down.");
        await killProcess(entry.proc);
      }),
    );
  };

  const onSessionExited = (listener: (event: AcpSessionExitedEvent) => void): (() => void) => {
    exitedListeners.add(listener);
    return () => exitedListeners.delete(listener);
  };

  /** 测试/诊断用：返回当前池中的 sessionId 集合。 */
  const activeSessions = (): AcpSessionId[] => Array.from(pool.keys());

  return {
    agents: () => discovery.list(),
    openSession,
    closeSession,
    attachWebSocket,
    dispose,
    onSessionExited,
    activeSessions,
    hasSession: (id: AcpSessionId) => pool.has(id),
  };
}

/** 默认 spawn：stdio 全 pipe，cwd 由调用方指定。 */
function defaultSpawn(binary: string, args: string[], options: { cwd: string }): ChildProcess {
  return spawn(binary, args, {
    cwd: options.cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/** ACP 桥接服务实例接口。 */
export interface AcpBridgeService {
  /** 返回 daemon 生命周期缓存的 agent 列表。 */
  agents(): Promise<import("../shared/contracts/acp.js").AcpAgentInfo[]>;
  /** spawn agent 子进程并注册到池，返回 opaque sessionId。 */
  openSession(input: AcpSessionOpenInput): Promise<AcpSessionOpenResult>;
  /** 终止指定 session 的 agent 子进程（幂等）。 */
  closeSession(sessionId: AcpSessionId): Promise<void>;
  /** 把浏览器 WS 接入指定 session 的双向帧桥（含安全门）。 */
  attachWebSocket(sessionId: AcpSessionId, ws: WsWebSocket): void;
  /** daemon stop 时有界杀光全部 agent 子进程。 */
  dispose(): Promise<void>;
  /** 订阅 agent 子进程异常退出事件（WS 推送用）。 */
  onSessionExited(listener: (event: AcpSessionExitedEvent) => void): () => void;
  /** 当前池中的 sessionId 集合（诊断用）。 */
  activeSessions(): AcpSessionId[];
  /** 该 sessionId 是否仍在池中（WS upgrade 校验用）。 */
  hasSession(id: AcpSessionId): boolean;
}
