/**
 * 用户原始需求 [2026-10-02]（skills-dashboard）：「左侧 workspace 这里的入口，
 * 改成 skills，默认不再按照 agent 去做分类，而是直接展示所有的 skill」。
 * 正交意图：
 *   [1] workspace 级平铺技能列表态（skills.listWorkspace：q 预过滤 + nextCursor
 *       分段追加 + 单 provider typed error 隔离投影）。
 *   [2] latest-request-wins + connection owner generation 提交纪律（与
 *       loadSkills/searchSkills 同族样板）。
 *   [3] 纯函数投影：provider chips 计数 / duplicates-only 过滤 / 重复组成员计数
 *       （store 纯逻辑可单测，不依赖 DOM）。
 *   [4] 简单窗口化虚拟列表数学（>200 行时只减 DOM；服务端有界性由契约承担）。
 */
import type { SkillsListWorkspaceOutput } from "$shared/rpc-contract.js";
import type { SkillListWorkspaceDuplicates } from "$shared/contracts/search.js";
import type { ProviderId, WorkspaceId } from "$shared/contracts/workspaces.js";
import type { SkillId } from "$shared/contracts/skills.js";
import { getConnectionGeneration, requireRpc } from "./connection.svelte";
import { createRequestGenerationGate } from "./request-generation.js";

/** listWorkspace 平铺行（SkillMetadata + typed providerId 归属）。 */
export type DashboardSkillRow = SkillsListWorkspaceOutput["skills"][number];
/** listWorkspace provider 摘要行（单 provider 失败 → typed error 字段）。 */
export type DashboardProviderSummary = SkillsListWorkspaceOutput["providers"][number];

/** dashboard 平铺列表态（组件挂载期间由 store 管理；路由离开 reset）。 */
export const dashboardSkillsState = $state<{
  /** 当前数据归属（wsId + q 指纹）；与请求目标不一致的提交一律丢弃。 */
  key: string | null;
  wsId: WorkspaceId | null;
  q: string;
  providers: DashboardProviderSummary[];
  rows: DashboardSkillRow[];
  nextCursor: string | null;
  duplicates: SkillListWorkspaceDuplicates | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
}>({
  key: null,
  wsId: null,
  q: "",
  providers: [],
  rows: [],
  nextCursor: null,
  duplicates: null,
  loading: false,
  loadingMore: false,
  error: null,
});

const listRequests = createRequestGenerationGate(getConnectionGeneration);

export function dashboardRequestKey(wsId: WorkspaceId, q: string): string {
  return `${wsId}\u0000${q}`;
}

/**
 * 载入第一页（wsId 或 q 变化时调用；重置全部行并按 request key 隔离竞态）。
 * 单 provider 扫描失败已在 server 侧投影为 providers[].error，整体响应仍成功；
 * 断线/typed 失败置 error（行保留上次成功页——降级策略由调用方决定）。
 */
export async function loadDashboardSkills(wsId: WorkspaceId, q = ""): Promise<void> {
  const request = listRequests.issue();
  const key = dashboardRequestKey(wsId, q);
  dashboardSkillsState.key = key;
  dashboardSkillsState.wsId = wsId;
  dashboardSkillsState.q = q;
  dashboardSkillsState.loading = true;
  dashboardSkillsState.error = null;
  try {
    const output = await requireRpc().skills.listWorkspace(
      q ? { wsId, q, limit: 200 } : { wsId, limit: 200 },
    );
    if (!request.isCurrent() || dashboardSkillsState.key !== key) return;
    dashboardSkillsState.providers = output.providers;
    dashboardSkillsState.rows = output.skills;
    dashboardSkillsState.nextCursor = output.nextCursor ?? null;
    dashboardSkillsState.duplicates = output.duplicates;
  } catch (error) {
    if (!request.isCurrent() || dashboardSkillsState.key !== key) return;
    dashboardSkillsState.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (request.isLatest()) dashboardSkillsState.loading = false;
  }
}

/**
 * 经 nextCursor 追加下一页（有界契约的 UI 面：分段续拉不重不漏）。
 * 无游标时静默跳过；新一轮 loadDashboardSkills 会代次失效在途追加。
 * FD-20 反馈增强：返回新增行数供调用方瞬时反馈（1.5s toast / 按钮区文案）。
 */
