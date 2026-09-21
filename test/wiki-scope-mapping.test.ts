/**
 * wiki workspaceId → slug 持久化登记表 + 存量根迁移（jixoai-search-core
 * 3.1/3.2 + 终审 P1-1/P2-1 处置）。
 *
 * User input [2026-09-21]: "wiki scope 使用人类可读名；digest 仍是 registry 内部
 * id" + "存量 ~/.skill-creator/wiki 实体目录一次性 mv 后建 symlink"。
 * Orthogonal intents:
 *   [1] slug 分配登记表（skill-wiki scopes.ts：scopeSlugBase 纯函数 +
 *       openScopeSlugRegistry 持久化分配）——同 label 消歧、同 id 复用、
 *       forget 后存活者不顶替裸名、登记表损坏 typed 拒绝且不清目录。
 *   [2] 迁移三态经真实 createWikiService 首次打开触发：mv+symlink / 冲突拒绝 /
 *       空 legacy 清理；幂等（指向 rootDir 的 symlink = no-op）；broken/
 *       错误目标 symlink 与 IO 故障 typed 拒绝（不 fail-open）。
 *   [3] registry 轻量 listImported（同 label 双注册枚举）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceRegistry } from "../src/daemon/workspace-registry/index.js";
import { createWikiService } from "../src/daemon/wiki-service.js";
import { migrateLegacyWikiRoot } from "../src/daemon/wiki-root-migration.js";
import { DomainError } from "../src/daemon/domain-error.js";
import { setHomeOverride } from "../src/shared/paths.js";
import { runCli } from "../packages/skill-wiki/src/cli.js";
import { openScopeSlugRegistry, scopeSlugBase } from "../packages/skill-wiki/src/scopes.js";
import { SkillWikiError } from "../packages/skill-wiki/src/schema.js";
import type { WorkspaceRegistry } from "../src/daemon/workspace-registry/index.js";
import type { WorkspaceId } from "../src/shared/contracts/workspaces.js";

const WS_A = "ws_" + "a".repeat(24);
const WS_B = "ws_" + "b".repeat(24);
const WS_A_SUFFIX = WS_A.slice(3, 7);
const WS_B_SUFFIX = WS_B.slice(3, 7);

const tempDirs: string[] = [];
function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-wiki-mapping-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
});

/** 双 workspace 桩 registry（labels 可注入以构造 slug 冲突）。 */
function stubRegistry(
  entries: { id: WorkspaceId; label: string }[],
): Pick<WorkspaceRegistry, "lookup" | "listImported"> {
  return {
    lookup: (id) => entries.find((entry) => entry.id === id) ?? null,
    listImported: () => entries,
  };
}

/** 读取 <wikiRoot>/scopes.json 的 assignments（测试断言用）。 */
function readAssignments(rootDir: string): Record<string, string> {
  const parsed = JSON.parse(fs.readFileSync(path.join(rootDir, "scopes.json"), "utf8")) as {
    assignments: Record<string, string>;
  };
  return parsed.assignments;
}

