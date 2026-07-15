/**
 * Daemon domain startup boundary tests.
 *
 * User input [2026-07-15]: "按照你自己的节奏去推进开发迭代。"
 * Architecture decision [2026-07-15]: invalid strict Registry state must not
 * leave the daemon half-started after it acquires IPC ownership.
 *
 * Orthogonal intents:
 *   [1] Reject incompatible private registry state during daemon startup.
 *   [2] Release the acquired IPC singleton lock after composition failure.
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
  it("releases IPC ownership when the Workspace Registry cannot load", async () => {
    fs.mkdirSync(appDir(), { recursive: true });
    fs.writeFileSync(
      path.join(appDir(), "workspaces.json"),
      JSON.stringify({ activeId: "~", workspaces: [] }),
      "utf8",
    );

    await expect(
      bootDaemon({ cliVersion: "test", withTray: false, exitProcess: () => {} }),
    ).rejects.toThrow("Invalid workspace registry");

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
