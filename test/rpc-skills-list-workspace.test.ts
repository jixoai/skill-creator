/**
 * skills.listWorkspace RPC 集成测试（skills-dashboard task 1.1；design §5/§7）。
 *
 * 用户原始需求 [2026-10-03]（spec skill-registry Scenario 集）：
 * 「单次响应有界 / limit 越界是校验错误 / 单 provider 失败隔离 / Global 读取
 * 同形 / q 预过滤为包含式且与游标兼容 / 排序与续页不重不漏 / duplicates 投影
 * 双层有界」——本文件以真实 domain + oRPC client 端到端钉死契约面。
 *
 * 正交意图：
 *   [1] 真实 domain 的 Global 聚合（provider 计数 + 平铺行 + duplicates 同源投影）。
 *   [2] 输入合同：limit>500 / 非法 cursor = BAD_REQUEST；未知 wsId = NOT_FOUND。
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

/** provider catalog 的 Global root env overrides（照 rpc-search.test.ts 的隔离集）。 */
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
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "sc-rpc-list-workspace-"));
  const home = path.join(sandbox, "home");
  const isolatedState = path.join(sandbox, "state");
  for (const name of [
    "HOME",
    "USERPROFILE",
    "SKILL_CREATOR_HOME",
    "XDG_CONFIG_HOME",
    ...PROVIDER_HOME_OVERRIDES,
  ]) {
    previousEnv[name] = process.env[name];
  }
  for (const name of PROVIDER_HOME_OVERRIDES) delete process.env[name];
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.SKILL_CREATOR_HOME = isolatedState;
  process.env.XDG_CONFIG_HOME = path.join(home, ".config");
  setHomeOverride(isolatedState);
});

afterEach(async () => {
  setHomeOverride(null);
  for (const name of [
    "HOME",
    "USERPROFILE",
    "SKILL_CREATOR_HOME",
    "XDG_CONFIG_HOME",
    ...PROVIDER_HOME_OVERRIDES,
  ]) {
    const previous = previousEnv[name];
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
    delete previousEnv[name];
  }
  // skillSearch 持有 sqlite 引擎句柄：dispose 是 async 完成屏障（Windows EPERM 防线）。
  for (const domain of createdDomains) await domain.skillSearch.dispose();
  createdDomains.length = 0;
  fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 10 });
});

const createdDomains: DaemonDomain[] = [];