describe("workspace slug derivation", () => {
  it("slugifies labels npm-scope style and falls back to ws on empty", () => {
    expect(scopeSlugBase("My App!")).toBe("my-app");
    expect(scopeSlugBase("skill-creator")).toBe("skill-creator");
    expect(scopeSlugBase("  Skill   Creator  ")).toBe("skill-creator");
    expect(scopeSlugBase("app2")).toBe("app2");
    expect(scopeSlugBase("技能仓库")).toBe("ws");
    expect(scopeSlugBase("")).toBe("ws");
  });

  it("caps slug length at 48 without a trailing hyphen", () => {
    const slug = scopeSlugBase("x".repeat(60));
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug).not.toMatch(/-$/);
    expect(slug).toMatch(/^[a-z0-9](-?[a-z0-9])*$/);
  });

  it("assigns the bare slug first, the disambiguated one on collision, and persists both", () => {
    const wikiRoot = makeTempDir();
    const registry = openScopeSlugRegistry(wikiRoot);
    expect(registry.assign({ key: WS_A, label: "skill-creator", disambiguator: WS_A_SUFFIX })).toBe(
      "skill-creator",
    );
    expect(registry.assign({ key: WS_B, label: "skill-creator", disambiguator: WS_B_SUFFIX })).toBe(
      `skill-creator-${WS_B_SUFFIX}`,
    );
    // 命中即复用：label 改名不换名（slug 是持久身份，不是 label 的投影）。
    expect(
      registry.assign({ key: WS_A, label: "Renamed Entirely", disambiguator: WS_A_SUFFIX }),
    ).toBe("skill-creator");
    // 落盘可跨实例复用（新登记表加载即见既有分配）。
    const reloaded = openScopeSlugRegistry(wikiRoot);
    expect(reloaded.assign({ key: WS_B, label: "skill-creator", disambiguator: WS_B_SUFFIX })).toBe(
      `skill-creator-${WS_B_SUFFIX}`,
    );
    expect(readAssignments(wikiRoot)).toEqual({
      [WS_A]: "skill-creator",
      [WS_B]: `skill-creator-${WS_B_SUFFIX}`,
    });
  });

  it("treats pre-existing scope directories as claimed (no silent adoption)", () => {
    const wikiRoot = makeTempDir();
    fs.mkdirSync(path.join(wikiRoot, "existing-scope", "patterns"), { recursive: true });
    const registry = openScopeSlugRegistry(wikiRoot);
    const slug = registry.assign({
      key: WS_A,
      label: "Existing Scope",
      disambiguator: WS_A_SUFFIX,
    });
    expect(slug).toBe(`existing-scope-${WS_A_SUFFIX}`);
  });

  it("rejects with typed WIKI_SCOPE_CONFLICT when both bare and suffixed slugs are claimed", () => {
    const wikiRoot = makeTempDir();
    fs.mkdirSync(path.join(wikiRoot, "dup"), { recursive: true });
    fs.mkdirSync(path.join(wikiRoot, `dup-${WS_A_SUFFIX}`), { recursive: true });
    const registry = openScopeSlugRegistry(wikiRoot);
    try {
      registry.assign({ key: WS_A, label: "dup", disambiguator: WS_A_SUFFIX });
      expect.unreachable("must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(SkillWikiError);
      expect((error as SkillWikiError).code).toBe("WIKI_SCOPE_CONFLICT");
    }
    // 拒绝后零写入（不落盘、不动目录）。
    expect(fs.existsSync(path.join(wikiRoot, "scopes.json"))).toBe(false);
  });

  it("colliding labels in one registry map to distinct scope directories", () => {
    const rootDir = makeTempDir();
    const service = createWikiService(
      stubRegistry([
        { id: WS_A, label: "dup workspace" },
        { id: WS_B, label: "dup workspace" },
      ]),
      { rootDir, legacyDir: null },
    );
    service.append(WS_A, { title: "In A", body: "a-body" });
    service.append(WS_B, { title: "In B", body: "b-body" });
    expect(fs.existsSync(path.join(rootDir, "dup-workspace", "patterns", "in-a.md"))).toBe(true);
    expect(
      fs.existsSync(path.join(rootDir, `dup-workspace-${WS_B_SUFFIX}`, "patterns", "in-b.md")),
    ).toBe(true);
    // 无冲突时第二个 workspace 不携带后缀。
    const cleanRoot = makeTempDir();
    const clean = createWikiService(
      stubRegistry([
        { id: WS_A, label: "alpha" },
        { id: WS_B, label: "beta" },
      ]),
      { rootDir: cleanRoot, legacyDir: null },
    );
    clean.append(WS_B, { title: "In B", body: "b-body" });
    expect(fs.existsSync(path.join(cleanRoot, "beta", "patterns", "in-b.md"))).toBe(true);
  });
});

