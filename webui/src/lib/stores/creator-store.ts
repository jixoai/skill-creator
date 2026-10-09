/**
 * 用户原始需求 [2026-10-09]（creator-skill-store 批 2）：「然后再通过 ccski-sdk
 * 将这些 skill 安装到本地 agent skills 目录……怎么把这个体验做得更好、更平滑」。
 * 正交意图：
 *   [1] creatorStore.* 列面/应用面命令的 per-call 代次门包装（同 repository.svelte
 *       范式：结果交调用方持有，断线/新请求撤销旧响应提交资格——latest-request-wins）。
 *   [2] typed result 不吞：apply/sync/uninstall 的逐收据结果原样透传，业务失败
 *       不伪装异常；revision 闸（CONFLICT）等 ORPC 业务错以 {message, code} 呈现。
 * 妥协声明：状态不缓存在全局单例——列面组件按需拉取并持有，刷新即重拉。
 */
import { ORPCError } from "@orpc/client";
import type {
  CreatorStoreApplyResult,
  CreatorStoreListResult,
  CreatorStoreRemoveResult,
  CreatorStoreStatusResult,
  CreatorStoreSyncResult,
  CreatorStoreUninstallResult,
  SkillDirectoryName,
  WorkspaceProviderTarget,
} from "../types";
import { getConnectionGeneration, requireRpc } from "./connection.svelte";
import { createRequestGenerationGate } from "./request-generation.js";

/** 结构化调用失败（与 repository 面同族：message + oRPC 业务码）。 */
export interface CreatorStoreCallFailure {
  message: string;
  code?: string;
}

function toFailure(error: unknown): CreatorStoreCallFailure {
  if (error instanceof ORPCError) return { message: error.message, code: String(error.code) };
  return { message: error instanceof Error ? error.message : String(error) };
}

/** 绑定连接世代的 per-call 代次门（per-call 构造，组件卸载即 GC）。 */
function bindGate(): { issue: () => { isCurrent: () => boolean } } {
  const gate = createRequestGenerationGate(getConnectionGeneration);
  return { issue: () => gate.issue() };
}

/** 枚举 store 技能（不兼容条目跳过计数随行）。 */
export async function listStoreSkills(): Promise<{
  list: CreatorStoreListResult | null;
  error: CreatorStoreCallFailure | null;
}> {
  const request = bindGate().issue();
  try {
    const list = await requireRpc().creatorStore.list({});
    return request.isCurrent() ? { list, error: null } : { list: null, error: null };
  } catch (error) {
    if (!request.isCurrent()) return { list: null, error: null };
    return { list: null, error: toFailure(error) };
  }
}

/** 查询一份 store 技能的状态（已应用 roots + outdated 过期判定）。 */
export async function storeSkillStatus(
  directoryName: SkillDirectoryName,
): Promise<{ status: CreatorStoreStatusResult | null; error: CreatorStoreCallFailure | null }> {
  const request = bindGate().issue();
  try {
    const status = await requireRpc().creatorStore.status({ directoryName });
    return request.isCurrent() ? { status, error: null } : { status: null, error: null };
  } catch (error) {
    if (!request.isCurrent()) return { status: null, error: null };
    return { status: null, error: toFailure(error) };
  }
}

/** 应用到显式 targets（ccski 两阶段；逐 target 收据透传，不抛业务错）。 */
export async function applyStoreSkill(input: {
  directoryName: SkillDirectoryName;
  targets: WorkspaceProviderTarget[];
}): Promise<{ result: CreatorStoreApplyResult | null; error: CreatorStoreCallFailure | null }> {
  const request = bindGate().issue();
  try {
    const result = await requireRpc().creatorStore.apply(input);
    return request.isCurrent() ? { result, error: null } : { result: null, error: null };
  } catch (error) {
    if (!request.isCurrent()) return { result: null, error: null };
    return { result: null, error: toFailure(error) };
  }
}

/** 同步全部已登记应用面（updateEntity source=store；逐 root 收据透传）。 */
export async function syncStoreSkill(
  directoryName: SkillDirectoryName,
): Promise<{ result: CreatorStoreSyncResult | null; error: CreatorStoreCallFailure | null }> {
  const request = bindGate().issue();
  try {
    const result = await requireRpc().creatorStore.sync({ directoryName });
    return request.isCurrent() ? { result, error: null } : { result: null, error: null };
  } catch (error) {
    if (!request.isCurrent()) return { result: null, error: null };
    return { result: null, error: toFailure(error) };
  }
}

/** 卸载（全部已登记面或显式 scopes；末投影由内核 GC）。 */
export async function uninstallStoreSkill(input: {
  directoryName: SkillDirectoryName;
  scopes?: Array<{ scope: "global" } | { scope: "project"; workspaceId: string }>;
}): Promise<{ result: CreatorStoreUninstallResult | null; error: CreatorStoreCallFailure | null }> {
  const request = bindGate().issue();
  try {
    const result = await requireRpc().creatorStore.uninstall(input);
    return request.isCurrent() ? { result, error: null } : { result: null, error: null };
  } catch (error) {
    if (!request.isCurrent()) return { result: null, error: null };
    return { result: null, error: toFailure(error) };
  }
}

/** 删除根源（与卸载正交；剩余应用面如实随结果返回，不阻止删除）。 */
export async function removeStoreSkill(input: {
  directoryName: SkillDirectoryName;
  expectedRevision: string;
}): Promise<{ result: CreatorStoreRemoveResult | null; error: CreatorStoreCallFailure | null }> {
  const request = bindGate().issue();
  try {
    const result = await requireRpc().creatorStore.remove(input);
    return request.isCurrent() ? { result, error: null } : { result: null, error: null };
  } catch (error) {
    if (!request.isCurrent()) return { result: null, error: null };
    return { result: null, error: toFailure(error) };
  }
}
