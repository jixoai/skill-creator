/**
 * User input [2026-07-21]: "pnpm dev must replace previous production and development runtimes."
 * Orthogonal intents:
 * 1. Prove development startup releases the production daemon before claiming OpenTray.
 * 2. Prove an absent production daemon remains an idempotent no-op.
 * 3. Prove a replacement development session releases the previous development owner.
 */
import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { readCliVersion } from "../src/cli/package-version.js";
import { IpcServer } from "../src/daemon/ipc-server.js";
import { setHomeOverride, socketPath } from "../src/shared/paths.js";
import { socketAcceptsConnections } from "../src/shared/socket-liveness.js";
import { stopExistingDaemonsForDev } from "../webui/config/dev-runtime-takeover.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  setHomeOverride(null);
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.promises.rm(directory, { recursive: true, force: true })),
  );
});

describe("development runtime takeover", () => {
  it("stops the production daemon and waits for its socket to be released", async () => {
    const productionHome = await createTemporaryHome();
    const developmentHome = await createTemporaryHome();
    setHomeOverride(productionHome);
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
      stopExistingDaemonsForDev({
        productionHomeDir: productionHome,
        developmentHomeDir: developmentHome,
        clientVersion: readCliVersion(),
        processIsAlive: () => !stopped,
      }),
    ).resolves.toEqual({ production: true, development: false });

    expect(stopped).toBe(true);
    expect(await socketAcceptsConnections(socketPath(productionHome), 50)).toBe(false);
  });

  it("does nothing when no known daemon owns a socket", async () => {
    const productionHome = await createTemporaryHome();
    const developmentHome = await createTemporaryHome();

    await expect(
      stopExistingDaemonsForDev({
        productionHomeDir: productionHome,
        developmentHomeDir: developmentHome,
        clientVersion: readCliVersion(),
      }),
    ).resolves.toEqual({ production: false, development: false });
  });

  it("stops the previous development daemon before starting its replacement", async () => {
    const productionHome = await createTemporaryHome();
    const developmentHome = await createTemporaryHome();
    setHomeOverride(developmentHome);
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

    try {
      await expect(
        stopExistingDaemonsForDev({
          productionHomeDir: productionHome,
          developmentHomeDir: developmentHome,
          clientVersion: readCliVersion(),
          processIsAlive: () => !stopped,
        }),
      ).resolves.toEqual({ production: false, development: true });

      expect(stopped).toBe(true);
      expect(await socketAcceptsConnections(socketPath(developmentHome), 50)).toBe(false);
    } finally {
      await daemon.stop();
    }
  });
});

async function createTemporaryHome(): Promise<string> {
  const directory = await fs.promises.mkdtemp("/tmp/sc-dev-takeover-");
  temporaryDirectories.push(directory);
  return directory;
}
