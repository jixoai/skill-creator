/**
 * 用户原始需求 [2026-07-27]：「`marked` 默认转义 HTML；在测试中加一条「body 含 `<script>` 时不出现在输出中」的断言」。
 * 正交意图：[1] 验证 frontmatter 切分；[2] 验证 markdown body 渲染；[3] 验证 `<script>` 注入被阻断。
 */
import { describe, expect, it } from "vitest";
import { renderSkillBody, splitSkillContent } from "../render-skill-md.js";

describe("splitSkillContent", () => {
  it("splits a well-formed frontmatter block and body", () => {
    const content = "---\nname: My Skill\ndescription: Hello world\n---\n# Title\n\nBody text.";
    const { frontmatter, body } = splitSkillContent(content);
    expect(frontmatter).toEqual({ name: "My Skill", description: "Hello world" });
    expect(body).toBe("# Title\n\nBody text.");
  });

  it("preserves unknown passthrough frontmatter keys", () => {
    const content = "---\nname: x\ndescription: y\nlicense: MIT\nversion: 2\n---\nbody";
    const { frontmatter } = splitSkillContent(content);
    expect(frontmatter).toEqual({ name: "x", description: "y", license: "MIT", version: "2" });
  });

  it("treats content without frontmatter fence as body only", () => {
    const content = "# Just a title\n\ntext";
    const { frontmatter, body } = splitSkillContent(content);
    expect(frontmatter).toEqual({});
    expect(body).toBe(content);
  });

  it("treats unclosed frontmatter fence as body only (safe fallback)", () => {
    const content = "---\nname: dangling\nthis is not closed";
    const { frontmatter, body } = splitSkillContent(content);
    expect(frontmatter).toEqual({});
    expect(body).toBe(content);
  });

  it("strips surrounding quotes from scalar values", () => {
    const content = "---\nname: \"Quoted\"\ndescription: 'Single'\n---\nbody";
    const { frontmatter } = splitSkillContent(content);
    expect(frontmatter).toEqual({ name: "Quoted", description: "Single" });
  });

  it("returns empty body for empty content", () => {
    const { frontmatter, body } = splitSkillContent("");
    expect(frontmatter).toEqual({});
    expect(body).toBe("");
  });
});

describe("splitSkillContent block scalars (ux-polish-walkthrough-residue #1)", () => {
  it("unfolds a `>-` folded scalar into one joined paragraph (no trailing newline)", () => {
    const content =
      "---\nname: My Skill\ndescription: >-\n  One long line that\n  wraps across source lines.\n---\nbody";
    const { frontmatter, body } = splitSkillContent(content);
    expect(frontmatter.description).toBe("One long line that wraps across source lines.");
    expect(frontmatter.name).toBe("My Skill");
    expect(body).toBe("body");
  });

  it("keeps paragraph breaks (blank lines) as newlines inside folded scalars", () => {
    const content = "---\ndescription: >-\n  First paragraph.\n\n  Second paragraph.\n---\n";
    const { frontmatter } = splitSkillContent(content);
    expect(frontmatter.description).toBe("First paragraph.\nSecond paragraph.");
  });

  it("applies clip chomping to plain `>` (single trailing newline)", () => {
    const content = "---\ndescription: >\n  folded text\n---\n";
    const { frontmatter } = splitSkillContent(content);
    expect(frontmatter.description).toBe("folded text\n");
  });

  it("keeps literal `|-` line breaks without a trailing newline", () => {
    const content = "---\ndescription: |-\n  line one\n  line two\n---\n";
    const { frontmatter } = splitSkillContent(content);
    expect(frontmatter.description).toBe("line one\nline two");
  });

  it("applies clip chomping to plain `|` (single trailing newline)", () => {
    const content = "---\ndescription: |\n  line one\n  line two\n---\n";
    const { frontmatter } = splitSkillContent(content);
    expect(frontmatter.description).toBe("line one\nline two\n");
  });

  it("resumes `key: value` parsing on the line that terminates a block scalar", () => {
    const content = "---\nname: My Skill\ndescription: >-\n  folded body\nlicense: MIT\n---\n# Doc";
    const { frontmatter } = splitSkillContent(content);
    expect(frontmatter.description).toBe("folded body");
    expect(frontmatter.license).toBe("MIT");
  });

  it("treats a block scalar header with no indented content as empty string", () => {
    const content = "---\ndescription: >-\nname: still-parsed\n---\n";
    const { frontmatter } = splitSkillContent(content);
    expect(frontmatter.description).toBe("");
    expect(frontmatter.name).toBe("still-parsed");
  });

  it("supports keep chomping (`|+`) preserving trailing blank lines", () => {
    const content = "---\ndescription: |+\n  line one\n\n\n---\n";
    const { frontmatter } = splitSkillContent(content);
    expect(frontmatter.description).toBe("line one\n\n\n");
  });
});

describe("renderSkillBody", () => {
  it("renders headings, lists, code blocks, and emphasis", () => {
    const body = "## Title\n\n- one\n- two\n\n**bold** and _italics_\n\n```\ncode block\n```";
    const html = renderSkillBody(body);
    expect(html).toContain("<h2");
    expect(html).toContain("<ul");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italics</em>");
    expect(html).toContain("<pre><code");
  });

  it("escapes a raw <script> tag so it is not injected as executable HTML", () => {
    const body = "<script>alert(1)</script>";
    const html = renderSkillBody(body);
    expect(html.toLowerCase()).not.toContain("<script");
  });

  it("strips a <script> tag that survives inside rendered HTML", () => {
    // 即使渲染器把某些片段保留为 HTML，兜底 sanitizer 也必须移除 <script>。
    const body = "<script>alert('xss')</script>";
    const html = renderSkillBody(body);
    expect(html).not.toMatch(/<script\b/i);
  });

  it("renders an empty string for empty body", () => {
    expect(renderSkillBody("")).toBe("");
  });

  it("renders a link as an anchor", () => {
    const html = renderSkillBody("[docs](https://example.com/docs)");
    expect(html).toContain('<a href="https://example.com/docs"');
  });
});
