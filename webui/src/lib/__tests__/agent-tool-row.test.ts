/**
 * AgentToolRow payload 三面收窄单测（2026-09-12 codex 阻塞 5 / PM 修复 4）。
 *
 * 用户原始需求 [2026-09-12]：「工具行 payload（args/result/uiCard）均直接 cast
 * 驱动渲染」——改为最小 Zod schema safeParse，失败退化为纯文本渲染；diff 行
 * +绿/-红 着色为纯展示启发式。
 *
 * 正交意图：
 *   [1] argsText：malformed JSON / 非 record JSON → null（退纯文本）；流式前缀
 *       正则提取保持既有行为。
 *   [2] result/uiCard/proposed：字符串、content blocks、record 三态收窄与回退。
 *   [3] diff 行着色：^[-+](?![-+]) 命中规则与 +++/--- 头排除。
 */
import { describe, expect, it, vi } from "vitest";

// node 环境替身（route-match.test.ts 同法）：lucide node_modules 的 .svelte 源
// 不经 svelte 插件编译；子组件链（AgentCard 的 $app/navigation、ProposalCard 的
// RPC 面）与被测纯函数无关，以 stub 隔离——本测试只测 module 侧导出的收窄函数。
const iconStub = vi.hoisted(() => ({ default: {} }));
vi.mock("@lucide/svelte/icons/terminal", () => iconStub);
vi.mock("@lucide/svelte/icons/file-text", () => iconStub);
vi.mock("@lucide/svelte/icons/image", () => iconStub);
vi.mock("@lucide/svelte/icons/wrench", () => iconStub);
vi.mock("../components/agent/DisclosureRow.svelte", () => ({ default: {} }));
vi.mock("../components/agent/AgentCard.svelte", () => ({ default: {} }));
vi.mock("../components/agent/AgentProposalCard.svelte", () => ({ default: {} }));

import {
  diffLineClass,
  parseToolArgsRecord,
  parseToolProposalResult,
  projectToolErrorLine,
  projectToolResultText,
  todoSummaryOf,
  toolUiCardRefOf,
} from "../components/agent/AgentToolRow.svelte";

describe("parseToolArgsRecord (codex 阻塞 5)", () => {
  it("parses complete JSON objects into loose records", () => {
    expect(parseToolArgsRecord('{"command":"ls","n":3}')).toEqual({ command: "ls", n: 3 });
  });

  it("narrows non-record JSON (array/number/string literal) to null", () => {
    expect(parseToolArgsRecord("[1,2]")).toBeNull();
    expect(parseToolArgsRecord("42")).toBeNull();
    expect(parseToolArgsRecord('"text"')).toBeNull();
    expect(parseToolArgsRecord("null")).toBeNull();
    expect(parseToolArgsRecord("true")).toBeNull();
  });

  it("falls back to the streaming-prefix regex for malformed JSON (§4.1 preserved)", () => {
    // 末串未闭合的流式前缀：已知键名渐进提取，行为与收窄前一致。
    expect(parseToolArgsRecord('{"command":"ls -la')).toEqual({ command: "ls -la" });
    expect(parseToolArgsRecord('{"file_path":"/tmp/a.md","description":"read')).toEqual({
      file_path: "/tmp/a.md",
      description: "read",
    });
  });

  it("returns null for malformed JSON without known keys and for empty input", () => {
    expect(parseToolArgsRecord("{oops}")).toBeNull();
    expect(parseToolArgsRecord("")).toBeNull();
    expect(parseToolArgsRecord(undefined)).toBeNull();
  });
});

describe("projectToolResultText (codex 阻塞 5)", () => {
  it("passes strings through directly", () => {
    expect(projectToolResultText("plain text")).toBe("plain text");
  });

  it("joins content-block texts", () => {
    const result = {
      content: [
        { type: "text", text: "line one" },
        { type: "image", alt: "x" },
        { type: "text", text: "line two" },
      ],
    };
    expect(projectToolResultText(result)).toBe("line one\nline two");
  });

  it("falls back to JSON text for records, arrays, and schema-incompatible shapes", () => {
    expect(projectToolResultText({ ok: true })).toBe('{\n  "ok": true\n}');
    expect(projectToolResultText([1, 2])).toBe("[\n  1,\n  2\n]");
    expect(projectToolResultText(3.14)).toBe("3.14");
    expect(projectToolResultText(undefined)).toBe("");
    // content 块无 text：回退 JSON 化（纯文本兜底永不缺席）。
    expect(projectToolResultText({ content: [{ type: "image" }] })).toContain("image");
  });
});

describe("parseToolProposalResult", () => {
  it("projects proposed results with capability/status fallbacks", () => {
    expect(parseToolProposalResult({ kind: "proposed", proposalId: "p1" }, "bash")).toEqual({
      proposalId: "p1",
      capability: "bash",
      status: "pending",
    });
    expect(
      parseToolProposalResult(
        { kind: "proposed", proposalId: "p2", capability: "cap", status: "approved" },
        "bash",
      ),
    ).toEqual({ proposalId: "p2", capability: "cap", status: "approved" });
  });

  it("rejects non-proposed or malformed payloads", () => {
    expect(parseToolProposalResult({ kind: "other", proposalId: "p1" }, "bash")).toBeNull();
    expect(parseToolProposalResult({ kind: "proposed" }, "bash")).toBeNull();
    expect(parseToolProposalResult("proposed", "bash")).toBeNull();
    expect(parseToolProposalResult(undefined, "bash")).toBeNull();
  });
});

