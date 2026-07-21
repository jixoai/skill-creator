/**
 * User input [2026-07-21]: pnpm dev must mount the tray after a production start.
 * Orthogonal intents:
 * 1. Stop the production daemon before development claims OpenTray's single session.
 * 2. Wait for both the production process and IPC endpoint to be fully released.
 * 3. Treat an absent or concurrently exiting production daemon as an idempotent no-op.
 */
import fs from "node:fs";
import os from "node:os";
import { DaemonConnectionError, requestDaemon } from "../../src/cli/ipc-client.js";
import { readCliVersion } from "../../src/cli/package-version.js";
import { DaemonStatusSchema } from "../../src/shared/contracts/daemon.js";
import { socketPath } from "../../src/shared/paths.js";
import { socketAcceptsConnections } from "../../src/shared/socket-liveness.js";

const DEFAULT_RELEASE_TIMEOUT_MS = 8_000;
export const SKILL_CREATOR_DEV_PRODUCTION_HOME_ENV = "SKILL_CREATOR_DEV_PRODUCTION_HOME";

/** Release the production daemon so development can own the shared app identity. */
export async function stopProductionDaemonForDev(
  options: {
    homeDir?: string;
    clientVersion?: string;
    releaseTimeoutMs?: number;
    processIsAlive?: (pid: number) => boolean;
  } = {},
): Promise<boolean> {
  const endpoint = socketPath(
    options.homeDir ?? process.env[SKILL_CREATOR_DEV_PRODUCTION_HOME_ENV] ?? os.homedir(),
  );
  if (!(await socketAcceptsConnections(endpoint, 100))) return false;
  const clientVersion = options.clientVersion ?? readCliVersion();

  const status = DaemonStatusSchema.safeParse(
    await requestDaemon({
      socket: endpoint,
      clientVersion,
      command: { type: "status" },
    }),
  );
  if (!status.success) {
    throw new Error("production daemon returned an invalid status response during takeover");
  }

  try {
    await requestDaemon({
      socket: endpoint,
      clientVersion,
      command: { type: "stop" },
    });
  } catch (error) {
    if (
      error instanceof DaemonConnectionError &&
      !(await socketAcceptsConnections(endpoint, 100))
    ) {
      return false;
    }
    throw error;
  }

  const deadline = Date.now() + (options.releaseTimeoutMs ?? DEFAULT_RELEASE_TIMEOUT_MS);
  const processIsAlive = options.processIsAlive ?? isProcessAlive;
  while (Date.now() < deadline) {
    const acceptsConnections = await socketAcceptsConnections(endpoint, 100);
    const endpointRemoved = process.platform === "win32" || !fs.existsSync(endpoint);
    if (!acceptsConnections && endpointRemoved && !processIsAlive(status.data.pid)) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(
    `production daemon did not fully release: pid=${status.data.pid}; endpoint=${endpoint}`,
  );
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    return code !== "ESRCH";
  }
}
