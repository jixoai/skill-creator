/**
 * 原始需求 [2026-07-14]：「opentray 的一些适配没做好，好好学习 pnpm-pub」。
 * 正交意图：
 * 1. 释放生产 daemon 后由 Vite 接管应用身份，并绑定开发进程生命周期。
 * 2. 将开发态 HTTP 与 WebSocket 请求代理到动态 daemon 端口。
 * 3. 在 daemon 启动竞态期间返回可重试失败，不让代理错误终止 Vite。
 * 4. 把绝对 Node + 真实 Vite JS 监督器向量传给 daemon，供 Dock 冷启动恢复开发树。
 */
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execa, type ResultPromise } from "execa";
import httpProxy from "http-proxy";
import type { Plugin } from "vite";
import {
  serializeDevAppLaunch,
  SKILL_CREATOR_DEV_APP_LAUNCH_ENV,
  type DevAppLaunch,
} from "../../src/shared/dev-app-launch";
import { stopProductionDaemonForDev } from "./dev-production-takeover";

/** Spawn the development daemon and proxy its browser transport through Vite. */
export function skillCreatorDaemonDev(): Plugin {
  let daemon: ResultPromise | null = null;
  let daemonExitExpected = false;
  let stopDaemonPromise: Promise<void> | null = null;

  const stopDaemon = (): Promise<void> => {
    if (stopDaemonPromise) return stopDaemonPromise;
    daemonExitExpected = true;
    const child = daemon;
    stopDaemonPromise = (async () => {
      if (!child) return;
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      try {
        await child;
      } catch {
        // Execa rejects when an intentional signal terminates the child.
      } finally {
        if (daemon === child) daemon = null;
      }
    })();
    return stopDaemonPromise;
  };

  return {
    name: "skill-creator/daemon-dev",
    apply: "serve",
    enforce: "pre",
    async configureServer(server) {
      const httpServer = server.httpServer;
      if (!httpServer) return;

      if (await stopProductionDaemonForDev()) {
        console.info("[dev] production daemon stopped; development now owns OpenTray");
      }

      const configuredPort = readOptionalPort(process.env.SKILL_CREATOR_DEV_DAEMON_PORT);
      const port = configuredPort ?? (await allocateRandomPort());
      let shuttingDown = false;

      const shutdown = async (reason: string): Promise<void> => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.error(`[dev] ${reason}; stopping dev session`);
        await server.close().catch(() => {});
        process.exit(0);
      };

      const spawnDaemon = (port: number, webuiUrl: string): void => {
        if (daemon) throw new Error("The Vite plugin already owns a development daemon.");
        daemonExitExpected = false;
        stopDaemonPromise = null;
        const entry =
          process.env.SKILL_CREATOR_DEV_DAEMON_ENTRY ??
          path.resolve(repoRoot(), "src/daemon/dev.ts");
        const appLaunch = resolveDevAppLaunch();
        daemon = execa(process.execPath, resolveDevDaemonArgs(entry), {
          stdio: "inherit",
          forceKillAfterDelay: 3_000,
          env: {
            ...process.env,
            SKILL_CREATOR_DEV_DAEMON_PORT: String(port),
            SKILL_CREATOR_DEV_WEBVIEW_URL: webuiUrl,
            SKILL_CREATOR_DEV_SUPERVISOR_PID: String(process.pid),
            [SKILL_CREATOR_DEV_APP_LAUNCH_ENV]: serializeDevAppLaunch(appLaunch),
          },
        });
        daemon.once("exit", (code, signal) => {
          if (daemonExitExpected) return;
          console.error(`[dev] daemon child exit: code=${String(code)} signal=${String(signal)}`);
          void shutdown(`daemon exited (code=${String(code)} signal=${String(signal)})`);
        });
      };

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

      // Async configureServer hooks finish before Vite mounts its internal SPA middleware.
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
    },
    // Vite 8 invokes closeBundle once per environment; share one awaited child teardown.
    closeBundle() {
      return stopDaemon();
    },
  };
}

function resolveDevDaemonArgs(entry: string): string[] {
  if (!entry.endsWith(".ts")) return [entry];
  const tsxLoader = createRequire(import.meta.url).resolve("tsx");
  return ["--import", tsxLoader, entry];
}

/** Resolve the PATH-independent Vite supervisor that owns daemon and WebView together. */
export function resolveDevAppLaunch(
  command = process.execPath,
  cwd = repoRoot(),
  viteEntry = resolveViteEntry(cwd),
): DevAppLaunch {
  if (!path.isAbsolute(command)) {
    throw new Error("pnpm dev requires an absolute Node executable for Dock relaunch.");
  }
  if (!path.isAbsolute(viteEntry)) {
    throw new Error("pnpm dev requires an absolute Vite entry for Dock relaunch.");
  }
  return {
    command,
    args: [viteEntry, "dev"],
    cwd: path.join(cwd, "webui"),
  };
}

function resolveViteEntry(cwd: string): string {
  return path.join(cwd, "webui/node_modules/vite/bin/vite.js");
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
  socket.end(
    "HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\nRetry-After: 1\r\n\r\n",
  );
}

function readOptionalPort(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("SKILL_CREATOR_DEV_DAEMON_PORT must be an integer between 1 and 65535.");
  }
  return port;
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