describe("workspace slug lifecycle across forget / re-import (final review P1-1)", () => {
  it("keeps the survivor on its suffixed slug after the bare owner is forgotten", () => {
    const rootDir = makeTempDir();
    const both = createWikiService(
      stubRegistry([
        { id: WS_A, label: "dup workspace" },
        { id: WS_B, label: "dup workspace" },
      ]),
      { rootDir, legacyDir: null },
    );
    both.append(WS_A, { title: "In A", body: "a-body" });
    both.append(WS_B, { title: "In B", body: "b-body" });
    const bareDir = path.join(rootDir, "dup-workspace");
    const suffixDir = path.join(rootDir, `dup-workspace-${WS_B_SUFFIX}`);

    // A 被 forget（registry 不再认识 A）：B 不得顶替裸名读写 A 的遗留目录。
    const survivor = createWikiService(stubRegistry([{ id: WS_B, label: "dup workspace" }]), {
      rootDir,
      legacyDir: null,
    });
    expect(survivor.list(WS_B).patterns.map((item) => item.name)).toEqual(["in-b"]);
    survivor.append(WS_B, { title: "Still B", body: "b2" });
    expect(fs.existsSync(path.join(suffixDir, "patterns", "still-b.md"))).toBe(true);
    // A 的目录与登记项原样留存（forget 不释放、不清数据）。
    expect(fs.existsSync(path.join(bareDir, "patterns", "in-a.md"))).toBe(true);
    expect(readAssignments(rootDir)[WS_A]).toBe("dup-workspace");
    expect(readAssignments(rootDir)[WS_B]).toBe(`dup-workspace-${WS_B_SUFFIX}`);
  });

  it("re-importing the same workspace id reuses its original slug and data", () => {
    const rootDir = makeTempDir();
    const first = createWikiService(stubRegistry([{ id: WS_A, label: "reimport me" }]), {
      rootDir,
      legacyDir: null,
    });
    first.append(WS_A, { title: "Persisted", body: "p" });

    const reimported = createWikiService(
      stubRegistry([{ id: WS_A, label: "reimport me (renamed)" }]),
      { rootDir, legacyDir: null },
    );
    expect(reimported.list(WS_A).patterns.map((item) => item.name)).toEqual(["persisted"]);
    expect(readAssignments(rootDir)[WS_A]).toBe("reimport-me");
  });

  it("sequential first opens are idempotent (same slug, single assignment)", () => {
    const rootDir = makeTempDir();
    const service = createWikiService(stubRegistry([{ id: WS_A, label: "idem" }]), {
      rootDir,
      legacyDir: null,
    });
    service.append(WS_A, { title: "One", body: "one" });
    service.append(WS_A, { title: "Two", body: "two" });
    expect(fs.readdirSync(path.join(rootDir, "idem", "patterns")).sort()).toEqual([
      "one.md",
      "two.md",
    ]);
    expect(Object.keys(readAssignments(rootDir))).toEqual([WS_A]);
  });

  it("a corrupt scopes.json is a typed rejection that clears nothing", () => {
    const rootDir = makeTempDir();
    const service = createWikiService(stubRegistry([{ id: WS_A, label: "kept" }]), {
      rootDir,
      legacyDir: null,
    });
    service.append(WS_A, { title: "Kept", body: "k" });
    const scopesFile = path.join(rootDir, "scopes.json");
    fs.writeFileSync(scopesFile, "{ not json", "utf8");

    const broken = createWikiService(stubRegistry([{ id: WS_A, label: "kept" }]), {
      rootDir,
      legacyDir: null,
    });
    try {
      broken.list(WS_A);
      expect.unreachable("must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe("UNAVAILABLE");
    }
    // 不清 scope 目录、不改写登记表（人工检查语义）。
    expect(fs.existsSync(path.join(rootDir, "kept", "patterns", "kept.md"))).toBe(true);
    expect(fs.readFileSync(scopesFile, "utf8")).toBe("{ not json");
  });
});

describe("legacy wiki root migration", () => {
  it("moves a legacy directory to the new root and symlinks the old path (idempotent)", () => {
    const sandbox = makeTempDir();
    const rootDir = path.join(sandbox, "new-root");
    const legacyDir = path.join(sandbox, "legacy-parent", "wiki");
    fs.mkdirSync(path.join(legacyDir, "~", "patterns"), { recursive: true });
    fs.writeFileSync(path.join(legacyDir, "~", "patterns", "kept.md"), "page\n", "utf8");

    const service = createWikiService(stubRegistry([]), { rootDir, legacyDir });
    const listed = service.list("~");
    expect(listed.patterns.map((item) => item.name)).toEqual([]);
    // 数据落在 scope 目录（~ 的 patterns 从 legacy 继承，kept.md 无合法 frontmatter 被丢弃）。
    expect(fs.readdirSync(path.join(rootDir, "~", "patterns"))).toContain("kept.md");
    // 原位 symlink，幂等：第二次打开 no-op。
    expect(fs.lstatSync(legacyDir).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(legacyDir)).toBe(fs.realpathSync(rootDir));
    expect(() => service.list("~")).not.toThrow();
  });

  it("rejects with typed CONFLICT when both roots hold data", () => {
    const sandbox = makeTempDir();
    const rootDir = path.join(sandbox, "new-root", ".skill-wiki");
    fs.mkdirSync(rootDir, { recursive: true });
    fs.writeFileSync(path.join(rootDir, "sentinel.txt"), "x", "utf8");
    const legacyDir = path.join(sandbox, "legacy", "wiki");
    fs.mkdirSync(path.join(legacyDir, "~"), { recursive: true });
    fs.writeFileSync(path.join(legacyDir, "~", "patterns.md"), "data", "utf8");

    const service = createWikiService(stubRegistry([]), { rootDir, legacyDir });
    try {
      service.list("~");
      expect.unreachable("must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe("CONFLICT");
    }
    // 双方数据原样保留（不覆盖、不删除）。
    expect(fs.existsSync(path.join(rootDir, "sentinel.txt"))).toBe(true);
    expect(fs.existsSync(path.join(legacyDir, "~", "patterns.md"))).toBe(true);
  });

  it("replaces an empty legacy directory with the symlink when the root already exists", () => {
    const sandbox = makeTempDir();
    const rootDir = path.join(sandbox, "root");
    fs.mkdirSync(path.join(rootDir, "~"), { recursive: true });
    const legacyDir = path.join(sandbox, "legacy", "wiki");
    fs.mkdirSync(legacyDir, { recursive: true });

    migrateLegacyWikiRoot(rootDir, legacyDir);
    expect(fs.lstatSync(legacyDir).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(path.join(rootDir, "~"))).toBe(true);
  });

  it("creates the compat symlink when no legacy path ever existed", () => {
    const sandbox = makeTempDir();
    const rootDir = path.join(sandbox, "root");
    const legacyDir = path.join(sandbox, "legacy", "wiki");
    migrateLegacyWikiRoot(rootDir, legacyDir);
    expect(fs.lstatSync(legacyDir).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(legacyDir)).toBe(fs.realpathSync(rootDir));
  });

  it("is a no-op when the legacy path is already a symlink to the root", () => {
    const sandbox = makeTempDir();
    const rootDir = path.join(sandbox, "root");
    fs.mkdirSync(rootDir, { recursive: true });
    const legacyDir = path.join(sandbox, "legacy", "wiki");
    fs.mkdirSync(path.dirname(legacyDir), { recursive: true });
    fs.symlinkSync(rootDir, legacyDir, "dir");
    expect(() => migrateLegacyWikiRoot(rootDir, legacyDir)).not.toThrow();
    expect(fs.lstatSync(legacyDir).isSymbolicLink()).toBe(true);
  });

  it("rejects a broken legacy symlink with typed CONFLICT (final review P2-1)", () => {
    const sandbox = makeTempDir();
    const rootDir = path.join(sandbox, "root");
    fs.mkdirSync(rootDir, { recursive: true });
    const legacyDir = path.join(sandbox, "legacy", "wiki");
    fs.mkdirSync(path.dirname(legacyDir), { recursive: true });
    fs.symlinkSync(path.join(sandbox, "gone"), legacyDir, "dir");
    try {
      migrateLegacyWikiRoot(rootDir, legacyDir);
      expect.unreachable("must throw");
    } catch (error) {
      expect((error as DomainError).code).toBe("CONFLICT");
      expect((error as DomainError).message).toContain("broken");
    }
  });

  it("rejects a legacy symlink pointing at the wrong directory", () => {
    const sandbox = makeTempDir();
    const rootDir = path.join(sandbox, "root");
    fs.mkdirSync(rootDir, { recursive: true });
    const elsewhere = path.join(sandbox, "elsewhere");
    fs.mkdirSync(elsewhere, { recursive: true });
    const legacyDir = path.join(sandbox, "legacy", "wiki");
    fs.mkdirSync(path.dirname(legacyDir), { recursive: true });
    fs.symlinkSync(elsewhere, legacyDir, "dir");
    try {
      migrateLegacyWikiRoot(rootDir, legacyDir);
      expect.unreachable("must throw");
    } catch (error) {
      expect((error as DomainError).code).toBe("CONFLICT");
      expect((error as DomainError).message).toContain("points to");
    }
  });

  it("surfaces an unreadable legacy directory as typed UNAVAILABLE instead of treating it as empty", () => {
    const sandbox = makeTempDir();
    const rootDir = path.join(sandbox, "root");
    fs.mkdirSync(path.join(rootDir, "~"), { recursive: true });
    const legacyDir = path.join(sandbox, "legacy", "wiki");
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, "data.md"), "data", "utf8");
    fs.chmodSync(legacyDir, 0o000);
    let code: string | undefined;
    try {
      try {
        migrateLegacyWikiRoot(rootDir, legacyDir);
        expect.unreachable("must throw");
      } catch (error) {
        expect(error).toBeInstanceOf(DomainError);
        code = (error as DomainError).code;
      }
    } finally {
      fs.chmodSync(legacyDir, 0o700);
    }
    expect(code).toBe("UNAVAILABLE");
    // 拒绝时不动任何一边。
    expect(fs.readFileSync(path.join(legacyDir, "data.md"), "utf8")).toBe("data");
  });

  it("rejects a legacy path that is a plain file", () => {
    const sandbox = makeTempDir();
    const rootDir = path.join(sandbox, "root");
    const legacyDir = path.join(sandbox, "legacy", "wiki");
    fs.mkdirSync(path.dirname(legacyDir), { recursive: true });
    fs.writeFileSync(legacyDir, "not a dir", "utf8");
    try {
      migrateLegacyWikiRoot(rootDir, legacyDir);
      expect.unreachable("must throw");
    } catch (error) {
      expect((error as DomainError).code).toBe("CONFLICT");
    }
  });
});

