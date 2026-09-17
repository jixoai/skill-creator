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
  parseGithubSource,
  type FetchLike,
  type UpdateCloner,
} from "../src/daemon/skills-update-service.js";
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
  it("produces a stable SHA-256 that changes when content changes", () => {
    const dir = writeSkillDocument(path.join(sandbox, "s"), "s", "d", "# One\n");
    const hash1 = computeSkillFolderHash(dir);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      '---\nname: "s"\ndescription: "d"\n---\n# Two\n',
      "utf8",
    );
    const hash2 = computeSkillFolderHash(dir);
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

describe("skills-CLI update-check", () => {
  /**
   * 构造一个完整的 update-service + skills/probe/repo 桩，方便各场景复用。
   * `globalLock` / `projectLock` 直接以字符串注入；fetch / clone 可覆盖。
   */
  async function buildUpdateService(args: {
    skillDirectory: string;
    skillName?: string;
    globalLock?: string | null;
    projectLock?: string | null;
    fetch?: FetchLike;
    clone?: UpdateCloner;
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
      readGlobalLock: () => args.globalLock ?? null,
      readProjectLock: () => args.projectLock ?? null,
    });
    return { workspaces, skills, probe, repository, service, canonical };
  }

  it("reports updated when the GitHub tree SHA differs from the lock hash", async () => {
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
      fetch: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(fakeGithubTree("skills/demo-skill", "NEWTREE")),
      }),
    });
    const discovered = await skills.list(codexTarget);
    const result = await service.checkUpdates(codexTarget, discovered);
    expect(result.results).toEqual([
      expect.objectContaining({
        status: "updated",
        currentHash: "OLDTREE",
        upstreamHash: "NEWTREE",
        source: "https://github.com/owner/repo",
      }),
    ]);
  });

  it("reports already-current when the tree SHA equals the lock hash", async () => {
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
            skillFolderHash: "SAMETREE",
            installedAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      }),
      fetch: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(fakeGithubTree("skills/demo-skill", "SAMETREE")),
      }),
    });
    const discovered = await skills.list(codexTarget);
    const result = await service.checkUpdates(codexTarget, discovered);
    expect(result.results[0]?.status).toBe("already-current");
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
    const upstreamHash = computeSkillFolderHash(path.join(cloneDir, "demo-skill"));
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

  it("reinstalls via the repository pipeline and refreshes the in-memory hash overlay", async () => {
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
    expect(result.results[0]?.status).toBe("updated");
    // 内存覆盖层应已写入新 hash（来自克隆计算）。
    const overlay = service._hashOverlayForTest();
    expect(overlay.get("demo-skill")).toMatch(/^[a-f0-9]{64}$/);
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
    const upstreamHash = computeSkillFolderHash(canonical);

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
});
