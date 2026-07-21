/**
 * User input [2026-07-21]: Dock cold launch must use the Skill Creator lifecycle entry.
 * Orthogonal intents:
 * 1. Prove built daemons persist `cli.js start`, not the raw daemon entry.
 * 2. Preserve the direct-source Bun entry for source daemon development.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveDaemonAppLaunch } from "../src/daemon/app-launch.js";

describe("daemon app launch vector", () => {
  it("routes a built daemon through the public CLI start command", () => {
    const packageRoot = path.join(path.parse(process.cwd()).root, "opt", "skill-creator");
    const runtimeExecutable = path.join(packageRoot, "runtime", "node");
    expect(
      resolveDaemonAppLaunch(
        pathToFileURL(path.join(packageRoot, "dist", "daemon.js")).href,
        runtimeExecutable,
      ),
    ).toEqual({
      command: runtimeExecutable,
      args: [path.join(packageRoot, "dist", "cli.js"), "start"],
      cwd: packageRoot,
    });
  });

  it("routes a source daemon through the TypeScript CLI entry", () => {
    const packageRoot = path.join(path.parse(process.cwd()).root, "opt", "skill-creator");
    const runtimeExecutable = path.join(packageRoot, "runtime", "bun");
    expect(
      resolveDaemonAppLaunch(
        pathToFileURL(path.join(packageRoot, "src", "daemon", "main.ts")).href,
        runtimeExecutable,
      ),
    ).toEqual({
      command: runtimeExecutable,
      args: [path.join(packageRoot, "src", "cli", "cli.ts"), "start"],
      cwd: packageRoot,
    });
  });
});
