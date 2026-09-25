/**
 * 用户原始需求 [2026-09-21]：「global 能承载 workspace 泛化出来的 skill」+
 * 「P1 本质上是在收集一些碎片的认知……是 skill-wiki 输入的一部分」。
 * 修订 [2026-09-22]（目录映射标准 Owner 裁决）：scope 寻址 = workspace 目录
 * 路径；global 是 `~` 特例；slug 形状与中央登记表退役。
 * 正交意图：[1] 钉死目录映射标准与碎片追加的去重幂等；
 * [2] 钉死磁盘输入边界（畸形 pattern/impact 行丢弃、typed 失败、原子写）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SkillWikiError,
  globalWikiDirectory,
  listWikiPatternsReadOnly,
  openWikiWorkspace,
  patternContentHash,
  resolveWikiDirectory,
  wikiPatternSummary,
  workspaceWikiDirectory,
} from "../src/index.js";

const tempDirs: string[] = [];
function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-wiki-test-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
});

describe("directory mapping standard (2026-09-22)", () => {
  it("maps a workspace directory to its co-located .agents/skill-wiki", () => {
    expect(workspaceWikiDirectory("/tmp/proj")).toBe(
      path.join("/tmp/proj", ".agents", "skill-wiki"),
    );
  });

  it("resolves global '~' and workspace paths to non-overlapping wiki directories", () => {
    const previous = process.env.SKILL_WIKI_HOME;
    try {
      const home = makeTempDir();
      process.env.SKILL_WIKI_HOME = home;
      const workspace = makeTempDir();
      const global = resolveWikiDirectory("~");
      const local = resolveWikiDirectory(workspace);
      expect(global).toBe(home);
      expect(local).toBe(path.join(workspace, ".agents", "skill-wiki"));
      expect(global).not.toBe(local);
    } finally {
      if (previous === undefined) delete process.env.SKILL_WIKI_HOME;
      else process.env.SKILL_WIKI_HOME = previous;
    }
  });

  it("resolves relative workspace references against the current directory", () => {
    const workspace = makeTempDir();
    // chdir 后 process.cwd() 是物理路径（macOS /var → /private/var），
    // 期望值必须同样取 realpath 口径。
    const physical = fs.realpathSync(workspace);
    const previousCwd = process.cwd();
    try {
      process.chdir(workspace);
      expect(resolveWikiDirectory("./")).toBe(workspaceWikiDirectory(physical));
      expect(resolveWikiDirectory(".")).toBe(workspaceWikiDirectory(physical));
      expect(resolveWikiDirectory("sub/dir")).toBe(
        workspaceWikiDirectory(path.join(physical, "sub/dir")),
      );
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("defaults global to ~/.agents/skill-wiki, overridable via SKILL_WIKI_HOME", () => {
    const previous = process.env.SKILL_WIKI_HOME;
    try {
      delete process.env.SKILL_WIKI_HOME;
      expect(globalWikiDirectory()).toBe(path.join(os.homedir(), ".agents", "skill-wiki"));
      expect(resolveWikiDirectory("~")).toBe(path.join(os.homedir(), ".agents", "skill-wiki"));
      process.env.SKILL_WIKI_HOME = "/tmp/wiki-home-override";
      expect(globalWikiDirectory()).toBe("/tmp/wiki-home-override");
      expect(resolveWikiDirectory("~")).toBe("/tmp/wiki-home-override");
    } finally {
      if (previous === undefined) delete process.env.SKILL_WIKI_HOME;
      else process.env.SKILL_WIKI_HOME = previous;
    }
  });

  it("rejects empty or unparseable workspace input with WIKI_INVALID_SCOPE", () => {
    for (const bad of ["", "   ", "a\0b"]) {
      try {
        resolveWikiDirectory(bad);
        expect.unreachable(`must reject: ${JSON.stringify(bad)}`);
      } catch (error) {
        expect(error).toBeInstanceOf(SkillWikiError);
        expect((error as SkillWikiError).code).toBe("WIKI_INVALID_SCOPE");
      }
    }
  });

  it("host and CLI converge on the same physical wiki for one workspace directory", () => {
    // spec「宿主与 CLI 同根」scenario：同一 workspace 目录 → 同一 wiki 目录。
    const workspace = makeTempDir();
    const wiki = openWikiWorkspace(resolveWikiDirectory(workspace));
    wiki.appendPattern({ title: "Shared insight", body: "one physical directory" });
    expect(
      fs.existsSync(path.join(workspace, ".agents", "skill-wiki", "patterns", "shared-insight.md")),
    ).toBe(true);
  });
});

describe("WikiWorkspace patterns", () => {
  it("starts empty on a fresh directory", () => {
    const wiki = openWikiWorkspace(makeTempDir());
    expect(wiki.listPatterns()).toEqual([]);
    expect(wiki.listImpact()).toEqual([]);
  });

  it("appends a pattern, rewrites index.md, and lists it", () => {
    const dir = makeTempDir();
    const wiki = openWikiWorkspace(dir);
    const { item, deduplicated } = wiki.appendPattern({
      title: "Always pin shell exit codes",
      body: "Gate commands must branch on exit code, never on piped stdout.",
    });
    expect(deduplicated).toBe(false);
    expect(item.name).toBe("always-pin-shell-exit-codes");
    expect(item.origin).toBe("~");

    const listed = wiki.listPatterns();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.contentHash).toBe(
      patternContentHash("Gate commands must branch on exit code, never on piped stdout."),
    );

    const index = fs.readFileSync(path.join(dir, "index.md"), "utf8");
    expect(index).toContain("# Wiki Index");
    expect(index).toContain("always-pin-shell-exit-codes — Always pin shell exit codes");
  });

  it("deduplicates by contentHash: same body appends nothing and returns the existing item", () => {
    const wiki = openWikiWorkspace(makeTempDir());
    const first = wiki.appendPattern({ title: "First title", body: "shared body" });
    const second = wiki.appendPattern({ title: "Different title", body: "shared body" });
    expect(second.deduplicated).toBe(true);
    expect(second.item.name).toBe(first.item.name);
    expect(wiki.listPatterns()).toHaveLength(1);
  });

  it("CRLF and LF bodies with the same content deduplicate together", () => {
    const wiki = openWikiWorkspace(makeTempDir());
    wiki.appendPattern({ title: "A", body: "line1\nline2" });
    const crlf = wiki.appendPattern({ title: "B", body: "line1\r\nline2" });
    expect(crlf.deduplicated).toBe(true);
  });

  it("suffixes the filename when the slug collides on distinct content", () => {
    const wiki = openWikiWorkspace(makeTempDir());
    wiki.appendPattern({ title: "Same Title", body: "one" });
    const second = wiki.appendPattern({ title: "Same Title", body: "two" });
    expect(second.item.name).toBe("same-title-2");
    expect(wiki.listPatterns()).toHaveLength(2);
  });

  it("round-trips a pattern through readPattern", () => {
    const wiki = openWikiWorkspace(makeTempDir());
    const workspacePath = makeTempDir();
    wiki.appendPattern({
      title: "Round trip",
      body: "content here",
      origin: workspacePath,
    });
    const read = wiki.readPattern("round-trip");
    expect(read.frontmatter.title).toBe("Round trip");
    // origin 足迹约定：workspace 写入 = workspace 目录绝对路径。
    expect(read.frontmatter.origin).toBe(workspacePath);
    expect(read.frontmatter.promotedFrom).toBeNull();
    expect(read.body.replace(/\n$/, "")).toBe("content here");
  });

  it("reads hand-written YAML null promotedFrom as null (no phantom badge)", () => {
    const dir = makeTempDir();
    const patterns = path.join(dir, "patterns");
    fs.mkdirSync(patterns, { recursive: true });
    // 手写 YAML 的合法 null 字面量——逐行解析器读到字符串 "null"，必须归一
    // （走查实证：否则 promotedFrom 真值化 → UI 幽灵 promoted 徽章）。
    fs.writeFileSync(
      path.join(patterns, "hand-written.md"),
      [
        "---",
        "title: Hand written",
        "created: 2026-09-25T10:00:00.000Z",
        "updated: 2026-09-25T10:00:00.000Z",
        "origin: ~",
        "promotedFrom: null",
        "---",
        "",
        "body",
        "",
      ].join("\n"),
    );
    const wiki = openWikiWorkspace(dir);
    expect(wiki.listPatterns()[0]?.promotedFrom).toBeNull();
    expect(wiki.readPattern("hand-written").frontmatter.promotedFrom).toBeNull();
  });

  it("projects an invalid promotedFrom envelope to null on every read face, preserving the original bytes", () => {
    const dir = makeTempDir();
    const patterns = path.join(dir, "patterns");
    fs.mkdirSync(patterns, { recursive: true });
    // 非空坏值（非法 JSON 信封）：读投影一律 null（L 信封法——不伪装空足迹、
    // 不清洗原文），原文件逐字节保留，等待人工修复。
    fs.writeFileSync(
      path.join(patterns, "bad-envelope.md"),
      [
        "---",
        "title: Bad envelope",
        "created: 2026-09-25T10:00:00.000Z",
        "updated: 2026-09-25T10:00:00.000Z",
        "origin: ~",
        "promotedFrom: not-an-envelope",
        "---",
        "",
        "body",
        "",
      ].join("\n"),
    );
    const pagePath = path.join(patterns, "bad-envelope.md");
    const before = fs.readFileSync(pagePath, "utf8");
    const wiki = openWikiWorkspace(dir);
    expect(wiki.listPatterns()[0]?.promotedFrom).toBeNull();
    expect(listWikiPatternsReadOnly(dir)[0]?.promotedFrom).toBeNull();
    expect(wiki.readPattern("bad-envelope").frontmatter.promotedFrom).toBeNull();
    expect(fs.readFileSync(pagePath, "utf8")).toBe(before);
  });

  it("projects an empty promotedFrom envelope [] to null (no-footprint), preserving the original bytes", () => {
    const dir = makeTempDir();
    const patterns = path.join(dir, "patterns");
    fs.mkdirSync(patterns, { recursive: true });
    // 空数组是合法 JSON 但语义 = 无足迹（design：存储值恒非空数组）——
    // 读投影 null，不把真值空信封漏给 UI 徽章；磁盘原文不动。
    fs.writeFileSync(
      path.join(patterns, "empty-envelope.md"),
      [
        "---",
        "title: Empty envelope",
        "created: 2026-09-25T10:00:00.000Z",
        "updated: 2026-09-25T10:00:00.000Z",
        "origin: ~",
        "promotedFrom: []",
        "---",
        "",
        "body",
        "",
      ].join("\n"),
    );
    const pagePath = path.join(patterns, "empty-envelope.md");
    const before = fs.readFileSync(pagePath, "utf8");
    const wiki = openWikiWorkspace(dir);
    expect(wiki.listPatterns()[0]?.promotedFrom).toBeNull();
    expect(listWikiPatternsReadOnly(dir)[0]?.promotedFrom).toBeNull();
    expect(wiki.readPattern("empty-envelope").frontmatter.promotedFrom).toBeNull();
    expect(fs.readFileSync(pagePath, "utf8")).toBe(before);
  });

  it("rejects empty/oversized titles before writing anything", () => {
    const dir = makeTempDir();
    const wiki = openWikiWorkspace(dir);
    for (const title of ["", "   ", "x".repeat(121)]) {
      try {
        wiki.appendPattern({ title, body: "b" });
        expect.unreachable("must throw");
      } catch (error) {
        expect((error as SkillWikiError).code).toBe("WIKI_INVALID_PATTERN");
      }
    }
    expect(wiki.listPatterns()).toEqual([]);
    expect(fs.existsSync(path.join(dir, "index.md"))).toBe(false);
  });

  it("readPattern fails typed on unknown or invalid names", () => {
    const wiki = openWikiWorkspace(makeTempDir());
    try {
      wiki.readPattern("does-not-exist");
      expect.unreachable("must throw");
    } catch (error) {
      expect((error as SkillWikiError).code).toBe("WIKI_INVALID_PATTERN");
    }
    try {
      wiki.readPattern("../escape");
      expect.unreachable("must throw");
    } catch (error) {
      expect((error as SkillWikiError).code).toBe("WIKI_INVALID_PATTERN");
    }
  });

  it("drops malformed pattern files from listPatterns but keeps valid siblings", () => {
    const dir = makeTempDir();
    const wiki = openWikiWorkspace(dir);
    wiki.appendPattern({ title: "Valid", body: "keep me" });
    fs.writeFileSync(path.join(dir, "patterns", "broken.md"), "no frontmatter at all\n", "utf8");
    const listed = wiki.listPatterns();
    expect(listed.map((item) => item.name)).toEqual(["valid"]);
  });

  it("drops pattern pages whose frontmatter carries unknown fields (strict semantics)", () => {
    const dir = makeTempDir();
    const wiki = openWikiWorkspace(dir);
    wiki.appendPattern({ title: "Valid", body: "keep me" });
    fs.writeFileSync(
      path.join(dir, "patterns", "unknown-field.md"),
      [
        "---",
        "title: Has extra",
        "created: 2026-09-21T00:00:00.000Z",
        "updated: 2026-09-21T00:00:00.000Z",
        "origin: ~",
        "extra: unexpected",
        "---",
        "",
        "body",
      ].join("\n"),
      "utf8",
    );
    // 未知 key = 当前版本无法接受的页：整页丢弃，不清洗字段（codex 复核 P2）。
    expect(wiki.listPatterns().map((item) => item.name)).toEqual(["valid"]);
  });

  it("rebuildIndex regenerates index.md from the patterns directory", () => {
    const dir = makeTempDir();
    const wiki = openWikiWorkspace(dir);
    wiki.appendPattern({ title: "One", body: "1" });
    wiki.appendPattern({ title: "Two", body: "2" });
    fs.writeFileSync(path.join(dir, "index.md"), "stale index\n", "utf8");
    wiki.rebuildIndex();
    const index = fs.readFileSync(path.join(dir, "index.md"), "utf8");
    expect(index).toContain("one — One");
    expect(index).toContain("two — Two");
    expect(index).not.toContain("stale");
  });
});

describe("WikiWorkspace edit, remove, and raw read", () => {
  it("editPattern applies anchored edits to the body, bumps updated, and keeps frontmatter", () => {
    const dir = makeTempDir();
    const wiki = openWikiWorkspace(dir);
    const first = wiki.appendPattern({
      title: "Gate exits",
      body: "Branch on exit code, never on piped stdout.",
    });
    const edited = wiki.editPattern("gate-exits", [
      { op: "replace", target: "piped stdout", content: "tail output" },
      { op: "append", content: "\nAlways use pipefail." },
    ]);
    expect(edited.item.name).toBe("gate-exits");
    expect(edited.item.contentHash).not.toBe(first.item.contentHash);

    const read = wiki.readPattern("gate-exits");
    expect(read.body).toContain("never on tail output.");
    expect(read.body).toContain("Always use pipefail.");
    expect(read.frontmatter.title).toBe("Gate exits");
    expect(read.frontmatter.updated >= first.item.updated).toBe(true);

    const index = fs.readFileSync(path.join(dir, "index.md"), "utf8");
    expect(index).toContain("gate-exits — Gate exits");
  });

  it("editPattern fails atomically when any anchor misses (zero changes)", () => {
    const dir = makeTempDir();
    const wiki = openWikiWorkspace(dir);
    wiki.appendPattern({ title: "Stable", body: "keep this line\nand this one\n" });
    const before = fs.readFileSync(path.join(dir, "patterns", "stable.md"), "utf8");
    try {
      wiki.editPattern("stable", [
        { op: "replace", target: "keep this line", content: "changed" },
        { op: "replace", target: "NO_SUCH_ANCHOR", content: "boom" },
      ]);
      expect.unreachable("must throw");
    } catch (error) {
      expect((error as SkillWikiError).code).toBe("WIKI_PATCH_FAILED");
    }
    const after = fs.readFileSync(path.join(dir, "patterns", "stable.md"), "utf8");
    expect(after).toBe(before);
  });

  it("removePattern deletes the page and rebuilds the index; unknown names typed-fail", () => {
    const dir = makeTempDir();
    const wiki = openWikiWorkspace(dir);
    wiki.appendPattern({ title: "Doomed", body: "bye" });
    wiki.removePattern("doomed");
    expect(wiki.listPatterns()).toEqual([]);
    expect(fs.existsSync(path.join(dir, "patterns", "doomed.md"))).toBe(false);
    expect(fs.readFileSync(path.join(dir, "index.md"), "utf8")).not.toContain("doomed");
    try {
      wiki.removePattern("doomed");
      expect.unreachable("must throw");
    } catch (error) {
      expect((error as SkillWikiError).code).toBe("WIKI_INVALID_PATTERN");
    }
  });

  it("readPatternRaw returns the on-disk bytes", () => {
    const dir = makeTempDir();
    const wiki = openWikiWorkspace(dir);
    wiki.appendPattern({ title: "Raw", body: "line\n" });
    const raw = wiki.readPatternRaw("raw");
    expect(raw.startsWith("---\n")).toBe(true);
    expect(raw).toContain("title: Raw");
    expect(raw).toContain("line");
  });

  it("readLogLines returns appended lines in order and tolerates a missing file", () => {
    const wiki = openWikiWorkspace(makeTempDir());
    expect(wiki.readLogLines()).toEqual([]);
    wiki.appendLog("first event");
    wiki.appendLog("second event");
    expect(wiki.readLogLines()).toHaveLength(2);
    expect(wiki.readLogLines()[1]).toMatch(/second event$/);
  });
});

describe("WikiWorkspace logs and impact", () => {
  it("appendLog appends timestamped lines to logs.md", () => {
    const dir = makeTempDir();
    const wiki = openWikiWorkspace(dir);
    wiki.appendLog("first event");
    wiki.appendLog("second event");
    const logs = fs.readFileSync(path.join(dir, "logs.md"), "utf8");
    const lines = logs.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^- \S+ first event$/);
    expect(lines[1]).toMatch(/^- \S+ second event$/);
  });

  it("appendImpact/listImpact round-trip and malformed lines are dropped", () => {
    const dir = makeTempDir();
    const wiki = openWikiWorkspace(dir);
    const entry = {
      date: "2026-09-21T00:00:00.000Z",
      proposal: { action: "create", skill: "exit-code-gating", summary: "add gating" },
      decision: "accept" as const,
      reason: "score 0.4000 -> 0.5000 (+0.1000), strict improvement",
    };
    wiki.appendImpact(entry);
    expect(wiki.listImpact()).toEqual([entry]);

    fs.appendFileSync(path.join(dir, "skill-impact.md"), "not json\n", "utf8");
    fs.appendFileSync(
      path.join(dir, "skill-impact.md"),
      JSON.stringify({ wrong: "shape" }) + "\n",
      "utf8",
    );
    expect(wiki.listImpact()).toEqual([entry]);
  });

  it("appendImpact rejects entries that fail the schema", () => {
    const wiki = openWikiWorkspace(makeTempDir());
    try {
      wiki.appendImpact({
        date: "",
        proposal: { action: "create", skill: "s", summary: "m" },
        decision: "accept",
        reason: "r",
      });
      expect.unreachable("must throw");
    } catch (error) {
      expect((error as SkillWikiError).code).toBe("WIKI_INVALID_PATTERN");
    }
  });
});

describe("wikiPatternSummary (read-only projection, codex r1 P1/r2 P2)", () => {
  it("counts valid pattern pages without creating any directory", () => {
    const workspace = makeTempDir();
    const wikiDir = workspaceWikiDirectory(workspace);
    fs.mkdirSync(wikiDir, { recursive: true });
    // 部分初始化：root 存在、patterns/ 缺失 → 计数 0 且绝不 mkdir。
    expect(wikiPatternSummary(wikiDir)).toEqual({ patternCount: 0, lastUpdated: null });
    expect(fs.existsSync(path.join(wikiDir, "patterns"))).toBe(false);
    expect(wikiPatternSummary(path.join(workspace, "not-initialized"))).toEqual({
      patternCount: 0,
      lastUpdated: null,
    });
    expect(fs.existsSync(path.join(workspace, "not-initialized"))).toBe(false);
  });

  it("matches listPatterns semantics (malformed pages dropped)", () => {
    const workspace = makeTempDir();
    const wiki = openWikiWorkspace(workspaceWikiDirectory(workspace));
    wiki.appendPattern({ title: "One", body: "first" });
    wiki.appendPattern({ title: "Two", body: "second" });
    // 畸形页：无 frontmatter——listPatterns 丢弃，计数同语义丢弃。
    fs.writeFileSync(path.join(wikiDirOf(workspace), "patterns", "broken.md"), "no frontmatter\n");
    // 非法文件名页（codex r2 P2 复现向量）：frontmatter 合法但文件名不过
    // PatternNameSchema——listPatterns 丢弃，计数必须同弃（计数/列表不漂移）。
    const legal = fs.readFileSync(path.join(wikiDirOf(workspace), "patterns", "one.md"), "utf8");
    fs.writeFileSync(path.join(wikiDirOf(workspace), "patterns", "Bad_Name.md"), legal);
    const listed = openWikiWorkspace(wikiDirOf(workspace)).listPatterns();
    expect(listed).toHaveLength(2);
    const summary = wikiPatternSummary(wikiDirOf(workspace));
    expect(summary.patternCount).toBe(2);
    // lastUpdated = 成员 pattern 的 frontmatter updated 最大值（非法名/畸形页不计入）。
    const listedUpdates = listed.map((item) => item.updated).sort();
    expect(summary.lastUpdated).toBe(listedUpdates.at(-1));
  });

  it("maps unreadable patterns directory to typed WIKI_IO, not zero", () => {
    if (process.platform === "win32") return; // chmod 对 Windows ACL 无效
    const workspace = makeTempDir();
    const wikiDir = workspaceWikiDirectory(workspace);
    fs.mkdirSync(path.join(wikiDir, "patterns"), { recursive: true });
    fs.chmodSync(path.join(wikiDir, "patterns"), 0o000);
    try {
      wikiPatternSummary(wikiDir);
      expect.unreachable("unreadable patterns dir must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(SkillWikiError);
      expect((error as SkillWikiError).code).toBe("WIKI_IO");
    } finally {
      fs.chmodSync(path.join(wikiDir, "patterns"), 0o700);
    }
  });
});

function wikiDirOf(workspace: string): string {
  return workspaceWikiDirectory(workspace);
}
