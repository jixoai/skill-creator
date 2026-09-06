/**
 * Repository sources RPC integration tests.
 *
 * User input [2026-07-27]: "Discover home Tab 卡片数据来自 repository.sources.list RPC；
 * 浏览器永远经 RPC 读写，不直接读盘。"
 * Architecture decision [2026-07-27]: sources.list/add/remove are wired through the oRPC
 * contract → router → SourceRegistry, with built-in ids protected and https-only URLs enforced.
 *
 * Orthogonal intents:
 *   [1] Exercise the sources.* RPCs through the public router client.
 *   [2] Prove built-in curated sources are listed and protected; invalid URLs are rejected at RPC.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ORPCError, createRouterClient } from "@orpc/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDaemonDomain } from "../src/daemon/domain.js";
import { deterministicSkillsCliProbe } from "./helpers/deterministic-probe.js";
import { createRpcRouter } from "../src/daemon/rpc-router.js";
import { CURATED_SOURCES } from "../src/shared/curated-sources.js";
import { setHomeOverride } from "../src/shared/paths.js";

const previousHome = process.env.SKILL_CREATOR_HOME;
let sandbox = "";

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-sources-rpc-"));
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

function createClient() {
  return createRouterClient(
    createRpcRouter({
      status: () => ({
        active: true,
        pid: process.pid,
        version: "test",
        port: 0,
        startedAt: 0,
        tray: "headless",
      }),
      domain: createDaemonDomain(undefined, { skillsCliProbe: deterministicSkillsCliProbe() }),
    }),
  );
}

describe("repository.sources RPC", () => {
  it("lists curated built-in sources through the router client", async () => {
    const client = createClient();
    const { builtIn, user } = await client.repository.sources.list({});
    expect(user).toEqual([]);
    expect(builtIn.map((entry) => entry.id)).toEqual(CURATED_SOURCES.map((entry) => entry.id));
  });

  it("adds a user source and reflects it in list", async () => {
    const client = createClient();
    const { source } = await client.repository.sources.add({
      label: "Custom",
      gitUrl: "https://github.com/me/skills.git",
      description: "my custom repo",
    });
    expect(source.id.startsWith("user_")).toBe(true);
    const { user } = await client.repository.sources.list({});
    expect(user).toHaveLength(1);
    expect(user[0]?.label).toBe("Custom");
  });

  it("removes a user source through the router client", async () => {
    const client = createClient();
    const { source } = await client.repository.sources.add({
      label: "Temp",
      gitUrl: "https://github.com/me/temp.git",
    });
    const result = await client.repository.sources.remove({ id: source.id });
    expect(result).toEqual({ removed: true });
    const { user } = await client.repository.sources.list({});
    expect(user).toEqual([]);
  });

  it("rejects non-https URLs at the RPC boundary (does not write)", async () => {
    const client = createClient();
    await expect(
      client.repository.sources.add({
        label: "Bad",
        gitUrl: "git@github.com:me/skills.git",
      }),
    ).rejects.toBeInstanceOf(ORPCError);
    const { user } = await client.repository.sources.list({});
    expect(user).toEqual([]);
    expect(fs.existsSync(path.join(sandbox, "state", ".skill-creator", "sources.json"))).toBe(
      false,
    );
  });

  it("persists user sources across daemon domain recreation", async () => {
    const clientA = createClient();
    await clientA.repository.sources.add({
      label: "Persist",
      gitUrl: "https://github.com/me/persist.git",
    });
    const clientB = createClient();
    const { user } = await clientB.repository.sources.list({});
    expect(user).toHaveLength(1);
    expect(user[0]?.gitUrl).toBe("https://github.com/me/persist.git");
  });
});
