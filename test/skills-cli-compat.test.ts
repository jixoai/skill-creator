/**
 * skills-CLI 兼容（lock 解析 + probe + provenance 投影 + update-check + apply）测试。
 *
 * 用户原始需求 [2026-07-27]：「让 Skill Creator 主动对齐 skills-CLI：识别哪些技能是经它装的、标记可升级、并直接在 Skill Creator 里一键升级。」
 * 架构决策 [2026-07-27]：
 * - lock 文件按不可信外部输入 safeParse，失败降级为 null，绝不抛错。
 * - `npx skills list --json` 输出按不可信处理，丢弃坏条目。
 * - GitHub 源走 Trees API、其余浅克隆算 on-disk hash；限流/网络失败标记 unavailable。
 * - apply 复用 repository install 流水线，成功后在内存覆盖层刷新 hash。
 *
 * 正交意图：
 *   [1] lock schema 解析（合法 / 不兼容 / 缺失）。
 *   [2] probe mock（成功 / 非 0 退出 / 无 npx）+ 缓存。
 *   [3] provenance 投影（命中 / 越界 / 无 probe）。
 *   [4] update-check hash 对比（GitHub tree SHA / on-disk hash / 限流 / 网络失败）。
 *   [5] apply（成功刷新覆盖层 / already-current / failed / 缺 lock）。
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LocalSkillLockFileSchema,
  SkillLockFileSchema,
  parseGlobalSkillLock,
  parseProjectSkillLock,
} from "../src/shared/contracts/skills-lock.js";
import { createSkillService, type SkillDiscoverer } from "../src/daemon/skill-service.js";
import {
  createSkillsCliProbe,
  parseSkillsCliList,
  type SkillsCliRunner,
} from "../src/daemon/skills-cli-probe.js";
import {
  computeSkillFolderHash,
  createSkillsUpdateService,
  defaultResolveDefaultBranch,
  parseGithubSource,
  type DefaultBranchResolver,
  type FetchLike,
  type UpdateCloner,
} from "../src/daemon/skills-update-service.js";
import { ensureEntity, projectEntity } from "ccski";
import { createRepositoryService } from "../src/daemon/repository-service.js";
import { createWorkspaceRegistry } from "../src/daemon/workspace-registry/index.js";
import {
  GLOBAL_WORKSPACE_ID,
  ProviderIdSchema,
  type WorkspaceProviderTarget,
} from "../src/shared/contracts/workspaces.js";
import { setHomeOverride } from "../src/shared/paths.js";
import type { SkillId, SkillMetadata } from "../src/shared/contracts/skills.js";

const previousHome = process.env.SKILL_CREATOR_HOME;
const previousXdgState = process.env.XDG_STATE_HOME;
let sandbox = "";
const codexTarget: WorkspaceProviderTarget = {
  workspaceId: GLOBAL_WORKSPACE_ID,
  providerId: ProviderIdSchema.parse("codex"),
};

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-skills-cli-test-"));
  const isolatedHome = path.join(sandbox, "state");
  process.env.SKILL_CREATOR_HOME = isolatedHome;
  process.env.XDG_STATE_HOME = path.join(sandbox, "xdg-state");
  setHomeOverride(isolatedHome);
});

afterEach(() => {
  setHomeOverride(null);
  if (previousHome === undefined) delete process.env.SKILL_CREATOR_HOME;
  else process.env.SKILL_CREATOR_HOME = previousHome;
  if (previousXdgState === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = previousXdgState;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

/** 写一个合法 SKILL.md 到目录，返回该目录。 */
function writeSkillDocument(
  directory: string,
  name: string,
  description: string,
  body = "# Skill\n",
): string {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "SKILL.md"),
    `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\n---\n${body}`,
    "utf8",
  );
  return directory;
}

/** 构造 ccski 发现结果格式的技能对象。 */
function discoveredSkill(directory: string, name = "demo-skill"): unknown {
  return {
    name,
    description: "A discovered skill.",
    provider: "codex",
    location: "user",
    path: directory,
    hasReferences: false,
    hasScripts: false,
    hasAssets: false,
  };
}

/** 构造一个总是返回固定技能集的 SkillDiscoverer。 */
function discovererFor(skills: Array<{ directory: string; name?: string }>): SkillDiscoverer {
  return async () => skills.map((skill) => discoveredSkill(skill.directory, skill.name));
}

