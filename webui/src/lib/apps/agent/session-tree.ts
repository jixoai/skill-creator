/**
 * Agent 页左栏树纯逻辑（skills-agent-page 1.3）。
 *
 * 用户原始需求 [2026-10-03]（design §1/§2）：「左栏：workspaces+sessions 树
 * （分组/续聊/新建）」——分组键 = summary.target.workspaceId（server-owned，
 * 客户端不可伪造）；无 target 旧会话归「Unassigned（只读）」组；subagent 不
 * 入树（list() 已过滤 origin=subagent，r2 裁决——以父会话节点内帧事件行呈现）。
 *
 * 正交意图：
 *   [1] 分组投影：sessions × workspaces（registry 顺序：Global 在前）→ 组列表；
 *       workspace 组恒在（新建入口），Unassigned 组仅有会话时出现。
 *   [2] 排序与查找：组内 createdAt 降序（新会话在上）；按 workspaceId 过滤
 *       （workspace attach 面板复用）；target 相等判定（新建入口高亮当前组）。
 * 妥协声明：无（纯函数，i18n 文案由组件层解析）。
 */

import type { AgentSessionSummary } from "$shared/contracts/agent.js";
import type { Workspace, WorkspaceId } from "$shared/contracts/workspaces.js";

/** Unassigned 组的稳定 key（workspace id 域外的哨兵值）。 */
export const UNASSIGNED_GROUP_KEY = "__unassigned__";

/** 树组投影（label 解析在组件层——纯层不持 i18n）。 */
export interface SessionTreeGroup {
  /** workspace id 或 UNASSIGNED_GROUP_KEY。 */
  key: string;
  /** 归属 workspace（Unassigned 组 = null）。 */
  workspace: Workspace | null;
  /** 组内会话（createdAt 降序）。 */
  sessions: AgentSessionSummary[];
}

/** 按 target.workspaceId 分组（design §2 list 投影；workspaces 取 registry 顺序）。 */
export function groupSessionsByTarget(
  sessions: readonly AgentSessionSummary[],
  workspaces: readonly Workspace[],
): SessionTreeGroup[] {
  const byWorkspace = new Map<string, AgentSessionSummary[]>();
  const unassigned: AgentSessionSummary[] = [];
  for (const session of sessions) {
    const workspaceId = session.target?.workspaceId;
    if (workspaceId === undefined) {
      unassigned.push(session);
      continue;
    }
    const bucket = byWorkspace.get(workspaceId) ?? [];
    bucket.push(session);
    byWorkspace.set(workspaceId, bucket);
  }
  const groups: SessionTreeGroup[] = workspaces
    .filter((workspace) => workspace.kind === "global" || workspace.kind === "directory")
    .map((workspace) => ({
      key: workspace.id,
      workspace,
      sessions: sortSessions(byWorkspace.get(workspace.id) ?? []),
    }));
  // 未命中 registry 的 target workspace（导入后被移除的 ws）：投影为无 workspace
  // 的归属组——会话仍可续聊（server 真相在转录 meta），但无新建入口。
  for (const [workspaceId, bucket] of byWorkspace) {
    if (workspaces.some((workspace) => workspace.id === workspaceId)) continue;
    groups.push({
      key: workspaceId,
      workspace: null,
      sessions: sortSessions(bucket),
    });
  }
  if (unassigned.length > 0) {
    groups.push({
      key: UNASSIGNED_GROUP_KEY,
      workspace: null,
      sessions: sortSessions(unassigned),
    });
  }
  return groups;
}

/** 组内排序：createdAt 降序（新会话在上；非法日期沉底稳定排序）。 */
function sortSessions(sessions: readonly AgentSessionSummary[]): AgentSessionSummary[] {
  return [...sessions].sort((a, b) => {
    const at = Date.parse(a.createdAt);
    const bt = Date.parse(b.createdAt);
    const av = Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at;
    const bv = Number.isNaN(bt) ? Number.NEGATIVE_INFINITY : bt;
    return bv - av;
  });
}

/** workspace attach 面板的会话过滤（1.7：target.workspaceId = 当前 ws）。 */
export function sessionsForWorkspace(
  sessions: readonly AgentSessionSummary[],
  workspaceId: WorkspaceId,
): AgentSessionSummary[] {
  return sortSessions(sessions.filter((session) => session.target?.workspaceId === workspaceId));
}

/** 会话显示名（title 缺省回退 sessionId 前缀）。 */
export function sessionDisplayName(session: AgentSessionSummary): string {
  return session.title.length > 0 ? session.title : session.sessionId.slice(0, 14);
}

/** 会话是否只读（无归属 target 的旧会话——design §2 r2 裁决徽标依据）。 */
export function sessionIsUnassigned(session: AgentSessionSummary): boolean {
  return session.target === undefined;
}
