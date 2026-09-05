/**
 * User input [2026-07-14]: "参考 ../../pnpm-pub 这个项目的架构：cli+gui(webui+opentray)"
 * User input [2026-07-21]: "我们默认是破坏性更新的……遇到不兼容的就当是空值。"
 * User input [2026-07-22]: "同意，但是改成 `skill-creator openinbrowser`。"
 * Architecture decision [2026-07-14]: lifecycle behavior is verified through
 * the public CLI and framed IPC boundary.
 *
 * Orthogonal intents:
 *   [1] Start/replace a daemon and preserve actionable startup diagnostics.
 *   [2] Project tray/headless status and explicit browser access through the CLI.
 *   [3] Wait through starting races and recover a mounted daemon whose tray is unavailable.
 *   [4] Discover production/development runtimes and report stop success only after teardown.
 *   [5] Isolate real daemon fixtures from the operator's native tray runtime.
 * 妥协声明：这些断言共享同一临时 daemon fixture 与进程清理边界，拆分
 * 会让 lifecycle race 失去端到端时序；业务单元测试仍按 service 分文件。
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { IpcServer } from "../src/daemon/ipc-server.js";
import { readCliVersion } from "../src/cli/package-version.js";
import { appDir, setHomeOverride, socketPath } from "../src/shared/paths.js";
import { socketAcceptsConnections } from "../src/shared/socket-liveness.js";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const cliEntry = path.join(root, "src", "cli", "cli.ts");
const currentVersion = readCliVersion();
const temporaryDirectories: string[] = [];
const spawnedDaemonPids = new Set<number>();

afterEach(async () => {
  setHomeOverride(null);
  for (const pid of spawnedDaemonPids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // The fixture daemon normally exits after the CLI opens it.
    }
  }
  spawnedDaemonPids.clear();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.promises.rm(directory, { recursive: true, force: true })),
  );
});

describe("CLI daemon lifecycle", () => {
  it("stops a different-version daemon, waits for release, and spawns the current daemon", async () => {
    const home = await createTemporaryHome();
    setHomeOverride(home);
    let oldDaemonStopped = false;
    let oldDaemon: IpcServer;
    oldDaemon = new IpcServer({
      onStatus: () => daemonStatus({ version: "0.0.0-old", tray: "mounted" }),
      onOpen: async () => {},
      onStop: async () => {
        return async () => {
          oldDaemonStopped = true;
          await oldDaemon.stop();
        };
      },
    });
    expect(await oldDaemon.start()).toBe(true);

    try {
      const marker = path.join(home, "spawned-daemon.pid");
      const daemonEntry = await writeFixtureDaemon(home);
      let result: { stdout: string; stderr: string };
      try {
        result = await runCli(home, ["start"], {
          SKILL_CREATOR_DAEMON_ENTRY: daemonEntry,
          TEST_DAEMON_MARKER: marker,
        });
      } catch (error) {
        const fixtureError = `${marker}.error`;
        if (fs.existsSync(fixtureError)) {
          throw new Error(await fs.promises.readFile(fixtureError, "utf8"));
        }
        throw new Error(`fixture did not execute: ${daemonEntry}; cause: ${String(error)}`);
      }

      expect(result.stderr).toBe("");
      expect(result.stdout).toContain(`replacing daemon 0.0.0-old with ${currentVersion}`);
      expect(result.stdout).toContain("skill-creator daemon started.");
      expect(oldDaemonStopped).toBe(true);
      expect(fs.existsSync(marker)).toBe(true);
      spawnedDaemonPids.add(Number.parseInt(await fs.promises.readFile(marker, "utf8"), 10));
    } finally {
      await oldDaemon.stop();
    }
  });

  it("waits through starting and retries until the mounted daemon can open", async () => {
    const home = await createTemporaryHome();
    setHomeOverride(home);
    let statusChecks = 0;
    let openAttempts = 0;
    let daemon: IpcServer;
    daemon = new IpcServer({
      onStatus: () => {
        statusChecks += 1;
        const mounted = statusChecks > 2;
        return daemonStatus({
          version: currentVersion,
          tray: mounted ? "mounted" : "starting",
          port: 4567,
        });
      },
      onOpen: async () => {
        openAttempts += 1;
        if (openAttempts === 1) throw new Error("Tray window is not openable yet.");
      },
      onStop: async () => async () => {
        await daemon.stop();
      },
    });
    expect(await daemon.start()).toBe(true);

    try {
      const result = await runCli(home, ["start"]);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("skill-creator daemon is already running.");
      expect(result.stdout).toContain("Opening the tray window");
      expect(result.stdout).not.toContain("Opening browser:");
      expect(statusChecks).toBeGreaterThanOrEqual(3);
      expect(openAttempts).toBe(2);
    } finally {
      await daemon.stop();
    }
  });

  it("restarts a running daemon whose mounted tray can no longer open", async () => {
    const home = await createTemporaryHome();
    setHomeOverride(home);
    let staleDaemonStopped = false;
    let staleDaemon: IpcServer;
    staleDaemon = new IpcServer({
      onStatus: () => daemonStatus({ version: currentVersion, tray: "mounted", port: 4567 }),
      onOpen: async () => {
        throw new Error("broker connection closed");
      },
      onStop: async () => async () => {
        staleDaemonStopped = true;
        await staleDaemon.stop();
      },
    });
    expect(await staleDaemon.start()).toBe(true);

    try {
      const marker = path.join(home, "spawned-daemon.pid");
      const daemonEntry = await writeFixtureDaemon(home);
      const result = await runCli(home, ["start"], {
        SKILL_CREATOR_DAEMON_ENTRY: daemonEntry,
        TEST_DAEMON_MARKER: marker,
      });

      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("restarting daemon because its tray runtime is unavailable");
      expect(result.stdout).toContain("skill-creator daemon started.");
      expect(staleDaemonStopped).toBe(true);
      spawnedDaemonPids.add(Number.parseInt(await fs.promises.readFile(marker, "utf8"), 10));
    } finally {
      await staleDaemon.stop();
    }
  });

  it("prints headless tray state (browser mode) and its failure", async () => {
    const home = await createTemporaryHome();
    setHomeOverride(home);
    const daemon = createDaemon({
      version: currentVersion,
      tray: "headless",
      trayError: "runtime-binding: native package unavailable",
    });
    expect(await daemon.start()).toBe(true);

    try {
      const result = await runCli(home, ["status"]);
      expect(result.stderr).toBe("");
      // opentray 是 Dashboard 模式：headless 不再是不可用，而是浏览器可达。
      expect(result.stdout).toContain("tray:    headless (browser mode)");
      expect(result.stdout).toContain("tray error: runtime-binding: native package unavailable");
    } finally {
      await daemon.stop();
    }
  });

  it("does not open a browser when start reaches a headless daemon", async () => {
    const home = await createTemporaryHome();
    setHomeOverride(home);
    const openerMarker = path.join(home, "browser-opened.txt");
    const openerDirectory = await writeBrowserOpener(home);
    const daemon = createDaemon({
      version: currentVersion,
      tray: "headless",
      port: 4567,
      webUrl: "http://127.0.0.1:4567/#token=headless",
    });
    expect(await daemon.start()).toBe(true);

    try {
      const result = await runCli(home, ["start"], {
        PATH: prependPath(openerDirectory),
        TEST_BROWSER_MARKER: openerMarker,
      });
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("skill-creator daemon is already running.");
      expect(result.stdout).toContain("skill-creator openinbrowser");
      expect(result.stdout).not.toContain("Opening browser:");
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(fs.existsSync(openerMarker)).toBe(false);
    } finally {
      await daemon.stop();
    }
  });

  it("does not downgrade open to a browser when the daemon is headless", async () => {
    const home = await createTemporaryHome();
    setHomeOverride(home);
    let openAttempts = 0;
    let daemon: IpcServer;
    daemon = new IpcServer({
      onStatus: () =>
        daemonStatus({
          version: currentVersion,
          tray: "headless",
          port: 4567,
          webUrl: "http://127.0.0.1:4567/#token=headless",
        }),
      onOpen: async () => {
        openAttempts += 1;
      },
      onStop: async () => async () => {
        await daemon.stop();
      },
    });
    expect(await daemon.start()).toBe(true);

    try {
      await expect(runCli(home, ["open"])).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining("skill-creator openinbrowser"),
      });
      expect(openAttempts).toBe(0);
    } finally {
      await daemon.stop();
    }
  });

  it("downgrades open to a browser launch when the daemon is in web mode", async () => {
    const home = await createTemporaryHome();
    setHomeOverride(home);
    let openAttempts = 0;
    const url = "http://127.0.0.1:4567/#token=web-mode";
    const openerMarker = path.join(home, "browser-opened.txt");
    const openerDirectory =
      process.platform === "win32" ? undefined : await writeBrowserOpener(home);
    let daemon: IpcServer;
    daemon = new IpcServer({
      onStatus: () =>
        daemonStatus({ version: currentVersion, tray: "web", port: 4567, webUrl: url }),
      onOpen: async () => {
        openAttempts += 1;
      },
      onStop: async () => async () => {
        await daemon.stop();
      },
    });
    expect(await daemon.start()).toBe(true);

    try {
      const result = await runCli(home, ["open"], {
        ...(openerDirectory ? { PATH: prependPath(openerDirectory) } : {}),
        TEST_BROWSER_MARKER: openerMarker,
      });
      expect(result.stdout).toContain(`Opening browser: ${url}`);
      // web 模式下 open 不发 IPC（CLI 直接打开浏览器），onOpen 不被调用。
      expect(openAttempts).toBe(0);
    } finally {
      await daemon.stop();
    }
  });

  if (process.platform !== "win32") {
    it("opens the authenticated WebUI URL only through openinbrowser", async () => {
      const home = await createTemporaryHome();
      setHomeOverride(home);
      const openerMarker = path.join(home, "browser-opened.txt");
      const openerDirectory = await writeBrowserOpener(home);
      const url = "http://127.0.0.1:4567/#token=explicit";
      const daemon = createDaemon({
        version: currentVersion,
        tray: "headless",
        port: 4567,
        webUrl: url,
      });
      expect(await daemon.start()).toBe(true);

      try {
        const result = await runCli(home, ["openinbrowser"], {
          PATH: prependPath(openerDirectory),
          TEST_BROWSER_MARKER: openerMarker,
        });
        expect(result.stderr).toBe("");
        expect(result.stdout).toContain(`Opening browser: ${url}`);
        await waitForFile(openerMarker);
        expect(await fs.promises.readFile(openerMarker, "utf8")).toBe(url);
      } finally {
        await daemon.stop();
      }
    });

    it("returns the WebUI URL when the system browser launcher is unavailable", async () => {
      const home = await createTemporaryHome();
      setHomeOverride(home);
      const url = "http://127.0.0.1:4567/#token=unavailable";
      const daemon = createDaemon({
        version: currentVersion,
        tray: "headless",
        port: 4567,
        webUrl: url,
      });
      expect(await daemon.start()).toBe(true);

      try {
        await expect(
          runCli(home, ["openinbrowser"], { PATH: path.join(home, "missing-browser-opener") }),
        ).rejects.toMatchObject({
          code: 1,
          stdout: expect.stringContaining(`Open this URL in your browser: ${url}`),
          stderr: expect.stringContaining("Failed to launch browser:"),
        });
      } finally {
        await daemon.stop();
      }
    });
  }

  it("reports stop success only after asynchronous teardown releases the socket", async () => {
    const home = await createTemporaryHome();
    setHomeOverride(home);
    let teardownCompleted = false;
    let daemon: IpcServer;
    daemon = new IpcServer({
      onStatus: () => daemonStatus({ version: currentVersion, tray: "mounted", port: 4567 }),
      onOpen: async () => {},
      onStop: async () => async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 75));
        await daemon.stop();
        teardownCompleted = true;
      },
    });
    expect(await daemon.start()).toBe(true);

    try {
      const result = await runCli(home, ["stop"]);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("skill-creator daemon stopped.");
      expect(teardownCompleted).toBe(true);
      if (process.platform !== "win32") expect(fs.existsSync(socketPath())).toBe(false);
    } finally {
      await daemon.stop();
    }
  });

  it("stops a development daemon when the production socket is absent", async () => {
    const productionHome = await createTemporaryHome();
    const developmentHome = await createTemporaryHome();
    setHomeOverride(developmentHome);
    let teardownCompleted = false;
    let daemon: IpcServer;
    daemon = new IpcServer({
      onStatus: () => daemonStatus({ version: currentVersion, tray: "mounted", port: 4567 }),
      onOpen: async () => {},
      onStop: async () => async () => {
        await daemon.stop();
        teardownCompleted = true;
      },
    });
    expect(await daemon.start()).toBe(true);

    try {
      const result = await runCli(productionHome, ["stop"], {
        SKILL_CREATOR_DEV_HOME: developmentHome,
      });
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("skill-creator development daemon stopped.");
      expect(teardownCompleted).toBe(true);
      expect(await socketAcceptsConnections(socketPath(developmentHome), 50)).toBe(false);
    } finally {
      await daemon.stop();
    }
  });

  it("starts a detached daemon when its Registry file is incompatible", async () => {
    const home = await createTemporaryHome();
    setHomeOverride(home);
    fs.mkdirSync(appDir(), { recursive: true });
    const registryFile = path.join(appDir(), "workspaces.json");
    const registrySource = JSON.stringify({ activeId: null, workspaces: [] });
    fs.writeFileSync(registryFile, registrySource, "utf8");

    try {
      const result = await runCli(home, ["start"]);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("skill-creator daemon started.");
      expect(await fs.promises.readFile(registryFile, "utf8")).toBe(registrySource);
      expect(await socketAcceptsConnections(socketPath(), 50)).toBe(true);
    } finally {
      if (await socketAcceptsConnections(socketPath(), 50)) {
        const result = await runCli(home, ["stop"]);
        expect(result.stdout).toContain("skill-creator daemon stopped.");
      }
    }
  }, 15_000);
});

function createDaemon(status: {
  version: string;
  tray: "starting" | "mounted" | "headless" | "web";
  trayError?: string;
  port?: number;
  webUrl?: string;
}): IpcServer {
  return new IpcServer({
    onStatus: () => daemonStatus(status),
    onOpen: async () => {},
    onStop: async () => async () => {},
  });
}

function daemonStatus(status: {
  version: string;
  tray: "starting" | "mounted" | "headless" | "web";
  trayError?: string;
  port?: number;
  webUrl?: string;
}) {
  return {
    active: true,
    pid: process.pid,
    version: status.version,
    port: status.port ?? 0,
    startedAt: 0,
    tray: status.tray,
    ...(status.trayError ? { trayError: status.trayError } : {}),
    ...(status.webUrl ? { webUrl: status.webUrl } : {}),
  };
}

async function createTemporaryHome(): Promise<string> {
  const directory = await fs.promises.mkdtemp("/tmp/sc-cli-test-");
  temporaryDirectories.push(directory);
  return directory;
}

async function runCli(
  home: string,
  args: string[],
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(process.execPath, ["--import", "tsx", cliEntry, ...args], {
    cwd: root,
    env: {
      ...process.env,
      ...extraEnv,
      OPENTRAY_HOME: path.join(home, "opentray-runtime"),
      SKILL_CREATOR_DISABLE_TRAY: "1",
      SKILL_CREATOR_HOME: home,
    },
    encoding: "utf8",
    timeout: 15_000,
  });
}

async function writeFixtureDaemon(home: string): Promise<string> {
  const entry = path.join(home, "fixture-daemon.ts");
  const ipcServerUrl = pathToFileURL(path.join(root, "src", "daemon", "ipc-server.ts")).href;
  const packageVersionUrl = pathToFileURL(
    path.join(root, "src", "daemon", "package-version.ts"),
  ).href;
  const source = `
import fs from "node:fs";
import { IpcServer } from ${JSON.stringify(ipcServerUrl)};
import { readPackageVersion } from ${JSON.stringify(packageVersionUrl)};

const marker = process.env.TEST_DAEMON_MARKER;
if (!marker) throw new Error("TEST_DAEMON_MARKER is required");
async function main(): Promise<void> {
  let daemon: IpcServer;
  try {
    const readyAt = Date.now() + 150;
    const version = readPackageVersion();
    daemon = new IpcServer({
      onStatus: () => ({
        active: true,
        pid: process.pid,
        version,
        port: Date.now() >= readyAt ? 4567 : 0,
        startedAt: Date.now(),
        tray: Date.now() >= readyAt ? "mounted" : "starting",
      }),
      onStop: async () => async () => {
          await daemon.stop();
          process.exit(0);
        },
      onOpen: async () => {
        if (Date.now() < readyAt) throw new Error("Tray window is unavailable.");
        setTimeout(() => void daemon.stop().then(() => process.exit(0)), 100);
      },
    });
    if (!(await daemon.start())) throw new Error("fixture daemon could not bind its socket");
    fs.writeFileSync(marker, String(process.pid));
  } catch (error) {
    fs.writeFileSync(
      marker + ".error",
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
    process.exit(3);
  }
}
void main();
`;
  await fs.promises.writeFile(entry, source, "utf8");
  return entry;
}

async function writeBrowserOpener(home: string): Promise<string> {
  const directory = path.join(home, "browser-opener");
  const binary = process.platform === "darwin" ? "open" : "xdg-open";
  const entry = path.join(directory, binary);
  const source = `#!/usr/bin/env node
const fs = require("node:fs");
const marker = process.env.TEST_BROWSER_MARKER;
if (!marker) throw new Error("TEST_BROWSER_MARKER is required");
fs.writeFileSync(marker, process.argv[2] ?? "", "utf8");
`;
  await fs.promises.mkdir(directory, { recursive: true });
  await fs.promises.writeFile(entry, source, "utf8");
  await fs.promises.chmod(entry, 0o755);
  return directory;
}

function prependPath(directory: string): string {
  return `${directory}${path.delimiter}${process.env.PATH ?? ""}`;
}

async function waitForFile(file: string, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for browser opener marker: ${file}`);
}
