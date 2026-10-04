/**
 * 终端 tab 纯模型单测（skills-agent-page-zcode-parity 2.1）——ZCode
 * terminalPanelState.ts / TerminalSession.tsx formatShellLabel / lib/path.ts
 * getPathLeaf 的逐函数对照。
 */
import { describe, expect, it } from "vitest";
import {
  TERMINAL_DEFAULT_WORKSPACE_KEY,
  formatShellLabel,
  formatTerminalTabTitle,
  nextSessionIndex,
  terminalPathLeaf,
} from "../terminal-tabs.js";

describe("formatShellLabel (ZCode TerminalSession.tsx:66-81)", () => {
  it("derives the last path segment, lowercased, .exe stripped", () => {
    expect(formatShellLabel("/bin/zsh")).toBe("zsh");
    expect(formatShellLabel("/usr/local/bin/fish")).toBe("fish");
    expect(formatShellLabel("C:\\Windows\\System32\\cmd.EXE")).toBe("cmd");
    expect(formatShellLabel("bash")).toBe("bash");
  });

  it("normalizes powershell variants to PowerShell", () => {
    expect(formatShellLabel("/usr/bin/pwsh")).toBe("PowerShell");
    expect(formatShellLabel("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")).toBe(
      "PowerShell",
    );
  });

  it("returns null for unknown shells and falls back to the raw string when empty-named", () => {
    expect(formatShellLabel(null)).toBeNull();
    expect(formatShellLabel("")).toBeNull();
    expect(formatShellLabel("/")).toBe("/");
  });
});

describe("terminalPathLeaf (ZCode lib/path.ts getPathLeaf)", () => {
  it("takes the last non-empty segment across separators", () => {
    expect(terminalPathLeaf("/x/myproj")).toBe("myproj");
    expect(terminalPathLeaf("C:\\Users\\me\\repo")).toBe("repo");
    expect(terminalPathLeaf("/x/trailing/")).toBe("trailing");
  });

  it("returns the input when no segments exist", () => {
    expect(terminalPathLeaf("")).toBe("");
    expect(terminalPathLeaf("///")).toBe("///");
  });
});

describe("formatTerminalTabTitle (ZCode terminalPanelState.ts:83-85)", () => {
  it("omits the suffix for the first session", () => {
    expect(formatTerminalTabTitle("myproj", 1)).toBe("myproj");
  });

  it("appends the workspace-local index otherwise", () => {
    expect(formatTerminalTabTitle("myproj", 2)).toBe("myproj 2");
    expect(formatTerminalTabTitle("myproj", 3)).toBe("myproj 3");
  });
});

describe("nextSessionIndex (ZCode getNextTerminalSessionIndex: minimal free hole)", () => {
  it("starts at 1", () => {
    expect(nextSessionIndex([])).toBe(1);
  });

  it("fills the smallest hole instead of monotonically increasing", () => {
    expect(nextSessionIndex([1, 2])).toBe(3);
    expect(nextSessionIndex([1, 3])).toBe(2);
    expect(nextSessionIndex([2])).toBe(1);
  });
});

describe("TERMINAL_DEFAULT_WORKSPACE_KEY", () => {
  it("matches the ZCode Terminal.tsx:49 fallback", () => {
    expect(TERMINAL_DEFAULT_WORKSPACE_KEY).toBe("__default__");
  });
});
