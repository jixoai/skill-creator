/**
 * 右栏布局纯计算单测（skills-agent-page-zcode-parity 3.3）。
 *
 * 用户原始需求 [2026-10-04]（design §3）：「用比例默认值配合 min/max 约束；关闭
 * 保留展开尺寸……自动 reveal active tab」。
 *
 * 正交意图：
 *   [1] tab 溢出判定：ZCode resolveSidePaneTabsOverflow 逐位对照（60px 预算 +
 *       4px gap + 1px 容差 + add 按钮内外两种布局）。
 *   [2] 比例记忆：默认 45%、65% 上限、240px 像素下限优先、键盘步进换算。
 *   [3] 自动 reveal：左右溢出 → 有符号 scrollBy；可见 → null。
 */
import { describe, expect, it } from "vitest";
import {
  clampSidePaneRatio,
  minSidePaneRatio,
  nudgeSidePaneRatio,
  resolvePanelTabRevealScroll,
  resolveSidePaneTabsOverflow,
  SIDE_PANE_DEFAULT_EXPANDED_RATIO,
  sidePaneRatioFromWidth,
  sidePaneWidthFromRatio,
} from "../side-pane-layout.js";
import {
  AGENT_RIGHT_PANEL_DEFAULT_EXPANDED_RATIO,
  DEFAULT_DEVICE_PREFS,
  DevicePrefsSchema,
} from "$lib/shell/device-prefs.js";

describe("resolveSidePaneTabsOverflow (ZCode sidePaneLayout parity)", () => {
  it("no tabs with the add button inside does not overflow a real viewport", () => {
    expect(
      resolveSidePaneTabsOverflow({
        addButtonInside: true,
        addButtonWidth: 28,
        tabCount: 0,
        viewportWidth: 100,
      }),
    ).toBe(false);
    // 零宽 viewport（挂载前量测）按预算判溢出：add 按钮 28 > 0+1。
    expect(
      resolveSidePaneTabsOverflow({
        addButtonInside: true,
        addButtonWidth: 28,
        tabCount: 0,
        viewportWidth: 0,
      }),
    ).toBe(true);
  });

  it("overflows when the 60px-per-tab budget exceeds the viewport (+1px tolerance)", () => {
    // 2 tabs = 60*2 + 4 gap = 124；+ gap 4 + add 28 = 156 > viewport+1 → 溢出。
    expect(
      resolveSidePaneTabsOverflow({
        addButtonInside: true,
        addButtonWidth: 28,
        tabCount: 2,
        viewportWidth: 150,
      }),
    ).toBe(true);
    expect(
      resolveSidePaneTabsOverflow({
        addButtonInside: true,
        addButtonWidth: 28,
        tabCount: 2,
        viewportWidth: 155,
      }),
    ).toBe(false);
    // 156 vs 155+1：等于容差边界 → 不溢出。
    expect(
      resolveSidePaneTabsOverflow({
        addButtonInside: true,
        addButtonWidth: 28,
        tabCount: 2,
        viewportWidth: 154.6,
      }),
    ).toBe(true);
  });

  it("accounts for the add button leaving the strip when pinned outside", () => {
    // add 按钮固定右侧时不再占 viewport 预算：预算 156 ≤ viewport+28+1 → 不溢出。
    expect(
      resolveSidePaneTabsOverflow({
        addButtonInside: false,
        addButtonWidth: 28,
        tabCount: 2,
        viewportWidth: 126,
      }),
    ).toBe(true);
    expect(
      resolveSidePaneTabsOverflow({
        addButtonInside: false,
        addButtonWidth: 28,
        tabCount: 2,
        viewportWidth: 127,
      }),
    ).toBe(false);
  });
});

