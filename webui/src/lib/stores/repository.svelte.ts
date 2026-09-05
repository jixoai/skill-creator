/**
 * 原始需求 [2026-07-14]：「我们还需要一个 `/repository/`，来支持远程仓库预览 skills 并安装 它们」。
 * 用户原始需求 [2026-07-27]：「视图状态（选中 skills / targets / 当前源）→ URL search params；
 * 持久态（scan session / install 记录 / sources）→ daemon RPC；不引入 TabScope。」
 * 正交意图：
 *   1. 按最新请求代次投影固定 commit 的仓库扫描与技能预览（per-call gate，组件持结果）。
 *   2. 按连接所有权与最新请求代次管理安装操作（per-call gate，组件持结果）。
 * 妥协声明：scan / preview / install 结果不再缓存在全局单例跨渲染周期；调用方（组件）按需拉取并
 * 持有当前视图所需结果，刷新会从 URL（sessionId / selected）重新拉取。
 */
import { ORPCError } from "@orpc/client";
import type {
  InstallResult,
  RemoteRepoScan,
  RemoteSkillId,
  RemoteSkillPreview,
  WorkspaceProviderTarget,
} from "../types";
import { getConnectionGeneration, requireRpc } from "./connection.svelte";
import { createRequestGenerationGate } from "./request-generation.js";

/** 结构化调用失败：区分 session 失效（需重扫）与普通错误。 */
export interface RepositoryCallFailure {
  message: string;
  /** daemon 公开的 oRPC 业务错误码（如 UNAVAILABLE / INVALID_OPERATION）。 */
  code?: string;
}

/** 判定一次调用失败是否因为 pinned session 已在 daemon 侧失效/被淘汰。 */
export function isSessionExpired(failure: RepositoryCallFailure | null): boolean {
  return failure?.code === "UNAVAILABLE" && failure.message.includes("session expired");
}

function toFailure(error: unknown): RepositoryCallFailure {
  if (error instanceof ORPCError) return { message: error.message, code: String(error.code) };
  return { message: error instanceof Error ? error.message : String(error) };
}

/** per-call 代次令牌（组件持结果前用以识别 stale 响应）。 */
interface RequestGeneration {
  /** 当前请求是否仍为最新且所属连接未断。 */
  isCurrent: () => boolean;
}

/** 绑定连接世代的 per-call 代次门（per-call 构造，组件卸载即 GC）。 */
function bindGate(): { issue: () => RequestGeneration } {
  const gate = createRequestGenerationGate(getConnectionGeneration);
  return {
    issue: () => {
      const inner = gate.issue();
      return { isCurrent: inner.isCurrent };
    },
  };
}

/** 扫描远程仓库并固定返回的 commit 会话；结果交给调用方持有。 */
export async function scanRemoteRepo(
  source: string,
  ref?: string,
): Promise<{ scan: RemoteRepoScan | null; error: RepositoryCallFailure | null }> {
  const request = bindGate().issue();
  try {
    const scan = await requireRpc().repository.scan({ source, ref });
    return request.isCurrent() ? { scan, error: null } : { scan: null, error: null };
  } catch (error) {
    if (!request.isCurrent()) return { scan: null, error: null };
    return { scan: null, error: toFailure(error) };
  }
}

/** 从固定会话加载一个技能预览；结果交给调用方持有。 */
export async function previewRemoteSkill(
  sessionId: RemoteRepoScan["sessionId"],
  skillId: RemoteSkillId,
): Promise<{ preview: RemoteSkillPreview | null; error: RepositoryCallFailure | null }> {
  const request = bindGate().issue();
  try {
    const preview = await requireRpc().repository.preview({ sessionId, skillId });
    return request.isCurrent() ? { preview, error: null } : { preview: null, error: null };
  } catch (error) {
    if (!request.isCurrent()) return { preview: null, error: null };
    return { preview: null, error: toFailure(error) };
  }
}

/** 将固定会话中的技能安装或 dry-run 到显式 Workspace Providers。 */
export async function installRemoteSkills(input: {
  sessionId: RemoteRepoScan["sessionId"];
  skillIds: RemoteSkillId[];
  targets: WorkspaceProviderTarget[];
  force?: boolean;
  dryRun?: boolean;
}): Promise<{ result: InstallResult | null; error: RepositoryCallFailure | null }> {
  const request = bindGate().issue();
  try {
    const result = await requireRpc().repository.install(input);
    return request.isCurrent() ? { result, error: null } : { result: null, error: null };
  } catch (error) {
    if (!request.isCurrent()) return { result: null, error: null };
    return { result: null, error: toFailure(error) };
  }
}
