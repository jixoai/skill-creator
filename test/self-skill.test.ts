/**
 * 产品自描述技能 symlink 自举测试（self-skill-symlink）。
 *
 * 用户原始需求 [2026-09-30]：「~/.agents/skills/skill-creator-v2 这个文件夹应该走
 * symlink……检查它的来源，是不是 npm:skill-creator 或者 git:skill-creator……realpath
 * 和这次启动的源对不上就删掉重建。反之……提醒用户存在 skill 冲突：覆盖安装（可选
 * 备份）；坚持使用用户自己已有的版本。」
 *
 * 正交意图：
 *   [1] ensure 状态机：linked/current/relinked/migrated/conflict(user-directory/
 *       foreign-link/foreign-entry)/kept/failed（永不抛出）。
 *   [2] 来源鉴定：package.json name === skill-creator 判据（本仓真源 + 伪造安装树）。
 *   [3] 裁决：resolve（备份时间戳目录 / foreign 不备份）与 keep（指纹记忆 + 漂移
 *       重提醒）。
 *   [4] 文档与闭环：入仓技能文件过契约校验、被自家检索面经 symlink 召回。
 * 妥协声明：主进程内测试以真实仓库为「本次安装源」（resolveSelfSkillSource 按
 * import.meta 定位本仓）；全局根经显式参数隔离，绝不触碰真实 ~/.agents。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import matter from "gray-matter";
import { parseSkillFile } from "ccski";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSkillSearchServiceWithRoots } from "../src/daemon/skill-search/service.js";
import {
  ensureSelfSkill,
  keepSelfSkillUserVersion,
  provenanceOurs,
  resolveSelfSkillConflict,
  resolveSelfSkillSource,
  selfSkillBackupDirectory,
  selfSkillStatus,
  SELF_SKILL_DIRECTORY_NAME,
  SELF_SKILL_ROOT_ENV,
} from "../src/daemon/self-skill.js";
import {
  SkillDirectoryNameSchema,
  SkillFrontmatterSchema,
} from "../src/shared/contracts/creator.js";
import { safeParseExternal } from "../src/shared/external-input.js";
import { setHomeOverride } from "../src/shared/paths.js";
import { GLOBAL_WORKSPACE_ID, ProviderIdSchema } from "../src/shared/contracts/workspaces.js";
import type { SkillRoot } from "../src/daemon/skill-search/scanner.js";

let sandbox = "";
let previousRootEnv: string | undefined;
const openServices: Array<ReturnType<typeof createSkillSearchServiceWithRoots>> = [];

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "self-skill-symlink-test-"));
  previousRootEnv = process.env[SELF_SKILL_ROOT_ENV];
  // keep 记录落 appDir：隔离 SKILL_CREATOR_HOME（setHomeOverride 同步内存态）。
  setHomeOverride(path.join(sandbox, "state"));
});

afterEach(async () => {
  if (previousRootEnv === undefined) delete process.env[SELF_SKILL_ROOT_ENV];
  else process.env[SELF_SKILL_ROOT_ENV] = previousRootEnv;
  setHomeOverride(null);
  for (const service of openServices.splice(0)) await service.dispose();
  fs.rmSync(sandbox, { recursive: true, force: true });
});

/** 全局根沙箱（valve 等价物：显式参数通道）。 */
function freshRoot(): string {
  return path.join(sandbox, `agents-skills-${Math.random().toString(36).slice(2, 8)}`);
}

function entryOf(root: string): string {
  return path.join(root, SELF_SKILL_DIRECTORY_NAME);
}

