/**
 * skills.search RPC 集成测试（skill-search-integration C1）。
 *
 * 用户原始需求 [2026-09-17]：「最终我们还需要将这个 search 能力内化到内核中和
 * GUI 中，在任何需要搜索 skills 的地方都进行升级。」
 *
 * 正交意图：
 *   [1] 真实 domain + oRPC client 的端到端检索（沙箱 HOME/状态目录隔离，不索引
 *       真实机器——global roots 经 os.homedir()/XDG/provider overrides 解析）。
 *   [2] 输入合同：空 query = 输入校验 typed 错误（schema min(1)，不产生伪成功）。
 *   [3] limit 透传边界。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ORPCError, createRouterClient } from "@orpc/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDaemonDomain, type DaemonDomain } from "../src/daemon/domain.js";
import { deterministicSkillsCliProbe } from "./helpers/deterministic-probe.js";
import { createRpcRouter } from "../src/daemon/rpc-router.js";
import { setHomeOverride } from "../src/shared/paths.js";

/** provider catalog 的 Global root env overrides（照 skill-search-cli.test.ts 的隔离集）。 */
const PROVIDER_HOME_OVERRIDES = [
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "VIBE_HOME",
  "HERMES_HOME",
  "AUTOHAND_HOME",
  "GROK_HOME",
] as const;

let sandbox = "";
const previousEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "sc-rpc-search-test-"));
  const home = path.join(sandbox, "home");
  const isolatedState = path.join(sandbox, "state");
  for (const name of [
    "HOME",
    "SKILL_CREATOR_HOME",
    "XDG_CONFIG_HOME",
    ...PROVIDER_HOME_OVERRIDES,
  ]) {
    previousEnv[name] = process.env[name];
  }
  for (const name of PROVIDER_HOME_OVERRIDES) delete process.env[name];
  process.env.HOME = home;
  process.env.SKILL_CREATOR_HOME = isolatedState;
  process.env.XDG_CONFIG_HOME = path.join(home, ".config");
  setHomeOverride(isolatedState);
});

afterEach(() => {
  setHomeOverride(null);
  for (const name of [
    "HOME",
    "SKILL_CREATOR_HOME",
    "XDG_CONFIG_HOME",
    ...PROVIDER_HOME_OVERRIDES,
  ]) {
    const previous = previousEnv[name];
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
    delete previousEnv[name];
  }
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function createClient(
  domain: DaemonDomain = createDaemonDomain(undefined, {
    skillsCliProbe: deterministicSkillsCliProbe(),
  }),
) {
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
      domain,
    }),
  );
}

/** 在沙箱 Global root（~/.claude/skills）写一个真实形态 SKILL.md。 */
function writeGlobalSkill(name: string, description: string): string {
  const directory = path.join(sandbox, "home", ".claude", "skills", name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n\nBody of ${name}.\n`,
  );
  return directory;
}

describe("skills.search RPC (skill-search-integration C1)", () => {
  it("returns scoped results with a stable id, canonical path, and content hash", async () => {
    const client = createClient();
    const reactDirectory = writeGlobalSkill(
      "react-component-design",
      "Design React components with care.",
    );
    writeGlobalSkill("typescript-type-safety", "TypeScript 类型安全指南。");

    const { results } = await client.skills.search({ query: "React组件设计" });
    expect(results.length).toBeGreaterThan(0);
    const top = results[0]!;
    expect(top.name).toBe("react-component-design");
    expect(top.id).toMatch(/^sk_[a-f0-9]{24}$/);
    expect(top.canonicalPath).toBe(fs.realpathSync(reactDirectory));
    expect(top.installations).toEqual([
      {
        path: reactDirectory,
        workspaceId: "~",
        providerId: "claude-code",
      },
    ]);
    expect(top.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(Number.isFinite(top.score)).toBe(true);
  });

  it("rejects an empty query as an input-validation error instead of pseudo-success", async () => {
    const client = createClient();
    writeGlobalSkill("any-skill", "Any skill.");

    try {
      await client.skills.search({ query: "" });
      expect.fail("Expected the empty query to be rejected.");
    } catch (error) {
      expect(error).toBeInstanceOf(ORPCError);
      if (!(error instanceof ORPCError)) throw error;
      expect(error.code).toBe("BAD_REQUEST");
      expect(error.message).toBe("Input validation failed");
    }
  });

  it("passes the limit option through to the ranking stage", async () => {
    const client = createClient();
    for (let index = 0; index < 3; index += 1) {
      writeGlobalSkill(`react-skill-${index}`, `React skill number ${index}.`);
    }
    const { results } = await client.skills.search({ query: "react", limit: 1 });
    expect(results).toHaveLength(1);
  });
});
describe("skills.search typed IO failure boundary", () => {
  it("projects index IO failures as typed UNAVAILABLE instead of internal errors", async () => {
    // 复现评审探针：损坏索引 + appDir 只读 → freshen 重建落盘失败必须以 typed
    // UNAVAILABLE 跨 RPC 边界，而不是 INTERNAL_SERVER_ERROR。
    writeGlobalSkill("alpha", "alpha skill body");
    const client = createClient();
    const appDataDir = path.join(sandbox, "state", ".skill-creator");
    fs.mkdirSync(appDataDir, { recursive: true });
    fs.writeFileSync(path.join(appDataDir, "search-index.json"), "{ not json");
    fs.chmodSync(appDataDir, 0o500);
    try {
      await expect(client.skills.search({ query: "alpha" })).rejects.toMatchObject({
        code: "UNAVAILABLE",
      });
    } finally {
      fs.chmodSync(appDataDir, 0o700);
    }
  });
});
