/**
 * 用户原始需求 [2026-07-22]：「一个 Workspace 下，是可以包含多个 providers 的。」
 * 修订 [2026-09-17]（skill-search-gui）：「任何需要搜索 skills 的地方都吃到
 * BM25 + 中文分词 + typo 容忍」——新增跨 Workspace 检索态（skills.search RPC）。
 * 正交意图：
 *   [1] 按 Workspace Provider 对投影技能列表与详情。
 *   [2] 编排同一 Provider 根目录内的启停和校验命令。
 *   [3] 派生查询过滤与统计数据。
 *   [4] 持有跨 Workspace 的 BM25 检索态（latest-request-wins + 断线代次失效）。
 */
import type {
  ProviderId,
  SkillId,
  SkillInfo,
  SkillMetadata,
  SkillSearchResult,
  ToggleSummary,
  ValidateResult,
  WorkspaceId,
  WorkspaceProviderTarget,
} from "../types";
import { untrack } from "svelte";
import { getConnectionGeneration, requireRpc } from "./connection.svelte";
import { createRequestGenerationGate } from "./request-generation.js";
import { workspaceState } from "./workspaces.svelte";

const listRequests = createRequestGenerationGate(getConnectionGeneration);
const selectionRequests = createRequestGenerationGate(getConnectionGeneration);
const mutationRequests = createRequestGenerationGate(getConnectionGeneration);
const validationRequests = createRequestGenerationGate(getConnectionGeneration);
const searchRequests = createRequestGenerationGate(getConnectionGeneration);

/** 当前 Workspace Provider 的技能列表、选中项与加载状态。 */
export const skillsState = $state<{
  target: WorkspaceProviderTarget | null;
  skills: SkillMetadata[];
  selected: SkillInfo | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  query: string;
}>({
  target: null,
  skills: [],
  selected: null,
  loading: false,
  refreshing: false,
  error: null,
  query: "",
});

/** 加载指定 Workspace Provider 的完整技能列表。 */
export async function loadSkills(target: WorkspaceProviderTarget): Promise<void> {
  const request = listRequests.issue();
  const canCommit = (): boolean => request.isCurrent() && targetsEqual(skillsState.target, target);
  // 调用方常在 $effect 中调用；untrack 防止这里同步读取的 .target/.skills 成为 effect 依赖，
  // 否则异步提交的新 skills 数组会让 effect 无限重跑（每轮重发 list RPC）。
  const targetChanged = untrack(() => !targetsEqual(skillsState.target, target));
  const hadSkills = untrack(() => skillsState.skills.length > 0);
  if (targetChanged) {
    selectionRequests.invalidate();
    skillsState.target = target;
    skillsState.skills = [];
    skillsState.selected = null;
  }
  skillsState.loading = !hadSkills;
  skillsState.refreshing = hadSkills;
  skillsState.error = null;
  try {
    const { skills } = await requireRpc().skills.list({ ...target, includeDisabled: true });
    if (!canCommit()) return;
    skillsState.skills = skills;
    if (skillsState.selected && !skills.some((skill) => skill.id === skillsState.selected?.id)) {
      skillsState.selected = null;
    }
  } catch (error) {
    if (!canCommit()) return;
    skillsState.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (request.isLatest()) {
      skillsState.loading = false;
      skillsState.refreshing = false;
    }
  }
}

/** 加载并选中当前 Workspace Provider 内的技能详情。 */
export async function selectSkill(skillId: SkillId): Promise<void> {
  const target = skillsState.target;
  if (!target) return;
  const request = selectionRequests.issue();
  const canCommit = (): boolean => request.isCurrent() && targetsEqual(skillsState.target, target);
  skillsState.error = null;
  try {
    const selected = await requireRpc().skills.info({ ...target, skillId, includeDisabled: true });
    if (canCommit()) skillsState.selected = selected;
  } catch (error) {
    if (!canCommit()) return;
    skillsState.error = error instanceof Error ? error.message : String(error);
  }
}

/** 清除当前技能详情选择。 */
export function clearSelection(): void {
  selectionRequests.invalidate();
  skillsState.selected = null;
}

/** 批量启用或禁用当前 Provider 内的技能并刷新投影。 */
export async function toggleSkills(
  skillIds: SkillId[],
  mode: "enable" | "disable",
): Promise<ToggleSummary | null> {
  const target = skillsState.target;
  if (!target) return null;
  const request = mutationRequests.issue();
  const canCommit = (): boolean => request.isCurrent() && targetsEqual(skillsState.target, target);
  let result: ToggleSummary;
  try {
    result = await requireRpc().skills.toggle({ ...target, skillIds, mode });
  } catch (error) {
    if (!canCommit()) return null;
    throw error;
  }
  if (!canCommit()) return null;
  await loadSkills(target);
  if (!canCommit()) return null;
  if (skillsState.selected && skillIds.includes(skillsState.selected.id)) {
    await selectSkill(skillsState.selected.id);
  }
  return canCommit() ? result : null;
}

