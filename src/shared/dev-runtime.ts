/**
 * User input [2026-07-21]: repeated `pnpm dev` must replace an existing Dock-launched dev runtime.
 * Orthogonal intents:
 * 1. Define the explicit development-home override shared by Vite, daemon, and CLI.
 * 2. Resolve the short platform development home required by Unix socket limits.
 */
import os from "node:os";
import path from "node:path";

/** Explicit development runtime home used by developer-facing lifecycle commands. */
export const SKILL_CREATOR_DEV_HOME_ENV = "SKILL_CREATOR_DEV_HOME";

/** Resolve the isolated home used by the Vite-owned development daemon. */
export function resolveDevHome(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
  temporaryDirectory = os.tmpdir(),
): string {
  const explicitDevHome = env[SKILL_CREATOR_DEV_HOME_ENV];
  if (explicitDevHome) return explicitDevHome;
  if (env.SKILL_CREATOR_HOME) return env.SKILL_CREATOR_HOME;
  return platform === "win32"
    ? path.join(temporaryDirectory, "skill-creator-v2-dev")
    : "/tmp/sc-v2";
}