export async function loadMoreDashboardSkills(): Promise<number> {
  const { wsId, q, key, nextCursor } = dashboardSkillsState;
  if (!wsId || !key || !nextCursor) return 0;
  const request = listRequests.issue();
  dashboardSkillsState.key = key;
  dashboardSkillsState.loadingMore = true;
  try {
    const output = await requireRpc().skills.listWorkspace(
      q ? { wsId, q, limit: 200, cursor: nextCursor } : { wsId, limit: 200, cursor: nextCursor },
    );
    if (!request.isCurrent() || dashboardSkillsState.key !== key) return 0;
    // 续页不重不漏由服务端游标保证；这里再按 (providerId, id) 键防御一次（同键去重）。
    const seen = new Set(dashboardSkillsState.rows.map((row) => `${row.providerId} ${row.id}`));
    const incoming = output.skills.filter((row) => !seen.has(`${row.providerId} ${row.id}`));
    dashboardSkillsState.rows = [...dashboardSkillsState.rows, ...incoming];
    dashboardSkillsState.nextCursor = output.nextCursor ?? null;
    // providers/duplicates 与首页同源（每页都携带最新投影）；末段提交一次即可。
    dashboardSkillsState.providers = output.providers;
    dashboardSkillsState.duplicates = output.duplicates;
    return incoming.length;
  } catch (error) {
    if (!request.isCurrent() || dashboardSkillsState.key !== key) return 0;
    dashboardSkillsState.error = error instanceof Error ? error.message : String(error);
    return 0;
  } finally {
    if (request.isLatest()) dashboardSkillsState.loadingMore = false;
  }
}

/** 回收 dashboard 列表态（路由离开 / 组件卸载）。 */
export function resetDashboardSkills(): void {
  listRequests.invalidate();
  dashboardSkillsState.key = null;
  dashboardSkillsState.wsId = null;
  dashboardSkillsState.q = "";
  dashboardSkillsState.providers = [];
  dashboardSkillsState.rows = [];
  dashboardSkillsState.nextCursor = null;
  dashboardSkillsState.duplicates = null;
  dashboardSkillsState.loading = false;
  dashboardSkillsState.loadingMore = false;
  dashboardSkillsState.error = null;
}

// ---- 纯投影（可单测） ----

/**
 * provider chips 计数（facet 口径 = provider 摘要的 skillCount 总量，非已载行数）。
 * 2.2 处置批 P2-2 的排序保留：非零计数前置、零计数殿后（组内保持摘要相对序）。
 * loadMore 抖动修复（workspace-page-polish θ4）：摘要总量在同一查询的每一页
 * 响应里恒同值（daemon scanProvider 返回全量计数）——chips 计数/分区跨页
 * 稳定，不再随「已载行数」逐页重排。平铺行里有、providers 摘要缺席的 provider
 * （防御）：以 id 兜底补一行（计数退回已载行数）。
 */
