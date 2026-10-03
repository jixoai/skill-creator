/**
 * 人类终端域服务（skills-agent-page task 1.6 daemon 侧）。
 *
 * 用户原始需求 [2026-10-03]（design §4 定稿）：「复刻 openspecui 的 terminal-
 * shell-profiles 归档实现……专用 /ws/terminal 单端点 + typed JSON 协议 + 输出
 * 独立 batcher（2026-07-21『终端输出饿死 Server』必抄）+ 并发 ≤4 + 10k 行环形
 * 缓冲（行+字节双闸）+ stop/idle 有界回收 + 非 sandbox 如实声明。」
 *
 * 正交意图：
 *   [1] daemon-owned PTY 池：node-pty 会话生命周期（create/write/resize/exit/
 *       list/buffer 管理面）+ per-session 单调 seq 环形 scrollback（行数与字节
 *       双上限裁剪）+ write reqId 高水位去重（r4：write 非幂等）。
 *   [2] WS 端点协议执行：每入站帧 safeParse 后分发；非法帧 typed error 回执不
 *       杀终端；sessionId 多路复用；输出经 per-subscription 有界 batcher 泵送
 *       （洪泛不饿死事件循环）；慢客户端 socket 有界（bufferedAmount 闸）。
 *   [3] 生命周期有界：全局 ≤4 活 PTY（超限 typed 拒绝）；idle 30 分钟（无附着
 *       且无输入）自动 exit 回收；dispose 走 SIGHUP → 宽限 → SIGKILL 渐进升级，
 *       不留孤儿进程。
 * 妥协声明：非 sandbox 如实声明——PTY 以 daemon 用户本地权限全权运行，cwd 只是
 *   启动目录；本域不接 agent 工具面（内核收窄面无终端工具），技能 mutation 链
 *   与它无关。退出会话保留缓冲供重连重放，由 idle 超时/容量上限回收。
 */
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import * as pty from "@lydell/node-pty";
import type { WebSocket as WsWebSocket } from "ws";
import {
  TERMINAL_BUFFER_WINDOW_MAX_ENTRIES,
  TerminalClientMessageSchema,
  type TerminalBufferEntry,
  type TerminalClientMessage,
  type TerminalErrorCode,
  type TerminalServerMessage,
  type TerminalSessionInfo,
} from "./protocol.js";
import { TerminalOutputBatcher } from "./output-batcher.js";
import { TerminalInputWriter } from "./input-writer.js";

/** daemon 全局并发活 PTY 上限（design §4 SHALL：超限 create typed 拒绝）。 */
export const TERMINAL_MAX_LIVE = 4;
/** scrollback 行上限（10k 行环形）。 */
export const TERMINAL_MAX_BUFFER_LINES = 10_000;
/** scrollback 字节上限（与 openspecui pty-manager 双闸同值）。 */
export const TERMINAL_MAX_BUFFER_BYTES = 2 * 1024 * 1024;
/** 注册表总上限（含已退会话——防重放面无界；FIFO 逐出已退记录）。 */
const TERMINAL_REGISTRY_CAP = 32;
/** idle 回收（无 WS 附着且无输入）——30 分钟。 */
export const TERMINAL_IDLE_MS = 30 * 60 * 1000;
/** 单 socket 排队输出闸（慢客户端隔离；超过即 terminate 该连接）。 */
const MAX_SOCKET_BUFFERED_BYTES = 256 * 1024;
/** dispose 渐进升级的默认宽限。 */
const DEFAULT_DISPOSE_GRACE_MS = 1_500;

/** 终端域 typed 失败（code = 协议闭集；不伪装成功）。 */
export class TerminalServiceError extends Error {
  constructor(
    readonly code: TerminalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TerminalServiceError";
  }
}

/** 一个 WS 附着在某会话上的订阅（独立 batcher + 有界 sender）。 */
export interface TerminalSessionSubscriber {
  /** 输出块投递（seq 原子；内部经有界 batcher）。 */
  output(entry: TerminalBufferEntry): void;
  /** 生命周期通知（exit 等；在残余输出之后发出）。 */
  notify(message: TerminalServerMessage): void;
  /** 订阅退役（socket 关闭/替换/detach）。 */
  close(): void;
}