describe("skills-CLI lock schema", () => {
  it("parses a valid global v3 lock file", () => {
    const value = {
      version: 3,
      skills: {
        "demo-skill": {
          source: "owner/repo",
          sourceType: "github",
          sourceUrl: "https://github.com/owner/repo",
          skillPath: "skills/demo-skill",
          skillFolderHash: "abc123treeSHA",
          installedAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      },
      dismissed: { findSkillsPrompt: true },
      lastSelectedAgents: ["codex"],
    };
    expect(parseGlobalSkillLock(value)).toEqual(value);
    expect(SkillLockFileSchema.safeParse(value).success).toBe(true);
  });

  it("parses a valid project v1 lock file", () => {
    const value = {
      version: 1,
      skills: {
        "demo-skill": {
          source: "owner/repo",
          sourceUrl: "https://github.com/owner/repo",
          ref: "main",
          sourceType: "github",
          skillPath: "skills/demo-skill",
          computedHash: "deadbeef",
          subagents: [""],
        },
      },
    };
    expect(parseProjectSkillLock(value)).toEqual(value);
    expect(LocalSkillLockFileSchema.safeParse(value).success).toBe(true);
  });

  it("returns null for incompatible global lock schema (wrong version)", () => {
    expect(parseGlobalSkillLock({ version: 2, skills: {} })).toBeNull();
  });

  it("returns null for incompatible project lock schema (missing skills)", () => {
    expect(parseProjectSkillLock({ version: 1 })).toBeNull();
  });

  it("returns null for malformed structure", () => {
    expect(parseGlobalSkillLock("not-an-object")).toBeNull();
    expect(parseProjectSkillLock({ version: 1, skills: { x: { source: 1 } } })).toBeNull();
    expect(parseGlobalSkillLock(null)).toBeNull();
  });

  it("returns null when a required lock entry field is missing", () => {
    expect(
      parseGlobalSkillLock({
        version: 3,
        skills: { "demo-skill": { source: "owner/repo", sourceType: "github" } },
      }),
    ).toBeNull();
  });
});

describe("skills-CLI probe", () => {
  it("parses a successful npx skills list --json output into a path map", () => {
    const stdout = JSON.stringify([
      { name: "demo-skill", path: "/home/u/.codex/skills/demo-skill", scope: "global" },
      { name: "other", path: "/proj/.agents/skills/other", scope: "project" },
      // 缺 path 的坏条目应被整体丢弃（safeParse 失败）。
      { name: "broken" },
      // 多余字段忽略。
      { name: "extra", path: "/x", scope: "global", agents: ["Codex"] },
    ]);
    const map = parseSkillsCliList(stdout);
    expect(map.size).toBe(3);
    expect(map.get("/home/u/.codex/skills/demo-skill")?.name).toBe("demo-skill");
    expect(map.get("/x")?.scope).toBe("global");
  });

  it("returns an empty map for unparseable JSON output", () => {
    expect(parseSkillsCliList("not json").size).toBe(0);
    expect(parseSkillsCliList(JSON.stringify({ not: "array" })).size).toBe(0);
  });

  it("peek returns null before the first probe and the map afterwards (perf B-5)", async () => {
    const probe = createSkillsCliProbe({
      run: async () => ({ stdout: JSON.stringify([{ name: "x", path: "/x" }]) }),
    });
    expect(probe.peek()).toBeNull();
    await probe.probe();
    expect(probe.peek()?.get("/x")?.name).toBe("x");
  });

  it("shares one shell-out across concurrent probes", async () => {
    let calls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const probe = createSkillsCliProbe({
      run: async () => {
        calls += 1;
        await gate;
        return { stdout: JSON.stringify([{ name: "x", path: "/x" }]) };
      },
    });
    const first = probe.probe();
    const second = probe.probe();
    release();
    await Promise.all([first, second]);
    expect(calls).toBe(1);
  });

  it("caches the probe result for the module lifetime", async () => {
    let calls = 0;
    const runner: SkillsCliRunner = async () => {
      calls += 1;
      return { stdout: JSON.stringify([{ name: "x", path: "/x", scope: "global" }]) };
    };
    const probe = createSkillsCliProbe({ run: runner });
    await probe.probe();
    await probe.probe();
    expect(calls).toBe(1);
  });

  it("degrades to an empty map when npx exits non-zero and never throws", async () => {
    const runner: SkillsCliRunner = async () => {
      throw new Error("npx not found");
    };
    const probe = createSkillsCliProbe({ run: runner });
    await expect(probe.probe()).resolves.toEqual(expect.any(Map));
    expect((await probe.probe()).size).toBe(0);
  });

  it("invalidate(paths?) removes only the named entries; invalidate() forces a re-probe", async () => {
    let calls = 0;
    const runner: SkillsCliRunner = async () => {
      calls += 1;
      return {
        stdout: JSON.stringify([
          { name: "a", path: "/a", scope: "global" },
          { name: "b", path: "/b", scope: "global" },
        ]),
      };
    };
    const probe = createSkillsCliProbe({ run: runner });
    const initial = await probe.probe();
    expect(initial.size).toBe(2);
    expect(calls).toBe(1);
    // 命中缓存：不重跑。
    await probe.probe();
    expect(calls).toBe(1);
    // 仅移除 /a：缓存仍持有 /b，不重跑。
    probe.invalidate(["/a"]);
    expect((await probe.probe()).size).toBe(1);
    expect(calls).toBe(1);
    // 清空全部缓存：下次 probe 必须重跑，重新得到完整 2 条。
    probe.invalidate();
    expect((await probe.probe()).size).toBe(2);
    expect(calls).toBe(2);
  });
});

describe("skills-CLI provenance projection", () => {
  it("marks a skill whose path is in the probe map as skills-cli + updatable", async () => {
    const skillDir = writeSkillDocument(path.join(sandbox, "demo-skill"), "demo-skill");
    const canonical = fs.realpathSync(skillDir);
    const workspaces = createWorkspaceRegistry();
    const probe = createSkillsCliProbe({
      run: async () => ({
        stdout: JSON.stringify([{ name: "demo-skill", path: canonical, scope: "global" }]),
      }),
    });
    // 新契约（perf B-5）：list 不阻塞等待 probe；测试先预热再断言 provenance。
    await probe.probe();
    const skills = createSkillService(workspaces, {
      skillsCliProbe: probe,
      discoverSkills: discovererFor([{ directory: canonical }]),
    });
    const [skill] = await skills.list(codexTarget);
    expect(skill?.installedVia).toBe("skills-cli");
    expect(skill?.updatable).toBe(true);
  });

  it("reports installedVia=unknown when the probe path escapes the server-owned root", async () => {
    const inScope = writeSkillDocument(path.join(sandbox, "demo-skill"), "demo-skill");
    // 探测里伪造一个不存在的越界路径（不会命中真实技能路径）。
    const probe = createSkillsCliProbe({
      run: async () => ({
        stdout: JSON.stringify([{ name: "evil", path: "/etc/passwd", scope: "global" }]),
      }),
    });
    const workspaces = createWorkspaceRegistry();
    // 新契约（perf B-5）：list 不阻塞等待 probe；测试先预热再断言 provenance。
    await probe.probe();
    const skills = createSkillService(workspaces, {
      skillsCliProbe: probe,
      discoverSkills: discovererFor([{ directory: fs.realpathSync(inScope) }]),
    });
    const [skill] = await skills.list(codexTarget);
    expect(skill?.installedVia).toBe("unknown");
    expect(skill?.updatable).toBe(false);
  });

  it("reports installedVia=unknown when no probe is injected", async () => {
    const skillDir = writeSkillDocument(path.join(sandbox, "demo-skill"), "demo-skill");
    const workspaces = createWorkspaceRegistry();
    const skills = createSkillService(workspaces, {
      discoverSkills: discovererFor([{ directory: fs.realpathSync(skillDir) }]),
    });
    const [skill] = await skills.list(codexTarget);
    expect(skill?.installedVia).toBe("unknown");
    expect(skill?.updatable).toBe(false);
  });

  it("keeps returning skills when the probe fails (graceful degradation)", async () => {
    const skillDir = writeSkillDocument(path.join(sandbox, "demo-skill"), "demo-skill");
    const workspaces = createWorkspaceRegistry();
    const probe = createSkillsCliProbe({
      run: async () => {
        throw new Error("npx missing");
      },
    });
    // 新契约（perf B-5）：list 不阻塞等待 probe；测试先预热再断言 provenance。
    await probe.probe();
    const skills = createSkillService(workspaces, {
      skillsCliProbe: probe,
      discoverSkills: discovererFor([{ directory: fs.realpathSync(skillDir) }]),
    });
    const list = await skills.list(codexTarget);
    expect(list).toHaveLength(1);
    expect(list[0]?.installedVia).toBe("unknown");
    expect(list[0]?.updatable).toBe(false);
  });
});

describe("parseGithubSource", () => {
  it("extracts owner/repo from short and URL forms", () => {
    expect(parseGithubSource("owner/repo")).toEqual({ owner: "owner", repo: "repo" });
    expect(parseGithubSource("https://github.com/owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
    });
    expect(parseGithubSource("https://github.com/owner/repo.git")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("returns null for non-GitHub sources", () => {
    expect(parseGithubSource("file:///local/path")).toBeNull();
    expect(parseGithubSource("")).toBeNull();
  });
});

describe("computeSkillFolderHash", () => {
  it("produces a stable SHA-256 that changes when content changes", async () => {
    const dir = writeSkillDocument(path.join(sandbox, "s"), "s", "d", "# One\n");
    const hash1 = await computeSkillFolderHash(dir);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      '---\nname: "s"\ndescription: "d"\n---\n# Two\n',
      "utf8",
    );
    const hash2 = await computeSkillFolderHash(dir);
    expect(hash2).not.toBe(hash1);
  });
});

/** 构造一棵假的 GitHub tree，命中指定 skillPath 的目录条目。 */
function fakeGithubTree(skillPath: string, sha: string): unknown {
  const folder = skillPath.replace(/\/SKILL\.md$/i, "").replace(/\/$/, "");
  return {
    sha: "rootcommitsha",
    url: "https://api.github.com/repos/o/r/git/trees/main",
    tree: [
      { path: folder, mode: "040000", type: "tree", sha },
      { path: `${folder}/SKILL.md`, mode: "100644", type: "blob", sha: "filesha" },
    ],
    truncated: false,
  };
}

/**
 * 构造一个完整的 update-service + skills/probe/repo 桩，方便各场景复用。
 * `globalLock` / `projectLock` 直接以字符串注入；fetch / clone / 默认分支解析可覆盖。
 */
async function buildUpdateService(args: {
  skillDirectory: string;
  skillName?: string;
  globalLock?: string | null;
  projectLock?: string | null;
  fetch?: FetchLike;
  clone?: UpdateCloner;
  resolveDefaultBranch?: DefaultBranchResolver;
  runner?: SkillsCliRunner;
}) {
  const canonical = fs.realpathSync(args.skillDirectory);
  const workspaces = createWorkspaceRegistry();
  const probe = createSkillsCliProbe({
    run:
      args.runner ??
      (async () => ({
        stdout: JSON.stringify([
          { name: args.skillName ?? "demo-skill", path: canonical, scope: "global" },
        ]),
      })),
  });
  // 新契约（perf B-5）：list 不阻塞等待 probe；测试先预热再断言 provenance。
  await probe.probe();
  const skills = createSkillService(workspaces, {
    skillsCliProbe: probe,
    discoverSkills: discovererFor([{ directory: canonical, name: args.skillName }]),
  });
  const repository = createRepositoryService(workspaces, skills);
  const service = createSkillsUpdateService(workspaces, skills, probe, repository, {
    fetch: args.fetch,
    clone: args.clone,
    resolveDefaultBranch: args.resolveDefaultBranch,
    readGlobalLock: () => args.globalLock ?? null,
    readProjectLock: () => args.projectLock ?? null,
  });
  return { workspaces, skills, probe, repository, service, canonical };
}

describe("skills-CLI update-check", () => {
  it("reports updated for a GitHub source when the cloned folder hash differs (ccski 3.0 批 2.2)", async () => {
    const dir = writeSkillDocument(path.join(sandbox, "demo-skill"), "demo-skill");
    const cloneDir = path.join(sandbox, "clone-src");
    writeSkillDocument(path.join(cloneDir, "skills", "demo-skill"), "demo-skill", "d", "# New\n");
    const upstreamHash = await computeSkillFolderHash(path.join(cloneDir, "skills", "demo-skill"));
    const { service, skills } = await buildUpdateService({
      skillDirectory: dir,
      globalLock: JSON.stringify({
        version: 3,
        skills: {
          "demo-skill": {
            source: "owner/repo",
            sourceType: "github",
            sourceUrl: "https://github.com/owner/repo",
            skillPath: "skills/demo-skill",
            skillFolderHash: "0".repeat(64),
            installedAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      }),
      fetch: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(fakeGithubTree("skills/demo-skill", "nevertree")),
      }),
      clone: async () => ({ directory: cloneDir }),
      resolveDefaultBranch: async () => "main",
    });
    const discovered = await skills.list(codexTarget);
    const result = await service.checkUpdates(codexTarget, discovered);
    // 上游对比 = 浅克隆 + ccski 单源 folder-hash（64-hex）；tree SHA 只是探针。
    expect(result.results[0]).toMatchObject({
      status: "updated",
      currentHash: "0".repeat(64),
      upstreamHash,
      source: "https://github.com/owner/repo",
    });
  });

  it("reports already-current for a GitHub source when the cloned folder hash equals the lock hash", async () => {
    const cloneDir = path.join(sandbox, "clone-src");
    writeSkillDocument(path.join(cloneDir, "skills", "demo-skill"), "demo-skill", "d", "# Same\n");
    const upstreamHash = await computeSkillFolderHash(path.join(cloneDir, "skills", "demo-skill"));
    const dir = writeSkillDocument(path.join(sandbox, "demo-skill"), "demo-skill", "d", "# Same\n");
    const { service, skills } = await buildUpdateService({
      skillDirectory: dir,
      globalLock: JSON.stringify({
        version: 3,
        skills: {
          "demo-skill": {
            source: "owner/repo",
            sourceType: "github",
            sourceUrl: "https://github.com/owner/repo",
            skillPath: "skills/demo-skill",
            skillFolderHash: upstreamHash,
            installedAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      }),
      fetch: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(fakeGithubTree("skills/demo-skill", "sametree")),
      }),
      clone: async () => ({ directory: cloneDir }),
      resolveDefaultBranch: async () => "main",
    });
    const discovered = await skills.list(codexTarget);
    const result = await service.checkUpdates(codexTarget, discovered);
    expect(result.results[0]?.status).toBe("already-current");
  });

  it("treats a 40-hex legacy lock entry as stale even when upstream is unchanged (hash 代际裁决)", async () => {
    // 旧算法条目（tree-SHA 时代，40-hex）：即使上游内容一致也判 stale 触发一次
    // 重装收敛——两代算法无等值语义。
    const cloneDir = path.join(sandbox, "clone-src");
    writeSkillDocument(path.join(cloneDir, "skills", "demo-skill"), "demo-skill", "d", "# Same\n");
    const dir = writeSkillDocument(path.join(sandbox, "demo-skill"), "demo-skill", "d", "# Same\n");
    const upstreamHash = await computeSkillFolderHash(path.join(cloneDir, "skills", "demo-skill"));
    const legacyHash = "a".repeat(40);
    const { service, skills } = await buildUpdateService({
      skillDirectory: dir,
      globalLock: JSON.stringify({
        version: 3,
        skills: {
          "demo-skill": {
            source: "file:///legacy-source",
            sourceType: "local",
            sourceUrl: "file:///legacy-source",
            skillPath: "skills/demo-skill",
            skillFolderHash: legacyHash,
            installedAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      }),
      clone: async () => ({ directory: cloneDir }),
    });
    const discovered = await skills.list(codexTarget);
    const result = await service.checkUpdates(codexTarget, discovered);
    expect(result.results[0]).toMatchObject({
      status: "updated",
      currentHash: legacyHash,
      upstreamHash,
    });
  });

  it("reports unavailable when GitHub API returns 403 rate limit", async () => {
    const dir = writeSkillDocument(path.join(sandbox, "demo-skill"), "demo-skill");
    const { service, skills } = await buildUpdateService({
      skillDirectory: dir,
      globalLock: JSON.stringify({
        version: 3,
        skills: {
          "demo-skill": {
            source: "owner/repo",
            sourceType: "github",
            sourceUrl: "https://github.com/owner/repo",
            skillPath: "skills/demo-skill",
            skillFolderHash: "OLDTREE",
            installedAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      }),
      fetch: async () => ({ ok: false, status: 403, text: async () => "rate limited" }),
      resolveDefaultBranch: async () => "main",
    });
    const discovered = await skills.list(codexTarget);
    const result = await service.checkUpdates(codexTarget, discovered);
    expect(result.results[0]?.status).toBe("unavailable");
  });

  it("reports unavailable when fetch throws (no network)", async () => {
    const dir = writeSkillDocument(path.join(sandbox, "demo-skill"), "demo-skill");
    const { service, skills } = await buildUpdateService({
      skillDirectory: dir,
      globalLock: JSON.stringify({
        version: 3,
        skills: {
          "demo-skill": {
            source: "owner/repo",
            sourceType: "github",
            sourceUrl: "https://github.com/owner/repo",
            skillPath: "skills/demo-skill",
            skillFolderHash: "OLDTREE",
            installedAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      }),
      fetch: async () => {
        throw new Error("ENOTFOUND");
      },
      resolveDefaultBranch: async () => "main",
    });
    const discovered = await skills.list(codexTarget);
    const result = await service.checkUpdates(codexTarget, discovered);
    expect(result.results[0]?.status).toBe("unavailable");
  });

  it("computes on-disk hash for non-GitHub sources and reports updated when it differs", async () => {
    const dir = writeSkillDocument(path.join(sandbox, "demo-skill"), "demo-skill");
    // 克隆到一个临时目录，内容与本地不同。
    const cloneDir = path.join(sandbox, "clone-src");
    writeSkillDocument(path.join(cloneDir, "demo-skill"), "demo-skill", "d", "# Different\n");
    const upstreamHash = await computeSkillFolderHash(path.join(cloneDir, "demo-skill"));
    const { service, skills } = await buildUpdateService({
      skillDirectory: dir,
      globalLock: JSON.stringify({
        version: 3,
        skills: {
          "demo-skill": {
            source: "file:///non-github",
            sourceType: "local",
            sourceUrl: "file:///non-github",
            skillPath: "demo-skill",
            skillFolderHash: "OLDDISKHASH",
            installedAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      }),
      clone: async () => ({ directory: cloneDir }),
    });
    const discovered = await skills.list(codexTarget);
    const result = await service.checkUpdates(codexTarget, discovered);
    expect(result.results[0]?.status).toBe("updated");
    expect(result.results[0]?.upstreamHash).toBe(upstreamHash);
  });

  it("reports unavailable when no lock entry exists for a probe-matched skill", async () => {
    const dir = writeSkillDocument(path.join(sandbox, "demo-skill"), "demo-skill");
    const { service, skills } = await buildUpdateService({
      skillDirectory: dir,
      globalLock: null,
      projectLock: null,
    });
    const discovered = await skills.list(codexTarget);
    const result = await service.checkUpdates(codexTarget, discovered);
    expect(result.results[0]?.status).toBe("unavailable");
  });

  it("returns empty results (no throw) when probe finds nothing and lock is missing", async () => {
    const dir = writeSkillDocument(path.join(sandbox, "demo-skill"), "demo-skill");
    const { service, skills } = await buildUpdateService({
      skillDirectory: dir,
      globalLock: null,
      projectLock: null,
      runner: async () => ({ stdout: "[]" }),
    });
    const discovered = await skills.list(codexTarget);
    const result = await service.checkUpdates(codexTarget, discovered);
    expect(result.results).toEqual([]);
  });

  it("reports failed when a non-GitHub clone throws", async () => {
    const dir = writeSkillDocument(path.join(sandbox, "demo-skill"), "demo-skill");
    const { service, skills } = await buildUpdateService({
      skillDirectory: dir,
      globalLock: JSON.stringify({
        version: 3,
        skills: {
          "demo-skill": {
            source: "file:///broken",
            sourceType: "local",
            sourceUrl: "file:///broken",
            skillFolderHash: "OLDDISKHASH",
            installedAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      }),
      clone: async () => {
        throw new Error("clone failed");
      },
    });
    const discovered = await skills.list(codexTarget);
    const result = await service.checkUpdates(codexTarget, discovered);
    expect(result.results[0]?.status).toBe("failed");
  });
});

describe("skills-CLI apply-update", () => {
  const openclawProviderId = ProviderIdSchema.parse("openclaw");

  /** 构造一个真实本地 git 仓库，install pipeline 会从中克隆。 */
  function buildGitRepo(suffix = "git-source"): string {
    const repo = path.join(sandbox, suffix);
    fs.mkdirSync(repo, { recursive: true });
    git(repo, "init", "--quiet");
    git(repo, "config", "user.name", "Test");
    git(repo, "config", "user.email", "test@example.invalid");
    return repo;
  }

  function git(cwd: string, ...args: string[]): string {
    return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  }

  it("reports failed when the skill is not tracked by the skills CLI (no probe hit)", async () => {
    const workspaceRoot = path.join(sandbox, "ws-demo-skill");
    const skillDir = writeSkillDocument(
      path.join(workspaceRoot, "skills", "demo-skill"),
      "demo-skill",
    );
    const canonical = fs.realpathSync(skillDir);
    const workspaces = createWorkspaceRegistry();
    const workspace = workspaces.import(workspaceRoot, "demo-skill");
    const target: WorkspaceProviderTarget = {
      workspaceId: workspace.id,
      providerId: openclawProviderId,
    };
    const probe = createSkillsCliProbe({ run: async () => ({ stdout: "[]" }) });
    // 新契约（perf B-5）：list 不阻塞等待 probe；测试先预热再断言 provenance。
    await probe.probe();
    const skills = createSkillService(workspaces, {
      skillsCliProbe: probe,
      discoverSkills: discovererFor([{ directory: canonical }]),
    });
    const repository = createRepositoryService(workspaces, skills);
    const service = createSkillsUpdateService(workspaces, skills, probe, repository, {
      readGlobalLock: () => null,
      readProjectLock: () => null,
    });
    const discovered = await skills.list(target);
    const skillId = discovered[0]?.id as SkillId;
    const result = await service.applyUpdates(target, [skillId], {
      workspaceId: target.workspaceId,
      providerId: target.providerId,
      skillIds: [skillId],
    });
    expect(result.results[0]?.status).toBe("failed");
    expect(result.results[0]?.error).toContain("not tracked");
    await repository.dispose();
  });

  it("reports failed when no lock entry exists for the skill", async () => {
    const workspaceRoot = path.join(sandbox, "ws-demo-skill");
    const skillDir = writeSkillDocument(
      path.join(workspaceRoot, "skills", "demo-skill"),
      "demo-skill",
    );
    const canonical = fs.realpathSync(skillDir);
    const workspaces = createWorkspaceRegistry();
    const workspace = workspaces.import(workspaceRoot, "demo-skill");
    const target: WorkspaceProviderTarget = {
      workspaceId: workspace.id,
      providerId: openclawProviderId,
    };
    const probe = createSkillsCliProbe({
      run: async () => ({
        stdout: JSON.stringify([{ name: "demo-skill", path: canonical, scope: "project" }]),
      }),
    });
    // 新契约（perf B-5）：list 不阻塞等待 probe；测试先预热再断言 provenance。
    await probe.probe();
    const skills = createSkillService(workspaces, {
      skillsCliProbe: probe,
      discoverSkills: discovererFor([{ directory: canonical }]),
    });
    const repository = createRepositoryService(workspaces, skills);
    const service = createSkillsUpdateService(workspaces, skills, probe, repository, {
      readGlobalLock: () => null,
      readProjectLock: () => null,
    });
    const discovered = await skills.list(target);
    const skillId = discovered[0]?.id as SkillId;
    const result = await service.applyUpdates(target, [skillId], {
      workspaceId: target.workspaceId,
      providerId: target.providerId,
      skillIds: [skillId],
    });
    expect(result.results[0]?.status).toBe("failed");
    expect(result.results[0]?.error).toContain("lock entry");
    await repository.dispose();
  });

  it("reinstalls through the kernel entity API and refreshes the in-memory hash overlay", async () => {
    // 上游 git 仓库里放一个新版本的技能。
    const repo = buildGitRepo();
    writeSkillDocument(
      path.join(repo, "skills", "demo-skill"),
      "demo-skill",
      "Upstream skill.",
      "# Upstream\n",
    );
    git(repo, "add", ".");
    git(repo, "commit", "--quiet", "-m", "init");

    // 本地导入 workspace 下放一个旧版本技能（内容不同，hash 必然不同）。
    const workspaceRoot = path.join(sandbox, "ws-demo-skill");
    const localSkillDir = writeSkillDocument(
      path.join(workspaceRoot, "skills", "demo-skill"),
      "demo-skill",
      "Local skill.",
      "# Local\n",
    );
    const canonical = fs.realpathSync(localSkillDir);

    const workspaces = createWorkspaceRegistry();
    const workspace = workspaces.import(workspaceRoot, "demo-skill");
    const target: WorkspaceProviderTarget = {
      workspaceId: workspace.id,
      providerId: openclawProviderId,
    };
    const probe = createSkillsCliProbe({
      run: async () => ({
        stdout: JSON.stringify([{ name: "demo-skill", path: canonical, scope: "project" }]),
      }),
    });
    // 新契约（perf B-5）：list 不阻塞等待 probe；测试先预热再断言 provenance。
    await probe.probe();
    const skills = createSkillService(workspaces, {
      skillsCliProbe: probe,
      discoverSkills: discovererFor([{ directory: canonical }]),
    });
    const repository = createRepositoryService(workspaces, skills);
    const service = createSkillsUpdateService(workspaces, skills, probe, repository, {
      readGlobalLock: () =>
        JSON.stringify({
          version: 3,
          skills: {
            "demo-skill": {
              source: repo,
              sourceType: "local",
              sourceUrl: repo,
              skillPath: "skills/demo-skill",
              skillFolderHash: "OLDHASH",
              installedAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          },
        }),
      readProjectLock: () => null,
    });

    const discovered = await skills.list(target);
    const skillId = discovered[0]?.id as SkillId;
    const result = await service.applyUpdates(target, [skillId], {
      workspaceId: target.workspaceId,
      providerId: target.providerId,
      skillIds: [skillId],
    });
    expect(result.results[0]).toMatchObject({ status: "updated", lockSyncPending: true });
    // legacy 物化目录迁移为实体 + link 投影（批 2.2 两阶段）。
    const projected = path.join(workspaceRoot, "skills", "demo-skill");
    expect(fs.lstatSync(projected).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(projected, "SKILL.md"), "utf8")).toContain("Upstream skill.");
    const entityDir = path.join(workspaceRoot, ".agents", "skills", "demo-skill");
    expect(fs.lstatSync(entityDir).isDirectory()).toBe(true);
    // 内存覆盖层应已写入新 hash（来自克隆计算，64-hex 新代际）。
    const overlay = service._hashOverlayForTest();
    expect(overlay.get("demo-skill")).toMatch(/^[a-f0-9]{64}$/);
    await repository.dispose();
  });

  it("converges a 40-hex legacy lock entry through one kernel reinstall (hash 代际裁决)", async () => {
    // 上游内容与本地完全一致，但 lock 记录是 40-hex 旧算法条目——不短路为
    // already-current，触发一次重装收敛，覆盖层落 64-hex 新代际。
    const repo = buildGitRepo("git-legacy");
    writeSkillDocument(
      path.join(repo, "skills", "demo-skill"),
      "demo-skill",
      "Upstream skill.",
      "# Upstream\n",
    );
    git(repo, "add", ".");
    git(repo, "commit", "--quiet", "-m", "init");

    const workspaceRoot = path.join(sandbox, "ws-legacy");
    const localSkillDir = path.join(workspaceRoot, "skills", "demo-skill");
    fs.cpSync(path.join(repo, "skills", "demo-skill"), localSkillDir, { recursive: true });
    const canonical = fs.realpathSync(localSkillDir);

    const workspaces = createWorkspaceRegistry();
    const workspace = workspaces.import(workspaceRoot, "legacy");
    const target: WorkspaceProviderTarget = {
      workspaceId: workspace.id,
      providerId: openclawProviderId,
    };
    const probe = createSkillsCliProbe({
      // probe 路径按运行时 realpath 解析：apply 收敛后目录变为 link 投影，
      // realpath 跟随到实体路径（覆盖层刷新后 recheck 需要新 probe 命中）。
      run: async () => ({
        stdout: JSON.stringify([
          {
            name: "demo-skill",
            path: fs.realpathSync(path.join(workspaceRoot, "skills", "demo-skill")),
            scope: "project",
          },
        ]),
      }),
    });
    await probe.probe();
    const skills = createSkillService(workspaces, {
      skillsCliProbe: probe,
      discoverSkills: async () => {
        const live = fs.realpathSync(path.join(workspaceRoot, "skills", "demo-skill"));
        return [discoveredSkill(live)];
      },
    });
    const repository = createRepositoryService(workspaces, skills);
    const service = createSkillsUpdateService(workspaces, skills, probe, repository, {
      readGlobalLock: () =>
        JSON.stringify({
          version: 3,
          skills: {
            "demo-skill": {
              source: repo,
              sourceType: "local",
              sourceUrl: repo,
              skillPath: "skills/demo-skill",
              skillFolderHash: "b".repeat(40),
              installedAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          },
        }),
      readProjectLock: () => null,
    });

    const discovered = await skills.list(target);
    const skillId = discovered[0]?.id as SkillId;
    const result = await service.applyUpdates(target, [skillId], {
      workspaceId: target.workspaceId,
      providerId: target.providerId,
      skillIds: [skillId],
    });
    expect(result.results[0]).toMatchObject({ status: "updated", lockSyncPending: true });
    const overlay = service._hashOverlayForTest();
    expect(overlay.get("demo-skill")).toMatch(/^[a-f0-9]{64}$/);
    // 收敛后重查：覆盖层新代际 hash 与上游一致 → already-current（不再循环 stale）。
    // probe 整表失效后先重热（list 的 updatable 投影走 peek，冷 probe 投影 false）。
    probe.invalidate();
    await probe.probe();
    const recheck = await service.checkUpdates(target, await skills.list(target));
    expect(recheck.results[0]?.status).toBe("already-current");
    await repository.dispose();
  });

  it("does not fake success when the kernel reinstall fails (负例：不伪装成功)", async () => {
    const repo = buildGitRepo("git-failing");
    writeSkillDocument(
      path.join(repo, "skills", "demo-skill"),
      "demo-skill",
      "Upstream skill.",
      "# Upstream\n",
    );
    git(repo, "add", ".");
    git(repo, "commit", "--quiet", "-m", "init");

    const workspaceRoot = path.join(sandbox, "ws-failing");
    const localSkillDir = writeSkillDocument(
      path.join(workspaceRoot, "skills", "demo-skill"),
      "demo-skill",
      "Local skill.",
      "# Local\n",
    );
    const canonical = fs.realpathSync(localSkillDir);

    const workspaces = createWorkspaceRegistry();
    const workspace = workspaces.import(workspaceRoot, "failing");
    const target: WorkspaceProviderTarget = {
      workspaceId: workspace.id,
      providerId: openclawProviderId,
    };
    const probe = createSkillsCliProbe({
      run: async () => ({
        stdout: JSON.stringify([{ name: "demo-skill", path: canonical, scope: "project" }]),
      }),
    });
    await probe.probe();
    const skills = createSkillService(workspaces, {
      skillsCliProbe: probe,
      discoverSkills: discovererFor([{ directory: canonical }]),
    });
    const repository = createRepositoryService(workspaces, skills);
    const service = createSkillsUpdateService(workspaces, skills, probe, repository, {
      kernel: {
        updateEntity: async () => ({
          kind: "error",
          code: "GUARD_ENTITY",
          message: "RAW KERNEL INTERNAL DETAIL must not leak",
        }),
        ensureEntity: async () => {
          throw new Error("must not be reached after a typed updateEntity error");
        },
        projectEntity: async () => {
          throw new Error("must not be reached after a typed updateEntity error");
        },
      },
      readGlobalLock: () =>
        JSON.stringify({
          version: 3,
          skills: {
            "demo-skill": {
              source: repo,
              sourceType: "local",
              sourceUrl: repo,
              skillPath: "skills/demo-skill",
              skillFolderHash: "OLDHASH",
              installedAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          },
        }),
      readProjectLock: () => null,
    });

    const discovered = await skills.list(target);
    const skillId = discovered[0]?.id as SkillId;
    const result = await service.applyUpdates(target, [skillId], {
      workspaceId: target.workspaceId,
      providerId: target.providerId,
      skillIds: [skillId],
    });
    const entry = result.results[0];
    expect(entry).toMatchObject({ status: "failed" });
    expect(entry?.error).toContain("ccski code: GUARD_ENTITY");
    expect(entry?.error).not.toContain("RAW KERNEL INTERNAL DETAIL");
    expect(entry).not.toHaveProperty("lockSyncPending");
    // 覆盖层未刷新（不伪装成功）。
    expect(service._hashOverlayForTest().size).toBe(0);
    // 本地旧内容原样保留。
    expect(fs.readFileSync(path.join(canonical, "SKILL.md"), "utf8")).toContain("Local skill.");
    await repository.dispose();
  });

  it("reports already-current when the upstream hash already matches before apply", async () => {
    const repo = buildGitRepo();
    writeSkillDocument(
      path.join(repo, "skills", "demo-skill"),
      "demo-skill",
      "Upstream skill.",
      "# Upstream\n",
    );
    git(repo, "add", ".");
    git(repo, "commit", "--quiet", "-m", "init");

    // 本地技能与上游一致：把上游内容拷过来，使其 hash 相同。
    const workspaceRoot = path.join(sandbox, "ws-demo-skill");
    const localSkillDir = path.join(workspaceRoot, "skills", "demo-skill");
    fs.cpSync(path.join(repo, "skills", "demo-skill"), localSkillDir, {
      recursive: true,
    });
    const canonical = fs.realpathSync(localSkillDir);
    const upstreamHash = await computeSkillFolderHash(canonical);

    const workspaces = createWorkspaceRegistry();
    const workspace = workspaces.import(workspaceRoot, "demo-skill");
    const target: WorkspaceProviderTarget = {
      workspaceId: workspace.id,
      providerId: openclawProviderId,
    };
    const probe = createSkillsCliProbe({
      run: async () => ({
        stdout: JSON.stringify([{ name: "demo-skill", path: canonical, scope: "project" }]),
      }),
    });
    // 新契约（perf B-5）：list 不阻塞等待 probe；测试先预热再断言 provenance。
    await probe.probe();
    const skills = createSkillService(workspaces, {
      skillsCliProbe: probe,
      discoverSkills: discovererFor([{ directory: canonical }]),
    });
    const repository = createRepositoryService(workspaces, skills);
    const service = createSkillsUpdateService(workspaces, skills, probe, repository, {
      readGlobalLock: () =>
        JSON.stringify({
          version: 3,
          skills: {
            "demo-skill": {
              source: repo,
              sourceType: "local",
              sourceUrl: repo,
              skillPath: "skills/demo-skill",
              skillFolderHash: upstreamHash,
              installedAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          },
        }),
      readProjectLock: () => null,
    });

    const discovered = await skills.list(target);
    const skillId = discovered[0]?.id as SkillId;
    const result = await service.applyUpdates(target, [skillId], {
      workspaceId: target.workspaceId,
      providerId: target.providerId,
      skillIds: [skillId],
    });
    expect(result.results[0]?.status).toBe("already-current");
    await repository.dispose();
  });

  it("reports failed with an error reason when reinstall cannot find the remote skill", async () => {
    const repo = buildGitRepo();
    // 上游仓库里放一个不同名字的技能（不会命中 demo-skill）。
    writeSkillDocument(
      path.join(repo, "skills", "other-skill"),
      "other-skill",
      "Other.",
      "# Other\n",
    );
    git(repo, "add", ".");
    git(repo, "commit", "--quiet", "-m", "init");

    const workspaceRoot = path.join(sandbox, "ws-demo-skill");
    const localSkillDir = writeSkillDocument(
      path.join(workspaceRoot, "skills", "demo-skill"),
      "demo-skill",
      "Local.",
      "# Local\n",
    );
    const canonical = fs.realpathSync(localSkillDir);

    const workspaces = createWorkspaceRegistry();
    const workspace = workspaces.import(workspaceRoot, "demo-skill");
    const target: WorkspaceProviderTarget = {
      workspaceId: workspace.id,
      providerId: openclawProviderId,
    };
    const probe = createSkillsCliProbe({
      run: async () => ({
        stdout: JSON.stringify([{ name: "demo-skill", path: canonical, scope: "project" }]),
      }),
    });
    // 新契约（perf B-5）：list 不阻塞等待 probe；测试先预热再断言 provenance。
    await probe.probe();
    const skills = createSkillService(workspaces, {
      skillsCliProbe: probe,
      discoverSkills: discovererFor([{ directory: canonical }]),
    });
    const repository = createRepositoryService(workspaces, skills);
    const service = createSkillsUpdateService(workspaces, skills, probe, repository, {
      readGlobalLock: () =>
        JSON.stringify({
          version: 3,
          skills: {
            "demo-skill": {
              source: repo,
              sourceType: "local",
              sourceUrl: repo,
              skillPath: "skills/demo-skill",
              skillFolderHash: "OLDHASH",
              installedAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          },
        }),
      readProjectLock: () => null,
    });

    const discovered = await skills.list(target);
    const skillId = discovered[0]?.id as SkillId;
    const result = await service.applyUpdates(target, [skillId], {
      workspaceId: target.workspaceId,
      providerId: target.providerId,
      skillIds: [skillId],
    });
    // 上游仓库里没有 demo-skill 路径 → 克隆后算 hash 时找不到目标目录 → failed。
    expect(result.results[0]?.status).toBe("failed");
    expect(result.results[0]?.error).toMatch(/compute|upstream|not found|install/i);
    await repository.dispose();
  });

  it("keeps the user-modified materialized projection when the kernel receipt is GUARD_PROJECTION (P0-1 回归)", async () => {
    // 终审 P0-1 现场：内核顶层 updateEntity ok、该 root 收据 GUARD_PROJECTION
    // failed（用户改过物化副本，内核保留被改副本）；宿主旧逻辑只看顶层 kind，
    // 对物化目录走 legacy 清理 rmSync → 用户修改丢失 + 投影消失 + state 仍
    // materialized。修复后逐投影收据裁决：如实 failed、磁盘原样。
    const repo = buildGitRepo("git-guard");
    writeSkillDocument(
      path.join(repo, "skills", "demo-skill"),
      "demo-skill",
      "Upstream skill.",
      "# Upstream\n",
    );
    git(repo, "add", ".");
    git(repo, "commit", "--quiet", "-m", "init");

    const workspaceRoot = path.join(sandbox, "ws-guard");
    fs.mkdirSync(workspaceRoot, { recursive: true });
    const source = writeSkillDocument(path.join(sandbox, "guard-src"), "demo-skill");
    const workspaces = createWorkspaceRegistry();
    const workspace = workspaces.import(workspaceRoot, "guard");
    const target: WorkspaceProviderTarget = {
      workspaceId: workspace.id,
      providerId: openclawProviderId,
    };
    const scope = workspaces.resolve(target, true);
    const canonicalWorkspace = scope.workspaceDirectory ?? workspaceRoot;
    const providerRoot = scope.directory;
    fs.mkdirSync(providerRoot, { recursive: true });

    // 实体 + 物化投影（真实内核）。
    const ensured = await ensureEntity({
      scope: "project",
      workspaceDir: canonicalWorkspace,
      source: { dir: source },
    });
    if (ensured.kind !== "ok") throw new Error(`ensureEntity failed: ${JSON.stringify(ensured)}`);
    const projected = await projectEntity({
      scope: "project",
      workspaceDir: canonicalWorkspace,
      name: "demo-skill",
      roots: [providerRoot],
      mode: "materialized",
      reason: "user-request",
    });
    if (projected.kind !== "ok")
      throw new Error(`projectEntity failed: ${JSON.stringify(projected)}`);

    // 用户修改物化副本（触发内核 GUARD_PROJECTION 收据）。
    const materializedDir = path.join(providerRoot, "demo-skill");
    fs.writeFileSync(
      path.join(materializedDir, "SKILL.md"),
      '---\nname: "demo-skill"\ndescription: "USER EDIT"\n---\n# USER EDIT\n',
      "utf8",
    );
    const canonical = fs.realpathSync(materializedDir);

    const probe = createSkillsCliProbe({
      run: async () => ({
        stdout: JSON.stringify([{ name: "demo-skill", path: canonical, scope: "project" }]),
      }),
    });
    await probe.probe();
    const skills = createSkillService(workspaces, {
      skillsCliProbe: probe,
      discoverSkills: discovererFor([{ directory: canonical }]),
    });
    const repository = createRepositoryService(workspaces, skills);
    const service = createSkillsUpdateService(workspaces, skills, probe, repository, {
      readGlobalLock: () =>
        JSON.stringify({
          version: 3,
          skills: {
            "demo-skill": {
              source: repo,
              sourceType: "local",
              sourceUrl: repo,
              skillPath: "skills/demo-skill",
              skillFolderHash: "OLDHASH",
              installedAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          },
        }),
      readProjectLock: () => null,
    });

    const discovered = await skills.list(target);
    const skillId = discovered[0]?.id as SkillId;
    const result = await service.applyUpdates(target, [skillId], {
      workspaceId: target.workspaceId,
      providerId: target.providerId,
      skillIds: [skillId],
    });
    const entry = result.results[0];
    expect(entry).toMatchObject({ status: "failed" });
    expect(entry?.error).toContain("ccski code: GUARD_PROJECTION");
    expect(entry?.error).toContain("kept the modified copy");
    expect(entry).not.toHaveProperty("lockSyncPending");
    // 物化投影与用户修改原样保留（内核语义：GUARD_PROJECTION 不动被改副本）。
    expect(fs.lstatSync(materializedDir).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(materializedDir, "SKILL.md"), "utf8")).toContain("USER EDIT");
    // state 仍记 materialized（宿主不做任何投影形态改写）。
    const state = JSON.parse(
      fs.readFileSync(path.join(canonicalWorkspace, ".agents", ".ccski-state.json"), "utf8"),
    ) as { projections: Record<string, { folderName?: string; mode?: string }> };
    const record = Object.values(state.projections).find(
      (candidate) => candidate.folderName === "demo-skill",
    );
    expect(record?.mode).toBe("materialized");
    // 覆盖层未刷新（失败不伪装成功）。
    expect(service._hashOverlayForTest().size).toBe(0);
    await repository.dispose();
  });

  it("stops all follow-up kernel calls for the root when the update receipt is failed (P0-1 mock 边界)", async () => {
    const repo = buildGitRepo("git-guard-mock");
    writeSkillDocument(
      path.join(repo, "skills", "demo-skill"),
      "demo-skill",
      "Upstream skill.",
      "# Upstream\n",
    );
    git(repo, "add", ".");
    git(repo, "commit", "--quiet", "-m", "init");

    const workspaceRoot = path.join(sandbox, "ws-guard-mock");
    const localSkillDir = writeSkillDocument(
      path.join(workspaceRoot, "skills", "demo-skill"),
      "demo-skill",
      "Local skill.",
      "# Local\n",
    );
    const canonical = fs.realpathSync(localSkillDir);

    const workspaces = createWorkspaceRegistry();
    const workspace = workspaces.import(workspaceRoot, "guard-mock");
    const target: WorkspaceProviderTarget = {
      workspaceId: workspace.id,
      providerId: openclawProviderId,
    };
    const probe = createSkillsCliProbe({
      run: async () => ({
        stdout: JSON.stringify([{ name: "demo-skill", path: canonical, scope: "project" }]),
      }),
    });
    await probe.probe();
    const skills = createSkillService(workspaces, {
      skillsCliProbe: probe,
      discoverSkills: discovererFor([{ directory: canonical }]),
    });
    const repository = createRepositoryService(workspaces, skills);
    const service = createSkillsUpdateService(workspaces, skills, probe, repository, {
      kernel: {
        updateEntity: async () => ({
          kind: "ok" as const,
          status: "updated" as const,
          entity: { folderName: "demo-skill" },
          projections: [
            {
              rootId: "root",
              rootPath: fs.realpathSync(path.join(workspaceRoot, "skills")),
              path: path.join(workspaceRoot, "skills", "demo-skill"),
              mode: "materialized" as const,
              disabled: false,
              status: "failed" as const,
              code: "GUARD_PROJECTION" as const,
              detail: "RAW KERNEL INTERNAL DETAIL must not leak",
            },
          ],
          updated: 0,
          unchanged: 0,
          skipped: 0,
          failed: 1,
          generation: 1,
          lockSyncPending: true,
          warnings: [],
        }),
        ensureEntity: async () => {
          throw new Error("must not be reached after a failed update receipt");
        },
        projectEntity: async () => {
          throw new Error("must not be reached after a failed update receipt");
        },
      },
      readGlobalLock: () =>
        JSON.stringify({
          version: 3,
          skills: {
            "demo-skill": {
              source: repo,
              sourceType: "local",
              sourceUrl: repo,
              skillPath: "skills/demo-skill",
              skillFolderHash: "OLDHASH",
              installedAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          },
        }),
      readProjectLock: () => null,
    });

    const discovered = await skills.list(target);
    const skillId = discovered[0]?.id as SkillId;
    const result = await service.applyUpdates(target, [skillId], {
      workspaceId: target.workspaceId,
      providerId: target.providerId,
      skillIds: [skillId],
    });
    const entry = result.results[0];
    expect(entry).toMatchObject({ status: "failed" });
    expect(entry?.error).toContain("ccski code: GUARD_PROJECTION");
    expect(entry?.error).not.toContain("RAW KERNEL INTERNAL DETAIL");
    // 本地（此处视为物化副本的）目录不被 legacy 清理触碰。
    expect(fs.existsSync(canonical)).toBe(true);
    expect(fs.readFileSync(path.join(canonical, "SKILL.md"), "utf8")).toContain("Local skill.");
    await repository.dispose();
  });

  it("fails closed without legacy cleanup when a corrupted projection record leaves no update receipt (P0-C 回归)", async () => {
    // 终审 P0-C 现场（真实内核复现）：state 投影记录 mode 损坏 → 内核
    // parseProjectionTable 丢弃该记录 → 该 root 无收据 → 旧逻辑把「无收据」解释
    // 为「未登记 root」执行 legacy 清理 rmSync 用户改过的物化副本并打 link。
    // 修复后（快照过渡语义：内核未报告投影表健康度时收据缺席 ≠ 未登记）：
    // typed 失败指路 ccski state repair，磁盘原样、绝不 legacy 清理。
    const repo = buildGitRepo("git-degraded-record");
    writeSkillDocument(
      path.join(repo, "skills", "demo-skill"),
      "demo-skill",
      "Upstream skill.",
      "# Upstream\n",
    );
    git(repo, "add", ".");
    git(repo, "commit", "--quiet", "-m", "init");

    const workspaceRoot = path.join(sandbox, "ws-degraded-record");
    fs.mkdirSync(workspaceRoot, { recursive: true });
    const source = writeSkillDocument(path.join(sandbox, "degraded-src"), "demo-skill");
    const workspaces = createWorkspaceRegistry();
    const workspace = workspaces.import(workspaceRoot, "degraded-record");
    const target: WorkspaceProviderTarget = {
      workspaceId: workspace.id,
      providerId: openclawProviderId,
    };
    const scope = workspaces.resolve(target, true);
    const canonicalWorkspace = scope.workspaceDirectory ?? workspaceRoot;
    const providerRoot = scope.directory;
    fs.mkdirSync(providerRoot, { recursive: true });

    // 实体 + 物化投影（真实内核），随后用户修改物化副本。
    const ensured = await ensureEntity({
      scope: "project",
      workspaceDir: canonicalWorkspace,
      source: { dir: source },
    });
    if (ensured.kind !== "ok") throw new Error(`ensureEntity failed: ${JSON.stringify(ensured)}`);
    const projected = await projectEntity({
      scope: "project",
      workspaceDir: canonicalWorkspace,
      name: "demo-skill",
      roots: [providerRoot],
      mode: "materialized",
      reason: "user-request",
    });
    if (projected.kind !== "ok")
      throw new Error(`projectEntity failed: ${JSON.stringify(projected)}`);
    const materializedDir = path.join(providerRoot, "demo-skill");
    fs.writeFileSync(
      path.join(materializedDir, "SKILL.md"),
      '---\nname: "demo-skill"\ndescription: "USER EDIT"\n---\n# USER EDIT\n',
      "utf8",
    );

    // 损坏该投影记录的 mode 字段（Codex 实测口径：改为无效值）。
    const statePath = path.join(canonicalWorkspace, ".agents", ".ccski-state.json");
    const rawState = JSON.parse(fs.readFileSync(statePath, "utf8")) as {
      projections: Record<string, { folderName?: string; mode?: string }>;
    };
    let corrupted = 0;
    for (const record of Object.values(rawState.projections)) {
      if (record.folderName === "demo-skill") {
        record.mode = "corrupted-mode";
        corrupted += 1;
      }
    }
    expect(corrupted).toBe(1);
    fs.writeFileSync(statePath, JSON.stringify(rawState), "utf8");

    const canonical = fs.realpathSync(materializedDir);
    const probe = createSkillsCliProbe({
      run: async () => ({
        stdout: JSON.stringify([{ name: "demo-skill", path: canonical, scope: "project" }]),
      }),
    });
    await probe.probe();
    const skills = createSkillService(workspaces, {
      skillsCliProbe: probe,
      discoverSkills: discovererFor([{ directory: canonical }]),
    });
    const repository = createRepositoryService(workspaces, skills);
    const service = createSkillsUpdateService(workspaces, skills, probe, repository, {
      readGlobalLock: () =>
        JSON.stringify({
          version: 3,
          skills: {
            "demo-skill": {
              source: repo,
              sourceType: "local",
              sourceUrl: repo,
              skillPath: "skills/demo-skill",
              skillFolderHash: "OLDHASH",
              installedAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          },
        }),
      readProjectLock: () => null,
    });

    const discovered = await skills.list(target);
    const skillId = discovered[0]?.id as SkillId;
    const result = await service.applyUpdates(target, [skillId], {
      workspaceId: target.workspaceId,
      providerId: target.providerId,
      skillIds: [skillId],
    });
    const entry = result.results[0];
    expect(entry).toMatchObject({ status: "failed" });
    // 断言钉住裁决面：这是宿主侧 fail-closed 裁决（无 ccski code token），不是
    // 内核 typed error（STATE_RECOVERY_REQUIRED 文案也含 state repair 字样）。
    expect(entry?.error).toContain(
      "cannot prove whether the materialized provider entry is registered",
    );
    expect(entry?.error).toContain("ccski state repair");
    expect(entry?.error).not.toContain("ccski code:");
    expect(entry).not.toHaveProperty("lockSyncPending");
    // 用户修改字节保留；目录仍是物化目录（未被 legacy 清理、未变 link）。
    expect(fs.lstatSync(materializedDir).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(materializedDir, "SKILL.md"), "utf8")).toContain("USER EDIT");
    // 宿主不修 state：损坏记录原样在场（folderName 仍可辨认）。
    const afterState = JSON.parse(fs.readFileSync(statePath, "utf8")) as {
      projections: Record<string, { folderName?: string; mode?: string }>;
    };
    expect(
      Object.values(afterState.projections).some(
        (record) => record.folderName === "demo-skill" && record.mode === "corrupted-mode",
      ),
    ).toBe(true);
    // 覆盖层未刷新（失败不伪装成功）。
    expect(service._hashOverlayForTest().size).toBe(0);
    await repository.dispose();
  });

  it("fails closed for materialized roots when the kernel reports degradedProjectionState (P0-C 新契约 seam)", async () => {
    // 内核新契约（并行落地，形状钉死）：ok 变体携带 degradedProjectionState=true +
    // invalidProjectionKeys。宿主消费：本轮对物化/疑似物化 root 一律 typed 失败
    // 指路 state repair，绝不 legacy 清理（即使收据缺席看起来像未登记 root）。
    const repo = buildGitRepo("git-degraded-flag");
    writeSkillDocument(
      path.join(repo, "skills", "demo-skill"),
      "demo-skill",
      "Upstream skill.",
      "# Upstream\n",
    );
    git(repo, "add", ".");
    git(repo, "commit", "--quiet", "-m", "init");

    const workspaceRoot = path.join(sandbox, "ws-degraded-flag");
    const localSkillDir = writeSkillDocument(
      path.join(workspaceRoot, "skills", "demo-skill"),
      "demo-skill",
      "Local skill.",
      "# Local\n",
    );
    const canonical = fs.realpathSync(localSkillDir);

    const workspaces = createWorkspaceRegistry();
    const workspace = workspaces.import(workspaceRoot, "degraded-flag");
    const target: WorkspaceProviderTarget = {
      workspaceId: workspace.id,
      providerId: openclawProviderId,
    };
    const probe = createSkillsCliProbe({
      run: async () => ({
        stdout: JSON.stringify([{ name: "demo-skill", path: canonical, scope: "project" }]),
      }),
    });
    await probe.probe();
    const skills = createSkillService(workspaces, {
      skillsCliProbe: probe,
      discoverSkills: discovererFor([{ directory: canonical }]),
    });
    const repository = createRepositoryService(workspaces, skills);
    const service = createSkillsUpdateService(workspaces, skills, probe, repository, {
      kernel: {
        updateEntity: async () => ({
          kind: "ok" as const,
          status: "updated" as const,
          entity: { folderName: "demo-skill" },
          projections: [],
          degradedProjectionState: true,
          invalidProjectionKeys: ["proj#<root>/demo-skill"],
          updated: 1,
          unchanged: 0,
          skipped: 0,
          failed: 0,
          generation: 1,
          lockSyncPending: true,
          warnings: [],
        }),
        ensureEntity: async () => {
          throw new Error(
            "must not be reached when the kernel reports a degraded projection table",
          );
        },
        projectEntity: async () => {
          throw new Error(
            "must not be reached when the kernel reports a degraded projection table",
          );
        },
      },
      readGlobalLock: () =>
        JSON.stringify({
          version: 3,
          skills: {
            "demo-skill": {
              source: repo,
              sourceType: "local",
              sourceUrl: repo,
              skillPath: "skills/demo-skill",
              skillFolderHash: "OLDHASH",
              installedAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          },
        }),
      readProjectLock: () => null,
    });

    const discovered = await skills.list(target);
    const skillId = discovered[0]?.id as SkillId;
    const result = await service.applyUpdates(target, [skillId], {
      workspaceId: target.workspaceId,
      providerId: target.providerId,
      skillIds: [skillId],
    });
    const entry = result.results[0];
    expect(entry).toMatchObject({ status: "failed" });
    expect(entry?.error).toContain(
      "cannot prove whether the materialized provider entry is registered",
    );
    expect(entry?.error).toContain("ccski state repair");
    expect(entry).not.toHaveProperty("lockSyncPending");
    // 物化目录不被 legacy 清理触碰，内容原样。
    expect(fs.lstatSync(localSkillDir).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(localSkillDir, "SKILL.md"), "utf8")).toContain("Local skill.");
    expect(service._hashOverlayForTest().size).toBe(0);
    await repository.dispose();
  });

  it("still converges an unregistered materialized copy when the kernel certifies a healthy projection table (P0-C 正向证明边界)", async () => {
    // 新内核显式 degradedProjectionState=false = 投影表完整解析（无记录被丢弃）：
    // 收据缺席 = 正向证明该 root 未登记（真 legacy 副本）→ legacy 清理收敛为投影
    // 的既有语义恢复。此测试钉住「保守不等于永久禁用」——快照刷新后多 provider
    // legacy 副本的收敛路径不回退。
    const repo = buildGitRepo("git-certified");
    writeSkillDocument(
      path.join(repo, "skills", "demo-skill"),
      "demo-skill",
      "Upstream skill.",
      "# Upstream\n",
    );
    git(repo, "add", ".");
    git(repo, "commit", "--quiet", "-m", "init");

    const workspaceRoot = path.join(sandbox, "ws-certified");
    fs.mkdirSync(workspaceRoot, { recursive: true });
    // 实体已注册（真实内核），provider root 上另有一个未登记的物化 legacy 副本。
    const source = writeSkillDocument(path.join(sandbox, "certified-src"), "demo-skill");
    const workspaces = createWorkspaceRegistry();
    const workspace = workspaces.import(workspaceRoot, "certified");
    const target: WorkspaceProviderTarget = {
      workspaceId: workspace.id,
      providerId: openclawProviderId,
    };
    const scope = workspaces.resolve(target, true);
    const canonicalWorkspace = scope.workspaceDirectory ?? workspaceRoot;
    const providerRoot = scope.directory;
    fs.mkdirSync(providerRoot, { recursive: true });
    const ensured = await ensureEntity({
      scope: "project",
      workspaceDir: canonicalWorkspace,
      source: { dir: source },
    });
    if (ensured.kind !== "ok") throw new Error(`ensureEntity failed: ${JSON.stringify(ensured)}`);
    const legacyDir = writeSkillDocument(
      path.join(providerRoot, "demo-skill"),
      "demo-skill",
      "Legacy copy.",
      "# Legacy\n",
    );
    const canonical = fs.realpathSync(legacyDir);

    const probe = createSkillsCliProbe({
      run: async () => ({
        stdout: JSON.stringify([{ name: "demo-skill", path: canonical, scope: "project" }]),
      }),
    });
    await probe.probe();
    const skills = createSkillService(workspaces, {
      skillsCliProbe: probe,
      discoverSkills: discovererFor([{ directory: canonical }]),
    });
    const repository = createRepositoryService(workspaces, skills);
    const service = createSkillsUpdateService(workspaces, skills, probe, repository, {
      kernel: {
        updateEntity: async () => ({
          kind: "ok" as const,
          status: "updated" as const,
          entity: { folderName: "demo-skill" },
          projections: [],
          degradedProjectionState: false,
          updated: 1,
          unchanged: 0,
          skipped: 0,
          failed: 0,
          generation: 1,
          lockSyncPending: true,
          warnings: [],
        }),
        ensureEntity: async () => {
          throw new Error("must not be reached when the entity already updated");
        },
        projectEntity,
      },
      readGlobalLock: () =>
        JSON.stringify({
          version: 3,
          skills: {
            "demo-skill": {
              source: repo,
              sourceType: "local",
              sourceUrl: repo,
              skillPath: "skills/demo-skill",
              skillFolderHash: "OLDHASH",
              installedAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          },
        }),
      readProjectLock: () => null,
    });

    const discovered = await skills.list(target);
    const skillId = discovered[0]?.id as SkillId;
    const result = await service.applyUpdates(target, [skillId], {
      workspaceId: target.workspaceId,
      providerId: target.providerId,
      skillIds: [skillId],
    });
    expect(result.results[0]).toMatchObject({ status: "updated", lockSyncPending: true });
    // legacy 物化副本被收敛为指向实体的 link 投影，state 记账在场。
    const projected = path.join(providerRoot, "demo-skill");
    expect(fs.lstatSync(projected).isSymbolicLink()).toBe(true);
    const entityDir = path.join(canonicalWorkspace, ".agents", "skills", "demo-skill");
    expect(fs.realpathSync(projected)).toBe(fs.realpathSync(entityDir));
    const state = JSON.parse(
      fs.readFileSync(path.join(canonicalWorkspace, ".agents", ".ccski-state.json"), "utf8"),
    ) as { projections: Record<string, { folderName?: string; mode?: string }> };
    expect(
      Object.values(state.projections).some(
        (record) => record.folderName === "demo-skill" && record.mode === "link",
      ),
    ).toBe(true);
    await repository.dispose();
  });

  it("converges an unregistered materialized copy through the REAL kernel when the projection table is healthy (P0-C 终审第三轮集成收口)", async () => {
    // 终审第三轮 7.8/10 唯一阻塞项的宿主收口：内核健康态现显式返回
    // degradedProjectionState:false（c314236），本测试不再 mock updateEntity——
    // 真实内核全程参与：实体 v1 真实换新为 v2、投影表健康真实出 false、
    // 未登记物化副本经正向证明分支收敛为 link 投影。staging 走 repository
    // session 的 pinned clone（真克隆 repo@HEAD），故 v2 直接打进 git 历史。
    const repo = buildGitRepo("git-real-kernel");
    writeSkillDocument(
      path.join(repo, "skills", "demo-skill"),
      "demo-skill",
      "Upstream skill.",
      "# Upstream\n",
    );
    git(repo, "add", ".");
    git(repo, "commit", "--quiet", "-m", "init");
    writeSkillDocument(
      path.join(repo, "skills", "demo-skill"),
      "demo-skill",
      "Upstream v2.",
      "# Upstream v2\n",
    );
    git(repo, "add", ".");
    git(repo, "commit", "--quiet", "-m", "v2");

    const workspaceRoot = path.join(sandbox, "ws-real-kernel");
    fs.mkdirSync(workspaceRoot, { recursive: true });
    const source = writeSkillDocument(path.join(sandbox, "real-src"), "demo-skill");
    const workspaces = createWorkspaceRegistry();
    const workspace = workspaces.import(workspaceRoot, "real-kernel");
    const target: WorkspaceProviderTarget = {
      workspaceId: workspace.id,
      providerId: openclawProviderId,
    };
    const scope = workspaces.resolve(target, true);
    const canonicalWorkspace = scope.workspaceDirectory ?? workspaceRoot;
    const providerRoot = scope.directory;
    fs.mkdirSync(providerRoot, { recursive: true });
    const ensured = await ensureEntity({
      scope: "project",
      workspaceDir: canonicalWorkspace,
      source: { dir: source },
    });
    if (ensured.kind !== "ok") throw new Error(`ensureEntity failed: ${JSON.stringify(ensured)}`);
    const legacyDir = writeSkillDocument(
      path.join(providerRoot, "demo-skill"),
      "demo-skill",
      "Legacy copy.",
      "# Legacy\n",
    );
    const canonical = fs.realpathSync(legacyDir);

    const probe = createSkillsCliProbe({
      run: async () => ({
        stdout: JSON.stringify([{ name: "demo-skill", path: canonical, scope: "project" }]),
      }),
    });
    await probe.probe();
    const skills = createSkillService(workspaces, {
      skillsCliProbe: probe,
      discoverSkills: discovererFor([{ directory: canonical }]),
    });
    const repository = createRepositoryService(workspaces, skills);
    const service = createSkillsUpdateService(workspaces, skills, probe, repository, {
      readGlobalLock: () =>
        JSON.stringify({
          version: 3,
          skills: {
            "demo-skill": {
              source: repo,
              sourceType: "local",
              sourceUrl: repo,
              skillPath: "skills/demo-skill",
              skillFolderHash: "OLDHASH",
              installedAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          },
        }),
      readProjectLock: () => null,
    });

    const discovered = await skills.list(target);
    const skillId = discovered[0]?.id as SkillId;
    const result = await service.applyUpdates(target, [skillId], {
      workspaceId: target.workspaceId,
      providerId: target.providerId,
      skillIds: [skillId],
    });
    expect(result.results[0]).toMatchObject({ status: "updated", lockSyncPending: true });
    const projected = path.join(providerRoot, "demo-skill");
    expect(fs.lstatSync(projected).isSymbolicLink()).toBe(true);
    const entityDir = path.join(canonicalWorkspace, ".agents", "skills", "demo-skill");
    expect(fs.realpathSync(projected)).toBe(fs.realpathSync(entityDir));
    // 真实换新落地：投影内容 = v2（经实体），不是 ensure 时的 v1，也不是 legacy 文案。
    const projectedBody = fs.readFileSync(path.join(projected, "SKILL.md"), "utf8");
    expect(projectedBody).toContain("Upstream v2.");
    expect(projectedBody).not.toContain("Legacy copy.");
    const state = JSON.parse(
      fs.readFileSync(path.join(canonicalWorkspace, ".agents", ".ccski-state.json"), "utf8"),
    ) as { projections: Record<string, { folderName?: string; mode?: string }> };
    expect(
      Object.values(state.projections).some(
        (record) => record.folderName === "demo-skill" && record.mode === "link",
      ),
    ).toBe(true);
    await repository.dispose();
  });
});

describe("skills-CLI default branch resolution (P1-5)", () => {
  it("probes the Trees API with the repository's real default branch when the lock has no ref", async () => {
    const dir = writeSkillDocument(path.join(sandbox, "demo-skill"), "demo-skill");
    const cloneDir = path.join(sandbox, "clone-trunk");
    writeSkillDocument(path.join(cloneDir, "skills", "demo-skill"), "demo-skill", "d", "# Trunk\n");
    const probedUrls: string[] = [];
    const { service, skills } = await buildUpdateService({
      skillDirectory: dir,
      globalLock: JSON.stringify({
        version: 3,
        skills: {
          "demo-skill": {
            // 无 ref：默认分支非 main 的仓库不得被硬编码 main 挡在探针上。
            source: "owner/repo",
            sourceType: "github",
            sourceUrl: "https://github.com/owner/repo",
            skillPath: "skills/demo-skill",
            skillFolderHash: "0".repeat(64),
            installedAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      }),
      fetch: async (url) => {
        probedUrls.push(url);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(fakeGithubTree("skills/demo-skill", "trunktreesha")),
        };
      },
      clone: async () => ({ directory: cloneDir }),
      resolveDefaultBranch: async () => "trunk",
    });
    const discovered = await skills.list(codexTarget);
    const result = await service.checkUpdates(codexTarget, discovered);
    expect(probedUrls).toHaveLength(1);
    expect(probedUrls[0]).toContain("/git/trees/trunk?recursive=1");
    expect(result.results[0]?.status).toBe("updated");
  });

  it("falls back to the recorded ref without resolving the default branch", async () => {
    const dir = writeSkillDocument(path.join(sandbox, "demo-skill"), "demo-skill");
    const probedUrls: string[] = [];
    let resolverCalls = 0;
    const { service, skills } = await buildUpdateService({
      skillDirectory: dir,
      globalLock: JSON.stringify({
        version: 3,
        skills: {
          "demo-skill": {
            source: "owner/repo",
            sourceType: "github",
            sourceUrl: "https://github.com/owner/repo",
            ref: "v2",
            skillPath: "skills/demo-skill",
            skillFolderHash: "0".repeat(64),
            installedAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      }),
      fetch: async (url) => {
        probedUrls.push(url);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(fakeGithubTree("skills/demo-skill", "tagsha")),
        };
      },
      clone: async () => {
        throw new Error("clone not needed for the probe assertion");
      },
      resolveDefaultBranch: async () => {
        resolverCalls += 1;
        return "trunk";
      },
    });
    const discovered = await skills.list(codexTarget);
    await service.checkUpdates(codexTarget, discovered);
    expect(probedUrls[0]).toContain("/git/trees/v2?recursive=1");
    expect(resolverCalls).toBe(0);
  });

  it("treats an unresolvable default branch as an unavailable probe (no main fallback)", async () => {
    const dir = writeSkillDocument(path.join(sandbox, "demo-skill"), "demo-skill");
    const probedUrls: string[] = [];
    const { service, skills } = await buildUpdateService({
      skillDirectory: dir,
      globalLock: JSON.stringify({
        version: 3,
        skills: {
          "demo-skill": {
            source: "owner/repo",
            sourceType: "github",
            sourceUrl: "https://github.com/owner/repo",
            skillPath: "skills/demo-skill",
            skillFolderHash: "0".repeat(64),
            installedAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      }),
      fetch: async (url) => {
        probedUrls.push(url);
        return { ok: true, status: 200, text: async () => "{}" };
      },
      clone: async () => {
        throw new Error("clone must not run when the probe is unavailable");
      },
      resolveDefaultBranch: async () => null,
    });
    const discovered = await skills.list(codexTarget);
    const result = await service.checkUpdates(codexTarget, discovered);
    // 解析失败 → 探针不可达 → unavailable；绝不退回硬编码 main。
    expect(result.results[0]?.status).toBe("unavailable");
    expect(probedUrls).toHaveLength(0);
  });

  it("parses the real symref output of git ls-remote against a local sandbox repository", async () => {
    // 本地 git 沙箱伺服（非 main 默认分支）：验证 defaultResolveDefaultBranch 的
    // 真实解析（execa → git ls-remote --symref HEAD）。
    const repo = path.join(sandbox, "trunk-repo");
    fs.mkdirSync(repo, { recursive: true });
    execFileSync("git", ["init", "--quiet", "--initial-branch=trunk", "."], { cwd: repo });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: repo });
    writeSkillDocument(path.join(repo, "skills", "demo-skill"), "demo-skill");
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "--quiet", "-m", "init"], { cwd: repo });
    await expect(defaultResolveDefaultBranch(repo)).resolves.toBe("trunk");
    // 不可达源 → null（不猜分支）。
    await expect(defaultResolveDefaultBranch("/nonexistent/repo")).resolves.toBeNull();
  });
});
