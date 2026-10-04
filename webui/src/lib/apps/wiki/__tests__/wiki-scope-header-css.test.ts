/**
 * WikiScopeView 页头机制契约测试（workspace-page-polish 批评处置 P1-2，
 * 2026-10-04；skills-dashboard-css 同族源码扫描模式）。
 * 用户原始需求（vision 批评回执摘录）：
 *  「Agent 面板开启的桌面宽度下 h1 截断 ~110px、描述压成 min-content 一行一词
 *   11 行；narrow-700 渲染完全正常。」
 * 正交意图：
 *   [1] 页头恒纵向堆叠（标题+描述块 / 动作行）——desk 与 narrow 同构；行内
 *       动作列 shrink-0 挤压文本块的结构不复存在。
 *   [2] 标题与描述恒 truncate（独占整行宽度，溢出走省略号而非折行）。
 * 妥协声明：jsdom 无布局引擎（实际行宽表现归编排者走查门）；本测试钉死
 * 堆叠结构的 CSS 机制契约。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("../WikiScopeView.svelte", import.meta.url)),
  "utf-8",
);

describe("页头纵向堆叠机制契约（批评处置 P1-2）", () => {
  it("header 恒 flex-col（标题+描述块 / 动作行）——desk 与 narrow 同构", () => {
    // 根因：行内动作列 shrink-0 把文本块压到 min-content（Agent 面板开启时
    // h1 截断 ~110px、描述一词一行折 11 行）；narrow 结构即正确答案，桌面照抄。
    expect(source).toMatch(
      /<header class="flex shrink-0 flex-col gap-2\.5 border-b border-border pb-4">/,
    );
    expect(source).not.toMatch(/max-\[720px\]:flex-col/);
    expect(source).not.toMatch(/items-start justify-between/);
  });

  it("标题与描述恒 truncate（动作行独占一行，不再挤压文本块）", () => {
    expect(source).toMatch(/class="truncate text-lg font-semibold outline-none"/);
    expect(source).toMatch(/class="min-w-0 truncate"/);
    expect(source).not.toMatch(/max-\[720px\]:truncate/);
  });

  it("动作行恒整行可用（无 shrink-0 顶宽，触摸目标类保留）", () => {
    expect(source).toMatch(/<div class="flex items-center gap-1\.5">/);
    expect(source).toMatch(/max-\[720px\]:h-11/);
  });
});
