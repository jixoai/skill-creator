/**
 * 原始需求 [2026-07-14]：「参考 ../../pnpm-pub 这个项目的架构：cli+gui(webui+opentray)」。
 * 正交意图：
 * 1. 先 bind，仅清理已确认失活的 Unix socket。
 * 2. 分发前校验带版本的客户端协议。
 * 3. 每个连接只分发一个 framed request。
 * 4. 先确认 shutdown，再有界回收所有 CLI 连接。
 * 妥协声明：socket bind、协议分发与 stop acknowledgement 必须共享同一
 * server 生命周期；拆分会引入竞态，领域处理已下沉到 daemon services。
 */
import fs from "node:fs";
import net from "node:net";
import {
  encodeFrame,
  FrameReader,
  IpcFrameTooLargeError,
  IPC_PROTOCOL_VERSION,
  parseIpcRequest,
  type IpcRequest,
  type IpcResponse,
} from "../shared/frame.js";
import type { DaemonStatus } from "../shared/contracts/daemon.js";
import { runDir, socketPath } from "../shared/paths.js";
import { socketAcceptsConnections } from "../shared/socket-liveness.js";
import { log } from "./log.js";

/** 仅在 stop acknowledgement 写出后调用的回收动作。 */
export type IpcStopAction = () => Promise<void>;

/** 请求通过 wire protocol 校验后调用的产品回调。 */
export interface IpcServerHandlers {
  /** 返回投影给 CLI 的 daemon 状态快照。 */
  onStatus: () => DaemonStatus;
  /** 准备或拒绝 stop，并返回确认响应后执行的回收动作。 */
  onStop: () => Promise<IpcStopAction>;
  /** 显示或聚焦已挂载的 tray 窗口。 */
  onOpen: () => Promise<void>;
}

/** 非协作 IPC 客户端被强制断开前的宽限期。 */
export interface IpcStopOptions {
  graceMs?: number;
}

/** 持有本地单实例 CLI socket，并为每个连接分发一个带版本请求。 */
export class IpcServer {
  private server?: net.Server;
  private stopPromise?: Promise<void>;
  private readonly connections = new Set<net.Socket>();

  constructor(private readonly handlers: IpcServerHandlers) {}

  /** 获取单实例 socket，仅清理已确认失活的 Unix 路径。 */
  async start(): Promise<boolean> {
    const directory = runDir();
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") fs.chmodSync(directory, 0o700);
    const server = await this.bindSocket(true);
    if (!server) return false;
    this.server = server;
    this.stopPromise = undefined;
    return true;
  }

  /** 停止接受新 CLI 连接并释放 socket 路径。 */
  stop(options: IpcStopOptions = {}): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    if (!this.server) return Promise.resolve();
    const server = this.server;
    this.server = undefined;
    const graceMs = Math.max(0, options.graceMs ?? 1_000);
    this.stopPromise = new Promise<void>((resolve, reject) => {
      const forceClose = (): void => {
        for (const connection of this.connections) connection.destroy();
      };
      const timer = setTimeout(forceClose, graceMs);
      timer.unref();
      try {
        server.close((error) => {
          clearTimeout(timer);
          this.connections.clear();
          if (error) reject(error);
          else resolve();
        });
        for (const connection of this.connections) connection.end();
        if (graceMs === 0) forceClose();
      } catch (error) {
        clearTimeout(timer);
        forceClose();
        reject(error);
      }
    });
    return this.stopPromise;
  }

  private async bindSocket(allowStaleCleanup: boolean): Promise<net.Server | null> {
    const socket = socketPath();
    const result = await new Promise<{ server?: net.Server; error?: NodeJS.ErrnoException }>(
      (resolve) => {
        const server = net.createServer((connection) => {
          this.connections.add(connection);
          connection.once("close", () => this.connections.delete(connection));
          void this.handle(connection);
        });
        server.once("error", (error: NodeJS.ErrnoException) => resolve({ error }));
        server.listen(socket, () => resolve({ server }));
      },
    );

    if (result.server) {
      if (process.platform !== "win32") fs.chmodSync(socket, 0o600);
      log(`ipc listening on ${socket}`);
      return result.server;
    }
    if (result.error?.code !== "EADDRINUSE" || process.platform === "win32") {
      log(`ipc listen error: ${result.error?.message ?? "unknown error"}`);
      return null;
    }
    if (!allowStaleCleanup || (await socketAcceptsConnections(socket))) return null;

    try {
      fs.unlinkSync(socket);
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      if (code !== "ENOENT") return null;
    }
    return this.bindSocket(false);
  }

  private async handle(connection: net.Socket): Promise<void> {
    const reader = new FrameReader();
    connection.on("data", (chunk) => reader.push(chunk));
    connection.on("end", () => reader.close());
    connection.on("error", () => reader.close());
    connection.on("close", () => reader.close());

    try {
      for await (const body of reader.frames()) {
        const decoded: unknown = JSON.parse(Buffer.from(body).toString("utf8"));
        const request = parseIpcRequest(decoded);
        if (!request) {
          connection.end(
            encodeFrame({
              ok: false,
              code: "invalid-request",
              error: "Invalid IPC request envelope.",
            } satisfies IpcResponse),
          );
          return;
        }
        if (request.protocolVersion !== IPC_PROTOCOL_VERSION) {
          connection.end(
            encodeFrame({
              ok: false,
              code: "protocol-mismatch",
              error: `IPC protocol mismatch: daemon=${IPC_PROTOCOL_VERSION}, client=${request.protocolVersion}.`,
            } satisfies IpcResponse),
          );
          return;
        }
        if (request.type === "stop") {
          const stopAction = await this.handlers.onStop();
          connection.end(
            encodeFrame({ ok: true } satisfies IpcResponse),
            (error?: Error | null) => {
              if (error) {
                log(`ipc stop acknowledgement failed: ${error.message}`);
                return;
              }
              setImmediate(() => {
                void stopAction().catch((error: unknown) => {
                  log(
                    `ipc stop action failed: ${error instanceof Error ? error.message : String(error)}`,
                  );
                });
              });
            },
          );
          return;
        }
        connection.end(encodeFrame(await this.dispatch(request)));
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`ipc handler error: ${message}`);
      const response: IpcResponse =
        error instanceof IpcFrameTooLargeError
          ? { ok: false, code: "frame-too-large", error: message }
          : { ok: false, error: message };
      connection.end(encodeFrame(response));
    }
  }

  private async dispatch(request: IpcRequest): Promise<IpcResponse> {
    switch (request.type) {
      case "status":
        return { ok: true, data: this.handlers.onStatus() };
      case "open":
        await this.handlers.onOpen();
        return { ok: true };
      case "stop":
        return { ok: true };
    }
  }
}
