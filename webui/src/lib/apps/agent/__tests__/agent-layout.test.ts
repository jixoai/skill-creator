import { describe, expect, it } from "vitest";
import {
  AGENT_TREE_DEFAULT_WIDTH,
  agentRightPanelRatio,
  agentRightPanelWidth,
  clampAgentTreeWidth,
  matchAgentShellShortcut,
  maxAgentTreeWidth,
  resizeAgentTreeWidth,
} from "../agent-layout.js";

describe("Agent shell geometry", () => {
  it("matches ZCode's 264px sidebar default/minimum and half-width maximum", () => {
    expect(AGENT_TREE_DEFAULT_WIDTH).toBe(264);
    expect(clampAgentTreeWidth(100, 1200)).toBe(264);
    expect(clampAgentTreeWidth(900, 1200)).toBe(600);
    expect(maxAgentTreeWidth(1200)).toBe(600);
  });

  it("supports 16px, Home, and End sidebar keyboard resizing", () => {
    expect(resizeAgentTreeWidth(280, "ArrowLeft", 1200)).toBe(264);
    expect(resizeAgentTreeWidth(280, "ArrowRight", 1200)).toBe(296);
    expect(resizeAgentTreeWidth(400, "Home", 1200)).toBe(264);
    expect(resizeAgentTreeWidth(400, "End", 1200)).toBe(600);
    expect(resizeAgentTreeWidth(400, "Escape", 1200)).toBeNull();
  });

  it("resolves a 45% right pane while keeping 320px for chat and a 65% cap", () => {
    expect(agentRightPanelWidth(0.45, 800)).toBe(360);
    expect(agentRightPanelWidth(0.9, 800)).toBe(480);
    expect(agentRightPanelWidth(0.1, 800)).toBe(240);
    expect(agentRightPanelRatio(360, 800)).toBe(0.45);
  });
});

describe("ZCode shortcut mapping", () => {
  const key = (overrides: Partial<KeyboardEvent> = {}): KeyboardEvent =>
    ({
      key: "b",
      code: "KeyB",
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      ...overrides,
    }) as KeyboardEvent;

  it("maps Cmd on macOS and Ctrl elsewhere without accepting the other platform modifier", () => {
    expect(matchAgentShellShortcut(key({ metaKey: true }), "mac")).toBe("toggle-sidebar");
    expect(matchAgentShellShortcut(key({ ctrlKey: true }), "other")).toBe("toggle-sidebar");
    expect(matchAgentShellShortcut(key({ ctrlKey: true }), "mac")).toBeNull();
    expect(matchAgentShellShortcut(key({ metaKey: true }), "other")).toBeNull();
  });

  it("keeps terminal, pane, new-session and conversation shortcuts distinct", () => {
    expect(matchAgentShellShortcut(key({ key: "j", code: "KeyJ", metaKey: true }), "mac")).toBe(
      "toggle-terminal",
    );
    expect(
      matchAgentShellShortcut(key({ key: "b", code: "KeyB", altKey: true, metaKey: true }), "mac"),
    ).toBe("toggle-side-pane");
    expect(matchAgentShellShortcut(key({ key: "n", code: "KeyN", metaKey: true }), "mac")).toBe(
      "new-session",
    );
    expect(
      matchAgentShellShortcut(
        key({ key: "{", code: "BracketLeft", metaKey: true, shiftKey: true }),
        "mac",
      ),
    ).toBe("previous-session");
    expect(
      matchAgentShellShortcut(
        key({ key: "}", code: "BracketRight", metaKey: true, shiftKey: true }),
        "mac",
      ),
    ).toBe("next-session");
  });

  it("maps every Agent-owned ZCode binding on both supported command modifiers", () => {
    const bindings = [
      ["b", "KeyB", false, false, "toggle-sidebar"],
      ["j", "KeyJ", false, false, "toggle-terminal"],
      ["b", "KeyB", true, false, "toggle-side-pane"],
      ["n", "KeyN", false, false, "new-session"],
      ["{", "BracketLeft", false, true, "previous-session"],
      ["}", "BracketRight", false, true, "next-session"],
    ] as const;

    for (const [keyName, code, altKey, shiftKey, expected] of bindings) {
      expect(
        matchAgentShellShortcut(
          key({ key: keyName, code, metaKey: true, altKey, shiftKey }),
          "mac",
        ),
      ).toBe(expected);
      expect(
        matchAgentShellShortcut(
          key({ key: keyName, code, ctrlKey: true, altKey, shiftKey }),
          "other",
        ),
      ).toBe(expected);
    }
  });
});