describe("ratio memory (45% default / 65% cap / 240px floor)", () => {
  it("defaults non-finite ratios to 0.45", () => {
    expect(clampSidePaneRatio(Number.NaN, 1_000)).toBe(SIDE_PANE_DEFAULT_EXPANDED_RATIO);
    expect(clampSidePaneRatio(Number.POSITIVE_INFINITY, 1_000)).toBe(
      SIDE_PANE_DEFAULT_EXPANDED_RATIO,
    );
  });

  it("caps the ratio at 65%", () => {
    expect(clampSidePaneRatio(0.9, 1_000)).toBe(0.65);
    expect(clampSidePaneRatio(0.5, 1_000)).toBe(0.5);
  });

  it("floors the ratio at 240px worth of the container", () => {
    expect(minSidePaneRatio(1_200)).toBeCloseTo(0.2, 10);
    expect(clampSidePaneRatio(0.1, 1_200)).toBeCloseTo(0.2, 10);
  });

  it("lets the 240px pixel floor win over the 65% cap on narrow containers", () => {
    // 容器 300px：240px 下限 = 0.8 > 0.65——像素下限优先（ZCode 面板 min 语义）。
    expect(clampSidePaneRatio(0.45, 300)).toBeCloseTo(0.8, 10);
    expect(clampSidePaneRatio(0.65, 300)).toBeCloseTo(0.8, 10);
    expect(sidePaneWidthFromRatio(0.45, 300)).toBe(240);
  });

  it("round-trips width and ratio clamped", () => {
    expect(sidePaneWidthFromRatio(0.45, 1_000)).toBe(450);
    expect(sidePaneRatioFromWidth(450, 1_000)).toBeCloseTo(0.45, 10);
    expect(sidePaneRatioFromWidth(990, 1_000)).toBe(0.65);
    expect(sidePaneWidthFromRatio(0.45, 0)).toBe(0);
    expect(sidePaneRatioFromWidth(450, 0)).toBe(SIDE_PANE_DEFAULT_EXPANDED_RATIO);
  });

  it("nudges by pixel deltas for keyboard resize", () => {
    expect(nudgeSidePaneRatio(0.45, 16, 1_000)).toBeCloseTo(0.466, 10);
    expect(nudgeSidePaneRatio(0.45, -160, 1_000)).toBeCloseTo(0.29, 10);
    // 越界钳制。
    expect(nudgeSidePaneRatio(0.6, 200, 1_000)).toBe(0.65);
    expect(nudgeSidePaneRatio(0.45, -400, 1_000)).toBeCloseTo(0.24, 10);
  });

  it("persists the remembered ratio in DevicePrefs (default 45%, static guards)", () => {
    expect(AGENT_RIGHT_PANEL_DEFAULT_EXPANDED_RATIO).toBe(SIDE_PANE_DEFAULT_EXPANDED_RATIO);
    // 默认偏好整包过 schema（v1 加法字段——旧存量缺键由 default 补齐）。
    expect(DevicePrefsSchema.safeParse(DEFAULT_DEVICE_PREFS).success).toBe(true);
    const withoutRatio = { ...DEFAULT_DEVICE_PREFS } as Partial<typeof DEFAULT_DEVICE_PREFS>;
    delete withoutRatio.agentRightPanelExpandedRatio;
    const backfilled = DevicePrefsSchema.parse(withoutRatio);
    expect(backfilled.agentRightPanelExpandedRatio).toBe(0.45);
    // 持久化记忆值过 schema（窄容器下限可超 65%——schema 静态界 0.15–1）。
    expect(
      DevicePrefsSchema.parse({
        ...DEFAULT_DEVICE_PREFS,
        agentRightPanelExpandedRatio: clampSidePaneRatio(0.45, 300),
      }).agentRightPanelExpandedRatio,
    ).toBeCloseTo(0.8, 10);
    expect(
      DevicePrefsSchema.safeParse({
        ...DEFAULT_DEVICE_PREFS,
        agentRightPanelExpandedRatio: 0.05,
      }).success,
    ).toBe(false);
  });
});

describe("active tab auto-reveal scroll", () => {
  it("scrolls left by the exact left overflow", () => {
    expect(resolvePanelTabRevealScroll(100, 400, 40, 140)).toBe(-60);
  });

  it("scrolls right by the exact right overflow", () => {
    expect(resolvePanelTabRevealScroll(100, 400, 380, 480)).toBe(80);
  });

  it("returns null when the tab is already visible", () => {
    expect(resolvePanelTabRevealScroll(100, 400, 120, 380)).toBeNull();
    expect(resolvePanelTabRevealScroll(100, 400, 100, 400)).toBeNull();
  });
});
