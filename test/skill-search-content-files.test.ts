/**
 * 额外 md 收集器边界测试（search-robustness R1）。
 *
 * User input [2026-09-18]: 「索引 skill 文件夹里的 md 文件；特殊文件夹名不该索引」。
 *
 * Orthogonal intents:
 *   [1] 排除矩阵：dot 目录/内置清单/配置追加；SKILL.md 变体不重复收集。
 *   [2] 边界：深度 ≤4、≤32 文件、symlink 目录/文件拒绝、路径排序确定性。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectExtraMarkdownFiles } from "../src/daemon/skill-search/content-files.js";

let sandbox = "";

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-search-content-files-"));
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function writeFile(relative: string, content = "text"): string {
  const file = path.join(sandbox, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

describe("extra markdown collection (search-robustness R1)", () => {
  it("collects nested markdown files in deterministic path order", () => {
    writeFile("SKILL.md", "skill");
    writeFile("reference/guide.md");
    writeFile("advanced/deep/topic.md");
    writeFile("a-top.md");
    const files = collectExtraMarkdownFiles(sandbox, new Set());
    expect(files.map((file) => path.relative(sandbox, file.path))).toEqual([
      "a-top.md",
      "advanced/deep/topic.md",
      "reference/guide.md",
    ]);
  });

  it("skips builtin and configured excluded directories at any depth", () => {
    writeFile("SKILL.md", "skill");
    writeFile("node_modules/lib.md");
    writeFile("reference/node_modules/lib.md");
    writeFile("build/out.md");
    writeFile("vendor/asset.md");
    const builtinOnly = collectExtraMarkdownFiles(sandbox, new Set());
    expect(builtinOnly.map((file) => path.relative(sandbox, file.path))).toEqual(["vendor/asset.md"]);
    const withConfig = collectExtraMarkdownFiles(sandbox, new Set(["vendor"]));
    expect(withConfig).toHaveLength(0);
  });

  it("always skips dot directories and rejects symlinked files and directories", () => {
    writeFile("SKILL.md", "skill");
    writeFile(".git/objects.md");
    writeFile(".hidden/secret.md");
    const outside = path.join(sandbox, "..", path.basename(sandbox) + "-outside.md");
    fs.writeFileSync(outside, "outside");
    fs.symlinkSync(outside, path.join(sandbox, "linked.md"));
    fs.mkdirSync(path.join(sandbox, "realdir"), { recursive: true });
    fs.writeFileSync(path.join(sandbox, "realdir", "inner.md"), "inner");
    fs.symlinkSync(path.join(sandbox, "realdir"), path.join(sandbox, "linkdir"));
    const files = collectExtraMarkdownFiles(sandbox, new Set());
    expect(files.map((file) => path.relative(sandbox, file.path))).toEqual(["realdir/inner.md"]);
  });

  it("caps collection at 32 files and depth 4", () => {
    writeFile("SKILL.md", "skill");
    for (let index = 0; index < 40; index += 1) writeFile(`f${String(index).padStart(2, "0")}.md`);
    expect(collectExtraMarkdownFiles(sandbox, new Set())).toHaveLength(32);
    const deep = path.join(sandbox, "d1", "d2", "d3", "d4", "d5");
    fs.mkdirSync(deep, { recursive: true });
    fs.writeFileSync(path.join(deep, "too-deep.md"), "x");
    fs.writeFileSync(path.join(sandbox, "d1", "d2", "d3", "d4", "at-limit.md"), "x");
    const files = collectExtraMarkdownFiles(sandbox, new Set());
    expect(files.some((file) => file.path.endsWith("too-deep.md"))).toBe(false);
    expect(files.some((file) => file.path.endsWith("at-limit.md"))).toBe(true);
  });

  it("excludes identity-file name variants case-insensitively and non-md files", () => {
    writeFile("SKILL.md", "skill");
    writeFile("skill.md", "variant");
    writeFile(".skill.md", "variant");
    writeFile("notes.txt", "text");
    writeFile("guide.markdown", "text");
    expect(collectExtraMarkdownFiles(sandbox, new Set())).toHaveLength(0);
  });
});
