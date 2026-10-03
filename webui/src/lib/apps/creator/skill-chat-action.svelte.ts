/**
 * 技能聊天入口动作（creator-agent-chat 1.4）。
 *
 * 用户原始需求 [2026-10-03]（design §1 r3 + specs/creator「技能维度的续聊精确
 * 匹配」）：「Chat about this skill 从 skills 详情发起，按统一 target
 * （workspaceId/providerId）+ seedSkill = 该技能 过滤会话——命中最近一条即
 * 续聊；无 seedSkill 匹配即新建（首条消息携带技能上下文，新会话 seed 记录
 * 该技能引用）。不做『同 target 最近会话不分技能一律续上』」。
 *
 * 正交意图：
 *   [1] resume 查找（两态）：列表未载先补拉一次（连接就绪时）；命中 =
 *   selectAgentSession 续聊既有 transcript；无匹配 = beginNewAgentSession
 *   （target + cwd 成对，Imported ws root）+ skill-chat seed 落 transcript
 *   meta（r3 补线：契约第三 kind）——summary.seedSkill 投影闭环，同技能
 *   再点击命中续聊；不自动发送，用户保有最后一步。
 *   [2] 面板开合：入口在 skills dashboard（workspace 页），会话呈现归
 *   workspace attach 面板承载——setAgentPanelOpen(true) 即可续聊/起草。
 * （r3 补线后无妥协：seed 落 meta，summary 投影即查找键。）
 */
import {
  agentSessionsList,
  loadAgentSessions,
  seedSkillChat,
  selectAgentSession,
  setAgentPanelOpen,
} from "$lib/stores/agent.svelte";
import { connectionState } from "$lib/stores/connection.svelte";
import { workspaceState } from "$lib/stores/workspaces.svelte";
import { buildSkillChatIntro, findSkillChatSession } from "./creator-sessions.js";
import type { ProviderId, WorkspaceId } from "$shared/contracts/workspaces.js";
import type { SkillId } from "$shared/contracts/skills.js";

/** 技能聊天入口身份（detail 面板的当前技能三元组 + 显示名）。 */
export interface SkillChatEntry {
  workspaceId: WorkspaceId;
  providerId: ProviderId;
  skillId: SkillId;
  skillName: string;
}

/**
 * 「Chat about this skill」动作（specs/creator 两 Scenario 的实现点）：
 * 同技能命中续聊 vs 异技能/无匹配新建。列表未载且已连接时先补拉（await——
 * 查找键以 server 投影为准，不用本地陈旧列表猜）；拉取失败按当前列表降级
 * 查找（可能空 → 新建，不阻塞入口）。
 */
export async function startSkillChat(entry: SkillChatEntry): Promise<void> {
  if (
    connectionState.status === "connected" &&
    !agentSessionsList.loaded &&
    !agentSessionsList.loading
  ) {
    await loadAgentSessions();
  }
  const hit = findSkillChatSession(
    agentSessionsList.sessions,
    { workspaceId: entry.workspaceId, providerId: entry.providerId },
    entry.skillId,
  );
  if (hit !== null) {
    selectAgentSession(hit.sessionId);
    setAgentPanelOpen(true);
    return;
  }
  const workspace = workspaceState.workspaces.find(
    (item) => item.id === (entry.workspaceId as string),
  );
  // cwd = Imported ws root（bash 落点）；Global/未知 = 缺省（daemon home）。
  const cwd = workspace?.kind === "directory" ? workspace.path : undefined;
  // r3 补线：新建分支落 skill-chat seed meta（daemon 契约已扩展第三 kind），
  // summary.seedSkill 投影闭环——同技能再点击即命中续聊。
  seedSkillChat({
    workspaceId: entry.workspaceId,
    providerId: entry.providerId,
    skillId: entry.skillId,
    skillName: entry.skillName,
    intro: buildSkillChatIntro(entry.skillName),
    ...(cwd !== undefined ? { cwd } : {}),
  });
  setAgentPanelOpen(true);
}
