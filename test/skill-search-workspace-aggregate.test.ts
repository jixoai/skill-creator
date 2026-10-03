/**
 * skills.listWorkspace 聚合单测（skills-dashboard task 1.1；design §5/§7）。
 *
 * 用户原始需求 [2026-10-03]（spec skill-registry ADDED Requirement）：
 * 「单次响应的 skills 数组长度 MUST NOT 超过生效 limit；单 provider 扫描失败
 * MUST 仅投影为该 provider 条目的 error 字段……duplicates 投影 MUST 与
 * skills.duplicates 数据同源，但按有界包装」。
 *
 * 正交意图：
 *   [1] provider fan-out 与失败隔离（typed code 闭集 + 该 provider 行缺席）。
 *   [2] q 预过滤 + (providerId, skillId) 字典序 + opaque cursor 分段（不重不漏）。
 *   [3] duplicates 三层有界包装 + workspace 作用域过滤（与 skills.duplicates 同源）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceSkillsAggregator } from "../src/daemon/skill-search/workspace-aggregate.js";
import { DomainError } from "../src/daemon/domain-error.js";
import { SkillsListWorkspaceOutputSchema } from "../src/shared/rpc-contract.js";
import { SkillIdSchema, type SkillMetadata } from "../src/shared/contracts/skills.js";
import type { SkillDuplicateGroup, SkillInstallation } from "../src/shared/contracts/search.js";
import {
  ImportedWorkspaceIdSchema,
  ProviderIdSchema,
  WorkspaceIdSchema,
  type WorkspaceId,
} from "../src/shared/contracts/workspaces.js";
import type { WorkspaceRegistry } from "../src/daemon/workspace-registry/index.js";

/** provider catalog 的 Global root env overrides（照 rpc-search.test.ts 的隔离集）。 */
const PROVIDER_HOME_OVERRIDES = [
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "VIBE_HOME",
  "HERMES_HOME",
  "AUTOHAND_HOME",
  "GROK_HOME",
] as const;
const ENV_NAMES = ["HOME", "USERPROFILE", "XDG_CONFIG_HOME", ...PROVIDER_HOME_OVERRIDES] as const;

const GLOBAL: WorkspaceId = WorkspaceIdSchema.parse("~");

const skillId = (hex: string) => SkillIdSchema.parse(`sk_${hex.padStart(24, "0")}`);

let sandbox = "";
const previousEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "ws-aggregate-test-"));
  const home = path.join(sandbox, "home");
  for (const name of ENV_NAMES) previousEnv[name] = process.env[name];
  for (const name of PROVIDER_HOME_OVERRIDES) delete process.env[name];
  process.env.HOME = home;
  // os.homedir() 在 win32 读 USERPROFILE：隔离集必须同时覆盖。
  process.env.USERPROFILE = home;
  process.env.XDG_CONFIG_HOME = path.join(home, ".config");
});

afterEach(() => {
  for (const name of ENV_NAMES) {
    const previous = previousEnv[name];
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
    delete previousEnv[name];
  }
  fs.rmSync(sandbox, { recursive: true, force: true });
});

