/**
 * 直连 propose 路径清零断言（intelligence-proposal-parity 3.3）。
 *
 * 用户原始需求 [2026-09-30]：GOAL 105「edit/disable/split/merge 均从实际 DSH
 * tool calls 形成方案」——C′2 后 proposal 的唯一创建路径是 agent 会话内的
 * intelligence_propose_* 工具调用；WebUI 不得残留任何直连创建调用。
 *
 * 正交意图：
 *   [1] 源扫描断言：webui/src 下任何 .ts/.svelte 文件均不含
 *       skillIntelligence.propose 调用面（RPC 契约已破坏性移除该过程）。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEBUI_SRC = join(import.meta.dirname, "..", "..", "..", "src", "lib");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.(ts|svelte)$/.test(entry) && !/\.test\.ts$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("intelligence direct propose path is gone (Ch4 3.3)", () => {
  it("has zero skillIntelligence.propose call sites in webui source", () => {
    const offenders = sourceFiles(WEBUI_SRC).filter((file) =>
      readFileSync(file, "utf8").includes("skillIntelligence.propose"),
    );
    expect(offenders).toEqual([]);
  });
});
