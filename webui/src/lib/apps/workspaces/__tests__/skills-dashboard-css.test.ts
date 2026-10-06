/**
 * SkillsDashboard chrome CSS 契约测试（skills-tabs-redesign 批 1/批 2，design 基准
 * = fuse2 融合稿 TabsHeader + Δ1 唯一 name 行 + Δ3 detail 独立路由）。
 * 用户原始需求 [2026-10-06]：「顶部 TabsHeader 三一等 Tabs，每 Tab 独占整幅
 * 画布」；「窄屏三 tab 单行不换行」；「pulse 统计退役为页题行小字」；
 * 「Skills 默认不出现重复 skill-name（×N 副本徽标）」；「detail 归独立路由页」。
 * 正交意图：
 *   [1] TabsHeader 契约：三一等 grid 均分 + nowrap 单行 + 激活底线
 *       （aria-selected 驱动）+ 窄屏触达 44px（692 阈值共源）。
 *   [2] 画布契约：panel grid 同格独占整幅（禁绝对定位）+ hidden 退场 + .screen
 *       弹性填满 panel（固定高语义由 flex 约束承担）+ 内滚/overscroll 分层。
 *   [3] 页题行统计小字契约（数据缺席不显数）。
 *   [4] detail 面零写源扫描（design §7：除 skills.toggle 外零写 RPC、无
 *       creator.save/delete 调用）——面板宿主迁独立路由页，契约继续有效。
 *   [5] 批 2 机制契约：master-detail 退役 + detail 页两栏容器（692 同阈值）
 *       + chips 横滚/滚动条 mask + ×N 徽标 layers 化。
 * 妥协声明：jsdom 无布局引擎（scrollWidth/clientWidth 恒 0）——真实布局的
 * 不溢出验证归走查门；本测试钉死防溢出的 CSS 机制契约。
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

describe("TabsHeader chrome CSS 契约（skills-tabs-redesign 批 1）", () => {
  const css = styleBlock(dashboardSrc);

  it("declares a named inline-size container on the shell", () => {
    expect(css).toMatch(/container-type:\s*inline-size/);
    expect(css).toMatch(/container-name:\s*dashboard/);
  });

  it("renders three equal tabs on a single non-wrapping row (grid, nowrap)", () => {
    // 三一等 Tabs：grid 均分轨道 + nowrap 单行（窄屏不换行不挤压）。
    expect(css).toMatch(/\.dashboard-tabs\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*1fr\)/);
    expect(css).toMatch(/\.dashboard-tab\s*\{[\s\S]*?white-space:\s*nowrap/);
    expect(css).toMatch(/\.dashboard-tab\s*\{[\s\S]*?min-width:\s*0/);
  });

  it("marks the selected tab with an accent underline driven by aria-selected", () => {
    // 激活 tab 底线（fuse2 语义）：aria-selected 属性选择器驱动，无 JS 类切换。
    expect(css).toMatch(
      /\.dashboard-tab\[aria-selected="true"\]\s*\{[\s\S]*?border-bottom-color:\s*var\(--primary/,
    );
  });

  it("keeps the 692px narrow container query as the shared single-row threshold", () => {
    // 窄屏单行形态：同一 TabsHeader（无第二套切换器），触达 ≥44px（AGENTS §7.2）。
    // 阈值 692 与 skills-screen master-detail 栈切换共源（改一处不改另一处 = 红）。
    const narrow =
      css.match(/@container dashboard \(width < 692px\) \{([\s\S]*?)\n  \}/)?.[1] ?? "";
    expect(narrow).toMatch(/\.dashboard-tab\s*\{[\s\S]*?min-height:\s*44px/);
    expect(css).not.toMatch(/screen-switcher|dashboard-grid|grid-item/);
  });

  it("panels own the full canvas via same-cell grid stacking, never absolute positioning", () => {
    // 每 Tab 独占整幅画布：panel 同格堆叠（1×1）+ hidden 退场（author 显式
    // display:none——UA [hidden] 样式会被 author display 覆盖）；禁绝对定位。
    expect(css).toMatch(/\.dashboard-panel\s*\{[\s\S]*?grid-area:\s*1\s*\/\s*1/);
    expect(css).toMatch(/\.dashboard-panel\[hidden\]\s*\{[\s\S]*?display:\s*none/);
    expect(css).not.toMatch(/position:\s*absolute/);
  });

  it("screens elastically fill their panel with internal scroll layering", () => {
    // .screen 填满 panel（Tab 化后画布 = 弹性剩余空间；固定高语义由 flex 约束
    // 承担，不随内容长高）+ body 内滚 + overscroll 不冒泡。
    expect(css).toMatch(/:global\(\.screen\)\s*\{[\s\S]*?flex:\s*1/);
    expect(css).toMatch(/:global\(\.screen\)\s*\{[\s\S]*?overflow:\s*hidden/);
    expect(css).toMatch(/:global\(\.screen > \.screen-body\)[\s\S]*?overflow-y:\s*auto/);
    expect(css).toMatch(/:global\(\.screen > \.screen-body\)[\s\S]*?min-height:\s*0/);
    expect(css).toMatch(/overscroll-behavior:\s*contain/);
  });

  it("pagehead renders stats as small secondary text (data-gated, no fake numbers)", () => {
    // 页题行统计小字（pulse 压缩退役）：小号次级文本 + tabular-nums；渲染闸在
    // DOM 测试钉（providers 摘要缺席不渲染），此处钉字号/降调机制。
    expect(css).toMatch(/\.dashboard-stats\s*\{[\s\S]*?font-size:\s*11\.5px/);
    expect(css).toMatch(/\.dashboard-stats\s*\{[\s\S]*?font-variant-numeric:\s*tabular-nums/);
  });
});

describe("真实目录规模防塌机制契约（走查 13-fix）", () => {
  const screenCss = skillsScreenSrc.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";

  it("provider chips render as a single-row horizontal scroller, never multi-line wrap", () => {
    // header 高度与 provider 数量解耦：76 chips wrap 九行曾把列表挤到 0px。
    // 机制 = chips 容器 nowrap + overflow-x（jsdom 无布局，钉 CSS 契约）。
    expect(skillsScreenSrc).toMatch(/class="chips-row[^"]*"\s+role="group"/);
    expect(screenCss).toMatch(/\.chips-row\s*\{[\s\S]*?flex-wrap:\s*nowrap/);
    expect(screenCss).toMatch(/\.chips-row\s*\{[\s\S]*?overflow-x:\s*auto/);
    // 源头不再出现 wrap 版 chips 容器（回归钉：防 flex-wrap 复活）。
    expect(skillsScreenSrc).not.toMatch(/class="mt-2 flex flex-wrap gap-1\.5"\s+role="group"/);
  });

  it("retires the imported-workspaces footer block; manager entry links to /workspace", () => {
    // workspace-page-polish（Owner 裁决）：「IMPORTED WORKSPACES」区块从 Global
    // 页脚退役——注册目录索引与 Remove 收口到标准管理页 /workspace；页脚只
    // 保留入口链接（remove 相关 i18n/组件随迁管理页）。
    expect(footerSrc).not.toMatch(/imported-list/);
    expect(footerSrc).not.toMatch(/workspacePage\.removeTitle|removeWorkspace|ConfirmDialog/);
    expect(footerSrc).toMatch(/data-testid="open-workspace-manager"/);
    expect(footerSrc).toMatch(/goById\("workspaces\.manage"\)/);
  });

  it("row descriptions clamp without the display:block override that defeats -webkit-box", () => {
    // 批评处置 P1-3b 同族根因：Tailwind 输出序 .block 后于 .line-clamp-*，
    // display:block 覆盖 -webkit-box 使 clamp 失效（desk 走查 40 行折叠）——
    // clamp 类禁与 block 同用。
    // FD-24 修订：leading-4 → leading-[18px] 微调（两行完整空间；75px 不动）。
    expect(skillsScreenSrc).toMatch(/class="mt-0\.5 line-clamp-2 text-xs leading-\[18px\]"/);
    expect(skillsScreenSrc).not.toMatch(/line-clamp-\d+ block/);
    expect(skillsScreenSrc).not.toMatch(/block line-clamp-\d+/);
  });
});

describe("master-detail 退役与 detail 独立路由布局契约（skills-tabs-redesign 批 2）", () => {
  const screenCss = skillsScreenSrc.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";

  it("retires the master-detail panes from the skills screen (detail owns a route now)", () => {
    // Δ3：detail 归 workspaces.skillDetail 独立路由页——列表屏满幅单列，
    // master-detail 双 pane 及其隐藏类不得复活。
    expect(skillsScreenSrc).not.toMatch(/skills-master-detail|skills-list-pane|skills-detail-pane/);
    expect(skillsScreenSrc).not.toMatch(/SkillDetailPanel/);
    expect(skillsScreenSrc).not.toMatch(/list-hidden|detail-hidden/);
    // 阈值一致性锚点迁移：skills-screen 保留 chips 触达面的 692 容器查询
    // （与 SkillsDashboard 单列降档逐字相等，改一处不改另一处 = 红）。
    const screenThreshold = Number(
      skillsScreenSrc.match(/@container dashboard \(width < (\d+)px\)/)?.[1],
    );
    expect(screenThreshold).toBe(692);
  });

  it("detail page owns a two-pane container with the same 692px single-column threshold", () => {
    // Δ3 简化版容器：左信息右内容占位；<692px 单列双行（panel/aside 各占半幅内滚
    // ——隐式 auto 行被 stretch 分配后放行内容溢出本行，画进下一行透明 aside
    // 底下，走查 390 实拍重叠——必须显式 minmax(0,1fr) 行约束）。
    const detailSrc = readFileSync(
      fileURLToPath(new URL("../SkillDetailPage.svelte", import.meta.url)),
      "utf-8",
    );
    const detailCss = detailSrc.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
    expect(detailCss).toMatch(/container-type:\s*inline-size/);
    expect(detailCss).toMatch(/@container skill-detail \(min-width:\s*692px\)/);
    expect(detailCss).toMatch(/grid-template-rows:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*1fr\)/);
    expect(detailCss).toMatch(
      /grid-template-columns:\s*minmax\(0,\s*1\.1fr\)\s*minmax\(0,\s*1fr\)/,
    );
    expect(detailCss).toMatch(/overflow:\s*hidden/);
    expect(detailCss).not.toMatch(/position:\s*absolute/);
  });

  it("hides the chips-row scrollbar behind an edge fade mask without losing scroll", () => {
    // P2-4：scrollbar-width: thin 会在「All」chip 下留常驻灰色滚动条残段——
    // 隐藏滚动条（Firefox scrollbar-width + WebKit 伪元素双面）+ mask 渐隐承担
    // 「可滚」affordance；overflow-x: auto 保留横滚能力。
    expect(screenCss).toMatch(/\.chips-row\s*\{[\s\S]*?scrollbar-width:\s*none/);
    expect(screenCss).toMatch(/\.chips-row::-webkit-scrollbar\s*\{[\s\S]*?display:\s*none/);
    expect(screenCss).toMatch(/\.chips-row\s*\{[\s\S]*?mask-image:/);
    expect(screenCss).toMatch(/\.chips-row\s*\{[\s\S]*?overflow-x:\s*auto/);
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

describe("workspace-page-polish 2.2 处置批机制契约（P2-2/P2-9）+ 批 1 深链 Tab", () => {
  const agentsSrc = readFileSync(
    fileURLToPath(new URL("../screens/agents-screen.svelte", import.meta.url)),
    "utf-8",
  );

  it("provider chips 零计数折叠（P2-2）：非零 chips 前置渲染 + 零计数收进 +N 溢出项", () => {
    expect(skillsScreenSrc).toMatch(/const nonZeroChips = \$derived\(providerChips\.filter/);
    expect(skillsScreenSrc).toMatch(/const zeroChips = \$derived\(providerChips\.filter/);
    expect(skillsScreenSrc).toMatch(/data-testid="zero-providers-overflow"/);
    expect(skillsScreenSrc).toMatch(/skillsScreen\.moreProviders/);
    // 选中的零计数 chip 强制露出（筛选态不被折叠隐藏）。
    expect(skillsScreenSrc).toMatch(
      /zeroChips\.some\(\(chip\) => chip\.providerId === providerFilter\)/,
    );
    // 主渲染循环只消费 nonZeroChips（全量 providerChips 循环 = 折叠回归）。
    const mainLoop = skillsScreenSrc.match(/\{#each nonZeroChips as chip \(chip\.providerId\)\}/);
    expect(mainLoop).not.toBeNull();
    expect(skillsScreenSrc).not.toMatch(/\{#each providerChips as chip \(chip\.providerId\)\}/);
  });

  it("副本徽标图标 layers 化（批 2 ×N 语义）：×N 副本徽标块携带 layers 图标", () => {
    expect(skillsScreenSrc).toMatch(/icons\/layers/);
    const start = skillsScreenSrc.indexOf("{#if copyCount > 1}");
    const end = skillsScreenSrc.indexOf("{/if}", start);
    expect(start).toBeGreaterThan(-1);
    const badgeBlock = skillsScreenSrc.slice(start, end);
    expect(badgeBlock).toMatch(/<IconLayers class="h-3 w-3"/);
    expect(badgeBlock).toMatch(/data-testid="copies-badge"/);
    expect(badgeBlock).not.toMatch(/IconArrowUpRight/);
  });

  it("磁盘缺失 provider 行不给 writable/readonly 徽标（P2-9：可写性断言以在盘为前提）", () => {
    // 徽标整块包在 available 闸内；缺失语义由「Not found on disk」行独自承担。
    const badgeGate = agentsSrc.match(/\{#if provider\.available\}\s*\{#if provider\.writable\}/);
    expect(badgeGate).not.toBeNull();
    expect(agentsSrc).toMatch(/agentsScreen\.notFound/);
  });

  it("dashboard 深链 Tab 选择（批 1）：?tab= 驱动 aria-selected + panel hidden 同源", () => {
    // 三屏网格退役后 ?tab= 深链语义 = Tab 选择：panel hidden 与 tab
    // aria-selected 绑定同一真相源（manifest zod enum 不动，值域测试归
    // dashboard-manifest.test.ts）；roving 键盘自动激活落同一 selectScreen。
    expect(dashboardSrc).toMatch(/activeScreen[^=]*=\s*\$derived\(search\.tab \?\? "skills"\)/);
    expect(dashboardSrc).toMatch(/hidden=\{activeScreen !== "skills"\}/);
    expect(dashboardSrc).toMatch(/hidden=\{activeScreen !== "agents"\}/);
    expect(dashboardSrc).toMatch(/hidden=\{activeScreen !== "repos"\}/);
    expect(dashboardSrc).toMatch(/aria-selected=\{activeScreen === tab\.id\}/);
    expect(dashboardSrc).toMatch(/role="tablist"/);
    expect(dashboardSrc).toMatch(/selectScreen\(SCREEN_IDS\[next\], true\)/);
  });
});
