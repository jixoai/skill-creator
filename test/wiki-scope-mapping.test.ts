/**
 * wiki workspaceId → slug 映射 + 存量根迁移三态（jixoai-search-core 3.1/3.2）。
 *
 * User input [2026-09-21]: "wiki scope 使用人类可读名；digest 仍是 registry 内部
 * id" + "存量 ~/.skill-creator/wiki 实体目录一次性 mv 后建 symlink"。
 * Orthogonal intents:
 *   [1] slug 派生纯函数（workspaceLabelSlug / workspaceScopeSlug）与同 label
 *       冲突消解（digest 前 4 hex）。
 *   [2] 迁移三态经真实 createWikiService 首次打开触发：mv+symlink / 冲突拒绝 /
 *       空 legacy 清理；幂等（symlink 已存在 = no-op）。
 *   [3] registry 轻量 listImported（slug 消歧的兄弟集来源）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceRegistry } from "../src/daemon/workspace-registry/index.js";
import {
  createWikiService,
  workspaceLabelSlug,
  workspaceScopeSlug,
} from "../src/daemon/wiki-service.js";
import { migrateLegacyWikiRoot } from "../src/daemon/wiki-root-migration.js";
import { DomainError } from "../src/daemon/domain-error.js";
import { setHomeOverride } from "../src/shared/paths.js";
import { runCli } from "../packages/skill-wiki/src/cli.js";
import type { WorkspaceRegistry } from "../src/daemon/workspace-registry/index.js";
import type { WorkspaceId } from "../src/shared/contracts/workspaces.js";

const WS_A = "ws_" + "a".repeat(24);
const WS_B = "ws_" + "b".repeat(24);

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

describe("workspace slug derivation", () => {
  it("slugifies labels npm-scope style and falls back to ws on empty", () => {
    expect(workspaceLabelSlug("My App!")).toBe("my-app");
    expect(workspaceLabelSlug("skill-creator")).toBe("skill-creator");
    expect(workspaceLabelSlug("  Skill   Creator  ")).toBe("skill-creator");
    expect(workspaceLabelSlug("app2")).toBe("app2");
    expect(workspaceLabelSlug("技能仓库")).toBe("ws");
    expect(workspaceLabelSlug("")).toBe("ws");
  });

  it("caps slug length at 48 without a trailing hyphen", () => {
    const slug = workspaceLabelSlug("x".repeat(60));
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug).not.toMatch(/-$/);
    expect(slug).toMatch(/^[a-z0-9](-?[a-z0-9])*$/);
  });

  it("appends the id digest prefix only on collisions", () => {
    expect(workspaceScopeSlug("skill-creator", WS_A, false)).toBe("skill-creator");
    expect(workspaceScopeSlug("skill-creator", WS_A, true)).toBe(
      `skill-creator-${WS_A.slice(3, 7)}`,
    );
    expect(workspaceScopeSlug("技能仓库", WS_A, true)).toBe(`ws-${WS_A.slice(3, 7)}`);
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
      fs.existsSync(path.join(rootDir, `dup-workspace-${WS_B.slice(3, 7)}`, "patterns", "in-b.md")),
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

  it("is a no-op when the legacy path is already a symlink", () => {
    const sandbox = makeTempDir();
    const rootDir = path.join(sandbox, "root");
    fs.mkdirSync(rootDir, { recursive: true });
    const legacyDir = path.join(sandbox, "legacy", "wiki");
    fs.mkdirSync(path.dirname(legacyDir), { recursive: true });
    fs.symlinkSync(rootDir, legacyDir, "dir");
    expect(() => migrateLegacyWikiRoot(rootDir, legacyDir)).not.toThrow();
    expect(fs.lstatSync(legacyDir).isSymbolicLink()).toBe(true);
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

describe("registry listImported (lightweight slug sibling source)", () => {
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
    // 同 label 双注册经 wiki-service 消歧为两个不同 slug。
    const wikiRoot = path.join(sandbox, "wiki-root");
    const service = createWikiService(registry, { rootDir: wikiRoot, legacyDir: null });
    service.append(importedFirst.id, { title: "One", body: "one" });
    service.append(importedSecond.id, { title: "Two", body: "two" });
    const scopes = fs.readdirSync(wikiRoot).sort();
    expect(scopes).toEqual(["my-project", `my-project-${importedSecond.id.slice(3, 7)}`].sort());
  });
});
