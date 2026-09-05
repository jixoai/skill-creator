/**
 * 用户原始需求 [2026-09-06]（openspec agent-steward）：「DSH/Codex 作为独立 backend，
 * 外部进程桥接。」
 * 正交意图：
 *   [1] 换行分隔 JSON-RPC over stdio 的最小客户端：请求/响应配对、通知订阅、
 *       server→client request 处理（授权类）。
 *   [2] 子进程生命周期：spawn 失败、提前退出、stderr 诊断，全部以类型化错误上抛。
 *   [3] 外部帧一律按 unknown 收窄（AGENTS 安全法则），不做结构性假设。
 * 妥协声明：DSH（ACP 草案）与 Codex app-server 共用本客户端；两者仅方法名不同，
 *   拆分两个客户端会重复同一组 pipe/配对逻辑。
 */
import { spawn, type ChildProcess } from "node:child_process";
import { DomainError } from "../domain-error.js";
import { HarnessProcessLostError } from "./harness-adapter.js";

/** spawn 注入器（测试用 mock 子进程）。 */
export type StdioSpawner = (
  command: string,
  args: string[],
  options: { cwd: string },
) => ChildProcess;

/** 一个 server→client 请求（如授权）。 */
export interface IncomingRequest {
  id: string | number;
  method: string;
  params: unknown;
  /** 回写结果；denied 时回 error。 */
  respond(result: unknown): void;
  respondError(code: number, message: string): void;
}

/** 通知或请求处理句柄。 */
export interface JsonRpcHandlers {
  onNotification?: (method: string, params: unknown) => void;
  onRequest?: (request: IncomingRequest) => void;
}

/** 最小 JSON-RPC 帧收窄（未知字段忽略）。 */
function parseFrame(raw: string): {
  id?: string | number | null;
  method?: unknown;
  params?: unknown;
  result?: unknown;
  error?: { message?: unknown };
} | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const frame = value as Record<string, unknown>;
  if ("method" in frame || "result" in frame || "error" in frame) return frame;
  return null;
}

/** 等待一个事件（带 abort 感知）。 */
function onceAbort(signal: AbortSignal, onAbort: () => void): () => void {
  const listener = (): void => onAbort();
  signal.addEventListener("abort", listener, { once: true });
  return () => signal.removeEventListener("abort", listener);
}

/**
 * 持有一个 backend 子进程的 JSON-RPC/stdio 客户端。
 * 帧顺序与 backend 产出一致；请求超时与进程退出都转为 typed 错误。
 */
export class StdioJsonRpcClient {
  private readonly proc: ChildProcess;
  private readonly signal: AbortSignal;
  private readonly handlers: JsonRpcHandlers;
  private readonly pending = new Map<
    string | number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();
  private nextId = 1;
  private buffer = "";
  private stderrText = "";
  private exitCode: number | null = null;
  private exitSignal: NodeJS.Signals | null = null;
  private readonly exitWaiters: Array<
    (info: { code: number | null; signal: string | null }) => void
  > = [];
  private closed = false;

  constructor(proc: ChildProcess, signal: AbortSignal, handlers: JsonRpcHandlers = {}) {
    this.proc = proc;
    this.signal = signal;
    this.handlers = handlers;
    proc.once("error", (error: Error) => {
      this.failPending(new DomainError("UNAVAILABLE", `Backend process failed: ${error.message}`));
    });
    proc.once("exit", (code, signal) => {
      this.exitCode = code;
      this.exitSignal = signal;
      for (const waiter of this.exitWaiters.splice(0)) waiter({ code, signal });
      this.failPending(
        new HarnessProcessLostError(
          `Backend process exited before completing (code=${code ?? "null"} signal=${signal ?? "null"}).`,
        ),
      );
    });
    proc.stdout?.setEncoding("utf8");
    proc.stdout?.on("data", (chunk: string) => this.consume(chunk));
    proc.stderr?.setEncoding("utf8");
    proc.stderr?.on("data", (chunk: string) => {
      // stderr 只做诊断累积（有界）。
      if (this.stderrText.length < 8000) this.stderrText += chunk;
    });
    onceAbort(signal, () => {
      this.kill();
    });
  }

  /** 诊断用 stderr 尾部。 */
  get stderrTail(): string {
    return this.stderrText.slice(-2000);
  }

