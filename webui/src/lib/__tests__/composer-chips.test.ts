/**
 * composer 芯片纯函数面测试（composer-references C1）。
 *
 * 有序出现消费 / 边界判定 / 剪除 / 原子退格 / 绘制段投影——镜像绘制层与提交
 * 共用同一消费序（token 被编辑掉 = 引用失效不复活）。
 */
import { describe, expect, it } from "vitest";
import {
  activeDraftReferences,
  atomicChipBeforeCaret,
  findSkillTokens,
  paintSegments,
  resolveChipOccurrences,
  type ComposerReference,
} from "$lib/components/agent/composer-chips";

function ref(
  uid: number,
  token: string,
  target: string,
  kind: "file" | "session" = "file",
): ComposerReference {
  return { uid, kind, token, target, label: token.slice(1) };
}

describe("resolveChipOccurrences (C1)", () => {
  it("pairs registry references with in-text occurrences in order", () => {
    const refs = [ref(1, "@spec.md", "/a/spec.md"), ref(2, "@earlier", "agent-1", "session")];
    const hits = resolveChipOccurrences("see @spec.md and @earlier please", refs);
    expect(hits.map((hit) => hit.reference.uid)).toEqual([1, 2]);
    expect(hits[0]).toMatchObject({ start: 4, end: 12 });
    expect(hits[1]).toMatchObject({ start: 17, end: 25 });
  });

  it("consumes duplicate tokens in registry order per occurrence", () => {
    const refs = [ref(1, "@notes", "/a/notes.md"), ref(2, "@notes", "/b/notes.md")];
    const hits = resolveChipOccurrences("@notes then @notes", refs);
    expect(hits.map((hit) => hit.reference.target)).toEqual(["/a/notes.md", "/b/notes.md"]);
  });

  it("prunes references whose token no longer appears (edit kills the chip)", () => {
    const refs = [ref(1, "@spec.md", "/a/spec.md"), ref(2, "@gone", "/a/gone.md")];
    const hits = resolveChipOccurrences("only @spec.md remains", refs);
    expect(hits.map((hit) => hit.reference.uid)).toEqual([1]);
    expect(activeDraftReferences("only @spec.md remains", refs).map((item) => item.target)).toEqual(
      ["/a/spec.md"],
    );
  });

  it("requires a word boundary before the token (email@x.md is not a chip)", () => {
    const refs = [ref(1, "@x.md", "/a/x.md")];
    expect(resolveChipOccurrences("email@x.md", refs)).toHaveLength(0);
    expect(resolveChipOccurrences("@x.md at start", refs)).toHaveLength(1);
    expect(resolveChipOccurrences("after space @x.md", refs)).toHaveLength(1);
  });

  it("keeps working with plain text containing no tokens", () => {
    expect(resolveChipOccurrences("nothing here", [ref(1, "@a", "/a")])).toHaveLength(0);
  });
});

describe("atomicChipBeforeCaret (C1)", () => {
  const refs = [ref(1, "@spec.md", "/a/spec.md")];
  const text = "see @spec.md now";

  it("matches when the caret is exactly at the token end", () => {
    const hit = atomicChipBeforeCaret(
      text,
      "see @spec.md".length,
      resolveChipOccurrences(text, refs),
    );
    expect(hit?.reference.uid).toBe(1);
    expect(hit?.start).toBe(4);
  });

  it("does not match mid-token or after trailing space", () => {
    expect(atomicChipBeforeCaret(text, 10, resolveChipOccurrences(text, refs))).toBeNull();
    expect(
      atomicChipBeforeCaret(text, "see @spec.md ".length, resolveChipOccurrences(text, refs)),
    ).toBeNull();
  });
});

describe("paintSegments (C1)", () => {
  it("splits text into plain and chip segments with identical text", () => {
    const refs = [ref(1, "@spec.md", "/a/spec.md")];
    const segments = paintSegments(
      "see @spec.md now",
      resolveChipOccurrences("see @spec.md now", refs),
    );
    expect(segments).toEqual([
      { kind: "plain", text: "see " },
      { kind: "chip", text: "@spec.md", reference: refs[0] },
      { kind: "plain", text: " now" },
    ]);
  });

  it("returns a single plain segment when no chips resolve", () => {
    expect(paintSegments("plain only", [])).toEqual([{ kind: "plain", text: "plain only" }]);
  });
});

describe("findSkillTokens (C3 skill lexicon decoration)", () => {
  const skills = ["code-review", "deploy"];

  it("decorates /name tokens that hit the skills catalog", () => {
    const spans = findSkillTokens("use /code-review then /deploy now", skills);
    expect(spans).toEqual([
      { start: 4, end: 16, name: "code-review" },
      { start: 22, end: 29, name: "deploy" },
    ]);
  });

  it("requires a boundary after the token (/deployz does not decorate /deploy)", () => {
    expect(findSkillTokens("/deployz now", skills)).toEqual([]);
    expect(findSkillTokens("/deploy", skills)).toEqual([{ start: 0, end: 7, name: "deploy" }]);
  });

  it("ignores command and escaped tokens (//, ://, unknown /compact)", () => {
    expect(findSkillTokens("//code-review", skills)).toEqual([]);
    expect(findSkillTokens("see https://x.com/code-review", skills)).toEqual([]);
    expect(findSkillTokens("/compact now", skills)).toEqual([]);
  });

  it("returns empty without a catalog", () => {
    expect(findSkillTokens("/deploy", [])).toEqual([]);
  });

  it("merges reference chips and skill spans in paintSegments output", () => {
    const refs = [ref(1, "@spec.md", "/a/spec.md")];
    const text = "see @spec.md and /deploy now";
    const segments = paintSegments(
      text,
      resolveChipOccurrences(text, refs),
      findSkillTokens(text, skills),
    );
    expect(segments.map((segment) => segment.kind)).toEqual([
      "plain",
      "chip",
      "plain",
      "skill",
      "plain",
    ]);
    expect(segments[3]).toMatchObject({ kind: "skill", text: "/deploy", name: "deploy" });
  });
});
