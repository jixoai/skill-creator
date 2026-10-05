/**
 * RepositoryScan 机制契约测试（workspace-page-polish 批评处置 P1-3，2026-10-04；
 * 2.2 处置批扩展 P1-1/P2-3/P2-4/P2-10）。
 * 用户原始需求（vision 批评回执摘录）：
 *  「(a) 工具栏 Discover 按钮被 Agent 面板拦腰切断；列表列 ~215px 描述折 40 行
 *   不可扫视；(c) Preview 面板原始 YAML 字符级硬切。」
 *  2.1 走查 P1-1：「75 目标全预勾，一次 Install 写进全部 provider root 造成 60
 *   个重复目录」——默认勾选收敛（已由 4ba89a7 预处置）+ >10 目标确认步（本批）。
 *  2.1 走查 P2-3：「writeSelected 读旧 page.url.search 互相覆盖」——本地 Set 真相。
 *  2.1 走查 P2-4：「repos scan <692px 50/50 截断 label」——单列栈。
 * 正交意图：
 *   [1] 工具栏防截断：header flex-wrap + 动作成组（组整体换行、组内自换行），
 *       任何面板宽度下按钮完整。
 *   [2] 列表行可扫视：描述 clamp 2 行 + 行高密度（py-1.5/leading 契约）+
 *       全文进 preview（预览头携带 description）。
 *   [3] preview 可读性：pre-wrap 换行（不硬切）+ 预览行 previewed 双向高亮。
 *   [4] 安装确认步（P1-1）：>10 目标阈值 + requestInstall 闸 + 对话框列计数与
 *       目标名 + 默认预填仍限当前 tab ws（防全选回归）。
 *   [5] 选中真相本地 Set（P2-3）：projectedSelections 回声闸 + selectedIds 从
 *       selectedTruth 派生。
 *   [6] 窄容器单列栈（P2-4）：692px 同源阈值（与 skills-dashboard-css 双源断言）。
 *   [7] scanning 骨架行（P2-10）：animate-pulse 行 + role=status。
 * 妥协声明：jsdom 无布局引擎（「按钮完整/行高数值」归编排者走查门）；本测试
 * 钉死防截断与防折叠的 CSS 机制契约（skills-dashboard-css 同族源码扫描模式）。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  fileURLToPath(new URL("../RepositoryScan.svelte", import.meta.url)),
  "utf-8",
);

describe("工具栏防截断机制契约（P1-3a）", () => {
  it("header flex-wrap 且标题块保有 basis 保底（换行前最小可读宽度）", () => {
    // 属性可被 fmt 换行：按 token 断言（shrink-0 + flex-wrap + 标题 basis-56）。
    expect(src).toMatch(/<header\s+class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2/);
    expect(src).toMatch(/class="min-w-0 flex-1 basis-56"/);
  });

  it("meta/表单/Discover 同组换行——组是 flex 行的单一 item，行宽不足时整体换行", () => {
    const groupMatch = src.match(
      /<div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1\.5">/,
    );
    expect(groupMatch).not.toBeNull();
    const groupStart = src.indexOf(groupMatch?.[0] ?? "");
    expect(src.indexOf('data-testid="scan-meta"')).toBeGreaterThan(groupStart);
    expect(src.indexOf('t("reposScan.discover")')).toBeGreaterThan(groupStart);
  });

  it("动作子项不再依赖行内 shrink-0 顶宽（Discover 按钮组内完整）", () => {
    // Discover 按钮仍在源码内且位于动作组内（上一条已证组内顺序），此处钉
    // 源头不再出现「header 直接子级散落 shrink-0 动作」的旧结构。
    const headerBlock = src.slice(
      src.indexOf("<header"),
      src.indexOf("</header>") + "</header>".length,
    );
    expect(headerBlock).toMatch(/t\("reposScan\.discover"\)/);
    expect(headerBlock).not.toMatch(/justify-between/);
  });
});

describe("列表行可扫视机制契约（P1-3b）", () => {
  it("description clamp 2 行且不与 block 同用（block 覆盖 -webkit-box 使 clamp 失效）", () => {
    // 根因（desk 走查 40 行折叠）：Tailwind 输出序 .block 后于 .line-clamp-*，
    // display:block 赢得级联 → -webkit-line-clamp 无 -webkit-box 可依附。
    expect(src).toMatch(
      /class="mt-0\.5 line-clamp-2 text-\[11px\] leading-4 text-muted-foreground"/,
    );
    expect(src).not.toMatch(/line-clamp-\d+ block/);
    expect(src).not.toMatch(/block line-clamp-\d+/);
  });

  it("行高密度契约：py-1.5 + 名称 leading-snug + 描述 leading-4（installable 行 ≈64px）", () => {
    expect(src).toMatch(/px-3 py-1\.5 text-left/);
    expect(src).toMatch(/text-\[13px\] font-medium leading-snug text-foreground/);
    expect(src).toMatch(/line-clamp-2 text-\[11px\] leading-4/);
  });

  it("非可安装 issues 单行 clamp + title 全文（不撑高行）", () => {
    expect(src).toMatch(
      /class="mt-0\.5 line-clamp-1 text-\[10px\] leading-3 text-amber-600 dark:text-amber-400"/,
    );
    expect(src).toMatch(
      /title=\{skill\.issues\.join\(" "\) \|\| t\("reposScan\.notInstallable"\)\}/,
    );
  });

  it("全文进 preview：预览头携带 name + description（列表 clamp 的全文出口）", () => {
    expect(src).toMatch(/data-testid="scan-preview-head"/);
    expect(src).toMatch(/\{preview\.skill\.name\}/);
    expect(src).toMatch(/\{preview\.skill\.description \|\| t\("reposScan\.noDescription"\)\}/);
  });
});

describe("preview 可读性与双向对应契约（P1-3c）", () => {
  it("pre 换行不硬切（pre-wrap + break-words；纵向内滚保留）", () => {
    expect(src).toMatch(/max-h-48 overflow-y-auto whitespace-pre-wrap break-words/);
  });

  it("预览行 previewed 高亮（ring + aria-current + data-previewed）", () => {
    expect(src).toMatch(/'bg-accent ring-1 ring-ring ring-inset'/);
    expect(src).toMatch(/aria-current=\{previewed \? "true" : undefined\}/);
    expect(src).toMatch(/data-previewed=\{previewed \|\| undefined\}/);
  });
});

describe("安装确认步机制契约（2.2 处置批 P1-1）", () => {
  it("阈值常量 >10 + requestInstall 闸（Install 按钮不再直连 runInstall(false)）", () => {
    expect(src).toMatch(/INSTALL_CONFIRM_TARGETS_THRESHOLD = 10/);
    expect(src).toMatch(/selectedTargetEntries\.length > INSTALL_CONFIRM_TARGETS_THRESHOLD/);
    expect(src).toMatch(/function requestInstall\(\): void/);
    // Install 主按钮经 requestInstall；Dry-run 按钮仍直连（无写入不设闸）。
    expect(src).toMatch(/onclick=\{\(\) => requestInstall\(\)\}/);
    const dryRunIdx = src.indexOf('t("reposScan.dryRun")');
    expect(src.slice(dryRunIdx - 400, dryRunIdx)).toMatch(/runInstall\(true\)/);
  });

  it("确认对话框列计数与目标名（aria + 计数插值 + 目标 label 列表）", () => {
    expect(src).toMatch(/data-testid="install-confirm"/);
    expect(src).toMatch(/reposScan\.confirmTitle/);
    expect(src).toMatch(/reposScan\.confirmBody/);
    expect(src).toMatch(/\{entry\.label\}/);
  });

  it("默认预填仍限当前 tab ws（P1-1 防全选回归——全量 targets 预勾即回归信号）", () => {
    // 预填 filter 必须绑定 workspaceId === current；不再出现无 ws 过滤的全量
    // selectedTargets = targets.map(...) 写法。
    expect(src).toMatch(
      /selectedTargets = targets\s*\n\s*\.filter\(\(entry\) => entry\.target\.workspaceId === current\)/,
    );
    const prefillBlock = src.slice(
      src.indexOf("let prefilled = false;"),
      src.indexOf("let scannedSourceKey"),
    );
    expect(prefillBlock).not.toMatch(/selectedTargets = targets\.map/);
  });
});

describe("选中真相本地 Set 机制契约（2.2 处置批 P2-3）", () => {
  it("selectedIds 从本地 selectedTruth 派生（不再直接派生 URL 参数）", () => {
    expect(src).toMatch(/let selectedTruth = \$state<Set<string>>\(new Set\(\)\)/);
    expect(src).toMatch(/const selectedIds = \$derived\(selectedTruth\)/);
  });

  it("投影回声闸：自写入的 param 落地不重放（乱序落地安全）", () => {
    expect(src).toMatch(/const projectedSelections = new Set<string>\(\)/);
    expect(src).toMatch(/if \(projectedSelections\.has\(param\)\) return;/);
    expect(src).toMatch(/projectedSelections\.add\(value\)/);
  });

  it("写入路径以本地真相覆写 selected 键（连续 toggle 不再互相覆盖）", () => {
    expect(src).toMatch(/function projectSelected\(search: URLSearchParams\): void/);
    expect(src).toMatch(/selectedTruth = ids;/);
  });
});

describe("窄容器单列栈机制契约（2.2 处置批 P2-4）", () => {
  it("自持容器 + <692px 栈切换（阈值与 dashboard 降档同源）", () => {
    expect(src).toMatch(/\.scan-root\s*\{\s*container-type: inline-size;\s*\}/);
    expect(src).toMatch(/@container \(width < 692px\)\s*\{/);
    expect(src).toMatch(/\.scan-split\s*\{\s*flex-direction: column;\s*\}/);
    expect(src).toMatch(/\.scan-list\s*\{\s*width: 100%;/);
    expect(src).toMatch(/\.scan-side\s*\{\s*width: 100%;/);
  });

  it("阈值与 skills-dashboard 单列降档一致（双源阈值相等）", () => {
    const dashSrc = readFileSync(
      fileURLToPath(new URL("../SkillsDashboard.svelte", import.meta.url)),
      "utf-8",
    );
    // dashboard 现为三档级联（1044/692）——双源一致锚定单列降档 692。
    const dashThreshold =
      [...dashSrc.matchAll(/@container dashboard \(width < (\d+)px\)/g)]
        .map((m) => Number(m[1]))
        .find((value) => value === 692) ?? 0;
    const scanThreshold = Number(/@container \(width < (\d+)px\)/.exec(src)?.[1] ?? 0);
    expect(dashThreshold).toBe(692);
    expect(scanThreshold).toBe(dashThreshold);
  });
});

describe("scanning 骨架行机制契约（2.2 处置批 P2-10）", () => {
  it("骨架行替换裸文本（animate-pulse 行 + role=status 保留扫描语义）", () => {
    expect(src).toMatch(/data-testid="scan-skeleton"/);
    expect(src).toMatch(/role="status"/);
    expect(src).toMatch(/aria-label=\{t\("reposScan\.scanning"\)\}/);
    expect(src).toMatch(/animate-pulse/);
    // 裸文本 scanning 段不再以整段 py-8 居中形式出现。
    expect(src).not.toMatch(
      /<p class="px-4 py-8 text-center text-xs text-muted-foreground">\{t\("reposScan\.scanning"\)\}<\/p>/,
    );
  });
});
