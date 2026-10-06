/**
 * SkillDetail CodeEditor CSS 契约测试（skills-tabs-redesign 批 3，design.md Δ2
 * 定稿 + fuse2 硬性裁决 2）。
 * 用户原始需求 [2026-10-06]：「左文件树（目录折叠、当前高亮）+ 中内容查看器
 * （filebar + statusbar 只读契约）；620 窄屏：树降级横向 chips、内容单列、
 * 动作 ≥44px」。
 * 正交意图：
 *   [1] 双形态共源阈值：chips/双栏切换挂在 page 命名容器 skill-detail 的 692
 *       阈值上（与批 2 单列降档/批 1 Tabs 单行共源——editor zone 宽度无法区分
 *       620 满宽与 1280 双栏两态）。
 *   [2] 窄屏形态：树列退场、chips 横滚 ≥44px 命中（滚动条隐藏 + mask 渐隐，
 *       chips-row 同族）、查看器单列。
 *   [3] 宽屏形态：树列 + 查看器双栏 grid（树 140-200px 惯例带宽）。
 *   [4] 机制契约：固定高 + overflow hidden（aside 内滚容器中的有界编辑器）、
 *       禁绝对定位（Owner 2026-10-05 grid 法则）。
 * 妥协声明：jsdom 无布局引擎——真实不溢出/命中验证归走查门；本测试钉死 CSS
 * 机制契约。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const editorSrc = readFileSync(
  fileURLToPath(new URL("../skill-detail-editor.svelte", import.meta.url)),
  "utf-8",
);

function styleBlock(source: string): string {
  const match = source.match(/<style>([\s\S]*?)<\/style>/);
  if (!match) throw new Error("style block not found");
  return match[1] ?? "";
}

/** 宽屏容器 query 块体（query 是 style 块的最后一条规则，取其后全文）。 */
function wideBlock(css: string): string {
  return css.split("@container skill-detail (min-width: 692px)")[1] ?? "";
}

describe("SkillDetail CodeEditor CSS 契约（skills-tabs-redesign 批 3）", () => {
  const css = styleBlock(editorSrc);

  it("switches chips/columns on the shared 692px page container threshold", () => {
    // 阈值共源：编辑器内部形态挂在 page 命名容器 skill-detail 的 692 阈值
    // （批 1 Tabs 单行 / 批 2 detail 单列降档同一断点，改一处不改另一处 = 红）。
    expect(css).toMatch(/@container skill-detail \(min-width:\s*692px\)/);
  });

  it("narrow form defaults to the chips rail (hidden tree) with 44px targets", () => {
    // 默认（窄屏基线）：chips 显示 + ≥44px 命中；树列退场；grid 单列（查看器
    // 仍在场——树隐藏不能连带内容消失）。
    expect(css).toMatch(/\.editor-chips\s*\{[\s\S]*?display:\s*flex/);
    expect(css).toMatch(/\.editor-chip\s*\{[\s\S]*?min-height:\s*44px/);
    expect(css).toMatch(/\.editor-tree\s*\{[\s\S]*?display:\s*none/);
    expect(css).toMatch(
      /\.editor-grid\s*\{[\s\S]*?display:\s*grid[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
    // 宽屏 query：双栏轨道 + 树列在场 + chips 退场。
    const wide = wideBlock(css);
    expect(wide).toMatch(
      /\.editor-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(140px,\s*200px\)\s+minmax\(0,\s*1fr\)/,
    );
    expect(wide).toMatch(/\.editor-tree\s*\{[\s\S]*?display:\s*block/);
    expect(wide).toMatch(/\.editor-chips\s*\{[\s\S]*?display:\s*none/);
  });

  it("hides the chips scrollbar behind an edge fade mask without losing scroll", () => {
    // chips 横滚 affordance（chips-row 同族）：overflow-x auto + 滚动条隐藏
    // （Firefox scrollbar-width + WebKit 伪元素双面）+ mask 渐隐。
    expect(css).toMatch(/\.editor-chips\s*\{[\s\S]*?overflow-x:\s*auto/);
    expect(css).toMatch(/\.editor-chips\s*\{[\s\S]*?scrollbar-width:\s*none/);
    expect(css).toMatch(/\.editor-chips::-webkit-scrollbar\s*\{[\s\S]*?display:\s*none/);
    expect(css).toMatch(/\.editor-chips\s*\{[\s\S]*?mask-image:/);
  });

  it("keeps the editor bounded inside the scrolling aside without absolute positioning", () => {
    // 有界编辑器：固定高（窄 340/宽 460）+ overflow hidden + min-height 0；
    // 禁绝对定位（Owner grid 法则）。
    expect(css).toMatch(/\.detail-editor\s*\{[\s\S]*?height:\s*340px/);
    expect(css).toMatch(/\.detail-editor\s*\{[\s\S]*?overflow:\s*hidden/);
    expect(css).toMatch(/\.detail-editor\s*\{[\s\S]*?min-height:\s*0/);
    const wide = wideBlock(css);
    expect(wide).toMatch(/\.detail-editor\s*\{[\s\S]*?height:\s*460px/);
    expect(css).not.toMatch(/position:\s*absolute/);
  });

  it("codes view carries line-number rows and the statusbar pins the read-only contract", () => {
    // 结构选择器存在性（DOM 断言的 CSS 面锚点）：行号列 + 状态条布局。
    expect(css).toMatch(/\.code-row\s*\{[\s\S]*?display:\s*flex/);
    expect(css).toMatch(/\.code-ln\s*\{[\s\S]*?user-select:\s*none/);
    expect(css).toMatch(/\.editor-statusbar\s*\{[\s\S]*?justify-content:\s*space-between/);
  });
});
