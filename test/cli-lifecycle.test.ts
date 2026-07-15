/**
 * User input [2026-07-14]: "参考 ../../pnpm-pub 这个项目的架构：cli+gui(webui+opentray)"
 * Architecture decision [2026-07-14]: lifecycle behavior is verified through
 * the public CLI and framed IPC boundary.
 *
 * Orthogonal intents:
 *   [1] Start/replace a daemon and preserve actionable startup diagnostics.
 *   [2] Project tray/headless status through the CLI.
 *   [3] Wait through starting and mounted-before-openable races.
 *   [4] Report stop success only after asynchronous teardown releases the socket.
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
import { appDir, daemonLogPath, setHomeOverride, socketPath } from "../src/shared/paths.js";
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
        const mounted = statusChecks > 1;
        return daemonStatus({
          version: currentVersion,
          tray: mounted ? "mounted" : "starting",
          port: mounted ? 4567 : 0,
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
      expect(statusChecks).toBeGreaterThanOrEqual(3);
      expect(openAttempts).toBe(2);
    } finally {
      await daemon.stop();
    }
  });

  it("prints headless tray state and its failure", async () => {
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
      expect(result.stdout).toContain("tray:    headless");
      expect(result.stdout).toContain("tray error: runtime-binding: native package unavailable");
    } finally {
      await daemon.stop();
    }
  });

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

  it("records a strict Registry startup failure before the detached daemon exits", async () => {
    const home = await createTemporaryHome();
    setHomeOverride(home);
    fs.mkdirSync(appDir(), { recursive: true });
    const registryFile = path.join(appDir(), "workspaces.json");
    const registrySource = JSON.stringify({ activeId: "~", workspaces: [] });
    fs.writeFileSync(registryFile, registrySource, "utf8");

    let failure: unknown = null;
    try {
      await runCli(home, ["start"]);
    } catch (error) {
      failure = error;
    }

    if (!isCliExecutionFailure(failure)) {
      throw new Error(`Expected CLI execution to fail, received: ${String(failure)}`);
    }
    expect(failure.code).toBe(1);
    expect(failure.stderr).toContain(daemonLogPath());
    expect(await fs.promises.readFile(daemonLogPath(), "utf8")).toContain(
      "Invalid workspace registry",
    );
    expect(await fs.promises.readFile(registryFile, "utf8")).toBe(registrySource);
    expect(await socketAcceptsConnections(socketPath(), 50)).toBe(false);
    if (process.platform !== "win32") expect(fs.existsSync(socketPath())).toBe(false);
  }, 15_000);
});

function createDaemon(status: {
  version: string;
  tray: "starting" | "mounted" | "headless";
  trayError?: string;
}): IpcServer {
  return new IpcServer({
    onStatus: () => daemonStatus(status),
    onOpen: async () => {},
    onStop: async () => async () => {},
  });
}

function daemonStatus(status: {
  version: string;
  tray: "starting" | "mounted" | "headless";
  trayError?: string;
  port?: number;
}) {
  return {
    active: true,
    pid: process.pid,
    version: status.version,
    port: status.port ?? 0,
    startedAt: 0,
    tray: status.tray,
    ...(status.trayError ? { trayError: status.trayError } : {}),
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
    env: { ...process.env, ...extraEnv, SKILL_CREATOR_HOME: home },
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

interface CliExecutionFailure {
  code: number;
  stderr: string;
}

function isCliExecutionFailure(value: unknown): value is CliExecutionFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof value.code === "number" &&
    "stderr" in value &&
    typeof value.stderr === "string"
  );
}