export function dashboardProviderCounts(
  providers: readonly DashboardProviderSummary[],
  rows: readonly DashboardSkillRow[],
): Array<{ providerId: ProviderId; label: string; count: number; error: boolean }> {
  const loadedCounts = new Map<string, number>();
  for (const row of rows)
    loadedCounts.set(row.providerId, (loadedCounts.get(row.providerId) ?? 0) + 1);
  const summaries = providers.map((provider) => ({
    providerId: provider.providerId,
    label: provider.label,
    count: provider.skillCount,
    error: provider.error !== undefined,
  }));
  // 平铺行里有、providers 摘要缺席的 provider（防御）：以 id 兜底补一行。
  for (const [providerId, count] of loadedCounts) {
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

/** skillId → 同内容副本数（重复组成员数 - 1；不在组内无条目）。 */
export function dashboardDuplicateCounts(
  duplicates: SkillListWorkspaceDuplicates | null,
): Map<SkillId, number> {
  const counts = new Map<SkillId, number>();
  if (!duplicates) return counts;
  for (const group of duplicates.groups) {
    for (const member of group.members) {
      counts.set(member.id, group.members.length - 1);
    }
  }
  return counts;
}

/**
 * duplicates-only 过滤 + provider chip 过滤（纯函数；q 过滤已在服务端完成）。
 * 2.2 处置批 P2-7：行序可预测——provider 分组按首现行序（保持服务端分组语义），
 * 组内以 name localeCompare 作二级排序键（重载/重扫不再随文件系统顺序漂移；
 * 等名行由 sort 稳定性退化到输入序）。
 */
export function filterDashboardRows(
  rows: readonly DashboardSkillRow[],
  options: { providerId?: ProviderId | null; duplicatesOnly?: boolean },
  duplicateCounts?: ReadonlyMap<SkillId, number>,
): DashboardSkillRow[] {
  const counts = duplicateCounts ?? new Map<SkillId, number>();
  const providerOrder = new Map<string, number>();
  for (const row of rows) {
    if (!providerOrder.has(row.providerId)) providerOrder.set(row.providerId, providerOrder.size);
  }
  return [...rows]
    .sort((a, b) => {
      const groupA = providerOrder.get(a.providerId) ?? 0;
      const groupB = providerOrder.get(b.providerId) ?? 0;
      if (groupA !== groupB) return groupA - groupB;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    })
    .filter((row) => {
      if (options.providerId && row.providerId !== options.providerId) return false;
      if (options.duplicatesOnly && !counts.has(row.id)) return false;
      return true;
    });
}

/** 任一 truncated 标志为真（UI 提示经 skills.duplicates 查全量）。 */
export function dashboardDuplicatesTruncated(
  duplicates: SkillListWorkspaceDuplicates | null,
): boolean {
  if (!duplicates) return false;
  if (duplicates.groupsTruncated) return true;
  return duplicates.groups.some((group) => group.membersTruncated);
}

// ---- 虚拟化窗口数学（纯函数） ----

/**
 * 平铺行统一行高（border-box，含 1px border-b）：py-2.5(20) + 名字行 leading-5(20)
 * + mt-0.5(2) + 描述 line-clamp-2 leading-4(32) + border(1) = 75px。
 * 行高必须与渲染层 CSS 严格一致（skills-screen 行类 h-[75px]）——窗口化 spacer
 * 位移按本常量计算，行高漂移即滚动错位（loadMore 抖动根因之一：旧行自然高
 * 59-75px 不等、常量 57，虚拟化后窗口与真实内容错位）。
 */
export const DASHBOARD_ROW_HEIGHT = 75;
/**
 * 虚拟化启用阈值：== listWorkspace 首页 limit（200）。满页首页（存在 nextCursor
 * ⇒ 首页必为满 200 行）在初始提交即达阈值——启用判定只发生在首页提交，续页
 * 追加永不跨档（loadMore 抖动根因之二：旧判定 `visibleRows.length > 200` 在
 * 200→201 追加瞬间切换渲染模式，整列 DOM 换成窗口 + spacer，可视行被销毁）。
 */
export const DASHBOARD_VIRTUALIZE_THRESHOLD = 200;
/** 视口上下各多渲染的行数（滚动时的安全余量）。 */
export const DASHBOARD_VIRTUAL_OVERSCAN = 6;
/** viewport 不可测（jsdom/0 高）时的默认页大小（保证窄窗口也能渲染一屏）。 */
export const DASHBOARD_FALLBACK_VIEWPORT_ROWS = 24;

/**
 * 计算可见窗口 [start, end)。viewport ≤ 0 时按 fallback 行数出窗（布局不可测
 * 环境仍可测「只渲染子集」）；返回值与 scrollTop 单位无关（行序号）。
 */
export function computeDashboardWindow(
  count: number,
  scrollTop: number,
  viewportPx: number,
  rowHeight = DASHBOARD_ROW_HEIGHT,
  overscan = DASHBOARD_VIRTUAL_OVERSCAN,
): { start: number; end: number } {
  if (count <= 0) return { start: 0, end: 0 };
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const rowsInViewport =
    viewportPx > 0
      ? Math.ceil(viewportPx / rowHeight) + overscan * 2
      : DASHBOARD_FALLBACK_VIEWPORT_ROWS;
  const end = Math.min(count, first + rowsInViewport);
  return { start: Math.min(first, Math.max(0, end - 1)), end };
}
