/**
 * SKILL.md → SearchDocument 解析器测试。
 *
 * User input [2026-09-17]: "无效 frontmatter 不弃文档：name 回退目录名、description 置空、
 * invalidFrontmatter=true；keywords/triggers 只接受 string|string[]；body 截 12k。"
 *
 * Orthogonal intents:
 *   [1] frontmatter 容错（合法/缺失/无效回退）。
 *   [2] keywords/triggers 收窄与 markdown-to-search-text（fence 剥离、12k 截断、headings）。
 */
import { describe, expect, it } from "vitest";
import { parseSkillDocument, PARSER_VERSION } from "../src/daemon/skill-search/parser.js";

function documentOf(frontmatter: string, body: string): Buffer {
  return Buffer.from(`---\n${frontmatter}---\n${body}`, "utf8");
}

describe("skill search parser", () => {
  it("extracts valid frontmatter fields", () => {
    const parsed = parseSkillDocument(
      documentOf(
        'name: react-component-design\ndescription: "Design React components."\nkeywords:\n  - react\n  - component\ntriggers: design a component\n',
        "# Guide\nUse composition.",
      ),
      "fallback-dir",
    );
    expect(parsed.name).toBe("react-component-design");
    expect(parsed.description).toBe("Design React components.");
    expect(parsed.keywords).toEqual(["react", "component"]);
    expect(parsed.triggers).toEqual(["design a component"]);
    expect(parsed.invalidFrontmatter).toBe(false);
    expect(parsed.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("falls back to directory name and empty description without frontmatter", () => {
    const parsed = parseSkillDocument(
      Buffer.from("# Only a body\n", "utf8"),
      "no-frontmatter-skill",
    );
    expect(parsed.name).toBe("no-frontmatter-skill");
    expect(parsed.description).toBe("");
    expect(parsed.invalidFrontmatter).toBe(true);
    expect(parsed.body).toContain("# Only a body");
  });

  it("falls back when frontmatter misses min-1 name or description", () => {
    const missingDescription = parseSkillDocument(
      documentOf("name: named-only\n", "body"),
      "named-dir",
    );
    expect(missingDescription.invalidFrontmatter).toBe(true);
    expect(missingDescription.name).toBe("named-dir");
    expect(missingDescription.description).toBe("");

    const emptyName = parseSkillDocument(
      documentOf('name: ""\ndescription: "valid"\n', "body"),
      "empty-name-dir",
    );
    expect(emptyName.invalidFrontmatter).toBe(true);
    expect(emptyName.name).toBe("empty-name-dir");
  });

  it("narrows keywords and triggers from string, string[], and drops other entry types", () => {
    const single = parseSkillDocument(
      documentOf("name: a\ndescription: d\nkeywords: single\ntriggers: one\n", "b"),
      "dir",
    );
    expect(single.keywords).toEqual(["single"]);
    expect(single.triggers).toEqual(["one"]);

    const mixed = parseSkillDocument(
      documentOf(
        "name: a\ndescription: d\nkeywords:\n  - keep\n  - 42\n  - null\ntriggers: []\n",
        "b",
      ),
      "dir",
    );
    expect(mixed.keywords).toEqual(["keep"]);
    expect(mixed.triggers).toEqual([]);

    const wrongType = parseSkillDocument(
      documentOf("name: a\ndescription: d\nkeywords:\n  map: nope\n", "b"),
      "dir",
    );
    expect(wrongType.keywords).toEqual([]);
  });

  it("strips code fence delimiter lines but keeps code identifiers in the body", () => {
    const parsed = parseSkillDocument(
      documentOf(
        "name: a\ndescription: d\n",
        "before\n```bash\nnpm install minisearch\n```\nafter\n",
      ),
      "dir",
    );
    expect(parsed.body).toContain("npm install minisearch");
    expect(parsed.body).not.toContain("```");
    expect(parsed.body).not.toContain("bash");
    expect(parsed.body).toContain("before");
    expect(parsed.body).toContain("after");
  });

  it("truncates the body at 12000 chars and caps headings at 30", () => {
    const headings = Array.from({ length: 40 }, (_, index) => `## heading-${index}`).join("\n");
    const longBody = `${headings}\n${"x".repeat(20_000)}`;
    const parsed = parseSkillDocument(documentOf("name: a\ndescription: d\n", longBody), "dir");
    expect(parsed.body.length).toBe(12_000);
    expect(parsed.headings.split("\n")).toHaveLength(30);
    expect(parsed.headings.split("\n")[0]).toBe("heading-0");
    expect(parsed.headings.split("\n")[29]).toBe("heading-29");
  });

  it("collects atx headings up to level 4 into the headings field", () => {
    const parsed = parseSkillDocument(
      documentOf("name: a\ndescription: d\n", "# one\n## two\n### three\n#### four\n##### five\n"),
      "dir",
    );
    expect(parsed.headings.split("\n")).toEqual(["one", "two", "three", "four"]);
  });

  it("freezes the parser version", () => {
    expect(PARSER_VERSION).toBe("matter-mdset-v2");
  });

  it("treats malformed yaml frontmatter as invalid frontmatter, keeping the raw text as body", () => {
    const malformed = Buffer.from("---\nname: [unclosed\ndescription: (\n---\n# body\n", "utf8");
    const parsed = parseSkillDocument(malformed, "malformed-dir");
    expect(parsed.invalidFrontmatter).toBe(true);
    expect(parsed.name).toBe("malformed-dir");
    // gray-matter 对畸形 YAML 会抛错：全文退化为 body，文档不弃。
    expect(parsed.body.length).toBeGreaterThan(0);
  });
});

describe("skill search parser fence semantics", () => {
  it("does not collect atx text inside fenced code blocks as headings", () => {
    const text = [
      "---",
      "name: fence-demo",
      "description: fenced heading demo",
      "---",
      "```markdown",
      "# fake heading",
      "```",
      "",
      "# real heading",
    ].join("\n");
    const parsed = parseSkillDocument(Buffer.from(text, "utf8"), "fence-demo");
    expect(parsed.headings.split("\n")).toEqual(["real heading"]);
  });
});
