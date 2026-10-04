/**
 * RepositoryScan 机制契约测试（workspace-page-polish 批评处置 P1-3，2026-10-04）。
 * 用户原始需求（vision 批评回执摘录）：
 *  「(a) 工具栏 Discover 按钮被 Agent 面板拦腰切断；列表列 ~215px 描述折 40 行
 *   不可扫视；(c) Preview 面板原始 YAML 字符级硬切。」
 * 正交意图：
 *   [1] 工具栏防截断：header flex-wrap + 动作成组（组整体换行、组内自换行），
 *       任何面板宽度下按钮完整。
 *   [2] 列表行可扫视：描述 clamp 2 行 + 行高密度（py-1.5/leading 契约）+
 *       全文进 preview（预览头携带 description）。
 *   [3] preview 可读性：pre-wrap 换行（不硬切）+ 预览行 previewed 双向高亮。
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
