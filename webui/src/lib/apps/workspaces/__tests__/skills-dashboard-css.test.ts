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
 *   [5] 窄屏栈切换类放置 + chips 滚动条隐藏契约（修复批 2：450px 盲区 /
 *       滚动条残段）。
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

  it("main-side structure: skills eats flexible width, agents/repos stack a narrow column", () => {
    // Owner 纠偏（2026-10-05 二轮）：list-detail 主面板不成比例宽——1fr 主列 +
    // 320-360px 副列；Skills 跨双行（高也成主体），Agents/Repos 副列纵向堆叠。
    expect(css).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(320px,\s*360px\)/);
    expect(css).toMatch(/\.skills-item\s*\{[\s\S]*?grid-column:\s*1[\s\S]*?grid-row:\s*1 \/ 3/);
    expect(css).toMatch(
      /\.grid-item\[data-screen="agents"\]\s*\{[\s\S]*?grid-column:\s*2[\s\S]*?grid-row:\s*1/,
    );
    expect(css).toMatch(
      /\.grid-item\[data-screen="repos"\]\s*\{[\s\S]*?grid-column:\s*2[\s\S]*?grid-row:\s*2/,
    );
  });

  it("mid tier (<1044px) falls back to shared auto-fill grid with skills span 2", () => {
    const mid = css.match(/@container dashboard \(width < 1044px\) \{([\s\S]*?)\n  \}/)?.[1] ?? "";
    expect(mid).toMatch(/grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(340px,\s*1fr\)\)/);
    expect(mid).toMatch(/\.skills-item\s*\{[\s\S]*?grid-column:\s*span 2/);
    // 显式放置在中档全部复位（否则跨结构泄漏）。
    expect(mid).toMatch(/grid-column:\s*auto/);
  });

  it("threshold consistency: container queries == 2/3×min track + gaps (692/1044px)", () => {
    const track = Number(css.match(/repeat\(auto-fill,\s*minmax\((\d+)px/)?.[1]);
    const gap = Number(css.match(/gap:\s*(\d+)px/)?.[1]);
    const thresholds = [...css.matchAll(/@container dashboard \(width < (\d+)px\)/g)].map((m) =>
      Number(m[1]),
    );
    expect(track).toBe(340);
    expect(gap).toBe(12);
    // Owner（2026-10-05）Skills 三列级联：中档 = 2 轨道 + 1×gap（692），
    // 三列档 = 3 轨道 + 2×gap（1044）。1 列显式网格内 span>1 会创建隐式列
    // （横向溢出）——阈值必须精确覆盖「auto-fill 只能解析出 N 列」的下边界。 */
    expect(thresholds).toContain(2 * track + gap);
    expect(thresholds).toContain(3 * track + 2 * gap);
  });

  it("explicitly demotes the skills screen to span 1 inside the single-column query", () => {
    const query = css.match(/@container dashboard \(width < 692px\) \{([\s\S]*?)\n  \}/)?.[1] ?? "";
    expect(query).toMatch(/\.skills-item\s*\{[\s\S]*?grid-column:\s*span 1/);
    // 单列容器只显示 active screen（mobileScreen 单屏切换）。
    expect(query).toMatch(/\.dashboard-grid \.grid-item\s*\{[\s\S]*?display:\s*none/);
    expect(query).toMatch(
      /\.dashboard-grid \.grid-item\[data-active="true"\]\s*\{[\s\S]*?display:\s*block/,
    );
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

  it("provider chips render as a single-row horizontal scroller, never multi-line wrap", () => {
    // header 高度与 provider 数量解耦：76 chips wrap 九行曾把 master-detail 挤到
    // 0px。机制 = chips 容器 nowrap + overflow-x（jsdom 无布局，钉 CSS 契约）。
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
    expect(skillsScreenSrc).toMatch(/class="mt-0\.5 line-clamp-2 text-xs leading-4"/);
    expect(skillsScreenSrc).not.toMatch(/line-clamp-\d+ block/);
    expect(skillsScreenSrc).not.toMatch(/block line-clamp-\d+/);
  });
});

describe("窄屏栈切换与 chips 滚动条机制契约（修复批 2）", () => {
  const screenCss = skillsScreenSrc.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";

  it("places narrow-stack hidden classes on the panes, never on the master-detail wrapper", () => {
    // 450px 盲区根因：@container (max-width: 559px) 的查询容器是匹配元素最近的
    // 祖先容器。类落在 pane 上 → 解析到 .skills-master-detail（inline-size 容器，
    // 「屏容器 < 560px」语义成立）；类落在 wrapper 自身 → 上溯到外层
    // .dashboard-shell 解析，列表行 + 空态 + 详情面整个被藏掉（宽度无关的
    // 空白盲区，450px 复现 / 700px 不复现正是 shell 容器宽度的两侧）。
    const wrapperClass = skillsScreenSrc.match(/class="skills-master-detail[^"]*"/)?.[0];
    expect(wrapperClass).toBeDefined();
    expect(wrapperClass).not.toMatch(/list-hidden|detail-hidden/);
    expect(skillsScreenSrc).toMatch(/class="skills-list-pane[^"]*list-hidden/);
    expect(skillsScreenSrc).toMatch(/class="skills-detail-pane[^"]*detail-hidden/);
  });

  it("stacks master-detail inside the dashboard's named single-column query (unified 692px)", () => {
    // 批评处置 P2：dashboard <692px 单列降档与 master-detail 栈切换共享同一
    // 阈值真相源（560-691px 区间曾出现「dashboard 已单列、master-detail 仍
    // 双栏挤压」——620px 走查实拍）。skills-screen 不再自带无名容器阈值。
    expect(screenCss).toMatch(/@container dashboard \(width < 692px\)\s*\{/);
    expect(screenCss).not.toMatch(/@container \(max-width: 559px\)/);
    expect(screenCss).not.toMatch(/\.skills-master-detail\s*\{[\s\S]*?container-type/);
    // 阈值一致性：与 SkillsDashboard 单列降档逐字相等（改一处不改另一处 = 红）。
    // dashboard 侧现为三档级联（1044/692）——双源一致锚定的是单列降档 692。
    const dashboardThreshold = Number(
      [...dashboardSrc.matchAll(/@container dashboard \(width < (\d+)px\)/g)]
        .map((m) => Number(m[1]))
        .find((value) => value === 692),
    );
    const screenThreshold = Number(
      skillsScreenSrc.match(/@container dashboard \(width < (\d+)px\)/)?.[1],
    );
    expect(screenThreshold).toBe(dashboardThreshold);
    expect(screenThreshold).toBe(692);
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

describe("workspace-page-polish 2.2 处置批机制契约（P2-2/P2-9/P2-10）", () => {
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

  it("重复徽标图标 layers 化（P2-9）：↗（外链语义）不再承担「同内容多副本」", () => {
    expect(skillsScreenSrc).toMatch(/icons\/layers/);
    const start = skillsScreenSrc.indexOf("{#if sameContent > 0}");
    const end = skillsScreenSrc.indexOf("{/if}", start);
    expect(start).toBeGreaterThan(-1);
    const badgeBlock = skillsScreenSrc.slice(start, end);
    expect(badgeBlock).toMatch(/<IconLayers class="h-3 w-3"/);
    expect(badgeBlock).not.toMatch(/IconArrowUpRight/);
  });

  it("磁盘缺失 provider 行不给 writable/readonly 徽标（P2-9：可写性断言以在盘为前提）", () => {
    // 徽标整块包在 available 闸内；缺失语义由「Not found on disk」行独自承担。
    const badgeGate = agentsSrc.match(/\{#if provider\.available\}\s*\{#if provider\.writable\}/);
    expect(badgeGate).not.toBeNull();
    expect(agentsSrc).toMatch(/agentsScreen\.notFound/);
  });

  it("dashboard 深链滚动（P2-10）：active 非 skills 时 scrollIntoView 落点网格项", () => {
    expect(dashboardSrc).toMatch(/data-screen="(skills|agents|repos)"/);
    expect(dashboardSrc).toMatch(
      /scrollIntoView\(\{ block: "nearest", inline: "nearest", behavior: "smooth" \}\)/,
    );
    // 高亮强化：active 边框之外追加 ring（落点可寻）。
    expect(dashboardSrc).toMatch(
      /\.grid-item\[data-active="true"\] :global\(\.screen\)\s*\{[\s\S]*?box-shadow:/,
    );
  });
});
