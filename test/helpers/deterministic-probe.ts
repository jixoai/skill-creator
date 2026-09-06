/**
 * 测试共用的确定性 skills-CLI 探测。
 *
 * 用户原始需求 [2026-09-06]（GOAL.md Observe）：「审查运行中全套 253 项有 2 个 timeout；
 * 先定位实际失败，不通过提高 timeout、删测试……来消除红灯。」
 * 根因：默认探测 shell out `npx skills list --json`（15s 超时、可能访问网络），
 * 每个测试用例各建一个 daemon domain 就各跑一次真实子进程；机器负载高时单个用例
 * 超过 vitest 20s 用例超时。修复是隔离外部子进程，而不是放宽超时。
 * 正交意图：[1] 提供零副作用、零网络的 probe 注入器。
 */
import { createSkillsCliProbe } from "../../src/daemon/skills-cli-probe.js";

/** 返回空映射的确定性探测：测试专用，不 spawn 任何子进程。 */
export function deterministicSkillsCliProbe() {
  return createSkillsCliProbe({ run: async () => ({ stdout: "[]" }) });
}
