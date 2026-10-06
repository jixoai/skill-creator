/**
 * 用户原始需求 [2026-10-06]（skills-tabs-redesign 批 2，design.md Δ1 定稿）：
 * 「Skills 默认不得出现重复 skill-name」——Skills Tab 数据面切换到
 * `skills.listCanonical` 唯一 name 分组投影（服务端拥有 canonical 语义）。
 * 正交意图：
 *   [1] workspace 级分组列表态（listCanonical：q 组级预过滤 + nextCursor 分段
 *       追加 + 单 provider typed error 隔离投影 + 两量纲计数 groupCount/copyCount）。
 *   [2] latest-request-wins + connection owner generation 提交纪律（与
 *       dashboard-skills 同族样板）。
 *   [3] 纯函数投影：provider chips（代表口径）/ duplicates-only 过滤（同内容
 *       ≥2 副本）/ same-content 计数（store 纯逻辑可单测，不依赖 DOM）。
 */
import type { SkillsCanonicalGroup, SkillsListCanonicalOutput } from "$shared/rpc-contract.js";
import type { ProviderId, WorkspaceId } from "$shared/contracts/workspaces.js";
import { getConnectionGeneration, requireRpc } from "./connection.svelte";
import { createRequestGenerationGate } from "./request-generation.js";

/** listCanonical 组行。 */
export type CanonicalGroupRow = SkillsCanonicalGroup;
/** listCanonical provider 摘要行（与 listWorkspace 同形同源）。 */
export type CanonicalProviderSummary = SkillsListCanonicalOutput["providers"][number];

/** dashboard 分组列表态（组件挂载期间由 store 管理；路由离开 reset）。 */
export const dashboardCanonicalState = $state<{
  /** 当前数据归属（wsId + q 指纹）；与请求目标不一致的提交一律丢弃。 */
  key: string | null;
  wsId: WorkspaceId | null;
  q: string;
  providers: CanonicalProviderSummary[];
  groups: CanonicalGroupRow[];
  groupCount: number;
  copyCount: number;
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
}>({
  key: null,
  wsId: null,
  q: "",
  providers: [],
  groups: [],
  groupCount: 0,
  copyCount: 0,
  nextCursor: null,
  loading: false,
  loadingMore: false,
  error: null,
});

const listRequests = createRequestGenerationGate(getConnectionGeneration);

export function canonicalRequestKey(wsId: WorkspaceId, q: string): string {
  return `${wsId}\u0000${q}`;
}

/**
 * 载入第一页组（wsId 或 q 变化时调用；重置全部组并按 request key 隔离竞态）。
 * 单 provider 扫描失败已在 server 侧投影为 providers[].error，整体响应仍成功；
 * 断线/typed 失败置 error（组保留上次成功页——降级策略由调用方决定）。
 */
export async function loadDashboardCanonical(
  wsId: WorkspaceId,
  q = "",
  limit = 200,
): Promise<void> {
  const request = listRequests.issue();
  const key = canonicalRequestKey(wsId, q);
  dashboardCanonicalState.key = key;
  dashboardCanonicalState.wsId = wsId;
  dashboardCanonicalState.q = q;
  dashboardCanonicalState.loading = true;
  dashboardCanonicalState.error = null;
  try {
    const output = await requireRpc().skills.listCanonical(
      q ? { wsId, q, limit } : { wsId, limit },
    );
    if (!request.isCurrent() || dashboardCanonicalState.key !== key) return;
    commitCanonicalPage(output);
  } catch (error) {
    if (!request.isCurrent() || dashboardCanonicalState.key !== key) return;
    dashboardCanonicalState.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (request.isLatest()) dashboardCanonicalState.loading = false;
  }
}

function commitCanonicalPage(output: SkillsListCanonicalOutput): void {
  dashboardCanonicalState.providers = output.providers;
  dashboardCanonicalState.groups = output.groups;
  dashboardCanonicalState.groupCount = output.groupCount;
  dashboardCanonicalState.copyCount = output.copyCount;
  dashboardCanonicalState.nextCursor = output.nextCursor ?? null;
}

/**
 * 经 nextCursor 追加下一页组（有界契约的 UI 面：分段续拉不重不漏）。
 * 无游标时静默跳过；新一轮 loadDashboardCanonical 会代次失效在途追加。
 * 返回新增组数供调用方瞬时反馈（FD-20 同族）。
 */
