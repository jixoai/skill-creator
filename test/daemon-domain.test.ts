/**
 * Daemon domain startup boundary tests.
 *
 * User input [2026-07-15]: "按照你自己的节奏去推进开发迭代。"
 * User input [2026-07-21]: "遇到不兼容的就当是空值。"
 * Architecture decision [2026-07-21]: an incompatible persisted Registry must
 * start as empty instead of leaving the daemon half-started.
 *
 * Orthogonal intents:
 *   [1] Start a daemon with an incompatible private Registry state.
 *   [2] Release the acquired IPC singleton lock after normal shutdown.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootDaemon } from "../src/daemon/index.js";
import { IpcServer } from "../src/daemon/ipc-server.js";
import { appDir, setHomeOverride } from "../src/shared/paths.js";

const previousHome = process.env.SKILL_CREATOR_HOME;
let sandbox = "";

beforeEach(() => {
  const prefix =
    process.platform === "win32" ? path.join(os.tmpdir(), "sc-domain-") : "/tmp/sc-domain-";
  sandbox = fs.mkdtempSync(prefix);
  const isolatedHome = path.join(sandbox, "state");
  process.env.SKILL_CREATOR_HOME = isolatedHome;
  setHomeOverride(isolatedHome);
});

afterEach(() => {
  setHomeOverride(null);
  if (previousHome === undefined) delete process.env.SKILL_CREATOR_HOME;
  else process.env.SKILL_CREATOR_HOME = previousHome;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("daemon domain startup", () => {
  it("starts and releases IPC ownership when the Workspace Registry is incompatible", async () => {
    fs.mkdirSync(appDir(), { recursive: true });
    fs.writeFileSync(
      path.join(appDir(), "workspaces.json"),
      JSON.stringify({ activeId: null, workspaces: [] }),
      "utf8",
    );

    const daemon = await bootDaemon({ cliVersion: "test", withTray: false, exitProcess: () => {} });
    if (!daemon) throw new Error("Expected the daemon to acquire its isolated IPC endpoint.");
    await daemon.stop();

    const probe = new IpcServer({
      onStatus: () => ({
        active: true,
        pid: process.pid,
        version: "test",
        port: 0,
        startedAt: 0,
        tray: "headless",
      }),
      onOpen: () => Promise.resolve(),
      onStop: () => Promise.resolve(async () => {}),
    });
    expect(await probe.start()).toBe(true);
    await probe.stop();
  });
});