/** 伪造一套 skill-creator 安装树（npm/git 同一身份判据）。 */
function fakeInstall(name: string, withGit: boolean): string {
  const pkgRoot = path.join(sandbox, name);
  const skillDir = path.join(pkgRoot, "skills", SELF_SKILL_DIRECTORY_NAME);
  fs.mkdirSync(path.join(skillDir, "references"), { recursive: true });
  fs.writeFileSync(
    path.join(pkgRoot, "package.json"),
    JSON.stringify({ name: "skill-creator", version: "9.9.9" }),
  );
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${SELF_SKILL_DIRECTORY_NAME}\ndescription: fake install source\n---\n\nbody\n`,
  );
  if (withGit) fs.mkdirSync(path.join(pkgRoot, ".git"));
  return skillDir;
}

function writeUserDirectory(root: string, marker = false): string {
  const entry = entryOf(root);
  fs.mkdirSync(path.join(entry, "references"), { recursive: true });
  fs.writeFileSync(
    path.join(entry, "SKILL.md"),
    marker
      ? `---\nname: ${SELF_SKILL_DIRECTORY_NAME}\ndescription: legacy\nx-managed-by: skill-creator\nx-managed-version: "1"\n---\n\nlegacy\n`
      : `---\nname: ${SELF_SKILL_DIRECTORY_NAME}\ndescription: my own copy\n---\n\nuser content\n`,
  );
  return entry;
}

describe("source resolution and provenance (design D1)", () => {
  it("resolves the real repo install as this run's source", () => {
    const source = resolveSelfSkillSource();
    expect(source).not.toBeNull();
    expect(path.basename(source!.skillDir)).toBe(SELF_SKILL_DIRECTORY_NAME);
    expect(source!.skillDir.endsWith(path.join("skills", SELF_SKILL_DIRECTORY_NAME))).toBe(true);
    expect(source!.viaGit).toBe(true);
  });

  it("resolves an explicit anchor and rejects anchor-less trees", () => {
    const skillDir = fakeInstall("pkg-a", false);
    expect(resolveSelfSkillSource(path.join(skillDir, "..", ".."))?.skillDir).toBe(skillDir);
    expect(resolveSelfSkillSource(path.join(sandbox, "empty"))).toBeNull();
  });

  it("skips a nested dist manifest that lacks the skills dir (dev repo layout)", () => {
    // 开发仓的 dist/ 内有同名构建 manifest：源解析必须越过它找到真正带
    // skills/ 的包根（走查实锤的 bundle 态路径）。
    const skillDir = fakeInstall("pkg-dist", true);
    const distDir = path.join(path.dirname(path.dirname(skillDir)), "dist");
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(
      path.join(distDir, "package.json"),
      JSON.stringify({ name: "skill-creator", version: "9.9.9", type: "module" }),
    );
    expect(resolveSelfSkillSource(distDir)?.skillDir).toBe(skillDir);
  });

  it("identifies provenance by package identity (npm and git installs alike)", () => {
    expect(provenanceOurs(path.dirname(fakeInstall("pkg-b", false)))).toBe(true);
    expect(provenanceOurs(path.dirname(fakeInstall("pkg-c", true)))).toBe(true);
    const stranger = path.join(sandbox, "stranger", "skills", SELF_SKILL_DIRECTORY_NAME);
    fs.mkdirSync(stranger, { recursive: true });
    expect(provenanceOurs(stranger)).toBe(false);
  });
});

describe("ensure state machine (design D2)", () => {
  it("links a missing entry and reports current on the next run", () => {
    const root = freshRoot();
    expect(ensureSelfSkill(root)).toEqual({ kind: "linked" });
    const entry = entryOf(root);
    expect(fs.lstatSync(entry).isSymbolicLink()).toBe(true);
    const realSource = resolveSelfSkillSource();
    expect(fs.realpathSync(entry)).toBe(fs.realpathSync(realSource!.skillDir));
    expect(ensureSelfSkill(root)).toEqual({ kind: "current" });
  });

  it("relinks a stale link that points at another skill-creator install", () => {
    const root = freshRoot();
    fs.mkdirSync(root, { recursive: true });
    fs.symlinkSync(fakeInstall("pkg-stale", false), entryOf(root), "dir");
    expect(ensureSelfSkill(root)).toEqual({ kind: "relinked" });
    expect(fs.realpathSync(entryOf(root))).toBe(
      fs.realpathSync(resolveSelfSkillSource()!.skillDir),
    );
  });

  it("replaces a dangling link (no user content can be lost)", () => {
    const root = freshRoot();
    fs.mkdirSync(root, { recursive: true });
    fs.symlinkSync(path.join(sandbox, "evicted", SELF_SKILL_DIRECTORY_NAME), entryOf(root), "dir");
    expect(ensureSelfSkill(root)).toEqual({ kind: "relinked" });
    expect(fs.lstatSync(entryOf(root)).isSymbolicLink()).toBe(true);
  });

  it("migrates a byte-identical legacy copy to a link without backup", () => {
    const root = freshRoot();
    // legacy 判据 = marker + 文档字节与本次安装源一致（仅 marker 可被用户仿冒，
    // 摘要不等的一律按用户目录冲突走显式裁决——复核 P2 加固）。
    const source = resolveSelfSkillSource()!;
    fs.mkdirSync(path.join(entryOf(root), "references"), { recursive: true });
    fs.writeFileSync(
      path.join(entryOf(root), "SKILL.md"),
      fs.readFileSync(path.join(source.skillDir, "SKILL.md")),
    );
    expect(ensureSelfSkill(root)).toEqual({ kind: "migrated" });
    expect(fs.lstatSync(entryOf(root)).isSymbolicLink()).toBe(true);
  });

  it("treats a marked-but-diverged directory as a user conflict (no silent rm)", () => {
    const root = freshRoot();
    writeUserDirectory(root, true);
    const result = ensureSelfSkill(root);
    expect(result.kind === "conflict" && result.conflict.kind).toBe("user-directory");
    expect(fs.readFileSync(path.join(entryOf(root), "SKILL.md"), "utf8")).toContain("legacy");
  });

  it("reports conflict and never touches a user-maintained directory", () => {
    const root = freshRoot();
    writeUserDirectory(root, false);
    const result = ensureSelfSkill(root);
    expect(result.kind).toBe("conflict");
    if (result.kind !== "conflict") return;
    expect(result.conflict.kind).toBe("user-directory");
    expect(fs.readFileSync(path.join(entryOf(root), "SKILL.md"), "utf8")).toContain("my own copy");
    expect(fs.lstatSync(entryOf(root)).isDirectory()).toBe(true);
  });

  it("reports conflict for a foreign link and keeps the target untouched", () => {
    const root = freshRoot();
    const target = path.join(sandbox, "user-owned-skill");
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "SKILL.md"), "---\nname: mine\ndescription: mine\n---\nx\n");
    fs.mkdirSync(root, { recursive: true });
    fs.symlinkSync(target, entryOf(root), "dir");
    const result = ensureSelfSkill(root);
    expect(result.kind).toBe("conflict");
    if (result.kind !== "conflict") return;
    expect(result.conflict.kind).toBe("foreign-link");
    // macOS tmp 在 /var → /private/var 下：目标以 realpath 形态报告。
    expect(result.conflict.targetPath).toBe(fs.realpathSync(target));
    expect(fs.readFileSync(path.join(target, "SKILL.md"), "utf8")).toContain("name: mine");
  });

  it("reports conflict for a foreign (non-directory) entry", () => {
    const root = freshRoot();
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(entryOf(root), "not a skill", "utf8");
    const result = ensureSelfSkill(root);
    expect(result.kind === "conflict" && result.conflict.kind).toBe("foreign-entry");
  });

  it("returns typed failed (never throws) when the root is blocked", () => {
    const root = path.join(sandbox, "blocked-root");
    fs.mkdirSync(path.dirname(root), { recursive: true });
    fs.writeFileSync(root, "root path is a file", "utf8");
    const result = ensureSelfSkill(root);
    expect(result.kind).toBe("failed");
  });
});

describe("conflict decisions (design D3)", () => {
  it("backs a user directory up to the timestamped skills-backup dir, then links", () => {
    const root = freshRoot();
    writeUserDirectory(root, false);
    const result = resolveSelfSkillConflict({ backup: true }, root);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.backupPath).toBeDefined();
    expect(result.backupPath).toContain("skills-backup");
    expect(
      result.backupPath!.match(/skill-creator-v2-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/),
    ).not.toBeNull();
    expect(fs.readFileSync(path.join(result.backupPath!, "SKILL.md"), "utf8")).toContain(
      "my own copy",
    );
    expect(fs.lstatSync(entryOf(root)).isSymbolicLink()).toBe(true);
  });

  it("removes a foreign link without touching the user's target (no backup)", () => {
    const root = freshRoot();
    const target = path.join(sandbox, "user-owned-2");
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "SKILL.md"), "---\nname: mine\ndescription: m\n---\nx\n");
    fs.mkdirSync(root, { recursive: true });
    fs.symlinkSync(target, entryOf(root), "dir");
    const result = resolveSelfSkillConflict({ backup: true }, root);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.backupPath).toBeUndefined();
    expect(fs.lstatSync(entryOf(root)).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(path.join(target, "SKILL.md"))).toBe(true);
  });

  it("overwrites a user directory without backup by removing it (unlink on dirs is EPERM)", () => {
    // 复核 P1-2：backup:false 的 user-directory 曾落 unlinkSync → 全平台 EPERM。
    const root = freshRoot();
    writeUserDirectory(root, false);
    const result = resolveSelfSkillConflict({ backup: false }, root);
    expect(result).toEqual({ ok: true });
    expect(fs.lstatSync(entryOf(root)).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(path.join(sandbox, "skills-backup"))).toBe(false);
  });

  it("overwrites a foreign file entry without backup", () => {
    const root = freshRoot();
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(entryOf(root), "not a skill", "utf8");
    expect(resolveSelfSkillConflict({ backup: false }, root)).toEqual({ ok: true });
    expect(fs.lstatSync(entryOf(root)).isSymbolicLink()).toBe(true);
  });

  it("keeps the user version silently until the entry changes", () => {
    const root = freshRoot();
    writeUserDirectory(root, false);
    expect(keepSelfSkillUserVersion(root)).toEqual({ ok: true });
    expect(ensureSelfSkill(root)).toEqual({ kind: "kept" });
    expect(selfSkillStatus(root).state).toBe("kept");
    // 指纹漂移（用户改了自己的 SKILL.md）→ 重新提醒。
    fs.appendFileSync(path.join(entryOf(root), "SKILL.md"), "\nuser edited\n");
    expect(ensureSelfSkill(root).kind).toBe("conflict");
    expect(selfSkillStatus(root).state).toBe("conflict");
  });

  it("rejects decisions when there is nothing to decide", () => {
    const root = freshRoot();
    ensureSelfSkill(root);
    expect(resolveSelfSkillConflict({ backup: false }, root)).toEqual({ ok: true });
    expect(keepSelfSkillUserVersion(root).ok).toBe(false);
  });
});

describe("shipped document invariants (design D4/D5)", () => {
  const repoSkillDir = path.join(import.meta.dirname, "..", "skills", SELF_SKILL_DIRECTORY_NAME);

  it("frontmatter passes the Creator contract and the directory name rule", () => {
    const parsed = matter(fs.readFileSync(path.join(repoSkillDir, "SKILL.md"), "utf8"));
    expect(safeParseExternal(SkillFrontmatterSchema, parsed.data)).not.toBeNull();
    expect(SkillDirectoryNameSchema.safeParse(SELF_SKILL_DIRECTORY_NAME).success).toBe(true);
    expect(parsed.data.name).toBe(SELF_SKILL_DIRECTORY_NAME);
    expect(parsed.data["x-managed-by"]).toBe("skill-creator");
    expect(fs.existsSync(path.join(repoSkillDir, "references", "tools.md"))).toBe(true);
  });

  it("parses through the ccski discovery validator", () => {
    expect(() => parseSkillFile(path.join(repoSkillDir, "SKILL.md"))).not.toThrow();
  });

  it("documents only real CLI commands and MCP tool names", () => {
    const reference = fs.readFileSync(path.join(repoSkillDir, "references", "tools.md"), "utf8");
    for (const command of [
      "skill-creator start",
      "skill-creator open",
      "skill-creator openinbrowser",
      "skill-creator status",
      "skill-creator stop",
      "skill-creator search",
      "skill-creator wiki",
      "skill-creator mcp",
      "skill-creator setup",
      "skill-creator self-skill",
    ]) {
      expect(reference).toContain(command);
    }
    for (const tool of [
      "workspace_list",
      "skills_list",
      "skills_info",
      "skills_validate",
      "skills_search",
      "skills_duplicates",
      "skills_update_check",
      "creator_load",
      "creator_revisions",
      "repository_scan",
      "repository_sources_list",
      "wiki_scopes",
      "wiki_list",
      "wiki_read",
    ]) {
      expect(reference).toContain(`\`${tool}\``);
    }
    expect(reference).not.toContain("`skills_toggle`");
    expect(reference).not.toContain("`creator_save`");
  });
});

describe("closed loop: the linked self skill is discoverable by the product", () => {
  it("search returns the self skill through the symlinked entry", async () => {
    const root = freshRoot();
    ensureSelfSkill(root);
    const roots: SkillRoot[] = [
      {
        rootPath: root,
        workspaceId: GLOBAL_WORKSPACE_ID,
        providerId: ProviderIdSchema.parse("cline"),
      },
    ];
    const service = createSkillSearchServiceWithRoots(() => roots);
    openServices.push(service);
    const results = await service.search("skill creator 技能管理", { limit: 10 });
    const match = results.find((result) => result.name === SELF_SKILL_DIRECTORY_NAME);
    expect(match).toBeDefined();
    expect(match!.canonicalPath).toContain(SELF_SKILL_DIRECTORY_NAME);
  });

  it("backup directory path follows the documented layout", () => {
    const root = freshRoot();
    const backup = selfSkillBackupDirectory(root);
    expect(path.basename(path.dirname(backup))).toBe("skills-backup");
    expect(path.dirname(path.dirname(backup))).toBe(path.dirname(path.resolve(root)));
  });
});
