/**
 * 原始需求 [2026-07-14]：「参考 ../../pnpm-pub 这个项目的架构：cli+gui(webui+opentray)」。
 * 正交意图：
 *   [1] 提供健康检查、SPA 静态资源与路由回退。
 *   [2] 在协议升级前拒绝未授权 WebSocket。
 *   [3] 通过受权 socket 承载共享 oRPC router，并有界回收完整连接生命周期。
 */
import { existsSync, promises as fs } from "node:fs";
import http from "node:http";
import type { Socket } from "node:net";
import path from "node:path";
import type { Duplex } from "node:stream";
import { RPCHandler } from "@orpc/server/ws";
import { WebSocketServer, type WebSocket as WsWebSocket } from "ws";
import { AcpSessionIdSchema } from "../shared/contracts/acp.js";
import type { DaemonStatus } from "../shared/contracts/daemon.js";
import type { DaemonDomain } from "./domain.js";
import { log } from "./log.js";
import { createRpcRouter } from "./rpc-router.js";

/** WebUI 静态服务和 RPC 通道的启动配置。 */
export interface WebServerOptions {
  webToken: string;
  webuiDir: string;
  status: () => DaemonStatus;
  domain: DaemonDomain;
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

/** 单生命周期地承载 WebUI SPA 与强类型 WebSocket RPC。 */
export class WebServer {
  private server?: http.Server;
  private stopPromise?: Promise<void>;
  private readonly connections = new Set<Socket>();
  private readonly rpcWsServer = new WebSocketServer({ noServer: true });
  private readonly acpWsServer = new WebSocketServer({ noServer: true });
  private readonly rpcHandler: RPCHandler<Record<never, never>>;
  /** 订阅 agent 子进程异常退出事件，断开时由 dispose 自动取消。 */
  private readonly unsubscribeExited: () => void;

  constructor(private readonly options: WebServerOptions) {
    this.rpcHandler = new RPCHandler(
      createRpcRouter({
        status: options.status,
        domain: options.domain,
      }),
    );
    // agent 子进程异常退出 → 向仍连着的浏览器 WS 推送 exited 通知，再关闭。
    this.unsubscribeExited = options.domain.acpBridge.onSessionExited((event) => {
      const notification = JSON.stringify({
        jsonrpc: "2.0",
        method: "session/exited",
        params: { type: event.type, sessionId: event.sessionId, code: event.code },
      });
      for (const client of this.acpWsServer.clients) {
        const ws = client as WsWebSocket;
        if (ws.readyState === ws.OPEN) {
          try {
            ws.send(notification);
            ws.close(1011, "agent process exited");
          } catch {
            // 忽略单个客户端发送失败。
          }
        }
      }
    });
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
    // 停止接收新的 ACP exited 推送；残余 agent 子进程由 acpBridge.dispose 统一回收。
    this.unsubscribeExited();
    const graceMs = Math.max(0, options.graceMs ?? 1_000);
    this.stopPromise = new Promise<void>((resolve, reject) => {
      let serverClosed = false;
      let rpcWsClosed = false;
      let acpWsClosed = false;
      let closeError: Error | undefined;
      let settled = false;
      const finishIfClosed = (): void => {
        if (settled || !serverClosed || !rpcWsClosed || !acpWsClosed || this.connections.size > 0) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (closeError) reject(closeError);
        else resolve();
      };
      const forceClose = (): void => {
        for (const client of this.rpcWsServer.clients) client.terminate();
        for (const client of this.acpWsServer.clients) client.terminate();
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
        rpcWsClosed = true;
        closeError ??= error;
        finishIfClosed();
      });
      this.acpWsServer.close((error) => {
        acpWsClosed = true;
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
      for (const client of this.acpWsServer.clients) {
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

  /** 生成带当前授权 token 的 WebUI 入口。 */
  webUiUrl(port: number): string {
    return `http://127.0.0.1:${port}/#token=${encodeURIComponent(this.options.webToken)}`;
  }

  /** 生成适合日志输出的脱敏 WebUI 入口。 */
  webUiUrlRedacted(port: number): string {
    return `http://127.0.0.1:${port}/#token=<redacted>`;
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
    // ACP 桥接端点：/ws/acp/<sessionId>?token=<webToken>，与 /ws/rpc 同鉴权。
    if (url.pathname.startsWith("/ws/acp/")) {
      this.handleAcpUpgrade(request, socket, head, url);
      return;
    }
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

  /** /ws/acp/<sessionId> upgrade：先验 token（401），再验 sessionId 存在（404），通过后接入桥。 */
  private handleAcpUpgrade(
    request: http.IncomingMessage,
    socket: Duplex,
    head: Buffer,
    url: URL,
  ): void {
    if (url.searchParams.get("token") !== this.options.webToken) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    const rawId = decodeURIComponent(url.pathname.slice("/ws/acp/".length));
    const parsed = AcpSessionIdSchema.safeParse(rawId);
    if (!parsed.success || !this.options.domain.acpBridge.hasSession(parsed.data)) {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    const sessionId = parsed.data;
    this.acpWsServer.handleUpgrade(request, socket, head, (websocket) => {
      this.options.domain.acpBridge.attachWebSocket(sessionId, websocket as WsWebSocket);
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
