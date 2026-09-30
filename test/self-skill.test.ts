/**
 * 产品自描述技能自举测试（self-skill-bootstrap）。
 *
 * 用户原始需求 [2026-09-30]：「在启动 skill creator 的时候会在 ~/.agents/skills/
 * skill-creator-v2 这个目录提供一个 `Skill Creator V2` 的技能……这是一个闭环。」
 *
 * 正交意图：
 *   [1] ensure 语义五态：installed / updated / current（含用户同版本改动保留）/
 *       foreign（无标记与坏 YAML）/ failed（IO 硬错误不抛出）。
 *   [2] 文档不变量：frontmatter 过 Creator/ccski 契约、name=目录名、所有权标记
 *       在场、references 随组落盘。
 *   [3] 闭环走查：自举产物被自家检索面（skill-search seam）按普通技能召回。
 * 妥协声明：main.ts 入口挂载本身不在此测试（生产入口不可沙箱化）；语义经
 * ensureSelfSkill 显式 root 注入覆盖（design D1/D5）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import matter from "gray-matter";
import { parseSkillFile } from "ccski";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSkillSearchServiceWithRoots } from "../src/daemon/skill-search/service.js";
import {
  SELF_SKILL_DIRECTORY_NAME,
  SELF_SKILL_ROOT_ENV,
  SELF_SKILL_VERSION,
  ensureSelfSkill,
  selfSkillDirectory,
  selfSkillMarkdown,
  selfSkillToolsReference,
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
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "self-skill-test-"));
  previousRootEnv = process.env[SELF_SKILL_ROOT_ENV];
});

afterEach(async () => {
  if (previousRootEnv === undefined) delete process.env[SELF_SKILL_ROOT_ENV];
  else process.env[SELF_SKILL_ROOT_ENV] = previousRootEnv;
  setHomeOverride(null);
  for (const service of openServices.splice(0)) await service.dispose();
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function skillFile(root: string): string {
  return path.join(root, SELF_SKILL_DIRECTORY_NAME, "SKILL.md");
}

function writeExistingSkill(root: string, frontmatter: string, body = "user content\n"): void {
  const file = skillFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `---\n${frontmatter}---\n\n${body}`, "utf8");
}

describe("ensureSelfSkill semantics (design D2)", () => {
  it("installs the document set into a fresh root", () => {
    const root = path.join(sandbox, "agents-skills");
    expect(ensureSelfSkill(root)).toEqual({ kind: "installed" });
    const document = matter(fs.readFileSync(skillFile(root), "utf8"));
    expect(document.data.name).toBe(SELF_SKILL_DIRECTORY_NAME);
    expect(document.data["x-managed-by"]).toBe("skill-creator");
    expect(document.data["x-managed-version"]).toBe(SELF_SKILL_VERSION);
    expect(
      fs.existsSync(path.join(root, SELF_SKILL_DIRECTORY_NAME, "references", "tools.md")),
    ).toBe(true);
  });

  it("respects the product disable marker instead of silently reinstalling", () => {
    // 产品禁用语义 = SKILL.md rename 为 .SKILL.md；忽略该痕迹会让技能在下次启动
    // 复活并与 .SKILL.md 并存进入 toggle conflict 永久态（复核 P1-1）。
    const root = path.join(sandbox, "agents-skills");
    ensureSelfSkill(root);
    const directory = path.join(root, SELF_SKILL_DIRECTORY_NAME);
    fs.renameSync(skillFile(root), path.join(directory, ".SKILL.md"));
    expect(ensureSelfSkill(root)).toEqual({ kind: "disabled" });
    expect(fs.existsSync(skillFile(root))).toBe(false);
    expect(fs.existsSync(path.join(directory, ".SKILL.md"))).toBe(true);
  });

  it("reports current and preserves same-version user edits", () => {
    const root = path.join(sandbox, "agents-skills");
    ensureSelfSkill(root);
    const file = skillFile(root);
    const edited = fs
      .readFileSync(file, "utf8")
      .replace("# Skill Creator V2", "# Skill Creator V2\n\n(user note)");
    fs.writeFileSync(file, edited, "utf8");
    expect(ensureSelfSkill(root)).toEqual({ kind: "current" });
    expect(fs.readFileSync(file, "utf8")).toBe(edited);
  });

  it("upgrades an older managed version and rewrites both files", () => {
    const root = path.join(sandbox, "agents-skills");
    writeExistingSkill(
      root,
      `name: ${SELF_SKILL_DIRECTORY_NAME}\ndescription: old\nx-managed-by: skill-creator\nx-managed-version: "0"\n`,
    );
    expect(ensureSelfSkill(root)).toEqual({ kind: "updated", fromVersion: "0" });
    expect(matter(fs.readFileSync(skillFile(root), "utf8")).data["x-managed-version"]).toBe(
      SELF_SKILL_VERSION,
    );
    expect(
      fs.existsSync(path.join(root, SELF_SKILL_DIRECTORY_NAME, "references", "tools.md")),
    ).toBe(true);
  });

  it("never touches a foreign document (no marker or unparsable frontmatter)", () => {
    const root = path.join(sandbox, "agents-skills");
    const foreign = "name: my-own\ndescription: mine\n";
    writeExistingSkill(root, foreign);
    expect(ensureSelfSkill(root)).toEqual({ kind: "foreign" });
    expect(fs.readFileSync(skillFile(root), "utf8")).toContain("name: my-own");

    const broken = path.join(sandbox, "broken");
    const brokenFile = skillFile(broken);
    fs.mkdirSync(path.dirname(brokenFile), { recursive: true });
    fs.writeFileSync(brokenFile, "---\nname: [unclosed\n---\n\nbody\n", "utf8");
    expect(ensureSelfSkill(broken)).toEqual({ kind: "foreign" });
    expect(fs.readFileSync(brokenFile, "utf8")).toContain("[unclosed");
  });

  it("returns typed failed (never throws) on hard IO errors", () => {
    // skill-creator-v2 作为普通文件存在 → 子路径读取 ENOTDIR（非 ENOENT）。
    const root = path.join(sandbox, "blocked");
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, SELF_SKILL_DIRECTORY_NAME), "not a directory", "utf8");
    const result = ensureSelfSkill(root);
    expect(result.kind).toBe("failed");
    expect(result.kind === "failed" && result.reason).toContain("self-skill bootstrap");
  });

  it("resolves the root through the isolation env valve", () => {
    const override = path.join(sandbox, "env-root");
    process.env[SELF_SKILL_ROOT_ENV] = override;
    expect(selfSkillDirectory()).toBe(path.join(override, SELF_SKILL_DIRECTORY_NAME));
    expect(ensureSelfSkill()).toEqual({ kind: "installed" });
    expect(fs.existsSync(skillFile(override))).toBe(true);
    // 显式参数优先于 env（单测直通通道）。
    const explicit = path.join(sandbox, "explicit-root");
    expect(ensureSelfSkill(explicit)).toEqual({ kind: "installed" });
    expect(fs.existsSync(skillFile(explicit))).toBe(true);
  });

  it("defaults to the community global root under the real home", () => {
    delete process.env[SELF_SKILL_ROOT_ENV];
    expect(selfSkillDirectory()).toBe(
      path.join(os.homedir(), ".agents", "skills", SELF_SKILL_DIRECTORY_NAME),
    );
  });
});

describe("document invariants (design D4)", () => {
  it("frontmatter passes the Creator contract and the directory name rule", () => {
    const parsed = matter(selfSkillMarkdown());
    expect(safeParseExternal(SkillFrontmatterSchema, parsed.data)).not.toBeNull();
    expect(SkillDirectoryNameSchema.safeParse(SELF_SKILL_DIRECTORY_NAME).success).toBe(true);
    expect(parsed.data.name).toBe(SELF_SKILL_DIRECTORY_NAME);
    expect(typeof parsed.data.description).toBe("string");
    expect(parsed.data.description.length).toBeGreaterThan(0);
  });

  it("parses through the ccski discovery validator", () => {
    const root = path.join(sandbox, "agents-skills");
    ensureSelfSkill(root);
    expect(() => parseSkillFile(skillFile(root))).not.toThrow();
  });

  it("documents only real CLI commands and MCP tool names", () => {
    const reference = selfSkillToolsReference();
    // CLI 面：与 cli.ts COMMANDS 键集合一致（抽样锚定 + 关键旗标拼写）。
    for (const command of [
      "skill-creator start",
      "skill-creator open",
      "skill-creator openinbrowser",
      "skill-creator status",
      "skill-creator stop",
      "skill-creator search",
      "skill-creator wiki",
      "skill-creator mcp",
    ]) {
      expect(reference).toContain(command);
    }
    expect(reference).toContain("[--json] [--limit N]");
    // MCP 面：readonly 目录抽样锚定（事实源 = capability 登记表）。
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
    // stdio 面不注册 mutation/propose：文档不得承诺写能力。
    expect(reference).not.toContain("`skills_toggle`");
    expect(reference).not.toContain("`creator_save`");
  });
});

describe("closed loop: the self skill is discoverable by the product search face", () => {
  it("returns the self skill for a skill-creator query", async () => {
    const root = path.join(sandbox, "agents-skills");
    ensureSelfSkill(root);
    setHomeOverride(path.join(sandbox, "state"));
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
    expect(match?.canonicalPath).toContain(SELF_SKILL_DIRECTORY_NAME);
  });
});
