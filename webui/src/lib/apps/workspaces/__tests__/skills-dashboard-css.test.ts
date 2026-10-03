/**
 * mobileScreen 网格 CSS 契约测试（skills-dashboard 1.2，design §1/§7）。
 * 用户原始需求 [2026-10-02]：「三块是并列 mobileScreen——每个 screen 有自身
 * height 概念，自动换行适应单/双/三/四列。」
 * 正交意图：
 *   [1] 网格壳契约：named container + auto-fill minmax 轨道 + gap（数值联动）。
 *   [2] 单列回落契约：container query 阈值 = 2×minmax 轨道 + 1×gap（692px）——
 *       数值一致性从源码提取后断言（改轨道不改阈值 = 此测试红）。
 *   [3] 一栏容器不溢出防线：span 2 → span 1 显式降档 + min-width:0 双闸 +
 *       screen 固定高/内滚/overscroll 不冒泡分层。
 *   [4] detail 面零写源扫描（design §7：除 skills.toggle 外零写 RPC、无
 *       creator.save/delete 调用）。
 * 妥协声明：jsdom 无布局引擎（scrollWidth/clientWidth 恒 0）——真实布局的
 * 不溢出验证归 1.10 ego-browser 走查门；本测试钉死防溢出的 CSS 机制契约。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dashboardSrc = readFileSync(
  fileURLToPath(new URL("../SkillsDashboard.svelte", import.meta.url)),
  "utf-8",
);

const skillsScreenSrc = readFileSync(
  fileURLToPath(new URL("../screens/skills-screen.svelte", import.meta.url)),
  "utf-8",
);

const footerSrc = readFileSync(
  fileURLToPath(new URL("../screens/dashboard-footer.svelte", import.meta.url)),
  "utf-8",
);

function styleBlock(source: string): string {
  const match = source.match(/<style>([\s\S]*?)<\/style>/);
  if (!match) throw new Error("style block not found");
  return match[1] ?? "";
}

describe("mobileScreen 网格壳 CSS 契约", () => {
  const css = styleBlock(dashboardSrc);

  it("declares a named inline-size container on the shell", () => {
    expect(css).toMatch(/container-type:\s*inline-size/);
    expect(css).toMatch(/container-name:\s*dashboard/);
  });

  it("uses auto-fill minmax tracks with a 12px gap", () => {
    expect(css).toMatch(/grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(340px,\s*1fr\)\)/);
    expect(css).toMatch(/gap:\s*12px/);
  });

  it("threshold consistency: container query width == 2×min track + 1×gap (692px)", () => {
    const track = Number(css.match(/minmax\((\d+)px/)?.[1]);
    const gap = Number(css.match(/gap:\s*(\d+)px/)?.[1]);
    const threshold = Number(css.match(/@container dashboard \(width < (\d+)px\)/)?.[1]);
    expect(track).toBe(340);
    expect(gap).toBe(12);
    // 1 列显式网格内 span 2 会创建隐式第二列（横向溢出）——阈值必须精确覆盖
    // 「auto-fill 只能解析出 1 列」的下边界（r2 修订）。
    expect(threshold).toBe(2 * track + gap);
    expect(threshold).toBe(692);
  });

  it("explicitly demotes the skills screen to span 1 inside the single-column query", () => {
    const query = css.match(/@container dashboard \(width < \d+px\) \{([\s\S]*?)\n  \}/)?.[1] ?? "";
    expect(query).toMatch(/\.skills-item\s*\{[\s\S]*?grid-column:\s*span 1/);
    // 单列容器只显示 active screen（mobileScreen 单屏切换）。
    expect(query).toMatch(/\.dashboard-grid \.grid-item\s*\{[\s\S]*?display:\s*none/);
    expect(query).toMatch(
      /\.dashboard-grid \.grid-item\[data-active="true"\]\s*\{[\s\S]*?display:\s*block/,
    );
  });

  it("skills screen spans 2 columns by default", () => {
    expect(css).toMatch(/\.skills-item\s*\{[\s\S]*?grid-column:\s*span 2/);
  });

  it("screens are fixed-height, header-owning, internally scrolling (no bubble)", () => {
    // 弹性下限（走查 13-fix）：默认高 = max(480px, 100dvh - 240px)——固定高语义
    // 不变（不随内容长高），但大视口按视口分配更多高度，480px 不再挤塌
    // master-detail。--screen-h 显式赋值仍优先（拖拽调高入口保留）。
    const elasticFloor = /max\(480px,\s*calc\(100dvh - 240px\)\)/;
    expect(css).toMatch(new RegExp(`height:\\s*var\\(--screen-h,\\s*${elasticFloor.source}\\)`));
    expect(css).toMatch(
      new RegExp(`min-height:\\s*var\\(--screen-h,\\s*${elasticFloor.source}\\)`),
    );
    expect(css).toMatch(/:global\(\.screen\)[\s\S]*?overflow:\s*hidden/);
    expect(css).toMatch(/:global\(\.screen > \.screen-body\)[\s\S]*?overflow-y:\s*auto/);
    expect(css).toMatch(/:global\(\.screen > \.screen-body\)[\s\S]*?min-height:\s*0/);
    // screen 内滚不冒泡（design §7）。
    expect(css).toMatch(/overscroll-behavior:\s*contain/);
  });

  it("guards the grid against implicit-column overflow with min-width: 0", () => {
    // 双闸之二：轨道内容永不撑出轨道（一栏容器 scrollWidth ≤ clientWidth 的
    // CSS 前提——溢出只能来自隐式列或内容 min-width，两处都已钉死）。
    expect(css).toMatch(/\.dashboard-grid\s*\{[\s\S]*?min-width:\s*0/);
    expect(css).toMatch(/\.grid-item\s*\{[\s\S]*?min-width:\s*0/);
  });
});

describe("真实目录规模防塌机制契约（走查 13-fix）", () => {
  const screenCss = skillsScreenSrc.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
  const footerCss = footerSrc.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";

  it("provider chips render as a single-row horizontal scroller, never multi-line wrap", () => {
    // header 高度与 provider 数量解耦：76 chips wrap 九行曾把 master-detail 挤到
    // 0px。机制 = chips 容器 nowrap + overflow-x（jsdom 无布局，钉 CSS 契约）。
    expect(skillsScreenSrc).toMatch(/class="chips-row[^"]*"\s+role="group"/);
    expect(screenCss).toMatch(/\.chips-row\s*\{[\s\S]*?flex-wrap:\s*nowrap/);
    expect(screenCss).toMatch(/\.chips-row\s*\{[\s\S]*?overflow-x:\s*auto/);
    // 源头不再出现 wrap 版 chips 容器（回归钉：防 flex-wrap 复活）。
    expect(skillsScreenSrc).not.toMatch(/class="mt-2 flex flex-wrap gap-1\.5"\s+role="group"/);
  });

  it("caps the Global footer imported-workspaces list with internal scrolling", () => {
    // 页脚默认高度上限收紧：多 workspace 列表 max-h + 内滚，Remove 入口仍可达。
    expect(footerSrc).toMatch(/class="imported-list[^"]*"/);
    expect(footerCss).toMatch(/\.imported-list\s*\{[\s\S]*?max-height:/);
    expect(footerCss).toMatch(/\.imported-list\s*\{[\s\S]*?overflow-y:\s*auto/);
  });
});

describe("skill-detail-panel 编辑所有权源扫描（design §7）", () => {
  const panelSrc = readFileSync(
    fileURLToPath(new URL("../../../components/skills/skill-detail-panel.svelte", import.meta.url)),
    "utf-8",
  );

  it("contains no creator-domain or repository-domain RPC calls", () => {
    // detail = 只读文档 + 管理动作；编辑唯一真相 = Creator 编辑页（r2 修订）。
    // 只扫代码（剥掉注释——注释里的规则陈述本身会含关键词）。
    const code = panelSrc.replace(/<!--[\s\S]*?-->/g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(
      /\bsaveSkill\b|\bdeleteSkill\b|creator\.save|creator\.remove|repository\./,
    );
  });

  it("lists skills.toggle as the single write-capable call surface", () => {
    expect(panelSrc).toMatch(/toggleSkills/);
    // 只读 RPC 面：info / validate / update check。
    expect(panelSrc).toMatch(/fetchSkillInfo/);
    expect(panelSrc).toMatch(/validateSkill/);
    expect(panelSrc).toMatch(/checkUpdates/);
  });
});