function createClient() {
  const domain = createDaemonDomain(undefined, {
    skillsCliProbe: deterministicSkillsCliProbe(),
  });
  createdDomains.push(domain);
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

/** 在沙箱 Global root（~/.claude/skills | ~/.codex/skills）写一个真实形态 SKILL.md。 */
function writeGlobalSkill(
  root: ".claude" | ".codex",
  name: string,
  description: string,
  body = "Body",
): string {
  const directory = path.join(sandbox, "home", root, "skills", name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n\n${body}\n`,
  );
  return directory;
}

describe("skills.listWorkspace RPC (skills-dashboard task 1.1)", () => {
  it("aggregates the Global workspace with provider counts and sorted flat rows", async () => {
    const client = createClient();
    writeGlobalSkill(".claude", "beta-skill", "second skill");
    writeGlobalSkill(".claude", "alpha-skill", "first skill");
    writeGlobalSkill(".codex", "codex-skill", "only codex skill");

    const output = await client.skills.listWorkspace({ wsId: "~" });
    const claude = output.providers.find((provider) => provider.providerId === "claude-code");
    const codex = output.providers.find((provider) => provider.providerId === "codex");
    expect(claude).toMatchObject({ available: true, skillCount: 2 });
    expect(codex).toMatchObject({ available: true, skillCount: 1 });

    // 平铺行按 (providerId, skillId) 字典序（sk id = canonical path digest）。
    const pairs = output.skills.map((row) => [row.providerId, row.id] as const);
    expect(pairs).toHaveLength(3);
    const sorted = [...pairs].sort((left, right) =>
      left[0] !== right[0] ? (left[0] < right[0] ? -1 : 1) : left[1] < right[1] ? -1 : 1,
    );
    expect(pairs).toEqual(sorted);
    expect(output.nextCursor).toBeUndefined();
    // 独立内容 → 空 duplicates 投影。
    expect(output.duplicates.groups).toEqual([]);
    expect(output.duplicates.groupsTruncated).toBe(false);
  });

  it("filters by q case-insensitively and paginates via nextCursor without overlap", async () => {
    const client = createClient();
    for (let index = 1; index <= 5; index += 1) {
      writeGlobalSkill(".claude", `vue-skill-${index}`, `Vue helper number ${index}`);
    }
    writeGlobalSkill(".claude", "plain-skill", "unrelated description");

    const first = await client.skills.listWorkspace({ wsId: "~", q: "VUE", limit: 2 });
    expect(first.skills).toHaveLength(2);
    expect(first.skills.every((row) => /vue-skill/i.test(row.name))).toBe(true);
    expect(first.nextCursor).toBeDefined();

    const ids: string[] = [...first.skills.map((row) => row.id)];
    let cursor = first.nextCursor;
    while (cursor !== undefined) {
      const page = await client.skills.listWorkspace({ wsId: "~", q: "vue", limit: 2, cursor });
      ids.push(...page.skills.map((row) => row.id));
      cursor = page.nextCursor;
    }
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    expect(ids).toEqual([...ids].sort());
  });

  it("bounds skills at the effective limit with default 200 semantics", async () => {
    const client = createClient();
    writeGlobalSkill(".claude", "only-skill", "one skill");
    const output = await client.skills.listWorkspace({ wsId: "~", limit: 1 });
    expect(output.skills).toHaveLength(1);
    expect(output.nextCursor).toBeUndefined();
  });

  it("projects same-content skills across global providers as a bounded duplicates group", async () => {
    const client = createClient();
    // 两个 provider root、同一 SKILL.md 字节 → 同 contentHash 组（成员 2）。
    const document = `---\nname: twin-skill\ndescription: identical bytes\n---\n# twin\n\nsame body\n`;
    for (const root of [".claude", ".codex"] as const) {
      const directory = path.join(sandbox, "home", root, "skills", "twin");
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, "SKILL.md"), document);
    }

    const output = await client.skills.listWorkspace({ wsId: "~" });
    expect(output.duplicates.groupsTruncated).toBe(false);
    expect(output.duplicates.groups).toHaveLength(1);
    const group = output.duplicates.groups[0];
    expect(group.members).toHaveLength(2);
    expect(group.membersTruncated).toBe(false);
    // 成员形状与 skills.duplicates 不同形：installations 为 {items, truncated} 包装。
    for (const member of group.members) {
      expect(member.installations.items.length).toBeGreaterThan(0);
      expect(member.installations.items.every((item) => item.workspaceId === "~")).toBe(true);
      expect(typeof member.installations.truncated).toBe("boolean");
    }
  });

  it("rejects limit above 500 and malformed cursors as typed validation errors", async () => {
    const client = createClient();
    writeGlobalSkill(".claude", "any-skill", "any");

    await expect(client.skills.listWorkspace({ wsId: "~", limit: 501 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      client.skills.listWorkspace({ wsId: "~", cursor: "!!!not-base64!!!" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    // 合法 base64 但非法形状 → 同为输入校验拒绝。
    await expect(client.skills.listWorkspace({ wsId: "~", cursor: "YWJj" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("rejects an unknown workspace id as typed NOT_FOUND", async () => {
    const client = createClient();
    try {
      await client.skills.listWorkspace({ wsId: "ws_ffffffffffffffffffffffff" });
      expect.fail("Expected the unknown workspace to be rejected.");
    } catch (error) {
      expect(error).toBeInstanceOf(ORPCError);
      if (!(error instanceof ORPCError)) throw error;
      expect(error.code).toBe("NOT_FOUND");
    }
  });
});
