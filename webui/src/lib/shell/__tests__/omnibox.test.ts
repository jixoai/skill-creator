import { describe, expect, it } from "vitest";
import {
  formatOmniboxUrl,
  historyAvailability,
  omniboxShortcut,
  parseOmniboxInput,
  rankPathCompletions,
} from "../omnibox.js";

describe("omnibox input parsing", () => {
  it("accepts local paths with or without the display scheme", () => {
    expect(parseOmniboxInput("/w/~/skills?q=agent")).toEqual({
      kind: "path",
      path: "/w/~/skills?q=agent",
    });
    expect(parseOmniboxInput("skill-creator://w/~/skills?q=agent")).toEqual({
      kind: "path",
      path: "/w/~/skills?q=agent",
    });
    expect(parseOmniboxInput("skill-creator://agent?session=s_1")).toEqual({
      kind: "path",
      path: "/agent?session=s_1",
    });
    expect(parseOmniboxInput("skill-creator://settings/model")).toEqual({
      kind: "path",
      path: "/settings/model",
    });
  });

  it("enters command mode only for a greater-than prefix", () => {
    expect(parseOmniboxInput("> creator")).toEqual({ kind: "command", query: "creator" });
    expect(parseOmniboxInput(">")).toEqual({ kind: "command", query: "" });
    expect(parseOmniboxInput("creator")).toEqual({
      kind: "invalid",
      reason: "malformed-path",
    });
  });

  it.each([
    "https://example.com",
    "skill-creator://other/path",
    "/w/~/skills#fragment",
    "/w/%ZZ/skills",
  ])("rejects unsupported or malformed input: %s", (input) => {
    expect(parseOmniboxInput(input)).toMatchObject({ kind: "invalid" });
  });

  it("formats paths as the copyable display scheme", () => {
    expect(formatOmniboxUrl("/w/~/skills?q=a")).toBe("skill-creator://w/~/skills?q=a");
    expect(formatOmniboxUrl("/agent")).toBe("skill-creator://agent");
  });
});

describe("omnibox suggestions and shortcuts", () => {
  it("ranks exact and path-prefix matches ahead of labels and substring matches", () => {
    const completions = [
      { path: "/w/~/wiki", label: "Wiki" },
      { path: "/w/~/skills", label: "Skills" },
      { path: "/w/~/skills/agents", label: "Agents" },
      { path: "/agent", label: "Agent" },
      { path: "/settings/model", label: "Model settings" },
    ];
    expect(rankPathCompletions("/w/~/skills", completions).map(({ path }) => path)).toEqual([
      "/w/~/skills",
      "/w/~/skills/agents",
    ]);
    expect(rankPathCompletions("model", completions)).toEqual([
      { path: "/settings/model", label: "Model settings" },
    ]);
  });

  it("maps focus and per-tab history shortcuts", () => {
    expect(omniboxShortcut({ key: "l", code: "KeyL", metaKey: true, ctrlKey: false })).toBe(
      "focus",
    );
    expect(omniboxShortcut({ key: "F6", code: "F6", metaKey: false, ctrlKey: false })).toBe(
      "focus",
    );
    expect(omniboxShortcut({ key: "[", code: "BracketLeft", metaKey: true, ctrlKey: false })).toBe(
      "back",
    );
    expect(omniboxShortcut({ key: "]", code: "BracketRight", metaKey: true, ctrlKey: false })).toBe(
      "forward",
    );
    expect(
      omniboxShortcut({
        key: "{",
        code: "BracketLeft",
        metaKey: true,
        ctrlKey: false,
        shiftKey: true,
      }),
    ).toBeNull();
    expect(omniboxShortcut({ key: "[", code: "BracketLeft", metaKey: false, ctrlKey: false })).toBe(
      null,
    );
  });

  it("maps settings and theme shortcuts while reserving shifted brackets for conversation switching", () => {
    expect(omniboxShortcut({ key: ",", code: "Comma", metaKey: true, ctrlKey: false })).toBe(
      "open-settings",
    );
    expect(
      omniboxShortcut({
        key: ",",
        code: "Comma",
        metaKey: false,
        ctrlKey: true,
      }),
    ).toBe("open-settings");
    expect(
      omniboxShortcut({
        key: "L",
        code: "KeyL",
        metaKey: true,
        ctrlKey: false,
        shiftKey: true,
      }),
    ).toBe("switch-theme");
    expect(
      omniboxShortcut({
        key: "{",
        code: "BracketLeft",
        metaKey: true,
        ctrlKey: false,
        shiftKey: true,
      }),
    ).toBeNull();
    expect(
      omniboxShortcut({
        key: "P",
        code: "KeyP",
        metaKey: true,
        ctrlKey: false,
        shiftKey: true,
      }),
    ).toBe("open-command-center");
    expect(
      omniboxShortcut({
        key: "p",
        code: "KeyP",
        metaKey: false,
        ctrlKey: true,
        shiftKey: true,
      }),
    ).toBe("open-command-center");
  });

  it("derives Back and Forward enabled states from the active stack cursor", () => {
    expect(historyAvailability({ entries: ["/a", "/b", "/c"], cursor: 1 })).toEqual({
      back: true,
      forward: true,
    });
    expect(historyAvailability({ entries: ["/a"], cursor: 0 })).toEqual({
      back: false,
      forward: false,
    });
    expect(historyAvailability(undefined)).toEqual({ back: false, forward: false });
  });
});
