/**
 * skills.listCanonical RPC 集成 + 聚合器单元测试（skills-tabs-redesign 批 2，Δ1）。
 *
 * 用户原始需求 [2026-10-06]（design.md Δ1 定稿）：「复用不重建：分组投影基于现有
 * skills.listWorkspace / workspace-aggregate；representative 与每个 copy 都携带
 * 完整 WorkspaceProviderTarget；unavailable provider → 组保留、该 copy 标记
 * unavailable、代表顺延；全组不可用 → 行保留置灰不隐藏；SKILL.md/.SKILL.md
 * conflict = copy 级标记；groupCount/copyCount 分开返回」。
 *
 * 正交意图：
 *   [1] 真实 domain（oRPC client 端到端）：跨 provider 同名分组 / 代表规则
 *       （enabled 优先）/ conflict copy 保留 / 组级 q 闸 / 两量纲计数 / 游标
 *       分段不重不漏 / 输入合同负例（limit 越界 / 非法游标 = BAD_REQUEST、
 *       未知 ws = NOT_FOUND）。
 *   [2] 聚合器单元（stub deps）：provider 扫描失败隔离 / 代表顺延（unavailable
 *       copy 让位）/ 全组不可用置灰不隐藏 / sourcePriority 代表规则 / plugin
 *       namespace 原样入键。
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
import {
  decodeSkillsListCanonicalCursor,
  encodeSkillsListCanonicalCursor,
} from "../src/shared/rpc-contract.js";
import { createWorkspaceSkillsAggregator } from "../src/daemon/skill-search/workspace-aggregate.js";
import { DomainError } from "../src/daemon/domain-error.js";
import {
  ProviderIdSchema,
  type WorkspaceProviderTarget,
} from "../src/shared/contracts/workspaces.js";
import { SkillIdSchema, type SkillMetadata } from "../src/shared/contracts/skills.js";

/** provider catalog 的 Global root env overrides（照 rpc-skills-list-workspace 的隔离集）。 */
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
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "sc-rpc-list-canonical-"));
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

