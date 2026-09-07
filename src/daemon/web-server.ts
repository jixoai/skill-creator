/**
 * 原始需求 [2026-07-14]：「参考 ../../pnpm-pub 这个项目的架构：cli+gui(webui+opentray)」。
 * 2026-09-06（openspec dsh-webui-composition 3.1a）：同源挂载 DSH web host——
 * Manager 保留 /ws/rpc、/ws/acp/* 与 /api/health，DSH 走自身官方 route
 * （/api/*、/plugins/*、index），SPA 静态回退仅在 DSH host 未挂载时生效（恢复入口）。
 * 正交意图：
 *   [1] 提供健康检查、SPA 静态资源与路由回退。
 *   [2] 在协议升级前拒绝未授权 WebSocket。
 *   [3] 通过受权 socket 承载共享 oRPC router，并有界回收完整连接生命周期。
 *   [4] 同源代理 DSH host 的 HTTP 与协议升级（单 loopback origin 双 surface）。
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

/** 已挂载的 DSH web host（loopback HTTP server 句柄）。 */
export interface DshMountHandle {
  host: string;
  port: number;
  server: http.Server;
  /**
   * DSH 进程级 launch token 的同源握手入口（`/?token=…`，仅 path+search）。
   * DSH 收到带 token 的 GET / 会签发会话 cookie 并 303 回干净的 /。
   */
  entryLocation: string;
  /** DSH 会话 cookie 名（`dsh-auth-<base64url(sha256(authority))>`）；存在则不再重定向。 */
  authCookieName: string;
}

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
  /** 已挂载的 DSH web host（null = 未挂载，SPA 静态回退是唯一 WebUI 入口）。 */
  private dshMount: DshMountHandle | null = null;

  /** 挂载/卸载 DSH web host（同源路由分区见 handleHttp/handleUpgrade）。 */
  mountDsh(handle: DshMountHandle | null): void {
    this.dshMount = handle;
    log(handle ? `dsh web host mounted: 127.0.0.1:${handle.port}` : "dsh web host unmounted");
  }

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
      // Manager 保留资产前缀（task 3.1a）：DSH host 挂载时，Manager island 资产
      // （/manager/dsh-island.js 等）仍从本 server 静态目录服务，保证单 origin 内
      // island bundle 与 DSH 页面同源可达。
      if (url.pathname.startsWith("/manager/")) {
        await this.serveManagerAsset(response, url.pathname.slice("/manager/".length));
        return;
      }
      // DSH host 挂载时：其官方 route（/api/*、/plugins/*、index 等）优先，
      // Manager SPA 静态回退退居 DSH 不可用时的恢复入口。裸 `/`（无 DSH
      // cookie、无 token 查询）先经同源握手桥——浏览器 303 到 `/?token=…`
      // 换 DSH 会话 cookie 后回到 `/`（fragment 由浏览器保留，island 的
      // hash-capture 仍能取到 daemon web token）。
      if (this.dshMount) {
        if (this.needsDshEntryHandshake(url, request)) {
          response.writeHead(303, {
            location: this.dshMount.entryLocation,
            "cache-control": "no-store",
            "referrer-policy": "no-referrer",
          });
          response.end();
          return;
        }
        this.proxyToDsh(request, response);
        return;
      }
      await this.serveStatic(response, url.pathname);
    } catch (error) {
      log(`web handle error: ${error instanceof Error ? error.message : String(error)}`);
      if (!response.headersSent) response.writeHead(500, { "content-type": "text/plain" });
      response.end("internal error");
    }
  }

  /**
   * 入口握手桥判定：仅裸 `/`（非 token 握手请求、无 DSH 会话 cookie）需要
   * 重定向。带 token 的请求交由 DSH 的 authorizeIndex 处理（设 cookie/303/401），
   * 已持有 cookie 的请求直接代理——两条件共同保证不产生重定向环。
   */
  private needsDshEntryHandshake(url: URL, request: http.IncomingMessage): boolean {
    const mount = this.dshMount;
    if (!mount) return false;
    if (url.pathname !== "/") return false;
    if (url.searchParams.has("token")) return false;
    return !(request.headers.cookie ?? "").includes(mount.authCookieName);
  }

  /** 把请求原样转发给已挂载的 DSH host（流式 pipe；连接错误映射 502）。 */
  private proxyToDsh(request: http.IncomingMessage, response: http.ServerResponse): void {
    const mount = this.dshMount;
    if (!mount) {
      response.writeHead(503, { "content-type": "text/plain" });
      response.end("dsh host unmounted");
      return;
    }
    // 同源组合（Transport Gate）：浏览器以 daemon origin 发请求，DSH host 的
    // Origin/Host CSRF 校验以它自己的 origin 为准。代理在 daemon 边界把 origin 系
    // 头改写为 DSH host origin——两套鉴权仍各自执行（浏览器侧 token/cookie 由
    // 各自 surface 签发，代理不吞凭据）。
    const dshOrigin = `http://${mount.host}:${mount.port}`;
    const headers = { ...request.headers, host: `${mount.host}:${mount.port}` };
    if (typeof headers.origin === "string") headers.origin = dshOrigin;
    if (typeof headers.referer === "string") {
      try {
        headers.referer =
          new URL(headers.referer).pathname === "/" ? `${dshOrigin}/` : headers.referer;
      } catch {
        delete headers.referer;
      }
    }
    const proxy = http.request(
      { host: mount.host, port: mount.port, method: request.method, path: request.url, headers },
      (upstream) => {
        // 入口自愈（桥接闭环）：裸 / 带 cookie 仍被 DSH 判 401（cookie 过期/签名
        // 轮换）时，转 303 重新握手——浏览器用当前 launch token 换新 cookie。
        // 带 token 的请求不在此列（token 无效属终态错误，如实呈现 401）。
        const url = new URL(request.url ?? "/", "http://dsh.invalid");
        if (upstream.statusCode === 401 && url.pathname === "/" && !url.searchParams.has("token")) {
          upstream.resume();
          response.writeHead(303, {
            location: mount.entryLocation,
            "cache-control": "no-store",
            "referrer-policy": "no-referrer",
          });
          response.end();
          return;
        }
        response.writeHead(upstream.statusCode ?? 502, upstream.headers);
        upstream.pipe(response);
      },
    );
    proxy.on("error", (error) => {
      log(`dsh proxy error: ${error instanceof Error ? error.message : String(error)}`);
      if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain" });
      response.end("dsh host unavailable");
    });
    request.pipe(proxy);
  }

  /** 把协议升级原样桥接给 DSH host（官方 connection 通道；双向 socket pipe）。 */
  private proxyUpgradeToDsh(request: http.IncomingMessage, socket: Duplex, head: Buffer): void {
    const mount = this.dshMount;
    if (!mount) {
      socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
      return;
    }
    // 与 HTTP 代理同源的 origin 改写：浏览器升级携带 daemon origin，DSH host 的
    // Origin/Host 校验以自身 origin 为准（remote.mux 等通道在 403 下静默重连）。
    const headers = {
      ...request.headers,
      host: `${mount.host}:${mount.port}`,
      origin: `http://${mount.host}:${mount.port}`,
      connection: "Upgrade",
    };
    const proxy = http.request({
      host: mount.host,
      port: mount.port,
      method: request.method,
      path: request.url,
      headers,
    });
    proxy.on("upgrade", (upstream, upstreamSocket, upstreamHead) => {
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\n` +
          Object.entries(upstream.headers)
            .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
            .join("\r\n") +
          "\r\n\r\n",
      );
      if (upstreamHead.length > 0) socket.write(upstreamHead);
      if (head.length > 0) upstreamSocket.write(head);
      upstreamSocket.pipe(socket);
      socket.pipe(upstreamSocket);
      const drop = (): void => {
        upstreamSocket.destroy();
        socket.destroy();
      };
      upstreamSocket.on("error", drop);
      socket.on("error", drop);
    });
    proxy.on("response", (upstream) => {
      // DSH host 拒绝升级（非 101）：回写状态后关闭。
      socket.end(
        `HTTP/1.1 ${upstream.statusCode ?? 502} ${upstream.statusMessage ?? ""}\r\nConnection: close\r\n\r\n`,
      );
    });
    proxy.on("error", () => {
      socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
    });
    proxy.end();
  }

  private handleUpgrade(request: http.IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(request.url ?? "/", "http://localhost");
    // ACP 桥接端点：/ws/acp/<sessionId>?token=<webToken>，与 /ws/rpc 同鉴权。
    if (url.pathname.startsWith("/ws/acp/")) {
      this.handleAcpUpgrade(request, socket, head, url);
      return;
    }
    if (url.pathname !== "/ws/rpc") {
      // Manager WS 端点之外：DSH host 挂载时桥接官方升级通道，否则 404。
      if (this.dshMount) {
        this.proxyUpgradeToDsh(request, socket, head);
        return;
      }
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

  /**
   * Manager island 资产（/manager/*）：优先 webuiDir（生产 staging 已把 island
   * 产物并入 dist/webui），回退 `<webuiDir>/../build-island`（源码/dev 态 vite
   * island 构建输出——dev daemon 的 webuiDir 解析到 webui/static 或 build，
   * 两者上一级都能命中 build-island）。与 SPA 回退语义不同：island 资产缺失
   * 必须 404，不得回退 index.html（脚本/样式以 HTML MIME 返回会被中止）。
   */
  private async serveManagerAsset(response: http.ServerResponse, asset: string): Promise<void> {
    const relative = decodeURIComponent(asset);
    if (!relative || relative.endsWith("/")) {
      response.writeHead(404).end("not found");
      return;
    }
    const root = path.resolve(this.options.webuiDir);
    let file = path.resolve(root, relative);
    if (path.relative(root, file).startsWith("..")) {
      response.writeHead(403).end();
      return;
    }
    if (!existsSync(file)) {
      const islandRoot = path.resolve(root, "..", "build-island");
      const candidate = path.resolve(islandRoot, relative);
      if (!path.relative(islandRoot, candidate).startsWith("..") && existsSync(candidate)) {
        file = candidate;
      }
    }
    if (!existsSync(file)) {
      response.writeHead(404).end("not found");
      return;
    }
    const extension = path.extname(file);
    const data = await fs.readFile(file);
    response.writeHead(200, {
      "content-type": MIME[extension] ?? "application/octet-stream",
      "cache-control": "public, max-age=3600",
    });
    response.end(data);
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
