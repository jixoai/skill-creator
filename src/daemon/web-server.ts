/**
 * 原始需求 [2026-07-14]：「参考 ../../pnpm-pub 这个项目的架构：cli+gui(webui+opentray)」。
 * 正交意图：
 * 1. 提供健康检查、SPA 静态资源与路由回退。
 * 2. 在协议升级前拒绝未授权 WebSocket。
 * 3. 通过受权 socket 承载共享 oRPC router。
 */
import { existsSync, promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import type { Duplex } from "node:stream";
import { RPCHandler } from "@orpc/server/ws";
import { WebSocketServer } from "ws";
import type { DaemonStatus } from "../shared/contracts/daemon.js";
import { log } from "./log.js";
import { createRpcRouter } from "./rpc-router.js";

/** WebUI 静态服务和 RPC 通道的启动配置。 */
export interface WebServerOptions {
  webToken: string;
  webuiDir: string;
  status: () => DaemonStatus;
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

/** 同时承载 WebUI SPA 与强类型 WebSocket RPC 的本地服务。 */
export class WebServer {
  private server?: http.Server;
  private readonly rpcWsServer = new WebSocketServer({ noServer: true });
  private readonly rpcHandler: RPCHandler<Record<never, never>>;

  constructor(private readonly options: WebServerOptions) {
    this.rpcHandler = new RPCHandler(createRpcRouter(options.status));
  }

  /** 启动环回服务，并返回实际监听端口。 */
  start(port: number): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const server = http.createServer((request, response) => {
        void this.handleHttp(request, response);
      });
      server.on("upgrade", (request, socket, head) => this.handleUpgrade(request, socket, head));
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        const address = server.address();
        this.server = server;
        resolve(typeof address === "object" && address ? address.port : port);
      });
    });
  }

  /** 关闭所有 RPC 客户端和 HTTP 服务。 */
  async stop(): Promise<void> {
    if (!this.server) return;
    for (const client of this.rpcWsServer.clients) client.close();
    const server = this.server;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    this.server = undefined;
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
