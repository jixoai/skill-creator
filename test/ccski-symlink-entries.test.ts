/**
 * ccski symlink 发现增补测试（self-skill-symlink D4）。
 *
 * 事实背景：ccski 2.5.0 root 扫描 `entry.isDirectory()` 过滤跳过 symlink 目录条目
 * （实测钉死）。本套件钉住增补模块的形状镜像与跳过口径。
 *
 * 正交意图：
 *   [1] 形状镜像：增补条目 = ccski customDir 实测形状（location "user" /
 *       sourceKind "custom" / sourcePriority 500 / provider 透传）。
 *   [2] 跳过口径：无 SKILL.md 的链、坏 frontmatter、includeDisabled 语义、
 *       真实目录不重复补。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listSkillsWithSymlinkedEntries } from "../src/daemon/ccski-symlink-entries.js";

let sandbox = "";

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "ccski-symlink-augment-"));
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function writeSkill(directory: string, name: string, extra = ""): string {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: skill ${name}\n${extra}---\n\nbody\n`,
  );
  return directory;
}

function linkSkill(root: string, name: string, target: string): string {
  fs.mkdirSync(root, { recursive: true });
  const link = path.join(root, name);
  fs.symlinkSync(target, link, "dir");
  return link;
}

describe("listSkillsWithSymlinkedEntries", () => {
  it("mirrors the ccski customDir shape for symlinked entries", async () => {
    const root = path.join(sandbox, "agents-skills");
    writeSkill(path.join(root, "real-skill"), "real-skill");
    const linked = writeSkill(path.join(sandbox, "pkg", "skills", "linked-skill"), "linked-skill");
    fs.mkdirSync(path.join(linked, "references"));
    linkSkill(root, "linked-skill", linked);
    const result = await listSkillsWithSymlinkedEntries({
      customDirs: [root],
      customProvider: "cline",
      scanDefaultDirs: false,
      all: false,
    });
    const byName = new Map(result.map((skill) => [skill.name, skill]));
    expect(byName.has("real-skill")).toBe(true);
    const augmented = byName.get("linked-skill");
    expect(augmented).toBeDefined();
    expect(augmented!.path).toBe(path.join(root, "linked-skill"));
    expect(augmented!.provider).toBe("cline");
    expect(augmented!.location).toBe("user");
    expect(augmented!.sourceKind).toBe("custom");
    expect(augmented!.sourcePriority).toBe(500);
    expect(augmented!.disabled).toBe(false);
    expect(augmented!.hasReferences).toBe(true);
  });

  it("skips non-skill links and unparsable frontmatter", async () => {
    const root = path.join(sandbox, "agents-skills");
    fs.mkdirSync(path.join(sandbox, "empty-dir"), { recursive: true });
    linkSkill(root, "not-a-skill", path.join(sandbox, "empty-dir"));
    const broken = path.join(sandbox, "broken-skill");
    fs.mkdirSync(broken, { recursive: true });
    fs.writeFileSync(path.join(broken, "SKILL.md"), "---\nname: [unclosed\n---\nbody\n");
    linkSkill(root, "broken-skill", broken);
    const result = await listSkillsWithSymlinkedEntries({
      customDirs: [root],
      customProvider: "cline",
      scanDefaultDirs: false,
    });
    expect(result).toHaveLength(0);
  });

  it("honors includeDisabled semantics for .SKILL.md-only links", async () => {
    const root = path.join(sandbox, "agents-skills");
    const disabledSkill = path.join(sandbox, "pkg", "skills", "disabled-skill");
    fs.mkdirSync(disabledSkill, { recursive: true });
    fs.writeFileSync(
      path.join(disabledSkill, ".SKILL.md"),
      "---\nname: disabled-skill\ndescription: d\n---\nbody\n",
    );
    linkSkill(root, "disabled-skill", disabledSkill);
    const base = {
      customDirs: [root],
      customProvider: "cline",
      scanDefaultDirs: false,
    } as const;
    expect(await listSkillsWithSymlinkedEntries({ ...base, all: false })).toHaveLength(0);
    const withDisabled = await listSkillsWithSymlinkedEntries({ ...base, all: true });
    expect(withDisabled).toHaveLength(1);
    expect(withDisabled[0]!.disabled).toBe(true);
  });
});