/** 在沙箱 Global root（~/.claude/skills | ~/.codex/skills）写一个真实形态技能目录。 */
function writeGlobalSkill(
  root: ".claude" | ".codex",
  name: string,
  description: string,
  options: { alsoDisabledDocument?: boolean } = {},
): string {
  const directory = path.join(sandbox, "home", root, "skills", name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n\nBody\n`,
  );
  if (options.alsoDisabledDocument) {
    fs.writeFileSync(
      path.join(directory, ".SKILL.md"),
      `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n\nBody\n`,
    );
  }
  return directory;
}

describe("skills.listCanonical RPC（Δ1 唯一投影）", () => {
  it("groups the same skill name across providers into one row with full targets", async () => {
    const client = createClient();
    writeGlobalSkill(".claude", "twin-skill", "claude copy");
    writeGlobalSkill(".codex", "twin-skill", "codex copy");
    writeGlobalSkill(".claude", "solo-skill", "only one copy");

    const output = await client.skills.listCanonical({ wsId: "~" });
    // 两量纲：2 组 / 3 副本（禁止单数字推导）。
    expect(output.groupCount).toBe(2);
    expect(output.copyCount).toBe(3);

    const twin = output.groups.find((group) => group.name === "twin-skill");
    expect(twin).toBeDefined();
    if (!twin) return;
    expect(twin.copies).toHaveLength(2);
    expect(twin.groupMeta).toEqual({ copyCount: 2, allUnavailable: false });
    // representative 与每个 copy 都携带完整 WorkspaceProviderTarget 三元组。
    for (const copy of [twin.representative, ...twin.copies]) {
      expect(copy.workspaceId).toBe("~");
      expect(copy.providerId).toMatch(/^(claude-code|codex)$/);
      expect(copy.skillId).toMatch(/^sk_[a-f0-9]{24}$/);
      expect(copy.unavailable).toBe(false);
      expect(copy.conflict).toBe(false);
    }
    // representative 必是组内一员。
    expect(
      twin.copies.some(
        (copy) =>
          copy.skillId === twin.representative.skillId &&
          copy.providerId === twin.representative.providerId,
      ),
    ).toBe(true);
    // 组描述 = 代表描述。
    expect(twin.description).toBe(twin.representative.description);
    // providers 摘要同源在列。
    expect(output.providers.length).toBeGreaterThan(1);
  });

  it("prefers the enabled copy as representative (enabled beats provider order)", async () => {
    const client = createClient();
    // claude-code 副本禁用（.SKILL.md only）、codex 副本启用——代表 = 启用者。
    const disabledDirectory = path.join(sandbox, "home", ".claude", "skills", "toggle-me");
    fs.mkdirSync(disabledDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(disabledDirectory, ".SKILL.md"),
      "---\nname: toggle-me\ndescription: disabled copy\n---\n# toggle-me\nBody\n",
    );
    writeGlobalSkill(".codex", "toggle-me", "enabled copy");

    const output = await client.skills.listCanonical({ wsId: "~" });
    const group = output.groups.find((entry) => entry.name === "toggle-me");
    expect(group).toBeDefined();
    if (!group) return;
    expect(group.representative.providerId).toBe("codex");
    expect(group.representative.disabled).toBe(false);
    expect(group.copies.map((copy) => copy.disabled)).toEqual([true, false]);
    expect(group.description).toBe("enabled copy");
  });

  it("keeps a SKILL.md/.SKILL.md conflict copy with a copy-level conflict mark", async () => {
    const client = createClient();
    writeGlobalSkill(".claude", "conflicted", "both documents present", {
      alsoDisabledDocument: true,
    });

    const output = await client.skills.listCanonical({ wsId: "~" });
    const group = output.groups.find((entry) => entry.name === "conflicted");
    expect(group).toBeDefined();
    if (!group) return;
    // conflict = copy 级标记，组不整体丢弃。
    expect(group.copies).toHaveLength(1);
    expect(group.copies[0]?.conflict).toBe(true);
    expect(group.representative.conflict).toBe(true);
    expect(group.groupMeta.allUnavailable).toBe(false);
  });

  it("filters by q at group scope and keeps the copies of a matched group intact", async () => {
    const client = createClient();
    writeGlobalSkill(".claude", "vue-helper", "generic name");
    writeGlobalSkill(".codex", "vue-helper", "Vue tooling description");
    writeGlobalSkill(".claude", "unrelated", "nothing to see");

    const output = await client.skills.listCanonical({ wsId: "~", q: "VUE" });
    expect(output.groupCount).toBe(1);
    // 组级 q 闸：副本恒完整（×N 与 copyCount 不随 q 缺角）。
    expect(output.groups[0]?.copies).toHaveLength(2);
    expect(output.copyCount).toBe(2);
    expect(output.groups.map((group) => group.name)).toEqual(["vue-helper"]);
  });

  it("paginates groups by name with an opaque cursor and stable two-dimension totals", async () => {
    const client = createClient();
    writeGlobalSkill(".claude", "alpha", "first");
    writeGlobalSkill(".claude", "beta", "second");
    writeGlobalSkill(".codex", "gamma", "third");
    writeGlobalSkill(".codex", "gamma-2", "fourth");

    const first = await client.skills.listCanonical({ wsId: "~", limit: 2 });
    expect(first.groups.map((group) => group.name)).toEqual(["alpha", "beta"]);
    expect(first.groupCount).toBe(4);
    expect(first.copyCount).toBe(4);
    expect(first.nextCursor).toBeDefined();

    // 游标 = 下一首组键（含起始组）：往返可解码。
    expect(decodeSkillsListCanonicalCursor(first.nextCursor!)).toBe("gamma");

    const second = await client.skills.listCanonical({
      wsId: "~",
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.groups.map((group) => group.name)).toEqual(["gamma", "gamma-2"]);
    expect(second.nextCursor).toBeUndefined();
    expect(second.groupCount).toBe(4);
  });

  it("keeps plugin-namespace names verbatim as distinct group keys", async () => {
    const client = createClient();
    writeGlobalSkill(".claude", "alpha", "plain name");
    writeGlobalSkill(".codex", "alpha:beta", "namespaced name");

    const output = await client.skills.listCanonical({ wsId: "~" });
    // name 精确匹配：`alpha` 与 `alpha:beta` 是两组（trim 外无归一）。
    expect(output.groupCount).toBe(2);
    expect(output.groups.map((group) => group.name).sort()).toEqual(["alpha", "alpha:beta"]);
  });

  it("rejects limit above 500, malformed cursors, and unknown workspaces as typed errors", async () => {
    const client = createClient();
    writeGlobalSkill(".claude", "any-skill", "any");

    await expect(client.skills.listCanonical({ wsId: "~", limit: 501 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      client.skills.listCanonical({ wsId: "~", cursor: "!!!not-base64!!!" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // 合法 base64 但缺 `g:` 前缀 → 同为输入校验拒绝。
    await expect(client.skills.listCanonical({ wsId: "~", cursor: "YWJj" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    try {
      await client.skills.listCanonical({ wsId: "ws_ffffffffffffffffffffffff" });
      expect.fail("Expected the unknown workspace to be rejected.");
    } catch (error) {
      expect(error).toBeInstanceOf(ORPCError);
      if (!(error instanceof ORPCError)) throw error;
      expect(error.code).toBe("NOT_FOUND");
    }
    // 合法形状但越界组键：游标落在末尾 = 空页（不抛错，分页收敛语义）。
    const tail = await client.skills.listCanonical({
      wsId: "~",
      cursor: encodeSkillsListCanonicalCursor("zzzz-last"),
    });
    expect(tail.groups).toEqual([]);
  });
});

// ---- 聚合器单元（stub deps）：provider 不可用 / 代表顺延 / 全组不可用 ----

function makeSkillMeta(input: {
  idSeed: string;
  name: string;
  description: string;
  providerId: string;
  path: string;
  disabled?: boolean;
  sourcePriority?: number;
}): SkillMetadata {
  return {
    id: SkillIdSchema.parse(`sk_${input.idSeed.padEnd(24, "0").slice(0, 24)}`),
    name: input.name,
    description: input.description,
    directoryName: path.basename(input.path),
    disabled: input.disabled ?? false,
    provider: input.providerId,
    location: "user",
    ...(input.sourcePriority === undefined ? {} : { sourcePriority: input.sourcePriority }),
    path: input.path,
    hasReferences: false,
    hasScripts: false,
    hasAssets: false,
    pluginInfo: null,
    installedVia: "unknown",
    updatable: false,
  };
}

function stubAggregator(listSkills: (target: WorkspaceProviderTarget) => Promise<SkillMetadata[]>) {
  return createWorkspaceSkillsAggregator({
    workspaces: { lookup: () => null },
    listSkills,
    duplicates: async () => [],
  });
}

const CLAUDE = ProviderIdSchema.parse("claude-code");
const CODEX = ProviderIdSchema.parse("codex");

describe("workspace-aggregator listCanonical 单元（stub deps）", () => {
  beforeEach(() => {
    // stub listSkills 只在 provider root 可用时被调用（scanProvider 的可用性闸）：
    // 先建出沙箱 Global roots（~/.claude/skills、~/.codex/skills）。
    for (const root of [".claude", ".codex"]) {
      fs.mkdirSync(path.join(sandbox, "home", root, "skills"), { recursive: true });
    }
  });

  it("isolates a failed provider scan as a typed error while keeping other groups", async () => {
    const aggregator = stubAggregator(async (target) => {
      if (target.providerId === CODEX) throw new DomainError("UNAVAILABLE", "codex root wedged");
      return [
        makeSkillMeta({
          idSeed: "a1",
          name: "keeper",
          description: "fine",
          providerId: CLAUDE,
          path: path.join(sandbox, "keeper"),
        }),
      ];
    });

    const output = await aggregator.listCanonical({ wsId: "~", limit: 200 });
    const codex = output.providers.find((provider) => provider.providerId === CODEX);
    expect(codex?.available).toBe(true);
    expect(codex?.error).toMatchObject({ code: "unavailable" });
    // 其余 provider 的组保留，不整屏失败。
    expect(output.groups.map((group) => group.name)).toEqual(["keeper"]);
    expect(output.groupCount).toBe(1);
  });

  it("defers the representative when the top copy is unavailable and keeps the stale copy marked", async () => {
    const staleDir = path.join(sandbox, "vanished-skill");
    // 故意不创建 staleDir：投影时 lstat 失败 = unavailable copy。
    const liveDir = path.join(sandbox, "live-skill");
    fs.mkdirSync(liveDir, { recursive: true });
    fs.writeFileSync(
      path.join(liveDir, "SKILL.md"),
      "---\nname: dup-skill\ndescription: live\n---\nBody\n",
    );

    const aggregator = stubAggregator(async (target) => {
      if (target.providerId === CLAUDE) {
        return [
          makeSkillMeta({
            idSeed: "aa",
            name: "dup-skill",
            description: "stale",
            providerId: CLAUDE,
            path: staleDir,
          }),
        ];
      }
      if (target.providerId === CODEX) {
        return [
          makeSkillMeta({
            idSeed: "bb",
            name: "dup-skill",
            description: "live",
            providerId: CODEX,
            path: liveDir,
          }),
        ];
      }
      return [];
    });

    const output = await aggregator.listCanonical({ wsId: "~", limit: 200 });
    const group = output.groups.find((entry) => entry.name === "dup-skill");
    expect(group).toBeDefined();
    if (!group) return;
    // 组保留；stale copy 标记 unavailable；代表顺延到可用副本。
    expect(group.groupMeta.allUnavailable).toBe(false);
    const stale = group.copies.find((copy) => copy.path === staleDir);
    expect(stale?.unavailable).toBe(true);
    expect(group.representative.path).toBe(liveDir);
  });

  it("keeps an all-unavailable group visible and greyed instead of hiding it", async () => {
    const aggregator = stubAggregator(async (target) => {
      const root = target.providerId === CLAUDE ? "gone-a" : "gone-b";
      return [
        makeSkillMeta({
          idSeed: target.providerId === CLAUDE ? "cc" : "dd",
          name: "ghost-skill",
          description: "both vanished",
          providerId: target.providerId,
          path: path.join(sandbox, root),
        }),
      ];
    });

    const output = await aggregator.listCanonical({ wsId: "~", limit: 200 });
    const group = output.groups.find((entry) => entry.name === "ghost-skill");
    // 全组不可用：行保留置灰不隐藏（代表仍由冻结序产出）。
    expect(group).toBeDefined();
    expect(group?.groupMeta).toEqual({ copyCount: 2, allUnavailable: true });
    expect(group?.copies.every((copy) => copy.unavailable)).toBe(true);
    expect(group?.representative.providerId).toBe(CLAUDE);
  });

  it("breaks representative ties by sourcePriority (missing = lowest) then providerId", async () => {
    const dirA = path.join(sandbox, "prio-a");
    const dirB = path.join(sandbox, "prio-b");
    const dirC = path.join(sandbox, "prio-c");
    for (const dir of [dirA, dirB, dirC]) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "SKILL.md"),
        "---\nname: prio-skill\ndescription: x\n---\nBody\n",
      );
    }
    const aggregator = stubAggregator(async (target) => {
      if (target.providerId === CLAUDE) {
        return [
          makeSkillMeta({
            idSeed: "e1",
            name: "prio-skill",
            description: "no priority",
            providerId: CLAUDE,
            path: dirA,
          }),
        ];
      }
      if (target.providerId === CODEX) {
        return [
          makeSkillMeta({
            idSeed: "e2",
            name: "prio-skill",
            description: "priority ten",
            providerId: CODEX,
            path: dirB,
            sourcePriority: 10,
          }),
          makeSkillMeta({
            idSeed: "e3",
            name: "prio-skill",
            description: "priority one",
            providerId: CODEX,
            path: dirC,
            sourcePriority: 1,
          }),
        ];
      }
      return [];
    });

    const output = await aggregator.listCanonical({ wsId: "~", limit: 200 });
    const group = output.groups.find((entry) => entry.name === "prio-skill");
    expect(group?.copies).toHaveLength(3);
    // sourcePriority 高者为代表（缺失 = 最低，输给 1 和 10）。
    expect(group?.representative.sourcePriority).toBe(10);
    expect(group?.representative.path).toBe(dirB);
  });
});
