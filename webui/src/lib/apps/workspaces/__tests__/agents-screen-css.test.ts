/**
 * agents-screen 源级 CSS/契约测试（skills-tabs-redesign 批 4，design Δ5 路径 1）。
 * 用户原始需求 [2026-10-06]：「可写|只读两组 sticky 分组头」；「行点击与行尾
 * 动作是两个独立可聚焦操作」；「【不做】健康点/finding 短标（假数据禁令）」。
 * 正交意图：
 *   [1] sticky 分组头 CSS 契约（jsdom 无布局，源级钉住）。
 *   [2] 窄屏 692px 容器契约：行/动作/清除钮触达 ≥44px；Insights 收敛图标态
 *       （aria-label 承担可访问名称）。
 *   [3] Δ5 假数据禁令负例：不得出现健康度/finding 短标产物。
 *   [4] 双操作纵向分隔：行尾动作 border-l 与行主体互不重叠。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("../screens/agents-screen.svelte", import.meta.url)),
  "utf-8",
);
// 只扫代码（剥掉注释——注释里的规则陈述本身会含关键词）。
const code = source.replace(/<!--[\s\S]*?-->/g, "").replace(/^\s*\/\/.*$/gm, "");

function styleBlock(): string {
  const start = source.indexOf("<style>");
  const end = source.indexOf("</style>", start);
  expect(start).toBeGreaterThan(-1);
  return source.slice(start, end);
}

describe("Agents sticky 分组头（批 4）", () => {
  it("pins group heads sticky inside the scrolling screen-body", () => {
    const head = styleBlock().match(/\.agents-group-head\s*\{[\s\S]*?\}/);
    expect(head).not.toBeNull();
    expect(head![0]).toMatch(/position:\s*sticky/);
    expect(head![0]).toMatch(/top:\s*0/);
  });
});

describe("Agents 窄屏容器契约（AGENTS §7.2）", () => {
  it("keeps 692px shared threshold and 44px touch targets for row/action/clear", () => {
    const narrow = styleBlock().match(/@container dashboard \(width < 692px\)\s*\{[\s\S]*\}/);
    expect(narrow).not.toBeNull();
    const block = narrow![0];
    expect(block).toMatch(/\.agents-search-input\s*\{[^}]*min-height:\s*44px/);
    expect(block).toMatch(/\.agents-row-main\s*\{[^}]*min-height:\s*44px/);
    expect(block).toMatch(/\.agents-row-action\s*\{[^}]*min-height:\s*44px/);
    expect(block).toMatch(/\.agents-search-clear\s*\{[^}]*min-height:\s*44px/);
  });

  it("collapses the insights action to icon-only on narrow (aria-label carries the name)", () => {
    const narrow = styleBlock().match(/@container dashboard \(width < 692px\)\s*\{[\s\S]*\}/);
    expect(narrow![0]).toMatch(/\.agents-action-extra\s*\{\s*display:\s*none/);
    // 图标态保留主图标（行动作可点击性可见）；文字 + 箭头整组收敛。
    expect(code).toMatch(/agents-action-extra/);
    expect(code).toMatch(/agents-action-text/);
    // aria-label 与 title 由 insightsAction 键承担（图标态可访问名称）。
    expect(code).toMatch(/aria-label=\{t\("agentsScreen\.insightsAction"\)\}/);
  });
});

describe("Agents Δ5 假数据禁令（负例）", () => {
  it("never renders health percentages, finding chips, or per-provider aggregates", () => {
    // 渲染词汇层断言：t() 键集合不得含健康度/finding 语义（viewFindings 是
    // Insights 路由处理函数名——行为保留，不在禁令面内）。
    const tKeys = [...code.matchAll(/\bt\("([^"]+)"/g)].map((match) => match[1]!);
    expect(tKeys.length).toBeGreaterThan(0);
    expect(tKeys.filter((key) => /health|finding/i.test(key))).toEqual([]);
    // 无字面百分号（健康度百分比形态）；无 providerHealth 投影消费。
    expect(code).not.toMatch(/%/);
    expect(code).not.toMatch(/providerHealth/);
  });

  it("keeps the two operations vertically separated (row tail owns its own border-l zone)", () => {
    expect(code).toMatch(/agents-row-action[^"]*border-l/);
  });
});
