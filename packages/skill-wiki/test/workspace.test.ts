/**
 * 用户原始需求 [2026-09-21]：「global 能承载 workspace 泛化出来的 skill」+
 * 「P1 本质上是在收集一些碎片的认知……是 skill-wiki 输入的一部分」。
 * 正交意图：[1] 钉死双级 scope 目录契约与碎片追加的去重幂等；
 * [2] 钉死磁盘输入边界（畸形 pattern/impact 行丢弃、typed 失败、原子写）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SkillWikiError,
  openWikiWorkspace,
  parseWikiScope,
  patternContentHash,
  wikiScopeDirectory,
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

describe("scope", () => {
  it("accepts global `~` and canonical ws_<24-hex> ids", () => {
    expect(parseWikiScope("~")).toBe("~");
    expect(parseWikiScope("ws_" + "a".repeat(24))).toBe("ws_" + "a".repeat(24));
  });

  it("rejects other shapes with WIKI_INVALID_SCOPE", () => {
    for (const bad of ["", "home", "ws_abc", "ws_" + "a".repeat(23), "../escape"]) {
      try {
        parseWikiScope(bad);
        expect.unreachable(`must reject: ${bad}`);
      } catch (error) {
        expect(error).toBeInstanceOf(SkillWikiError);
        expect((error as SkillWikiError).code).toBe("WIKI_INVALID_SCOPE");
      }
    }
  });

  it("maps scopes into the appDir sidecar tree", () => {
    expect(wikiScopeDirectory("/app", "~")).toBe(path.join("/app", "wiki", "~"));
    expect(wikiScopeDirectory("/app", "ws_" + "0".repeat(24))).toBe(
      path.join("/app", "wiki", "ws_" + "0".repeat(24)),
    );
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
    wiki.appendPattern({
      title: "Round trip",
      body: "content here",
      origin: "ws_" + "b".repeat(24),
    });
    const read = wiki.readPattern("round-trip");
    expect(read.frontmatter.title).toBe("Round trip");
    expect(read.frontmatter.origin).toBe("ws_" + "b".repeat(24));
    expect(read.frontmatter.promotedFrom).toBeNull();
    expect(read.body.replace(/\n$/, "")).toBe("content here");
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