/** 校验当前 Provider 内的一个技能。 */
export async function validateSkill(skillId: SkillId): Promise<ValidateResult | null> {
  const target = skillsState.target;
  if (!target) return null;
  const request = validationRequests.issue();
  const canCommit = (): boolean => request.isCurrent() && targetsEqual(skillsState.target, target);
  try {
    const result = await requireRpc().skills.validate({ ...target, skillId });
    return canCommit() ? result : null;
  } catch (error) {
    if (!canCommit()) return null;
    throw error;
  }
}

/** 按当前查询词派生可见技能列表。 */
export function filteredSkills(): SkillMetadata[] {
  const query = skillsState.query.trim().toLowerCase();
  if (!query) return skillsState.skills;
  return skillsState.skills.filter((skill) =>
    [skill.name, skill.description, skill.provider].some((value) =>
      value.toLowerCase().includes(query),
    ),
  );
}

/**
 * 直接从 daemon RPC 拉取单个技能详情（含正文与 revision）。
 *
 * 与 `selectSkill` 不同：本函数不写入全局 `skillsState`，结果交由调用方在组件级
 * `$state` 内持有（符合状态分层：技能正文不缓存在前端 memory 跨渲染周期）。
 */
export function fetchSkillInfo(
  target: WorkspaceProviderTarget,
  skillId: SkillId,
): Promise<SkillInfo> {
  return requireRpc().skills.info({ ...target, skillId, includeDisabled: true });
}

/** 派生技能总数、启停数与 Provider 分布。 */
export function skillCounts(): {
  total: number;
  enabled: number;
  disabled: number;
  byProvider: Record<string, number>;
} {
  const byProvider: Record<string, number> = {};
  let enabled = 0;
  let disabled = 0;
  for (const skill of skillsState.skills) {
    if (skill.disabled) disabled += 1;
    else enabled += 1;
    byProvider[skill.provider] = (byProvider[skill.provider] ?? 0) + 1;
  }
  return { total: skillsState.skills.length, enabled, disabled, byProvider };
}

/** Compare the authority-carrying fields of a Workspace Provider target. */
export function targetsEqual(
  left: WorkspaceProviderTarget | null,
  right: WorkspaceProviderTarget | null,
): boolean {
  return left?.workspaceId === right?.workspaceId && left?.providerId === right?.providerId;
}

/** 跨 Workspace 的技能检索状态（skills.search：BM25 + 中文分词 + typo 容忍）。 */
export const searchState = $state<{
  query: string;
  results: SkillSearchResult[];
  searching: boolean;
  error: string | null;
}>({ query: "", results: [], searching: false, error: null });

/** 检索结果条数上限的默认值（契约上限 50；GUI 消费方共用 20）。 */
const DEFAULT_SEARCH_LIMIT = 20;

/**
 * 跨 Workspace 检索技能（镜像 loadSkills 样板：issue → requireRpc → isCurrent 提交
 * → isLatest 清 loading）。空/全空白 query 不发 RPC（输入 schema min-1 是合同），
 * 直接清空结果态；错误保留旧结果并置 error——降级策略由调用方决定。
 */
export async function searchSkills(
  query: string,
  limit: number = DEFAULT_SEARCH_LIMIT,
): Promise<void> {
  const trimmed = query.trim();
  if (!trimmed) {
    resetSkillSearch();
    return;
  }
  const request = searchRequests.issue();
  searchState.query = trimmed;
  searchState.searching = true;
  try {
    const { results } = await requireRpc().skills.search({ query: trimmed, limit });
    if (!request.isCurrent()) return;
    searchState.results = results;
    searchState.error = null;
  } catch (error) {
    if (!request.isCurrent()) return;
    // 保留已提交结果（调用方可降级展示）；错误态由调用方决定降级策略。
    searchState.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (request.isLatest()) searchState.searching = false;
  }
}

/** 清空检索态（路由离开 / 消费方关闭时回收全局 searchState）。 */
export function resetSkillSearch(): void {
  searchRequests.invalidate();
  searchState.query = "";
  searchState.results = [];
  searchState.searching = false;
  searchState.error = null;
}

/** 检索结果 installation 的作用域显示名（workspace/providers label 反查，查不到用 id 兜底）。 */
export function installationScopeLabel(workspaceId: WorkspaceId, providerId: ProviderId): string {
  const workspace = workspaceState.workspaces.find((entry) => entry.id === workspaceId);
  if (!workspace) return `${workspaceId} / ${providerId}`;
  const provider = workspace.providers.find((entry) => entry.id === providerId);
  return `${workspace.label} / ${provider?.label ?? providerId}`;
}
