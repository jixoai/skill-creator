// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { readDevicePrefs, updateDevicePrefs } from "../device-prefs.js";

beforeEach(() => localStorage.clear());

describe("Agent layout device preferences", () => {
  it("defaults an older valid preference payload and stores the expanded tree width", () => {
    localStorage.setItem(
      "skill-creator:device-prefs",
      JSON.stringify({ version: 1, theme: "dark", sidebarCollapsed: true }),
    );
    expect(readDevicePrefs().agentTreeWidth).toBe(264);

    updateDevicePrefs({ agentTreeWidth: 420 });
    expect(readDevicePrefs().agentTreeWidth).toBe(420);
  });

  it("rejects corrupt geometry to defaults and keeps the terminal auto-size sentinel", () => {
    localStorage.setItem(
      "skill-creator:device-prefs",
      JSON.stringify({ version: 1, agentTreeWidth: 100, agentTerminalHeight: 0 }),
    );
    expect(readDevicePrefs().agentTreeWidth).toBe(264);
    expect(readDevicePrefs().agentTerminalHeight).toBe(0);

    localStorage.setItem(
      "skill-creator:device-prefs",
      JSON.stringify({ version: 1, agentTreeWidth: 264, agentTerminalHeight: 0 }),
    );
    expect(readDevicePrefs().agentTerminalHeight).toBe(0);
  });
});
