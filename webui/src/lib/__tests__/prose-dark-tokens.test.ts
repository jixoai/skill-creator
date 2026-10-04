/**
 * markdown 渲染层 dark token 契约测试（workspace-page-polish vision P1-5a）。
 *
 * 用户原始需求 [2026-10-04]（vision 批评）：「Dark 主题 skills 详情 h1『Alpha
 * Search』暗蓝紫压近黑底——markdown 渲染层沿用浅色 token」。
 *
 * 根因：@tailwindcss/typography 的 `.prose` 默认墨色是浅色系 slate/gray-900
 * （#111827 暗蓝紫），无任何 dark 反转挂载——SKILL.md 详情/Preview 在暗底上
 * h1/strong 对比近 1.2:1。修复 = layout.css 全局 `.dark .prose` 按主题 token
 * 重映射插件变量（skill-detail-panel 与 preview 两个消费点无需逐个挂 dark: 类）。
 *
 * 正交意图：
 *   [1] 源契约钉：`.dark .prose` 块存在且关键变量映射到 dark 前景 token
 *       （headings/body/bold/code）——防块被删或 token 名漂移。
 *   [2] 边界钉：暗色分隔线族（hr/quote/th/td borders）走 --border，代码块底
 *       走 --muted——不引入第二套硬编码色。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** 读取真实 layout.css 文本（vp/vitest 管线 CSS import 为空串，走 cwd 双候选）。 */
function readLayoutCss(): string {
  const candidates = [resolve("webui/src/routes/layout.css"), resolve("src/routes/layout.css")];
  for (const path of candidates) {
    try {
      return readFileSync(path, "utf8");
    } catch {
      // 尝试下一候选。
    }
  }
  throw new Error("layout.css not found relative to cwd");
}

describe("prose dark tokens (P1-5a)", () => {
  const css = readLayoutCss();
  const darkBlock = /\.dark \.prose \{[^}]*\}/.exec(css)?.[0] ?? "";

  it("defines a .dark .prose variable remap block", () => {
    expect(darkBlock).not.toBe("");
  });

  it("maps ink variables to dark foreground tokens (headings/body/bold/code)", () => {
    // h1/h2/strong（--tw-prose-headings/bold）与行内 code 走近白前景；
    // 正文/辅助（body/captions/counters）走 muted-foreground（dark 0.708，
    // 对 card 0.205 ≈ 5.5:1，AA）。
    expect(darkBlock).toContain("--tw-prose-headings: var(--foreground)");
    expect(darkBlock).toContain("--tw-prose-bold: var(--foreground)");
    expect(darkBlock).toContain("--tw-prose-code: var(--foreground)");
    expect(darkBlock).toContain("--tw-prose-body: var(--muted-foreground)");
  });

  it("keeps separators and code surfaces on theme tokens, not hardcoded darks", () => {
    expect(darkBlock).toContain("--tw-prose-hr: var(--border)");
    expect(darkBlock).toContain("--tw-prose-td-borders: var(--border)");
    expect(darkBlock).toContain("--tw-prose-pre-bg: var(--muted)");
    // 不引入硬编码 hex/rgb（slate 族残留）。
    expect(darkBlock).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(darkBlock).not.toMatch(/rgb\(/);
  });
});
