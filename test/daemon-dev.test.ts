/**
 * Vite-owned development daemon lifecycle tests.
 *
 * User input [2026-07-15]: "按照你自己的节奏去推进开发迭代。"
 * Architecture decision [2026-07-15]: a Vite config restart must await the
 * previous daemon's release before the replacement server starts a new child.
 *
 * Orthogonal intents:
 *   [1] Exercise the real Vite restart order against a singleton fake daemon.
 *   [2] Prove duplicate closeBundle hooks terminate each child exactly once.
 *   [3] Model the absolute package-manager entry guaranteed by pnpm dev.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execa } from "execa";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");

describe("Vite development daemon", () => {
  it.skipIf(process.platform === "win32")(
    "releases the old singleton before a config restart starts its replacement",
    async () => {
      const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-vite-restart-"));
      try {
        const binDirectory = path.join(fixture, "bin");
        const appRoot = path.join(fixture, "app");
        const eventsFile = path.join(fixture, "daemon.events");
        const configFile = path.join(fixture, "vite.config.ts");
        const harnessFile = path.join(fixture, "harness.mjs");
        fs.mkdirSync(binDirectory);
        fs.mkdirSync(appRoot);
        fs.writeFileSync(path.join(appRoot, "index.html"), '<div id="app"></div>');
        writeFakeBun(path.join(binDirectory, "bun"));
        fs.writeFileSync(configFile, viteConfigSource(appRoot));
        fs.writeFileSync(harnessFile, harnessSource(configFile, eventsFile));

        const result = await execa(process.execPath, [harnessFile], {
          env: {
            ...process.env,
            PATH: `${binDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
            npm_execpath: path.join(fixture, "pnpm.cjs"),
            SKILL_CREATOR_VITE_RESTART_FIXTURE: fixture,
          },
          reject: false,
          timeout: 15_000,
        });

        const events = readLines(eventsFile);
        expect(result.exitCode, [result.stderr, result.stdout].filter(Boolean).join("\n")).toBe(0);
        expect(result.stdout).toContain("[HARNESS] survived restart");
        expect(events.filter((event) => event.startsWith("spawn "))).toHaveLength(2);
        expect(events.filter((event) => event.startsWith("acquired "))).toHaveLength(2);
        expect(events.filter((event) => event.startsWith("contended "))).toHaveLength(0);

        const acquiredPids = events
          .filter((event) => event.startsWith("acquired "))
          .map((event) => event.slice("acquired ".length));
        for (const pid of acquiredPids) {
          expect(events.filter((event) => event === `sigterm ${pid}`)).toHaveLength(1);
        }
      } finally {
        fs.rmSync(fixture, { recursive: true, force: true });
      }
    },
  );
});

function viteConfigSource(appRoot: string): string {
  const viteUrl = pathToFileURL(
    path.join(repoRoot, "webui/node_modules/vite/dist/node/index.js"),
  ).href;
  const pluginUrl = pathToFileURL(path.join(repoRoot, "webui/config/daemon-dev.ts")).href;
  return `
import { defineConfig } from ${JSON.stringify(viteUrl)};
import { skillCreatorDaemonDev } from ${JSON.stringify(pluginUrl)};

export default defineConfig({
  logLevel: "silent",
  plugins: [skillCreatorDaemonDev()],
  root: ${JSON.stringify(appRoot)},
  server: { host: "127.0.0.1", port: 0, strictPort: true },
});
`;
}

function harnessSource(configFile: string, eventsFile: string): string {
  const viteUrl = pathToFileURL(
    path.join(repoRoot, "webui/node_modules/vite/dist/node/index.js"),
  ).href;
  return `
import fs from "node:fs";
import { createServer } from ${JSON.stringify(viteUrl)};

delete process.env.SKILL_CREATOR_DEV_DAEMON_PORT;
const eventsFile = ${JSON.stringify(eventsFile)};
const server = await createServer({ configFile: ${JSON.stringify(configFile)} });
await server.listen();
await waitFor(() => count("acquired ") === 1);
await server.restart();
await waitFor(() => count("spawn ") === 2);
if (count("contended ") > 0) throw new Error("replacement daemon raced old ownership");
console.log("[HARNESS] survived restart");
await server.close();

function count(prefix) {
  try {
    return fs.readFileSync(eventsFile, "utf8").split("\\n").filter((line) => line.startsWith(prefix)).length;
  } catch {
    return 0;
  }
}

async function waitFor(predicate) {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("fixture timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
`;
}

function writeFakeBun(file: string): void {
  fs.writeFileSync(
    file,
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const root = process.env.SKILL_CREATOR_VITE_RESTART_FIXTURE;
if (!root) process.exit(2);
const events = path.join(root, "daemon.events");
const lock = path.join(root, "daemon.lock");
const pid = String(process.pid);
const record = (event) => fs.appendFileSync(events, event + " " + pid + "\\n");
record("spawn");

try {
  const owner = Number(fs.readFileSync(lock, "utf8"));
  try {
    process.kill(owner, 0);
    record("contended");
    process.exit(0);
  } catch {
    fs.rmSync(lock, { force: true });
  }
} catch {}

fs.writeFileSync(lock, pid, { flag: "wx" });
record("acquired");
const cleanup = () => {
  try {
    if (fs.readFileSync(lock, "utf8") === pid) fs.rmSync(lock, { force: true });
  } catch {}
};
process.on("exit", cleanup);
process.on("SIGTERM", () => {
  record("sigterm");
  setTimeout(() => {
    cleanup();
    process.exit(0);
  }, 75);
});

const supervisor = Number(process.env.SKILL_CREATOR_DEV_SUPERVISOR_PID);
setInterval(() => {
  try {
    process.kill(supervisor, 0);
  } catch {
    process.exit(0);
  }
}, 50);
`,
    { mode: 0o755 },
  );
}

function readLines(file: string): string[] {
  try {
    return fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}
