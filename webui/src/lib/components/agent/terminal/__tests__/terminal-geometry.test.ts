// @vitest-environment jsdom
/**
 * 终端面板几何纯函数单测（skills-agent-page-zcode-parity 2.2）——ZCode
 * AnimatedTerminalPanel minSize 140px / maxSize 50% / expandedSize 30%。
 * CmdOrCtrl+J 匹配不在此面：绑定真相 = apps/agent/agent-layout.ts
 * matchAgentShellShortcut（容器批），本模块不持第二份。
 */
import { describe, expect, it } from "vitest";
import {
  TERMINAL_DEFAULT_HEIGHT_RATIO,
  TERMINAL_KEYBOARD_STEP_PX,
  TERMINAL_MAX_HEIGHT_RATIO,
  TERMINAL_MIN_HEIGHT_PX,
  clampTerminalHeightPx,
  defaultTerminalHeightPx,
  terminalMaxHeightPx,
} from "../terminal-geometry.js";
import { AGENT_TERMINAL_MAX_HEIGHT, AGENT_TERMINAL_MIN_HEIGHT } from "$lib/shell/device-prefs.js";

describe("terminal height bounds (ZCode AnimatedTerminalPanel.tsx:103-109)", () => {
  it("uses 140px minimum and 50% maximum", () => {
    expect(TERMINAL_MIN_HEIGHT_PX).toBe(140);
    expect(TERMINAL_MAX_HEIGHT_RATIO).toBe(0.5);
    expect(terminalMaxHeightPx(1_000)).toBe(500);
    // 极矮视口：50% 低于 140 时以 140 保底（min 优先，无死区）。
    expect(terminalMaxHeightPx(200)).toBe(140);
  });

  it("clamps arbitrary values into [140, 50%·basis]", () => {
    expect(clampTerminalHeightPx(100, 1_000)).toBe(140);
    expect(clampTerminalHeightPx(600, 1_000)).toBe(500);
    expect(clampTerminalHeightPx(300, 1_000)).toBe(300);
    expect(clampTerminalHeightPx(300.6, 1_000)).toBe(301);
    expect(clampTerminalHeightPx(Number.NaN, 1_000)).toBe(140);
  });

  it("expands to ~30% by default (ZCode expandedSize)", () => {
    expect(TERMINAL_DEFAULT_HEIGHT_RATIO).toBe(0.3);
    expect(defaultTerminalHeightPx(1_000)).toBe(300);
    // 30% 低于 min 的矮视口落到 140。
    expect(defaultTerminalHeightPx(400)).toBe(140);
  });

  it("keeps keyboard step at the ZCode sidebar keyboard-resize convention", () => {
    expect(TERMINAL_KEYBOARD_STEP_PX).toBe(16);
  });

  it("DevicePrefs storage bounds stay consistent with the dynamic clamp", () => {
    // 存储下界 = 140（0 = 自动哨兵由 prefs 层承载）；存储上界宽容，生效上界动态。
    expect(AGENT_TERMINAL_MIN_HEIGHT).toBe(TERMINAL_MIN_HEIGHT_PX);
    expect(AGENT_TERMINAL_MAX_HEIGHT).toBeGreaterThan(2_000);
  });
});
