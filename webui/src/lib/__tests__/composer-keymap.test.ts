/**
 * Composer 键位内核单测（openspec composer-capability-parity W1）。
 *
 * 用户指示 [2026-09-15]：「我们的 Agent Chat 输入框的能力，最好 100% 复刻官方
 * webui 的输入框能力的实现。」官方 keymap 语义（IME 守卫/粘贴消毒/占位符链）
 * 在本模块的可测内核上钉死。
 *
 * 正交意图：
 *   [1] IME 守卫判定序（isComposing → 229 → 宽限窗）。
 *   [2] 芯片占位字符消毒（外部文本不可伪造芯片）。
 *   [3] 占位符优先级链。
 */
import { describe, expect, it } from "vitest";
import {
  COMPOSITION_GRACE_MS,
  composerPlaceholder,
  containsChipPlaceholders,
  enterIsComposing,
  sanitizeComposerText,
} from "$lib/components/agent/composer-keymap.js";

describe("enterIsComposing (W1 IME guard)", () => {
  const now = 1_000_000;
  it("guards isComposing regardless of the composition window", () => {
    expect(enterIsComposing({ isComposing: true }, null, now)).toBe(true);
    expect(enterIsComposing({ isComposing: true }, now - 60_000, now)).toBe(true);
  });

  it("guards legacy keyCode 229", () => {
    expect(enterIsComposing({ isComposing: false, keyCode: 229 }, null, now)).toBe(true);
  });

  it("guards within the 10ms post-compositionend window (Safari ordering)", () => {
    expect(enterIsComposing({ isComposing: false, keyCode: 13 }, now - 5, now)).toBe(true);
    // 边界排他：正好满 10ms 时宽限窗已关。
    expect(
      enterIsComposing({ isComposing: false, keyCode: 13 }, now - (COMPOSITION_GRACE_MS - 1), now),
    ).toBe(true);
    expect(
      enterIsComposing({ isComposing: false, keyCode: 13 }, now - COMPOSITION_GRACE_MS, now),
    ).toBe(false);
  });

  it("does not guard outside the window or without composition history", () => {
    expect(enterIsComposing({ isComposing: false, keyCode: 13 }, now - 11, now)).toBe(false);
    expect(enterIsComposing({ isComposing: false, keyCode: 13 }, null, now)).toBe(false);
  });
});

describe("paste sanitization (W1)", () => {
  it("strips the official chip placeholder ranges", () => {
    expect(sanitizeComposerText("a\uE100b\uE11Dc\uFFFCd")).toBe("abcd");
    expect(sanitizeComposerText("plain text\nline2")).toBe("plain text\nline2");
  });

  it("detects placeholder presence to decide manual insertion", () => {
    expect(containsChipPlaceholders("x\uE101y")).toBe(true);
    expect(containsChipPlaceholders("x\uFFFCy")).toBe(true);
    expect(containsChipPlaceholders("clean")).toBe(false);
  });

  it("detection resets between calls (global regex lastIndex trap)", () => {
    containsChipPlaceholders("\uE100");
    expect(containsChipPlaceholders("clean")).toBe(false);
    expect(containsChipPlaceholders("clean")).toBe(false);
  });
});

describe("composerPlaceholder chain (W1)", () => {
  it("owner overrides everything", () => {
    expect(
      composerPlaceholder({
        owner: "Edit your message",
        disconnected: true,
        unavailable: true,
        modeLabel: "Create",
      }),
    ).toBe("Edit your message");
  });

  it("disconnected beats unavailable and mode", () => {
    expect(
      composerPlaceholder({ disconnected: true, unavailable: true, modeLabel: "Create" }),
    ).toBe("Reconnecting…");
  });

  it("unavailable beats mode", () => {
    expect(composerPlaceholder({ unavailable: true, modeLabel: "Create" })).toBe(
      "Agent unavailable",
    );
  });

  it("mode-specific copy falls back to default", () => {
    expect(composerPlaceholder({ modeLabel: "Create" })).toBe("Message the create agent…");
    expect(composerPlaceholder({})).toBe("Message the agent…");
    expect(composerPlaceholder({ modeLabel: null })).toBe("Message the agent…");
  });
});