  /** 进程是否仍在运行。 */
  get alive(): boolean {
    return this.exitCode === null && this.exitSignal === null && !this.closed;
  }

  /** 有界终止子进程：SIGTERM → 宽限 → SIGKILL。 */
  kill(graceMs = 1500): Promise<void> {
    if (this.exitCode !== null || this.exitSignal !== null) return Promise.resolve();
    this.closed = true;
    return new Promise<void>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        resolve();
      };
      this.proc.once("exit", finish);
      try {
        this.proc.kill("SIGTERM");
      } catch {
        finish();
        return;
      }
      // exit 事件可能在 kill 调用内同步到达，timer 必须晚声明晚赋值。
      timer = setTimeout(() => {
        if (this.exitCode === null && this.exitSignal === null) {
          try {
            this.proc.kill("SIGKILL");
          } catch {
            // 已退出。
          }
        }
        finish();
      }, graceMs);
      timer.unref();
    });
  }

  /** 等待进程退出（测试/清理用）。 */
  exited(): Promise<{ code: number | null; signal: string | null }> {
    if (this.exitCode !== null || this.exitSignal !== null) {
      return Promise.resolve({ code: this.exitCode, signal: this.exitSignal });
    }
    return new Promise((resolve) => this.exitWaiters.push(resolve));
  }

  /** 发送一个请求并等待响应。 */
  request(method: string, params: unknown, timeoutMs = 20_000): Promise<unknown> {
    if (!this.alive) {
      return Promise.reject(new HarnessProcessLostError("Backend process is not running."));
    }
    const id = this.nextId++;
    const frame = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new DomainError("UNAVAILABLE", `Backend request timed out: ${method}`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.proc.stdin?.write(`${frame}\n`, (error) => {
        if (error) {
          this.pending.delete(id);
          clearTimeout(timer);
          reject(new HarnessProcessLostError(`Failed to write to backend stdin: ${error.message}`));
        }
      });
    });
  }

  /** 发送一个通知（不期待响应）。 */
  notify(method: string, params: unknown): void {
    if (!this.alive) return;
    const frame = JSON.stringify({ jsonrpc: "2.0", method, params });
    this.proc.stdin?.write(`${frame}\n`);
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      this.handleLine(trimmed);
    }
  }

  private handleLine(line: string): void {
    const frame = parseFrame(line);
    if (!frame) return;
    if (frame.method !== undefined) {
      if (typeof frame.method !== "string") return;
      const id = typeof frame.id === "string" || typeof frame.id === "number" ? frame.id : null;
      if (id === null) {
        this.handlers.onNotification?.(frame.method, frame.params);
        return;
      }
      // server → client request（授权类）。
      this.handlers.onRequest?.({
        id,
        method: frame.method,
        params: frame.params,
        respond: (result) => {
          this.proc.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
        },
        respondError: (code, message) => {
          this.proc.stdin?.write(
            `${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`,
          );
        },
      });
      return;
    }
    if (typeof frame.id === "string" || typeof frame.id === "number") {
      const waiter = this.pending.get(frame.id);
      if (!waiter) return;
      this.pending.delete(frame.id);
      if (frame.error !== undefined) {
        const message =
          typeof frame.error?.message === "string" ? frame.error.message : "Unknown backend error.";
        waiter.reject(new Error(`Backend error: ${message}`));
        return;
      }
      waiter.resolve(frame.result);
    }
  }

  private failPending(error: Error): void {
    for (const [, waiter] of this.pending) waiter.reject(error);
    this.pending.clear();
  }
}

/** 默认 spawn：stdio 全 pipe。 */
export function defaultStdioSpawn(
  command: string,
  args: string[],
  options: { cwd: string },
): ChildProcess {
  return spawn(command, args, { cwd: options.cwd, stdio: ["pipe", "pipe", "pipe"] });
}

/** 解析命令字符串（支持带引号参数的显式配置）。 */
export function parseCommandSpec(spec: string): { command: string; args: string[] } | null {
  const trimmed = spec.trim();
  if (!trimmed) return null;
  const parts = trimmed.match(/"[^"]+"|\S+/g);
  if (!parts || parts.length === 0) return null;
  return {
    command: parts[0]!.replace(/^"|"$/g, ""),
    args: parts.slice(1).map((part) => part.replace(/^"|"$/g, "")),
  };
}
