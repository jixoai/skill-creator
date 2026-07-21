/**
 * User input [2026-07-21]: the stable Dock entry must start or reopen Skill Creator.
 * Orthogonal intents:
 * 1. Resolve the public CLI lifecycle entry beside the running daemon artifact.
 * 2. Persist a shell-free absolute Node command that works without Finder PATH.
 * 3. Keep source-mode Bun execution usable for direct daemon development.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { OpenTrayAppLaunchOptions } from "opentray";

/** Resolve the stable application entry for a production or direct-source daemon. */
export function resolveDaemonAppLaunch(
  daemonModuleUrl: string,
  runtimeExecutable = process.execPath,
): OpenTrayAppLaunchOptions {
  const daemonEntry = fileURLToPath(daemonModuleUrl);
  const daemonDirectory = path.dirname(daemonEntry);
  const sourceMode = path.basename(daemonEntry) === "main.ts";
  const cliEntry = sourceMode
    ? path.resolve(daemonDirectory, "../cli/cli.ts")
    : path.join(daemonDirectory, "cli.js");
  const packageRoot = sourceMode
    ? path.resolve(daemonDirectory, "../..")
    : path.resolve(daemonDirectory, "..");

  return {
    command: runtimeExecutable,
    args: [cliEntry, "start"],
    cwd: packageRoot,
  };
}
