/**
 * chrome z 阶梯契约（2026-10-05，Owner 实测 TabStrip ＋菜单浮到 Dialog 遮罩
 * 之上；同日布局裁决「absolute/fixed 尽量退场」）。
 * 用户原始需求：「addressBar 的层级居然比 Dialog 的遮罩层还高？为什么？」
 * 正交意图：
 *   [1] 阶梯契约：TabStrip 30 > Omnibox 20 > 内容 auto；Dialog overlay/content
 *       50 是全局顶——chrome 源码内禁止出现 z ≥ 50 的值（浮层靠困层而非高 z）。
 *   [2] 定位契约：＋菜单为锚定 absolute（fixed+clientX 是逃层叠时代 hack）；
 *       AppShell portal 层 grid 同格堆叠（无 position:absolute）。
 * 妥协声明：jsdom 无布局引擎——本测试钉「源码机制」契约；真实覆盖关系归
 * 走查门。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function src(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf-8");
}

/** 源码中出现的任意 z 值（z-50 / z-[90] / z-index: 40 等形态）里的大值扫描。
 *  先剥 Svelte/HTML 注释——注释里的历史名词（如「z-[100] 时代」）不是样式。 */
function maxZValue(source: string): number {
  const code = source.replace(/<!--[\s\S]*?-->/g, "");
  const values = [
    ...[...code.matchAll(/(?:^|\s)z-(\d+)(?!\d)/gm)].map((m) => Number(m[1])),
    ...[...code.matchAll(/z-\[(\d+)\]/g)].map((m) => Number(m[1])),
    ...[...code.matchAll(/z-index:\s*(\d+)/g)].map((m) => Number(m[1])),
  ];
  return values.length > 0 ? Math.max(...values) : 0;
}

describe("chrome z 阶梯与定位契约", () => {
  it("Dialog 遮罩/内容以 z-50 为全局顶（阶梯参照，ui 原语只读）", () => {
    const overlay = src("../../components/ui/dialog/dialog-overlay.svelte");
    const content = src("../../components/ui/dialog/dialog-content.svelte");
    expect(overlay).toMatch(/z-50/);
    expect(content).toMatch(/z-50/);
  });

  it("TabStrip：root z-30 困层（isolation 双保险），内部无 z ≥ 50", () => {
    const tabStrip = src("../TabStrip.svelte");
    expect(tabStrip).toMatch(/relative z-30 isolation-isolate/);
    expect(maxZValue(tabStrip)).toBeLessThan(50);
  });

  it("TabStrip ＋菜单为锚定 absolute（fixed+坐标 hack 退役）；右键菜单保留 fixed（光标锚定）", () => {
    const tabStrip = src("../TabStrip.svelte");
    expect(tabStrip).toMatch(/absolute right-0 top-full z-10/);
    // addPosition（clientX 定位 ＋菜单）已随 fixed 退役。
    expect(tabStrip).not.toMatch(/addPosition/);
    // 右键菜单：光标坐标锚定 = fixed 正当。
    expect(tabStrip).toMatch(/contextPosition/);
  });

  it("Omnibox：root z-20 层，内部无 z ≥ 50", () => {
    const omnibox = src("../Omnibox.svelte");
    expect(omnibox).toMatch(/relative z-20/);
    expect(maxZValue(omnibox)).toBeLessThan(50);
  });

  it("AppShell：portal 层 grid 同格堆叠（无 position:absolute/inset）", () => {
    const appShell = src("../AppShell.svelte");
    expect(appShell).toMatch(/grid-template-rows:\s*minmax\(0,\s*1fr\)/);
    expect(appShell).toMatch(/grid-area:\s*1 \/ 1/);
    expect(appShell).not.toMatch(/\.app-portal-root\s*\{[^}]*position:\s*absolute/s);
  });

  it("chrome 外的散点浮层同样无 z ≥ 50（困层语义：值只在自己的上下文内有意义）", () => {
    const sessionTree = src("../../apps/agent/SessionTree.svelte");
    const skillsScreen = src("../../apps/workspaces/screens/skills-screen.svelte");
    expect(maxZValue(sessionTree)).toBeLessThan(50);
    expect(maxZValue(skillsScreen)).toBeLessThan(50);
  });
});