export async function loadMoreDashboardCanonical(): Promise<number> {
  const { wsId, q, key, nextCursor } = dashboardCanonicalState;
  if (!wsId || !key || !nextCursor) return 0;
  const request = listRequests.issue();
  dashboardCanonicalState.key = key;
  dashboardCanonicalState.loadingMore = true;
  try {
    const output = await requireRpc().skills.listCanonical(
      q ? { wsId, q, limit: 200, cursor: nextCursor } : { wsId, limit: 200, cursor: nextCursor },
    );
    if (!request.isCurrent() || dashboardCanonicalState.key !== key) return 0;
    // 续页不重不漏由服务端游标保证；这里再按组名防御一次（同名去重）。
    const seen = new Set(dashboardCanonicalState.groups.map((group) => group.name));
    const incoming = output.groups.filter((group) => !seen.has(group.name));
    dashboardCanonicalState.groups = [...dashboardCanonicalState.groups, ...incoming];
    dashboardCanonicalState.nextCursor = output.nextCursor ?? null;
    // providers/两量纲计数与首页同源（每页都携带最新投影）；末段提交一次即可。
    dashboardCanonicalState.providers = output.providers;
    dashboardCanonicalState.groupCount = output.groupCount;
    dashboardCanonicalState.copyCount = output.copyCount;
    return incoming.length;
  } catch (error) {
    if (!request.isCurrent() || dashboardCanonicalState.key !== key) return 0;
    dashboardCanonicalState.error = error instanceof Error ? error.message : String(error);
    return 0;
  } finally {
    if (request.isLatest()) dashboardCanonicalState.loadingMore = false;
  }
}

/** 回收分组列表态（路由离开 / 组件卸载）。 */
export function resetDashboardCanonical(): void {
  listRequests.invalidate();
  dashboardCanonicalState.key = null;
  dashboardCanonicalState.wsId = null;
  dashboardCanonicalState.q = "";
  dashboardCanonicalState.providers = [];
  dashboardCanonicalState.groups = [];
  dashboardCanonicalState.groupCount = 0;
  dashboardCanonicalState.copyCount = 0;
  dashboardCanonicalState.nextCursor = null;
  dashboardCanonicalState.loading = false;
  dashboardCanonicalState.loadingMore = false;
  dashboardCanonicalState.error = null;
}

// ---- 纯投影（可单测） ----

/**
 * provider chips 计数（Δ1 批 2 裁决：chips 作用于组代表——facet 口径 = 组代表的
 * provider 归属，非已载行数）。非零计数前置、零计数殿后（P2-2 排序保留）。
 * 组里有、providers 摘要缺席的 provider（防御）：以 id 兜底补一行。
 */
export function canonicalProviderChips(
  providers: readonly CanonicalProviderSummary[],
  groups: readonly CanonicalGroupRow[],
): Array<{ providerId: ProviderId; label: string; count: number; error: boolean }> {
  const representativeCounts = new Map<string, number>();
  for (const group of groups) {
    const providerId = group.representative.providerId;
    representativeCounts.set(providerId, (representativeCounts.get(providerId) ?? 0) + 1);
  }
  const summaries = providers.map((provider) => ({
    providerId: provider.providerId,
    label: provider.label,
    count: representativeCounts.get(provider.providerId) ?? 0,
    error: provider.error !== undefined,
  }));
  for (const [providerId, count] of representativeCounts) {
    if (!summaries.some((entry) => entry.providerId === providerId)) {
      summaries.push({
        providerId: providerId as ProviderId,
        label: providerId,
        count,
        error: false,
      });
    }
  }
  const nonZero = summaries.filter((entry) => entry.count > 0);
  const zero = summaries.filter((entry) => entry.count === 0);
  return [...nonZero, ...zero];
}

/** 组内最大同内容副本数（contentHash 分桶；唯一内容 = 1）。 */
export function groupSameContentCount(group: CanonicalGroupRow): number {
  const byHash = new Map<string, number>();
  for (const copy of group.copies) {
    if (!copy.contentHash) continue;
    byHash.set(copy.contentHash, (byHash.get(copy.contentHash) ?? 0) + 1);
  }
  let max = 1;
  for (const count of byHash.values()) max = Math.max(max, count);
  return max;
}

/**
 * duplicates-only + provider chip 过滤（纯函数；q 过滤已在服务端完成）。
 * duplicates-only 语义 = 组内存在同内容副本（≥2 copies 共享 contentHash）。
 * 组序 = 服务端组名序（不做客户端重排——游标分段口径即展示口径）。
 */
export function filterCanonicalGroups(
  groups: readonly CanonicalGroupRow[],
  options: { providerId?: ProviderId | null; duplicatesOnly?: boolean },
): CanonicalGroupRow[] {
  return groups.filter((group) => {
    if (options.providerId && group.representative.providerId !== options.providerId) return false;
    if (options.duplicatesOnly && groupSameContentCount(group) < 2) return false;
    return true;
  });
}
