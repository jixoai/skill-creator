/**
 * 用户原始需求 [2026-09-30]（self-skill-symlink）：「如果发现 ~/.agents/skills/
 * skill-creator-v2 的源头不是 git/npm……在 cli 或者 webui 启动之后提醒用户存在
 * skill 冲突，给几个选择：覆盖安装（可选备份）；坚持使用用户自己已有的版本。」
 * Dock 冷启动向量无 TTY，WebUI 首页 banner 是该场景唯一可见提醒面。
 *
 * 正交意图：
 *   [1] selfSkill.state 拉取与 conflict/kept 投影（请求代次门）。
 *   [2] resolve（可选备份）/keep 裁决动作与终态反馈（toast 由调用方出）。
 */
import type { SelfSkillStatus } from "$shared/contracts/self-skill.js";
import { getConnectionGeneration, getRpc } from "./connection.svelte";
import { createRequestGenerationGate } from "./request-generation.js";

const stateRequests = createRequestGenerationGate(getConnectionGeneration);
const decisionRequests = createRequestGenerationGate(getConnectionGeneration);

/** 自举技能状态（conflict 时首页 banner 消费）。 */
export const selfSkillState = $state<{
  status: SelfSkillStatus | null;
  loading: boolean;
}>({ status: null, loading: false });

/** 刷新自举技能状态（Workspaces 首页挂载时调用）。 */
export async function loadSelfSkillState(): Promise<void> {
  const request = stateRequests.issue();
  const rpc = getRpc();
  if (!rpc) {
    if (request.isLatest()) selfSkillState.loading = false;
    return;
  }
  selfSkillState.loading = true;
  try {
    const status = await rpc.selfSkill.state({});
    if (!request.isCurrent()) return;
    selfSkillState.status = status;
  } catch {
    // 状态面失败不打扰首页（banner 静默缺席；CLI/daemon 日志仍有冲突记录）。
    if (request.isCurrent()) selfSkillState.status = null;
  } finally {
    if (request.isLatest()) selfSkillState.loading = false;
  }
}

/** 覆盖安装产品版本；成功返回备份路径（可选备份仅对真目录冲突生效）。 */
export async function resolveSelfSkillConflict(
  backup: boolean,
): Promise<{ ok: true; backupPath?: string } | { ok: false; reason: string }> {
  const request = decisionRequests.issue();
  const rpc = getRpc();
  if (!rpc) return { ok: false, reason: "Not connected to the daemon." };
  try {
    const result = await rpc.selfSkill.resolve({ backup });
    if (result.ok && request.isCurrent()) void loadSelfSkillState();
    return result;
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** 保留用户版本（fingerprint 记忆；条目变化后重新提醒）。 */
export async function keepSelfSkillUserVersion(): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  const request = decisionRequests.issue();
  const rpc = getRpc();
  if (!rpc) return { ok: false, reason: "Not connected to the daemon." };
  try {
    const result = await rpc.selfSkill.keep({});
    if (result.ok && request.isCurrent()) void loadSelfSkillState();
    return result;
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
