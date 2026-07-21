/**
 * User input [2026-07-21]: "pnpm dev must still mount the tray after production start."
 * Orthogonal intents:
 * 1. Prove development startup releases the production daemon before claiming OpenTray.
 * 2. Prove an absent production daemon remains an idempotent no-op.
 */
import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { readCliVersion } from "../src/cli/package-version.js";
import { IpcServer } from "../src/daemon/ipc-server.js";
import { setHomeOverride, socketPath } from "../src/shared/paths.js";
import { socketAcceptsConnections } from "../src/shared/socket-liveness.js";
import { stopProductionDaemonForDev } from "../webui/config/dev-production-takeover.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  setHomeOverride(null);
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.promises.rm(directory, { recursive: true, force: true })),
  );
});

describe("development production takeover", () => {
  it("stops the production daemon and waits for its socket to be released", async () => {
    const home = await createTemporaryHome();
    setHomeOverride(home);
    let stopped = false;
    let daemon: IpcServer;
    daemon = new IpcServer({
      onStatus: () => ({
        active: true,
        pid: process.pid,
        version: readCliVersion(),
        port: 4567,
        startedAt: 0,
        tray: "mounted",
      }),
      onOpen: async () => {},
      onStop: async () => async () => {
        await daemon.stop();
        stopped = true;
      },
    });
    expect(await daemon.start()).toBe(true);

    await expect(
      stopProductionDaemonForDev({
        homeDir: home,
        clientVersion: readCliVersion(),
        processIsAlive: () => !stopped,
      }),
    ).resolves.toBe(true);

    expect(stopped).toBe(true);
    expect(await socketAcceptsConnections(socketPath(home), 50)).toBe(false);
  });

  it("does nothing when no production daemon owns the socket", async () => {
    const home = await createTemporaryHome();

    await expect(
      stopProductionDaemonForDev({ homeDir: home, clientVersion: readCliVersion() }),
    ).resolves.toBe(false);
  });
});

async function createTemporaryHome(): Promise<string> {
  const directory = await fs.promises.mkdtemp("/tmp/sc-dev-takeover-");
  temporaryDirectories.push(directory);
  return directory;
}