/** 管理面创建选项。 */
export interface TerminalCreateOptions {
  cols?: number;
  rows?: number;
  cwd?: string;
  shell?: string;
}

/** 终端服务构造选项（测试可收紧时限/上限）。 */
export interface TerminalServiceOptions {
  maxLive?: number;
  maxBufferLines?: number;
  maxBufferBytes?: number;
  idleMs?: number;
  defaultCwd?: string;
  /** dispose 渐进升级宽限（SIGHUP → 宽限 → SIGKILL）。 */
  disposeGraceMs?: number;
}

/** 平台默认 shell（openspecui 同款探测：$SHELL / ComSpec / /bin/sh）。 */
export function defaultShell(env: NodeJS.ProcessEnv): string {
  if (process.platform === "win32") return env.ComSpec?.trim() || "cmd.exe";
  return env.SHELL?.trim() || "/bin/sh";
}

/** 构造终端域服务。 */
export function createTerminalService(options: TerminalServiceOptions = {}) {
  const maxLive = options.maxLive ?? TERMINAL_MAX_LIVE;
  const maxBufferLines = options.maxBufferLines ?? TERMINAL_MAX_BUFFER_LINES;
  const maxBufferBytes = options.maxBufferBytes ?? TERMINAL_MAX_BUFFER_BYTES;
  const idleMs = options.idleMs ?? TERMINAL_IDLE_MS;
  const defaultCwd = options.defaultCwd ?? os.homedir();
  const disposeGraceMs = options.disposeGraceMs ?? DEFAULT_DISPOSE_GRACE_MS;

  interface SessionRecord {
    sessionId: string;
    process: pty.IPty | null;
    pid: number | null;
    exited: boolean;
    exitCode: number | null;
    createdAt: string;
    cols: number;
    rows: number;
    cwd: string;
    shell: string;
    input: TerminalInputWriter | null;
    buffer: TerminalBufferEntry[];
    bufferBytes: number;
    bufferLines: number;
    /** 下一个输出 seq（1 起，per-session 单调）。 */
    nextSeq: number;
    /** write reqId 高水位（≤ 视为重试重复）。 */
    writeHighWater: number;
    subscribers: Set<TerminalSessionSubscriber>;
    lastActivityAt: number;
    idleTimer: NodeJS.Timeout | null;
  }

  const sessions = new Map<string, SessionRecord>();

  function aliveCount(): number {
    let count = 0;
    for (const record of sessions.values()) {
      if (!record.exited) count += 1;
    }
    return count;
  }

  function requireRecord(sessionId: string): SessionRecord {
    const record = sessions.get(sessionId);
    if (record === undefined) {
      throw new TerminalServiceError(
        "SESSION_NOT_FOUND",
        `terminal session not found: ${sessionId}`,
      );
    }
    return record;
  }

  /** 环形缓冲追加：行数与字节双闸裁剪（末条永保——单块超限先切尾）。 */
  function appendBuffer(record: SessionRecord, entry: TerminalBufferEntry): void {
    let data = entry.data;
    if (Buffer.byteLength(data) > maxBufferBytes) {
      const encoded = Buffer.from(data);
      data = encoded.subarray(encoded.byteLength - maxBufferBytes).toString("utf8");
    }
    record.buffer.push({ seq: entry.seq, data });
    record.bufferBytes += Buffer.byteLength(data);
    record.bufferLines += countNewlines(data);
    while (record.buffer.length > 1) {
      const overLines = record.bufferLines > maxBufferLines;
      const overBytes = record.bufferBytes > maxBufferBytes;
      if (!overLines && !overBytes) break;
      const head = record.buffer[0]!;
      record.buffer.shift();
      record.bufferBytes -= Buffer.byteLength(head.data);
      record.bufferLines -= countNewlines(head.data);
    }
  }

  function countNewlines(data: string): number {
    let count = 0;
    for (let index = data.indexOf("\n"); index !== -1; index = data.indexOf("\n", index + 1)) {
      count += 1;
    }
    return count;
  }

  /** 服务端当前缓冲首行 seq（空缓冲 = 下一 seq——缺口对账基准）。 */
  function firstBufferedSeq(record: SessionRecord): number {
    return record.buffer[0]?.seq ?? record.nextSeq;
  }

  function rescheduleIdle(record: SessionRecord): void {
    if (record.idleTimer !== null) clearTimeout(record.idleTimer);
    record.idleTimer = setTimeout(() => {
      record.idleTimer = null;
      // 附着期间不回收（活动性在 write/attach 刷新）。
      if (record.subscribers.size > 0) {
        record.lastActivityAt = Date.now();
        rescheduleIdle(record);
        return;
      }
      reapSession(record.sessionId, "idle");
    }, idleMs);
    record.idleTimer.unref();
  }

  /** 回收一条会话（杀进程 + 撤订阅 + 出表）；幂等。 */
  function reapSession(sessionId: string, reason: string): void {
    const record = sessions.get(sessionId);
    if (record === undefined) return;
    if (record.idleTimer !== null) {
      clearTimeout(record.idleTimer);
      record.idleTimer = null;
    }
    if (!record.exited) {
      record.exited = true;
      record.exitCode = null;
      killProcess(record, "SIGHUP");
    }
    for (const subscriber of record.subscribers) subscriber.close();
    record.subscribers.clear();
    sessions.delete(sessionId);
    console.log(`[terminal] session ${sessionId} reaped (${reason})`);
  }

  function killProcess(record: SessionRecord, signal: "SIGHUP" | "SIGKILL"): void {
    record.input?.close();
    record.input = null;
    try {
      record.process?.kill(signal);
    } catch {
      // 已退：kill 迟到是常态。
    }
  }

  /** 新建终端会话（管理面；WS 端点与测试共用）。 */
  function createSession(opts: TerminalCreateOptions): {
    sessionId: string;
    replayFrom: number;
    cols: number;
    rows: number;
  } {
    if (aliveCount() >= maxLive) {
      throw new TerminalServiceError(
        "LIMIT_EXCEEDED",
        `terminal live session limit reached (${maxLive}); close a terminal first`,
      );
    }
    const cwd = opts.cwd ?? defaultCwd;
    if (!path.isAbsolute(cwd) || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
      throw new TerminalServiceError(
        "CREATE_FAILED",
        `terminal cwd must be an existing absolute directory: ${cwd}`,
      );
    }
    const shell = opts.shell?.trim() || defaultShell(process.env);
    const cols = opts.cols ?? 80;
    const rows = opts.rows ?? 24;
    // 注册表容量：FIFO 逐出最旧已退记录（活会话受 maxLive 保护，不可能占满）。
    if (sessions.size >= TERMINAL_REGISTRY_CAP) {
      for (const [sessionId, record] of sessions) {
        if (sessions.size < TERMINAL_REGISTRY_CAP) break;
        if (record.exited) reapSession(sessionId, "registry-cap");
      }
    }
    const sessionId = `term-${randomUUID()}`;
    const record: SessionRecord = {
      sessionId,
      process: null,
      pid: null,
      exited: false,
      exitCode: null,
      createdAt: new Date().toISOString(),
      cols,
      rows,
      cwd,
      shell,
      input: null,
      buffer: [],
      bufferBytes: 0,
      bufferLines: 0,
      nextSeq: 1,
      writeHighWater: 0,
      subscribers: new Set(),
      lastActivityAt: Date.now(),
      idleTimer: null,
    };
    let processHandle: pty.IPty;
    try {
      processHandle = pty.spawn(shell, [], {
        name: "xterm-256color",
        cols,
        rows,
        cwd,
        env: { ...process.env, TERM: "xterm-256color" } as Record<string, string>,
      });
    } catch (error) {
      throw new TerminalServiceError(
        "CREATE_FAILED",
        `terminal spawn failed for ${shell}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    record.process = processHandle;
    record.pid = processHandle.pid;
    record.input = new TerminalInputWriter(processHandle, { platform: process.platform });
    processHandle.onData((data) => {
      const entry: TerminalBufferEntry = { seq: record.nextSeq++, data };
      appendBuffer(record, entry);
      for (const subscriber of record.subscribers) subscriber.output(entry);
    });
    processHandle.onExit(({ exitCode }) => {
      record.exited = true;
      record.exitCode = exitCode;
      record.input?.close();
      record.input = null;
      record.process = null;
      // exit 通知排在残余输出之后（订阅 batcher afterFlush 语义）。
      const message: TerminalServerMessage = {
        type: "exit",
        sessionId: record.sessionId,
        exitCode,
      };
      for (const subscriber of record.subscribers) subscriber.notify(message);
      rescheduleIdle(record);
    });
    sessions.set(sessionId, record);
    rescheduleIdle(record);
    return { sessionId, replayFrom: firstBufferedSeq(record), cols, rows };
  }

  /**
   * write：reqId ≤ 高水位 = 网络重试重复——回执 duplicate，不注入 PTY（r4：
   * write 非幂等——追加输入，重送会重复按键）。
   */
  function write(sessionId: string, reqId: number, data: string): "injected" | "duplicate" {
    const record = requireRecord(sessionId);
    if (record.exited) {
      throw new TerminalServiceError(
        "SESSION_EXITED",
        `terminal session already exited: ${sessionId}`,
      );
    }
    if (reqId <= record.writeHighWater) return "duplicate";
    record.writeHighWater = reqId;
    record.lastActivityAt = Date.now();
    const injected = record.input?.write(data) ?? false;
    if (!injected) {
      throw new TerminalServiceError(
        "LIMIT_EXCEEDED",
        `terminal input queue is backpressured or closed: ${sessionId}`,
      );
    }
    rescheduleIdle(record);
    return "injected";
  }

  /** resize：终值幂等（已退会话静默 no-op——展示面尺寸，不产错误噪音）。 */
  function resize(sessionId: string, cols: number, rows: number): void {
    const record = requireRecord(sessionId);
    if (record.exited) return;
    record.cols = cols;
    record.rows = rows;
    try {
      record.process?.resize(cols, rows);
    } catch {
      // 退出竞态：下一 onExit 收尾。
    }
  }

  /** exit：杀会话（记录保留供重放，idle/容量回收）。已退 = typed error（不复活）。 */
  function exitSession(sessionId: string): void {
    const record = requireRecord(sessionId);
    if (record.exited) {
      throw new TerminalServiceError(
        "SESSION_EXITED",
        `terminal session already exited: ${sessionId}`,
      );
    }
    killProcess(record, "SIGHUP");
  }

  /** buffer 缺口回放：已裁剪区间 → gap（客户端清屏重拉）；否则有界窗口回放。 */
  function bufferRange(
    sessionId: string,
    from: number,
    to: number,
  ): { entries: TerminalBufferEntry[] } | { gap: number } {
    const record = requireRecord(sessionId);
    const first = firstBufferedSeq(record);
    if (from < first) return { gap: first };
    const entries: TerminalBufferEntry[] = [];
    for (const entry of record.buffer) {
      if (entries.length >= TERMINAL_BUFFER_WINDOW_MAX_ENTRIES) break;
      if (entry.seq > to) break;
      if (entry.seq >= from) entries.push(entry);
    }
    return { entries };
  }

  function listSessions(): TerminalSessionInfo[] {
    return [...sessions.values()].map((record) => ({
      sessionId: record.sessionId,
      alive: !record.exited,
      pid: record.exited ? null : record.pid,
      exitCode: record.exitCode,
      createdAt: record.createdAt,
      cols: record.cols,
      rows: record.rows,
      attached: record.subscribers.size,
    }));
  }

  /** 附着订阅（WS attach / create / resume 路径；计入 idle 判定的反量）。 */
  function attachSubscriber(sessionId: string, subscriber: TerminalSessionSubscriber): void {
    const record = requireRecord(sessionId);
    record.subscribers.add(subscriber);
    record.lastActivityAt = Date.now();
    rescheduleIdle(record);
  }

  function detachSubscriber(sessionId: string, subscriber: TerminalSessionSubscriber): void {
    const record = sessions.get(sessionId);
    if (record === undefined) return;
    record.subscribers.delete(subscriber);
    subscriber.close();
    rescheduleIdle(record);
  }

  /**
   * 有界 WS sender（openspecui PtySocketSender 同法则）：单连接排队输出超闸
   * 即 terminate 该连接——PTY 会话与其它订阅不受慢客户端拖累。
   */
  class BoundedSocketSender {
    private terminated = false;
    constructor(private readonly socket: WsWebSocket) {}
    send(message: TerminalServerMessage): boolean {
      if (this.terminated || this.socket.readyState !== this.socket.OPEN) return false;
      let payload: string;
      try {
        payload = JSON.stringify(message);
      } catch {
        return false;
      }
      if (this.socket.bufferedAmount + Buffer.byteLength(payload) > MAX_SOCKET_BUFFERED_BYTES) {
        this.terminate();
        return false;
      }
      this.socket.send(payload);
      return true;
    }
    terminate(): void {
      if (this.terminated) return;
      this.terminated = true;
      try {
        this.socket.terminate();
      } catch {
        // 已断。
      }
    }
  }

  /** 会话订阅的 socket 侧实现：独立输出 batcher + exit 排队语义。 */
  function makeSocketSubscriber(
    sender: BoundedSocketSender,
    sessionId: string,
  ): TerminalSessionSubscriber {
    const batcher = new TerminalOutputBatcher(
      (entries) => {
        for (const entry of entries) {
          sender.send({ type: "output", sessionId, seq: entry.seq, data: entry.data });
        }
      },
      () => sender.terminate(),
    );
    return {
      output(entry) {
        batcher.enqueue(entry);
      },
      notify(message) {
        batcher.afterFlush(() => {
          sender.send(message);
        });
      },
      close() {
        batcher.close();
      },
    };
  }

  /**
   * WS 端点（鉴权在 upgrade 期由 web-server 完成——?token= web token 同 /ws/rpc）。
   * 每入站帧 JSON parse + safeParse：非法帧 typed error 回执，绝不杀终端连接。
   */
  function attachSocket(websocket: WsWebSocket): void {
    const sender = new BoundedSocketSender(websocket);
    /** 本连接在某会话上的订阅（socket 关闭时统一 detach）。 */
    const subscriptions = new Map<string, TerminalSessionSubscriber>();

    const detachAll = (): void => {
      for (const [sessionId, subscriber] of subscriptions) {
        detachSubscriber(sessionId, subscriber);
      }
      subscriptions.clear();
    };

    const attach = (sessionId: string, cols?: number, rows?: number): void => {
      const record = requireRecord(sessionId);
      if (cols !== undefined && rows !== undefined && !record.exited) {
        resize(sessionId, cols, rows);
      }
      // 同连接重复附着同一会话：先撤旧订阅（从 record.subscribers 移除并关闭）。
      const previous = subscriptions.get(sessionId);
      if (previous !== undefined) detachSubscriber(sessionId, previous);
      const subscriber = makeSocketSubscriber(sender, sessionId);
      subscriptions.set(sessionId, subscriber);
      attachSubscriber(sessionId, subscriber);
    };

    const dispatch = (message: TerminalClientMessage): void => {
      switch (message.type) {
        case "create": {
          if (message.resume !== undefined) {
            const record = sessions.get(message.resume);
            if (record === undefined) {
              sender.send({
                type: "error",
                code: "SESSION_NOT_FOUND",
                message: `terminal session not found: ${message.resume}`,
              });
              return;
            }
            attach(record.sessionId, message.cols, message.rows);
            sender.send({
              type: "created",
              sessionId: record.sessionId,
              replayFrom: firstBufferedSeq(record),
              cols: record.cols,
              rows: record.rows,
            });
            return;
          }
          const created = createSession(message);
          attach(created.sessionId);
          sender.send({
            type: "created",
            sessionId: created.sessionId,
            replayFrom: created.replayFrom,
            cols: created.cols,
            rows: created.rows,
          });
          return;
        }
        case "write": {
          const outcome = write(message.sessionId, message.reqId, message.data);
          if (outcome === "duplicate") {
            sender.send({
              type: "duplicate",
              sessionId: message.sessionId,
              reqId: message.reqId,
            });
          }
          return;
        }
        case "resize": {
          resize(message.sessionId, message.cols, message.rows);
          return;
        }
        case "exit": {
          try {
            exitSession(message.sessionId);
          } catch (error) {
            if (error instanceof TerminalServiceError) {
              sender.send({
                type: "error",
                code: error.code,
                message: error.message,
                sessionId: message.sessionId,
              });
            }
          }
          return;
        }
        case "buffer": {
          const outcome = bufferRange(message.sessionId, message.from, message.to);
          if ("gap" in outcome) {
            sender.send({
              type: "gap",
              sessionId: message.sessionId,
              availableFrom: outcome.gap,
            });
            return;
          }
          sender.send({
            type: "buffer",
            sessionId: message.sessionId,
            entries: outcome.entries,
          });
          return;
        }
        case "list": {
          sender.send({ type: "list", sessions: listSessions() });
          return;
        }
      }
    };

    websocket.on("message", (raw: unknown) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(typeof raw === "string" ? raw : String(raw));
      } catch {
        sender.send({ type: "error", code: "INVALID_JSON", message: "invalid JSON payload" });
        return;
      }
      const checked = TerminalClientMessageSchema.safeParse(parsed);
      if (!checked.success) {
        const firstIssue = checked.error.issues[0]?.message ?? "invalid terminal message";
        sender.send({ type: "error", code: "INVALID_MESSAGE", message: firstIssue });
        return;
      }
      try {
        dispatch(checked.data);
      } catch (error) {
        // 绝不让单帧异常击穿进程（非法帧/域失败一律 typed 回执，不杀终端）。
        if (error instanceof TerminalServiceError) {
          const sessionId =
            "sessionId" in checked.data && typeof checked.data.sessionId === "string"
              ? checked.data.sessionId
              : undefined;
          sender.send({
            type: "error",
            code: error.code,
            message: error.message,
            ...(sessionId ? { sessionId } : {}),
          });
          return;
        }
        console.error(
          `[terminal] unexpected dispatch failure: ${error instanceof Error ? error.message : String(error)}`,
        );
        sender.send({
          type: "error",
          code: "INTERNAL",
          message: "terminal dispatch failed unexpectedly",
        });
      }
    });
    websocket.on("close", detachAll);
    websocket.on("error", () => detachAll());
  }

  /**
   * 有界停机（stop coordinator 关停序）：SIGHUP 全部活会话 → 宽限期等待 →
   * SIGKILL 强制升级 → 清空注册表（订阅随记录撤除）。幂等。
   */
  async function dispose(disposeOptions: { graceMs?: number } = {}): Promise<void> {
    const graceMs = disposeOptions.graceMs ?? disposeGraceMs;
    const alive = [...sessions.values()].filter((record) => !record.exited);
    for (const record of alive) killProcess(record, "SIGHUP");
    if (alive.length > 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(finish, Math.max(0, graceMs));
        timer.unref();
        function finish(): void {
          clearTimeout(timer);
          resolve();
        }
        const poll = setInterval(() => {
          if (aliveCount() === 0) finish();
        }, 25);
        poll.unref();
      });
    }
    for (const record of sessions.values()) {
      if (!record.exited) killProcess(record, "SIGKILL");
    }
    for (const sessionId of [...sessions.keys()]) reapSession(sessionId, "dispose");
  }

  return {
    createSession,
    write,
    resize,
    exitSession,
    bufferRange,
    listSessions,
    attachSubscriber,
    detachSubscriber,
    attachSocket,
    dispose,
  };
}

/** 终端域服务面（domain 组合与 web-server 升级路由消费）。 */
export type TerminalService = ReturnType<typeof createTerminalService>;
