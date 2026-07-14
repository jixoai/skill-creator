/**
 * 原始需求 [2026-07-14]：「opentray 的一些适配没做好，好好学习 pnpm-pub」。
 * 正交意图：
 * 1. 由 Vite 启动开发 daemon，并绑定二者的进程生命周期。
 * 2. 将开发态 HTTP 与 WebSocket 请求代理到动态 daemon 端口。
 * 3. 在 daemon 启动竞态期间返回可重试失败，不让代理错误终止 Vite。
 */
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execa, type ResultPromise } from "execa";
import httpProxy from "http-proxy";
import type { Plugin } from "vite";

/** Spawn the development daemon and proxy its browser transport through Vite. */
export function skillCreatorDaemonDev(): Plugin {
  return {
    name: "skill-creator/daemon-dev",
    apply: "serve",
    enforce: "pre",
    configureServer(server) {
      const httpServer = server.httpServer;
      if (!httpServer) return;

      const portPromise = process.env.SKILL_CREATOR_DEV_DAEMON_PORT
        ? Promise.resolve(Number(process.env.SKILL_CREATOR_DEV_DAEMON_PORT))
        : allocateRandomPort();
      let daemon: ResultPromise | null = null;
      let shuttingDown = false;

      const shutdown = async (reason: string): Promise<void> => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.error(`[dev] ${reason}; stopping dev session`);
        await server.close().catch(() => {});
        process.exit(0);
      };

      const spawnDaemon = (port: number, webuiUrl: string): void => {
        const entry = path.resolve(repoRoot(), "src/daemon/dev.ts");
        daemon = execa("bun", [entry], {
          stdio: "inherit",
          env: {
            ...process.env,
            SKILL_CREATOR_DEV_DAEMON_PORT: String(port),
            SKILL_CREATOR_DEV_WEBVIEW_URL: webuiUrl,
            SKILL_CREATOR_DEV_SUPERVISOR_PID: String(process.pid),
          },
        });
        daemon.on("exit", (code, signal) => {
          console.error(`[dev] daemon child exit: code=${String(code)} signal=${String(signal)}`);
          void shutdown(`daemon exited (code=${String(code)} signal=${String(signal)})`);
        });
      };

      void portPromise.then((port) => {
        process.env.SKILL_CREATOR_DEV_DAEMON_PORT = String(port);
        const target = `http://127.0.0.1:${port}`;
        const proxy = httpProxy.createProxyServer({ target, ws: true });
        const isDaemonRoute = (url: string): boolean =>
          url.startsWith("/api/") || url.startsWith("/ws/");
        const handler = (
          req: http.IncomingMessage,
          res: http.ServerResponse,
          next: () => void,
        ): void => {
          if (!isDaemonRoute(req.url ?? "")) {
            next();
            return;
          }
          proxy.web(req, res, undefined, () => respondDaemonUnavailable(res));
        };

        // `pre` puts this public Connect middleware before SvelteKit's SPA fallback.
        server.middlewares.use(handler);
        httpServer.on("upgrade", (req, socket, head) => {
          if (!isDaemonRoute(req.url ?? "")) return;
          proxy.ws(req, socket, head, undefined, () => respondWebSocketUnavailable(socket));
        });

        const startDaemon = (): void => {
          spawnDaemon(port, webuiUrlFromAddress(httpServer.address()));
        };
        if (httpServer.listening) startDaemon();
        else httpServer.once("listening", startDaemon);
      });
    },
  };
}

function respondDaemonUnavailable(res: http.ServerResponse): void {
  if (res.headersSent || res.writableEnded) {
    res.destroy();
    return;
  }
  res.writeHead(503, {
    "content-type": "application/json; charset=utf-8",
    "retry-after": "1",
  });
  res.end(JSON.stringify({ error: "Skill Creator daemon is starting" }));
}

function respondWebSocketUnavailable(socket: import("node:stream").Duplex): void {
  if (socket.destroyed) return;
  socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nRetry-After: 1\r\n\r\n");
}

function repoRoot(): string {
  return path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
}

function allocateRandomPort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

function webuiUrlFromAddress(address: ReturnType<http.Server["address"]>): string {
  if (!isAddressInfo(address)) {
    throw new Error("Vite dev server did not expose a TCP listening address");
  }
  const host = address.address === "::" ? "127.0.0.1" : address.address;
  const formattedHost = host.includes(":") ? `[${host}]` : host;
  return `http://${formattedHost}:${address.port}/#token=__SKILL_CREATOR_WEB_TOKEN__`;
}

function isAddressInfo(address: ReturnType<http.Server["address"]>): address is AddressInfo {
  return (
    typeof address === "object" &&
    address !== null &&
    "address" in address &&
    "port" in address &&
    typeof address.address === "string" &&
    typeof address.port === "number"
  );
}
