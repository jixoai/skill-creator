/**
 * User input [2026-07-21]: pnpm dev must replace a previous production or development runtime.
 * Orthogonal intents:
 * 1. Stop known daemon owners before development claims OpenTray's single session.
 * 2. Wait for both each process and IPC endpoint to be fully released.
 * 3. Treat absent, duplicate, or concurrently exiting endpoints as idempotent no-ops.
 */
import fs from "node:fs";
import os from "node:os";
import { DaemonConnectionError, requestDaemon } from "../../src/cli/ipc-client.js";
import { readCliVersion } from "../../src/cli/package-version.js";
import { DaemonStatusSchema } from "../../src/shared/contracts/daemon.js";
import { resolveDevHome } from "../../src/shared/dev-runtime.js";
import { socketPath } from "../../src/shared/paths.js";
import { socketAcceptsConnections } from "../../src/shared/socket-liveness.js";

const DEFAULT_RELEASE_TIMEOUT_MS = 8_000;
export const SKILL_CREATOR_DEV_PRODUCTION_HOME_ENV = "SKILL_CREATOR_DEV_PRODUCTION_HOME";

export interface ExistingDaemonTakeoverResult {
  production: boolean;
  development: boolean;
}

/** Release known daemon owners before a replacement development session starts. */
export async function stopExistingDaemonsForDev(
  options: {
    productionHomeDir?: string;
    developmentHomeDir?: string;
    clientVersion?: string;
    releaseTimeoutMs?: number;
    processIsAlive?: (pid: number) => boolean;
  } = {},
): Promise<ExistingDaemonTakeoverResult> {
  const productionEndpoint = socketPath(
    options.productionHomeDir ?? process.env[SKILL_CREATOR_DEV_PRODUCTION_HOME_ENV] ?? os.homedir(),
  );
  const developmentEndpoint = socketPath(options.developmentHomeDir ?? resolveDevHome());
  const commonOptions = {
    ...(options.clientVersion === undefined ? {} : { clientVersion: options.clientVersion }),
    ...(options.releaseTimeoutMs === undefined
      ? {}
      : { releaseTimeoutMs: options.releaseTimeoutMs }),
    ...(options.processIsAlive === undefined ? {} : { processIsAlive: options.processIsAlive }),
  };
  const production = await stopDaemonForDev(productionEndpoint, "production", commonOptions);
  const development =
    developmentEndpoint === productionEndpoint
      ? false
      : await stopDaemonForDev(developmentEndpoint, "development", commonOptions);
  return { production, development };
}

async function stopDaemonForDev(
  endpoint: string,
  runtime: "production" | "development",
  options: {
    clientVersion?: string;
    releaseTimeoutMs?: number;
    processIsAlive?: (pid: number) => boolean;
  },
): Promise<boolean> {
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
    throw new Error(`${runtime} daemon returned an invalid status response during takeover`);
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
    `${runtime} daemon did not fully release: pid=${status.data.pid}; endpoint=${endpoint}`,
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
