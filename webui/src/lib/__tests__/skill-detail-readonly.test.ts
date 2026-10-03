/**
 * skill-detail 只读投影源扫描断言（creator-agent-chat 1.6；design §3/§5）。
 *
 * 用户原始需求 [2026-10-02]（skills-dashboard design §2，r2/r3 修订）：
 * 「detail = 只读文档详情 + 管理动作；frontmatter/正文编辑唯一真相 = Creator
 * 编辑页」——specs/creator「编辑单一真相源」Scenario：除 skills.toggle 外无
 * 任何 skills 域写 RPC 调用；编辑/保存/删除动作全部为深链或 agent 域动作。
 *
 * 正交意图：
 *   [1] 源扫描：detail 面无 creator.save/creator.remove 调用面（store 包装
 *       saveSkill/removeSkill 与 rpc 直连双禁）、不 import creator 编辑 store；
 *       skills 域唯一写 RPC = toggleSkills（正向钉死）。
 *   [2] 归属豁免：agent 域 Chat 入口（startSkillChat——agent.session.* 动作）
 *       不属 skills 域写，不受此断言（design §5 明示）——反向钉死其在场，
 *       防止后续重构把入口又退回禁用占位。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = join(import.meta.dirname, "..", "components", "skills", "skill-detail-panel.svelte");

describe("skill-detail readonly projection (specs/creator「编辑单一真相源」)", () => {
  // 只扫代码：剥注释（文件头的意图声明会提及被禁词——断言面是调用点，不是文档）。
  const code = readFileSync(SOURCE, "utf8")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/[^\n]*/g, "");

  it("has zero creator-domain write call sites (no save/remove, no creator store import)", () => {
    const banned = [
      /saveSkill/,
      /removeSkill/,
      /creator\.save/,
      /creator\.remove/,
      /stores\/creator/,
    ];
    const offenders = banned.filter((pattern) => pattern.test(code));
    expect(offenders, `banned patterns present: ${offenders}`).toEqual([]);
  });

  it("keeps skills.toggle as the ONLY skills-domain write RPC (positive pin)", () => {
    expect(code).toMatch(/toggleSkills/);
    // store 包装层其余写入口清零（toggle 之外 skills 域无写面）。
    const skillsStoreWrites = [/disableSkills/, /enableSkills/, /skills\.create/];
    expect(skillsStoreWrites.filter((pattern) => pattern.test(code))).toEqual([]);
  });

  it("wires the agent-domain chat entry (startSkillChat) — not a skills-domain write", () => {
    expect(code).toMatch(/startSkillChat/);
    expect(code).toMatch(/data-skill-chat-entry/);
  });

  it("keeps edit actions as deep links only (Edit in Creator → creator.workspace.skill)", () => {
    expect(code).toMatch(/creator\.workspace\.skill/);
  });
});