describe("toolUiCardRefOf (codex 阻塞 5)", () => {
  it("parses uiCard refs from string payloads with title defaulting to Card", () => {
    expect(toolUiCardRefOf('{"uiCard":{"resourceUri":"ui://x"}}')).toEqual({
      resourceUri: "ui://x",
      title: "Card",
    });
    expect(toolUiCardRefOf('{"uiCard":{"resourceUri":"ui://x","title":"T"}}')).toEqual({
      resourceUri: "ui://x",
      title: "T",
    });
  });

  it("finds refs embedded in content-block text", () => {
    const result = { content: [{ type: "text", text: '{"uiCard":{"resourceUri":"ui://y"}}' }] };
    expect(toolUiCardRefOf(result)).toEqual({ resourceUri: "ui://y", title: "Card" });
  });

  it("returns null for malformed JSON, non-ref JSON, and shape mismatches", () => {
    expect(toolUiCardRefOf("not json")).toBeNull();
    expect(toolUiCardRefOf('{"other":1}')).toBeNull();
    expect(toolUiCardRefOf('{"uiCard":{"title":"no uri"}}')).toBeNull();
    expect(toolUiCardRefOf('{"uiCard":{"resourceUri":""}}')).toBeNull();
    expect(toolUiCardRefOf(undefined)).toBeNull();
  });

  it("narrows content blocks via schema: malformed blocks drop, valid siblings survive (codex R2 阻塞 3)", () => {
    // 畸形 block（text 非字符串 / 非 object / null）逐条丢弃，不再旁路 cast 直读。
    const result = {
      content: [
        { type: "text", text: '{"uiCard":{"resourceUri":"ui://mixed"}}' },
        { type: "text", text: 42 },
        "not-an-object",
        null,
      ],
    };
    expect(toolUiCardRefOf(result)).toEqual({ resourceUri: "ui://mixed", title: "Card" });
  });

  it("treats non-array content and primitive payloads as having no block candidates", () => {
    expect(toolUiCardRefOf({ content: "oops" })).toBeNull();
    expect(toolUiCardRefOf({ content: { nested: true } })).toBeNull();
    expect(toolUiCardRefOf(42)).toBeNull();
  });
});

describe("diffLineClass (PM 修复 4)", () => {
  it("marks single +/- diff lines with 10% emerald/rose backgrounds", () => {
    expect(diffLineClass("+added line")).toBe("bg-emerald-500/10");
    expect(diffLineClass("-removed line")).toBe("bg-rose-500/10");
  });

  it("leaves diff headers (+++/---) and context lines unstyled", () => {
    expect(diffLineClass("+++ b/file.txt")).toBe("");
    expect(diffLineClass("--- a/file.txt")).toBe("");
    expect(diffLineClass(" context line")).toBe("");
    expect(diffLineClass("@@ -1,2 +1,3 @@")).toBe("");
    expect(diffLineClass("")).toBe("");
  });
});

describe("todoSummaryOf (codex R2 阻塞 3)", () => {
  it("summarizes valid todo arrays with completed counts (plural/singular)", () => {
    expect(
      todoSummaryOf([
        { content: "a", status: "completed" },
        { content: "b", status: "pending" },
      ]),
    ).toBe("2 todos · 1 done");
    expect(todoSummaryOf([{ content: "a", status: "completed" }])).toBe("1 todo · 1 done");
    expect(todoSummaryOf([])).toBe("0 todos · 0 done");
  });

  it("counts malformed entries toward total but never as done", () => {
    // 畸形条目（null / 字符串 / status 非字符串）不进 done 计数，也不抛。
    expect(todoSummaryOf([null, "completed", { status: 42 }, { status: "completed" }])).toBe(
      "4 todos · 1 done",
    );
    expect(todoSummaryOf([{ content: "only" }])).toBe("1 todo · 0 done");
  });

  it("returns null for non-array todo payloads (falls through to the generic summary)", () => {
    expect(todoSummaryOf(undefined)).toBeNull();
    expect(todoSummaryOf("not-array")).toBeNull();
    expect(todoSummaryOf({ todos: [] })).toBeNull();
  });
});

describe("projectToolErrorLine (codex R2 阻塞 3)", () => {
  it("projects the first line of a non-empty error envelope string", () => {
    expect(projectToolErrorLine({ error: "boom" }, "fallback")).toBe("boom");
    expect(projectToolErrorLine({ error: "boom\nstack trace" }, "fallback")).toBe("boom");
    expect(projectToolErrorLine({ error: "  padded  " }, "fallback")).toBe("padded");
  });

  it("keeps whitespace-only error strings as empty lines (pre-narrowing equivalence)", () => {
    expect(projectToolErrorLine({ error: "   " }, "fallback")).toBe("");
  });

  it("falls back to the result-text first line (truncated at 80ch) for malformed envelopes", () => {
    expect(projectToolErrorLine({ error: 42 }, "first\nsecond")).toBe("first");
    expect(projectToolErrorLine({ error: "" }, "first")).toBe("first");
    expect(projectToolErrorLine("plain string result", "from text")).toBe("from text");
    expect(projectToolErrorLine(undefined, "x".repeat(100))).toBe(`${"x".repeat(80)}…`);
    expect(projectToolErrorLine(null, "short")).toBe("short");
  });
});
