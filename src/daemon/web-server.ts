/**
 * 原始需求 [2026-07-14]：「参考 ../../pnpm-pub 这个项目的架构：cli+gui(webui+opentray)」。
 * 正交意图：
 *   [1] 提供健康检查、SPA 静态资源与路由回退。
 *   [2] 在协议升级前拒绝未授权 WebSocket。
 *   [3] 通过受权 socket 承载共享 oRPC router，并有界回收完整连接生命周期。
 *   [4] 把 tray 窗口投影与 keep-onTop 偏好以单向帧广播给每个已授权 WebUI 客户端。
 */
import { existsSync, promises as fs } from "node:fs";
import http from "node:http";
import { EventEmitter } from "node:events";
import type { Socket } from "node:net";
import path from "node:path";
import type { Duplex } from "node:stream";
import { RPCHandler } from "@orpc/server/ws";
import { WebSocketServer } from "ws";
import type { DaemonStatus } from "../shared/contracts/daemon.js";
import type { WsServerMessage } from "../shared/rpc-contract.js";
import type { DaemonDomain } from "./domain.js";
import { log } from "./log.js";
import { createRpcRouter, type TrayHostRef } from "./rpc-router.js";
import type { PreferencesStore } from "./preferences-store.js";
import type { TrayHost } from "./tray-host.js";

/** WebUI 静态服务和 RPC 通道的启动配置。 */
export interface WebServerOptions {
  webToken: string;
  webuiDir: string;
  status: () => DaemonStatus;
  domain: DaemonDomain;
  preferencesStore: PreferencesStore;
}

/** 本地 HTTP 与 WebSocket 客户端被强制断开前的宽限期。 */
export interface WebServerStopOptions {
  graceMs?: number;
}

const MIME: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

/** 单生命周期地承载 WebUI SPA、强类型 WebSocket RPC 与 tray 投影广播。 */
export class WebServer {
  private server?: http.Server;
  private stopPromise?: Promise<void>;
  private readonly connections = new Set<Socket>();
  private readonly rpcWsServer = new WebSocketServer({ noServer: true });
  /** daemon→WebUI 投影帧的内部事件总线；broadcast 一次 emit 推到所有订阅者。 */
  private readonly rpcEvents = new EventEmitter();
  /** tray host 间接引用；attachTray 之前为 null，首帧与 tray RPC 据此防御。 */
  private readonly trayHostRef: TrayHostRef = { host: null };
  private readonly rpcHandler: RPCHandler<Record<never, never>>;
  private readonly preferencesStore: PreferencesStore;
  private readonly preferencesUnsub: () => void;

  constructor(private readonly options: WebServerOptions) {
    this.preferencesStore = options.preferencesStore;
    this.rpcEvents.setMaxListeners(50);
    this.rpcHandler = new RPCHandler(
      createRpcRouter({
        status: options.status,
        domain: options.domain,
        trayHostRef: this.trayHostRef,
        preferencesStore: this.preferencesStore,
        broadcast: { subscribe: () => this.subscribeState() },
      }),
    );
    // keep-onTop 偏好变更 → 广播给所有 WebUI 客户端（标题栏 pin 与其它标签页同步）。
    const onPreferences = (preferences: { keepOnTop: boolean }): void =>
      this.broadcast({ type: "preferences", preferences });
    this.preferencesStore.on("preferences", onPreferences);
    this.preferencesUnsub = () => this.preferencesStore.off("preferences", onPreferences);
  }

