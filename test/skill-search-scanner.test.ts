/**
 * SkillScanner 扫描边界测试。
 *
 * User input [2026-09-17]: "直接子入口（目录或 symlink，statSync 跟进；broken 跳过）；
 * 真实子目录递归深度 ≤2 且递归不跟进 symlink；`.` 开头目录与 node_modules 跳过。"
 *
 * Orthogonal intents:
 *   [1] 入口层 symlink 跟进与 broken symlink 静默跳过。
 *   [2] 递归深度 ≤2、递归不跟进 symlink、dot/node_modules 边界。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanSkillRoots, type SkillRoot } from "../src/daemon/skill-search/scanner.js";
import { GLOBAL_WORKSPACE_ID, ProviderIdSchema } from "../src/shared/contracts/workspaces.js";

let sandbox = "";
const rootOf = (name: string): SkillRoot => ({
  rootPath: path.join(sandbox, name),
  workspaceId: GLOBAL_WORKSPACE_ID,
  providerId: ProviderIdSchema.parse("claude-code"),
});

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-search-scanner-test-"));
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function writeSkill(directory: string, filename = "SKILL.md"): string {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, filename),
    `---\nname: ${path.basename(directory)}\ndescription: fixture\n---\n# fixture\n`,
  );
  return directory;
}

describe("skill search scanner", () => {
  it("collects direct directory entries containing SKILL.md", () => {
    writeSkill(path.join(sandbox, "root", "skill-a"));
    writeSkill(path.join(sandbox, "root", "skill-b"));
    const entries = scanSkillRoots([rootOf("root")]);
    expect(entries.map((entry) => entry.path).sort()).toEqual([
      path.join(sandbox, "root", "skill-a"),
      path.join(sandbox, "root", "skill-b"),
    ]);
  });

  it("follows entry-level symlinks to skill directories", () => {
    const target = writeSkill(path.join(sandbox, "repo", "shared-skill"));
    fs.mkdirSync(path.join(sandbox, "root"), { recursive: true });
    fs.symlinkSync(target, path.join(sandbox, "root", "link-skill"));
    const entries = scanSkillRoots([rootOf("root")]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.path).toBe(path.join(sandbox, "root", "link-skill"));
  });

  it("recurses into real subdirectories up to depth 2", () => {
    writeSkill(path.join(sandbox, "root", "plugin-group", "nested-skill"));
    writeSkill(path.join(sandbox, "root", "plugin-group", "sub", "too-deep"));
    const entries = scanSkillRoots([rootOf("root")]);
    expect(entries.map((entry) => path.basename(entry.path))).toEqual(["nested-skill"]);
  });

  it("does not recurse through directory symlinks", () => {
    const outside = writeSkill(path.join(sandbox, "repo", "outside-skill"));
    fs.mkdirSync(path.join(sandbox, "root", "real-group"), { recursive: true });
    fs.symlinkSync(path.join(sandbox, "repo"), path.join(sandbox, "root", "real-group", "symdir"));
    const entries = scanSkillRoots([rootOf("root")]);
    // depth-2 的 symlink 目录不解析（防环、防逃逸），outside 不被枚举。
    expect(entries).toHaveLength(0);
    expect(fs.existsSync(outside)).toBe(true);
  });

  it("silently skips broken symlinks", () => {
    fs.mkdirSync(path.join(sandbox, "root"), { recursive: true });
    fs.symlinkSync(path.join(sandbox, "repo", "missing"), path.join(sandbox, "root", "broken"));
    writeSkill(path.join(sandbox, "root", "healthy"));
    const entries = scanSkillRoots([rootOf("root")]);
    expect(entries.map((entry) => path.basename(entry.path))).toEqual(["healthy"]);
  });

  it("skips dot directories and node_modules at every level", () => {
    writeSkill(path.join(sandbox, "root", ".hidden", "dot-skill"));
    writeSkill(path.join(sandbox, "root", "node_modules", "pkg-skill"));
    writeSkill(path.join(sandbox, "root", "group", ".git", "nested-dot-skill"));
    writeSkill(path.join(sandbox, "root", "visible-skill"));
    const entries = scanSkillRoots([rootOf("root")]);
    expect(entries.map((entry) => path.basename(entry.path))).toEqual(["visible-skill"]);
  });

  it("skips unavailable roots without throwing and binds scope per root", () => {
    writeSkill(path.join(sandbox, "root-a", "skill-a"));
    const otherProvider: SkillRoot = {
      rootPath: path.join(sandbox, "root-b"),
      workspaceId: GLOBAL_WORKSPACE_ID,
      providerId: ProviderIdSchema.parse("codex"),
    };
    const entries = scanSkillRoots([rootOf("root-a"), otherProvider, rootOf("missing-root")]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.providerId).toBe(ProviderIdSchema.parse("claude-code"));
    expect(entries[0]?.workspaceId).toBe(GLOBAL_WORKSPACE_ID);
  });

  it("accepts .SKILL.md-only entries as candidates", () => {
    writeSkill(path.join(sandbox, "root", "disabled-skill"), ".SKILL.md");
    const entries = scanSkillRoots([rootOf("root")]);
    expect(entries.map((entry) => path.basename(entry.path))).toEqual(["disabled-skill"]);
  });
});

describe("skill search scanner pathological entries", () => {
  it("skips candidates whose SKILL.md is a directory instead of a regular file", () => {
    const directory = path.join(sandbox, "skills", "trap");
    fs.mkdirSync(path.join(directory, "SKILL.md"), { recursive: true });
    const entries = scanSkillRoots([rootOf("skills")]);
    expect(entries.map((entry) => entry.path)).toEqual([]);
  });
});
