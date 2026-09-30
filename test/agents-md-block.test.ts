/**
 * agents-md 引导块测试（agents-md-prompt-block）。
 *
 * 用户原始需求 [2026-09-30]：「往 ~/.agents/AGENTS.md 中注入或者更新
 * `<skill-creator-v2>$PROMPT</skill-creator-v2>` 片段……引导 Agent 使用
 * skill-creator 去管理和维护和使用 skills，特别是使用 wiki 的部分实现记录和迭代。」
 *
 * 正交意图：
 *   [1] 块协议五态：injected（新文件/追加）/ current / updated（块外逐字保留）/
 *       multiple（只刷新首个）/ failed（残缺开标签拒绝写、IO 故障不抛）。
 *   [2] 隔离与只读面：valve 沙箱下推导 AGENTS.md；agentsMdBlockState 投影。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  agentsMdBlockState,
  agentsMdFilePath,
  agentsMdGuidanceBlock,
  ensureAgentsMdPromptBlock,
  SELF_SKILL_ROOT_ENV,
} from "../src/daemon/agents-md-block.js";

let sandbox = "";
let previousRootEnv: string | undefined;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "agents-md-block-test-"));
  previousRootEnv = process.env[SELF_SKILL_ROOT_ENV];
  process.env[SELF_SKILL_ROOT_ENV] = path.join(sandbox, "agents", "skills");
  // 写前包含断言（2026-09-30 事故教训：阀门常量曾导入自未导出模块变成 undefined，
  // 8 个测试把真实 ~/.agents/AGENTS.md 覆写成夹具）。任何 fs 操作前先钉死落点在沙箱内。
  const resolved = agentsMdFilePath();
  if (resolved !== path.join(sandbox, "agents", "AGENTS.md")) {
    throw new Error(
      `isolation valve broken: ${SELF_SKILL_ROOT_ENV} resolved to ${resolved}, expected inside sandbox ${sandbox}`,
    );
  }
});

afterEach(() => {
  if (previousRootEnv === undefined) delete process.env[SELF_SKILL_ROOT_ENV];
  else process.env[SELF_SKILL_ROOT_ENV] = previousRootEnv;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

const OPEN = "<skill-creator-v2>";
const CLOSE = "</skill-creator-v2>";

function file(): string {
  return agentsMdFilePath();
}

describe("ensureAgentsMdPromptBlock (design D1/D2)", () => {
  it("creates a fresh file containing only the block", () => {
    expect(ensureAgentsMdPromptBlock()).toEqual({ kind: "injected" });
    const content = fs.readFileSync(file(), "utf8");
    expect(content.trim()).toBe(agentsMdGuidanceBlock());
    expect(agentsMdBlockState()).toBe("present");
  });

  it("appends to a blockless file and keeps existing content byte-identical", () => {
    const existing = "# 用户全局指令\n\n- 已有规则一\n";
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), existing, "utf8");
    expect(ensureAgentsMdPromptBlock()).toEqual({ kind: "injected" });
    const content = fs.readFileSync(file(), "utf8");
    expect(content.startsWith(existing)).toBe(true);
    expect(content.slice(existing.length).startsWith("\n")).toBe(true);
    expect(content).toContain(CLOSE);
  });

  it("reports current when the block matches and never rewrites", () => {
    ensureAgentsMdPromptBlock();
    const before = fs.statSync(file()).mtimeMs;
    expect(ensureAgentsMdPromptBlock()).toEqual({ kind: "current" });
    expect(fs.statSync(file()).mtimeMs).toBe(before);
  });

  it("refreshes a diverged block while preserving surrounding content byte-identically", () => {
    const prefix = "# 前置内容\n";
    const suffix = "# 后置内容\n";
    const diverged = `${prefix}${OPEN}\n用户自己改过的块内容\n${CLOSE}\n${suffix}`;
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), diverged, "utf8");
    expect(ensureAgentsMdPromptBlock()).toEqual({ kind: "updated" });
    const content = fs.readFileSync(file(), "utf8");
    expect(content.startsWith(prefix)).toBe(true);
    expect(content.endsWith(suffix)).toBe(true);
    expect(content).toContain("Skill 管理与沉淀走 skill-creator");
    expect(content).not.toContain("用户自己改过的块内容");
  });

  it("refreshes only the first block and reports multiple", () => {
    const stale = `${OPEN}\nold\n${CLOSE}`;
    const twin = `${OPEN}\nold2\n${CLOSE}`;
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), `${stale}\n中间文本\n${twin}\n`, "utf8");
    const result = ensureAgentsMdPromptBlock();
    expect(result.kind).toBe("multiple");
    const content = fs.readFileSync(file(), "utf8");
    expect(content).toContain("Skill 管理与沉淀走 skill-creator");
    expect(content).toContain("old2");
  });

  it("refuses to write when the opening tag is unterminated", () => {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    const broken = `# t\n${OPEN}\n没有闭标签\n`;
    fs.writeFileSync(file(), broken, "utf8");
    const result = ensureAgentsMdPromptBlock();
    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.reason).toContain("unterminated");
    expect(fs.readFileSync(file(), "utf8")).toBe(broken);
    expect(agentsMdBlockState()).toBe("broken");
  });

  it("returns typed failed (never throws) when the path is blocked", () => {
    const agentsDir = path.dirname(file());
    fs.mkdirSync(path.dirname(agentsDir), { recursive: true });
    fs.writeFileSync(agentsDir, "not a directory", "utf8");
    expect(ensureAgentsMdPromptBlock().kind).toBe("failed");
  });

  it("derives the file path from the isolation valve root", () => {
    expect(file()).toBe(path.join(sandbox, "agents", "AGENTS.md"));
    expect(SELF_SKILL_ROOT_ENV).toBe("SKILL_CREATOR_SELF_SKILL_ROOT");
  });
});