/** 在沙箱 home 下放置一个存在的 provider Global root（决定 available=true）。 */
function globalRoot(relative: string): string {
  const directory = path.join(sandbox, "home", relative);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function metadata(id: SkillMetadata["id"], name: string, description: string): SkillMetadata {
  return {
    id,
    name,
    description,
    directoryName: name,
    disabled: false,
    provider: "claude-code",
    location: "user",
    path: `/sandbox/skills/${name}`,
    hasReferences: false,
    hasScripts: false,
    hasAssets: false,
    pluginInfo: null,
  };
}

const CLAUDE_PROVIDER = ProviderIdSchema.parse("claude-code");

function installation(wsId: WorkspaceId, suffix: string): SkillInstallation {
  return { path: `/roots/${wsId}/${suffix}`, workspaceId: wsId, providerId: CLAUDE_PROVIDER };
}

function aggregator(overrides?: {
  importedPaths?: Record<string, string>;
  listSkills?: (target: {
    workspaceId: WorkspaceId;
    providerId: string;
  }) => Promise<SkillMetadata[]>;
  duplicates?: () => SkillDuplicateGroup[];
}) {
  const importedPaths = overrides?.importedPaths ?? {};
  const lookup = ((id: WorkspaceId) => {
    if (id === "~") return null;
    const stored = importedPaths[id as string];
    return stored === undefined
      ? null
      : { id: ImportedWorkspaceIdSchema.parse(id), label: "ws", path: stored };
  }) as WorkspaceRegistry["lookup"];
  return createWorkspaceSkillsAggregator({
    workspaces: { lookup },
    listSkills:
      overrides?.listSkills ??
      (async () => {
        throw new Error("unexpected listSkills call");
      }),
    duplicates: async () => overrides?.duplicates?.() ?? [],
  });
}

describe("skills.listWorkspace aggregate (fan-out + failure isolation)", () => {
  it("projects provider counts and (providerId, skillId)-sorted flat rows", async () => {
    globalRoot(".claude/skills");
    globalRoot(".codex/skills");
    const service = aggregator({
      listSkills: async (target) => {
        if (target.providerId === "claude-code")
          return [
            metadata(skillId("02"), "b-skill", "second"),
            metadata(skillId("01"), "a-skill", "first"),
          ];
        if (target.providerId === "codex") return [metadata(skillId("03"), "c-skill", "third")];
        throw new Error(`unexpected provider scan: ${target.providerId}`);
      },
    });
    const output = await service.listWorkspace({ wsId: GLOBAL, limit: 200 });
    expect(SkillsListWorkspaceOutputSchema.safeParse(output).success).toBe(true);

    const claude = output.providers.find((provider) => provider.providerId === "claude-code");
    expect(claude).toMatchObject({ available: true, skillCount: 2 });
    expect(claude?.error).toBeUndefined();
    // globalPath=null 的 provider（eve）恒不可用且零计数。
    const eve = output.providers.find((provider) => provider.providerId === "eve");
    expect(eve).toMatchObject({ available: false, skillCount: 0 });

    expect(output.skills.map((row) => [row.providerId, row.id])).toEqual([
      ["claude-code", skillId("01")],
      ["claude-code", skillId("02")],
      ["codex", skillId("03")],
    ]);
    expect(output.nextCursor).toBeUndefined();
    expect(output.duplicates).toEqual({ groups: [], groupsTruncated: false });
  });

  it("isolates single provider scan failures as typed error rows with absent skills", async () => {
    globalRoot(".claude/skills");
    globalRoot(".codex/skills");
    globalRoot(".zcode/skills");
    globalRoot(".aider-desk/skills");
    const service = aggregator({
      listSkills: async (target) => {
        if (target.providerId === "claude-code")
          throw Object.assign(new Error("denied"), { code: "EACCES" });
        if (target.providerId === "codex") throw new DomainError("UNAVAILABLE", "root went away");
        if (target.providerId === "zcode") throw new Error("ccski scan boom");
        return [metadata(skillId("07"), "ok-skill", "fine")];
      },
    });
    const output = await service.listWorkspace({ wsId: GLOBAL, limit: 200 });

    const byId = new Map(
      output.providers.map((provider) => [provider.providerId as string, provider]),
    );
    expect(byId.get("claude-code")).toMatchObject({
      available: true,
      skillCount: 0,
      error: { code: "io-error" },
    });
    expect(byId.get("codex")).toMatchObject({
      available: true,
      skillCount: 0,
      error: { code: "unavailable", message: "root went away" },
    });
    expect(byId.get("zcode")).toMatchObject({
      available: true,
      skillCount: 0,
      error: { code: "scan-failed" },
    });
    // 仅未失败 provider 的行在场，响应整体成功。
    expect(output.skills.map((row) => row.providerId)).toEqual(["aider-desk"]);
    expect(output.skills).toHaveLength(1);
    expect(SkillsListWorkspaceOutputSchema.safeParse(output).success).toBe(true);
  });

  it("rejects an unknown workspace id as typed NOT_FOUND", async () => {
    const service = aggregator();
    await expect(
      service.listWorkspace({
        wsId: WorkspaceIdSchema.parse("ws_ffffffffffffffffffffffff"),
        limit: 200,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("marks every provider unavailable when the imported workspace directory is gone", async () => {
    const service = aggregator({
      importedPaths: { ws_0123456789abcdef01234567: "/nonexistent/workspace/root" },
      listSkills: async () => {
        throw new Error("listSkills must not be called for an unavailable workspace");
      },
    });
    const output = await service.listWorkspace({
      wsId: WorkspaceIdSchema.parse("ws_0123456789abcdef01234567"),
      limit: 200,
    });
    expect(output.skills).toEqual([]);
    expect(output.providers.every((provider) => provider.available === false)).toBe(true);
    expect(output.providers.every((provider) => provider.error === undefined)).toBe(true);
  });

  it("resolves imported workspace provider roots from a live canonical directory", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ws-aggregate-imported-"));
    const canonical = fs.realpathSync(workspace);
    fs.mkdirSync(path.join(canonical, ".claude", "skills"), { recursive: true });
    const service = aggregator({
      importedPaths: { ws_0123456789abcdef01234567: canonical },
      listSkills: async (target) =>
        target.providerId === "claude-code"
          ? [metadata(skillId("04"), "imported-skill", "in workspace")]
          : [],
    });
    const output = await service.listWorkspace({
      wsId: WorkspaceIdSchema.parse("ws_0123456789abcdef01234567"),
      limit: 200,
    });
    expect(
      output.providers.find((provider) => provider.providerId === "claude-code"),
    ).toMatchObject({ available: true, skillCount: 1 });
    expect(output.skills).toHaveLength(1);
  });
});

describe("skills.listWorkspace aggregate (q filter + cursor pagination)", () => {
  function vueService() {
    globalRoot(".claude/skills");
    const rows = [
      metadata(skillId("01"), "vue-b", "unrelated"),
      metadata(skillId("02"), "vue-a", "unrelated"),
      metadata(skillId("03"), "other", "built with Vue"),
      metadata(skillId("04"), "plain", "no match"),
      metadata(skillId("05"), "VUE-C", "unrelated"),
    ];
    return aggregator({
      listSkills: async (target) => (target.providerId === "claude-code" ? rows : []),
    });
  }

  it("filters rows by q case-insensitively across name and description", async () => {
    const output = await vueService().listWorkspace({ wsId: GLOBAL, q: "vUe", limit: 200 });
    // 命中：name vue-b/vue-a/VUE-C（大小写不敏感）+ description "built with Vue"。
    expect(output.skills.map((row) => row.name)).toEqual(["vue-b", "vue-a", "other", "VUE-C"]);
  });

  it("paginates strictly without overlap or gap under q filtering", async () => {
    const service = vueService();
    const first = await service.listWorkspace({ wsId: GLOBAL, q: "vue", limit: 2 });
    expect(first.skills).toHaveLength(2);
    expect(first.nextCursor).toBeDefined();
    const second = await service.listWorkspace({
      wsId: GLOBAL,
      q: "vue",
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.skills).toHaveLength(2);
    expect(second.nextCursor).toBeUndefined();

    const ids = [...first.skills, ...second.skills].map((row) => row.id);
    expect(new Set(ids).size).toBe(4);
    expect(ids).toEqual([...ids].sort());
    expect(SkillsListWorkspaceOutputSchema.safeParse(second).success).toBe(true);
  });

  it("returns the unfiltered full set when q is absent or blank", async () => {
    const service = vueService();
    const unfiltered = await service.listWorkspace({ wsId: GLOBAL, limit: 200 });
    const blank = await service.listWorkspace({ wsId: GLOBAL, q: "   ", limit: 200 });
    expect(unfiltered.skills).toHaveLength(5);
    expect(blank.skills).toHaveLength(5);
    expect(unfiltered.nextCursor).toBeUndefined();
  });
});

describe("skills.listWorkspace aggregate (duplicates bounded projection)", () => {
  const hash = (index: number) => "a".repeat(60) + String(index).padStart(4, "0");

  function member(
    groupIndex: number,
    memberIndex: number,
    installationCount: number,
    wsId: WorkspaceId = GLOBAL,
  ) {
    const installations = Array.from({ length: installationCount }, (_, index) =>
      installation(wsId, `${groupIndex}-${memberIndex}-${index}`),
    );
    const hex =
      String(groupIndex % 100).padStart(2, "0") +
      String(memberIndex).padStart(2, "0") +
      "0".repeat(20);
    return {
      id: skillId(hex),
      name: `member-${groupIndex}-${memberIndex}`,
      canonicalPath: `/canonical/${groupIndex}/${memberIndex}`,
      installations,
      disabled: false,
      conflict: false,
    };
  }

  it("wraps groups/members/installations with explicit truncation flags", async () => {
    const groups: SkillDuplicateGroup[] = [
      {
        contentHash: hash(1),
        members: Array.from({ length: 30 }, (_, index) => member(1, index, 12)),
      },
      { contentHash: hash(2), members: [member(2, 0, 1), member(2, 1, 1)] },
    ];
    const service = aggregator({ duplicates: () => groups });
    const output = await service.listWorkspace({ wsId: GLOBAL, limit: 200 });

    expect(output.duplicates.groupsTruncated).toBe(false);
    const oversized = output.duplicates.groups[0];
    expect(oversized.members).toHaveLength(16);
    expect(oversized.membersTruncated).toBe(true);
    expect(oversized.members[0].installations.items).toHaveLength(8);
    expect(oversized.members[0].installations.truncated).toBe(true);
    // 形状与 skills.duplicates 不同形：installations 是 {items, truncated} 包装。
    expect(Object.keys(oversized.members[0].installations).sort()).toEqual(["items", "truncated"]);
    const small = output.duplicates.groups[1];
    expect(small.membersTruncated).toBe(false);
    expect(small.members[0].installations).toEqual({
      items: [installation(GLOBAL, "2-0-0")],
      truncated: false,
    });
    expect(SkillsListWorkspaceOutputSchema.safeParse(output).success).toBe(true);
  });

  it("bounds groups at 50 with groupsTruncated and filters by workspace scope", async () => {
    const otherWs = WorkspaceIdSchema.parse("ws_0123456789abcdef01234567");
    const groups: SkillDuplicateGroup[] = Array.from({ length: 60 }, (_, index) => ({
      contentHash: hash(index + 1),
      members: [member(index + 1, 0, 1), member(index + 1, 1, 1)],
    }));
    // 仅存在于其他 ws 的组不得进入本 workspace 投影。
    groups.push({
      contentHash: hash(999),
      members: [member(999, 0, 1, otherWs), member(999, 1, 1, otherWs)],
    });
    const service = aggregator({
      // otherWs 只需 lookup 可解析（目录缺席不影响 duplicates 作用域投影）。
      importedPaths: { ws_0123456789abcdef01234567: "/nonexistent/workspace/root" },
      duplicates: () => groups,
    });

    const output = await service.listWorkspace({ wsId: GLOBAL, limit: 200 });
    expect(output.duplicates.groups).toHaveLength(50);
    expect(output.duplicates.groupsTruncated).toBe(true);
    expect(output.duplicates.groups.every((group) => group.contentHash !== hash(999))).toBe(true);

    const otherOutput = await service.listWorkspace({ wsId: otherWs, limit: 200 });
    expect(otherOutput.duplicates.groups.map((group) => group.contentHash)).toEqual([hash(999)]);
    expect(otherOutput.duplicates.groupsTruncated).toBe(false);
  });

  it("projects mixed-workspace groups without leaking other-ws installations (Codex r8)", async () => {
    const otherWs = WorkspaceIdSchema.parse("ws_0123456789abcdef01234567");
    const groups: SkillDuplicateGroup[] = [
      // 混合组：member 0/3 仅 Global、member 1/2 仅 otherWs（1 装与多装混合）。
      {
        contentHash: hash(10),
        members: [
          member(10, 0, 1, GLOBAL),
          member(10, 1, 2, otherWs),
          member(10, 2, 3, otherWs),
          member(10, 3, 4, GLOBAL),
        ],
      },
      // 全员仅 otherWs：Global 侧过滤后单成员 → 整组不返回。
      {
        contentHash: hash(11),
        members: [member(11, 0, 1, GLOBAL), member(11, 1, 1, otherWs), member(11, 2, 1, otherWs)],
      },
    ];
    const service = aggregator({
      importedPaths: { ws_0123456789abcdef01234567: "/nonexistent/workspace/root" },
      duplicates: () => groups,
    });

    const output = await service.listWorkspace({ wsId: GLOBAL, limit: 200 });
    // 单成员组（hash 11）整组丢弃：本 ws 投影下不再是重复组。
    expect(output.duplicates.groups.map((group) => group.contentHash)).toEqual([hash(10)]);
    const group = output.duplicates.groups[0]!;
    // member B/C（无 Global 安装）不进入响应；成员序沿用冻结排序。
    expect(group.members.map((entry) => entry.name)).toEqual(["member-10-0", "member-10-3"]);
    // 零跨 ws 泄露：所有安装记录的 workspaceId/providerId 都属于本 ws。
    const allInstallations = group.members.flatMap((entry) => entry.installations.items);
    expect(allInstallations.length).toBeGreaterThan(0);
    for (const installation of allInstallations) {
      expect(installation.workspaceId).toBe(GLOBAL);
    }
    // 本 ws 安装超过 8 的成员按过滤后数量计算截断（member-10-3 = 4 安装未截断）。
    expect(group.members[1]!.installations).toEqual({
      items: Array.from({ length: 4 }, (_, index) => installation(GLOBAL, `10-3-${index}`)),
      truncated: false,
    });
    expect(SkillsListWorkspaceOutputSchema.safeParse(output).success).toBe(true);

    // 对称断言：otherWs 侧看到 hash 10 的 B/C 成员与 hash 11 整组（3 成员），
    // 且零 Global 安装记录。
    const otherOutput = await service.listWorkspace({ wsId: otherWs, limit: 200 });
    expect(otherOutput.duplicates.groups.map((group) => group.contentHash)).toEqual([
      hash(10),
      hash(11),
    ]);
    const otherGroup10 = otherOutput.duplicates.groups[0]!;
    expect(otherGroup10.members.map((entry) => entry.name)).toEqual(["member-10-1", "member-10-2"]);
    for (const installation of otherGroup10.members.flatMap((entry) => entry.installations.items)) {
      expect(installation.workspaceId).toBe(otherWs);
    }
  });
});