describe("registry listImported (lightweight enumeration)", () => {
  const previousHome = process.env.SKILL_CREATOR_HOME;
  let sandbox = "";

  beforeEach(() => {
    sandbox = makeTempDir();
    process.env.SKILL_CREATOR_HOME = path.join(sandbox, "state");
    setHomeOverride(path.join(sandbox, "state"));
  });
  afterEach(() => {
    setHomeOverride(null);
    if (previousHome === undefined) delete process.env.SKILL_CREATOR_HOME;
    else process.env.SKILL_CREATOR_HOME = previousHome;
  });

  it("daemon service and CLI resolve the same default root (SKILL_WIKI_HOME)", async () => {
    const sharedRoot = path.join(sandbox, "shared-root");
    process.env.SKILL_WIKI_HOME = sharedRoot;
    try {
      // 宿主：rootDir 走默认装配（defaultWikiRoot() 读同一 env），仅禁用迁移。
      const service = createWikiService(stubRegistry([]), { legacyDir: null });
      service.append("~", { title: "Same root insight", body: "written by the daemon\n" });
      // CLI：runCli 的 openScope 同样经 defaultWikiRoot() 解析。
      const out: string[] = [];
      const code = await runCli(["list"], {
        readStdin: async () => "",
        stdout: (text) => out.push(text),
        stderr: () => {},
      });
      expect(code).toBe(0);
      expect(out.join("")).toContain("same-root-insight — Same root insight");
      expect(fs.existsSync(path.join(sharedRoot, "~", "patterns", "same-root-insight.md"))).toBe(
        true,
      );
    } finally {
      delete process.env.SKILL_WIKI_HOME;
    }
  });

  it("enumerates imported {id,label} without triggering skill scans", () => {
    const registry = createWorkspaceRegistry({ listSkills: () => Promise.resolve([]) });
    expect(registry.listImported()).toEqual([]);
    const first = path.join(sandbox, "proj-one");
    const second = path.join(sandbox, "proj-two");
    fs.mkdirSync(first, { recursive: true });
    fs.mkdirSync(second, { recursive: true });
    const importedFirst = registry.import(first, "My Project");
    const importedSecond = registry.import(second, "My Project");
    const entries = registry.listImported();
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.label)).toEqual(["My Project", "My Project"]);
    // 同 label 双注册经 wiki-service 消歧为两个不同 slug（持久化登记表分配）。
    const wikiRoot = path.join(sandbox, "wiki-root");
    const service = createWikiService(registry, { rootDir: wikiRoot, legacyDir: null });
    service.append(importedFirst.id, { title: "One", body: "one" });
    service.append(importedSecond.id, { title: "Two", body: "two" });
    const scopes = fs
      .readdirSync(wikiRoot)
      .filter((name) => name !== "scopes.json")
      .sort();
    expect(scopes).toEqual(["my-project", `my-project-${importedSecond.id.slice(3, 7)}`].sort());
  });
});