  /** 启动环回服务，并返回实际监听端口。 */
  start(port: number): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const server = http.createServer((request, response) => {
        void this.handleHttp(request, response);
      });
      server.on("connection", (connection) => {
        this.connections.add(connection);
        connection.once("close", () => this.connections.delete(connection));
      });
      server.on("upgrade", (request, socket, head) => this.handleUpgrade(request, socket, head));
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        const address = server.address();
        this.server = server;
        this.stopPromise = undefined;
        resolve(typeof address === "object" && address ? address.port : port);
      });
    });
  }

  /** 关闭所有 RPC 客户端和 HTTP 服务。 */
  stop(options: WebServerStopOptions = {}): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    if (!this.server) return Promise.resolve();
    const server = this.server;
    this.server = undefined;
    const graceMs = Math.max(0, options.graceMs ?? 1_000);
    this.stopPromise = new Promise<void>((resolve, reject) => {
      let serverClosed = false;
      let wsServerClosed = false;
      let closeError: Error | undefined;
      let settled = false;
      const finishIfClosed = (): void => {
        if (settled || !serverClosed || !wsServerClosed || this.connections.size > 0) return;
        settled = true;
        clearTimeout(timer);
        if (closeError) reject(closeError);
        else resolve();
      };
      const forceClose = (): void => {
        for (const client of this.rpcWsServer.clients) client.terminate();
        for (const connection of this.connections) connection.destroy();
        server.closeAllConnections();
      };
      const timer = setTimeout(forceClose, graceMs);
      timer.unref();

      try {
        server.close((error) => {
          serverClosed = true;
          closeError ??= error;
          finishIfClosed();
        });
      } catch (error) {
        serverClosed = true;
        closeError = error instanceof Error ? error : new Error(String(error));
      }
      this.rpcWsServer.close((error) => {
        wsServerClosed = true;
        closeError ??= error;
        finishIfClosed();
      });
      for (const connection of this.connections) connection.once("close", finishIfClosed);
      for (const client of this.rpcWsServer.clients) {
        try {
          client.close(1001, "Server shutting down");
        } catch (error) {
          closeError ??= error instanceof Error ? error : new Error(String(error));
          client.terminate();
        }
      }
      if (graceMs === 0 || closeError) {
        forceClose();
        finishIfClosed();
      }
    });
    return this.stopPromise;
  }

  /** 把一条投影帧广播给每个已授权 WebUI oRPC 订阅者。 */
  broadcast(msg: WsServerMessage): void {
    this.rpcEvents.emit("message", msg);
  }

  /** 后置注入 tray host，使 WebUI 投影首帧与 tray RPC 可访问其状态。 */
  attachTray(trayHost: TrayHost | null): void {
    this.trayHostRef.host = trayHost;
  }

  /** 生成带当前授权 token 的 WebUI 入口。 */
  webUiUrl(port: number): string {
    return `http://127.0.0.1:${port}/#token=${encodeURIComponent(this.options.webToken)}`;
  }

  /** 生成适合日志输出的脱敏 WebUI 入口。 */
  webUiUrlRedacted(port: number): string {
    return `http://127.0.0.1:${port}/#token=<redacted>`;
  }

  /** 释放偏好订阅（HTTP/WS 由 stop 关闭）。 */
  dispose(): void {
    this.preferencesUnsub();
  }

  /**
   * 每条已授权 WS 连接的投影帧订阅生成器。
   *
   * 首帧队列带 hello + 当前 preferences + 若 tray host 已挂载则带初始 pin；
   * 之后由 broadcast 推送的帧通过 rpcEvents 进队并唤醒迭代。
   */
  private async *subscribeState(): AsyncGenerator<WsServerMessage, void, void> {
    const queue: WsServerMessage[] = [
      { type: "hello" },
      { type: "preferences", preferences: this.preferencesStore.getPreferences() },
    ];
    const host = this.trayHostRef.host;
    if (host) queue.push({ type: "pin", ...host.getPinState() });

    let wake: (() => void) | null = null;
    const onMessage = (msg: WsServerMessage): void => {
      queue.push(msg);
      wake?.();
      wake = null;
    };
    this.rpcEvents.on("message", onMessage);
    try {
      while (true) {
        while (queue.length > 0) {
          const msg = queue.shift();
          if (msg) yield msg;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    } finally {
      this.rpcEvents.off("message", onMessage);
    }
  }

  private async handleHttp(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void> {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname === "/api/health") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
        return;
      }
      await this.serveStatic(response, url.pathname);
    } catch (error) {
      log(`web handle error: ${error instanceof Error ? error.message : String(error)}`);
      if (!response.headersSent) response.writeHead(500, { "content-type": "text/plain" });
      response.end("internal error");
    }
  }

  private handleUpgrade(request: http.IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws/rpc") {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    if (url.searchParams.get("token") !== this.options.webToken) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    this.rpcWsServer.handleUpgrade(request, socket, head, (websocket) => {
      void this.rpcHandler.upgrade(websocket, { context: {} }).catch((error: unknown) => {
        log(
          `[orpc] websocket upgrade failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        websocket.close();
      });
    });
  }

  private async serveStatic(response: http.ServerResponse, pathname: string): Promise<void> {
    let relativePath = decodeURIComponent(pathname.slice(1));
    if (!relativePath || relativePath.endsWith("/")) relativePath += "index.html";
    const root = path.resolve(this.options.webuiDir);
    let file = path.resolve(root, relativePath);
    if (path.relative(root, file).startsWith("..")) {
      response.writeHead(403).end();
      return;
    }
    if (!existsSync(file)) file = path.join(root, "index.html");
    if (!existsSync(file)) {
      response.writeHead(404).end("not found");
      return;
    }
    const extension = path.extname(file);
    const data = await fs.readFile(file);
    response.writeHead(200, {
      "content-type": MIME[extension] ?? "application/octet-stream",
      "cache-control": extension === ".html" ? "no-cache" : "public, max-age=3600",
    });
    response.end(data);
  }
}
