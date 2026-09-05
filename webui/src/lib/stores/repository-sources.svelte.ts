/**
 * 原始需求 [2026-07-27]：「Discover home Tab 卡片数据来自 repository.sources.list RPC，
 * 不缓存在前端 memory 跨渲染周期、不写 localStorage。」
 * 正交意图：
 *   [1] 按最新请求代次投影 home Tab 的源列表（curated ∪ user）。
 *   [2] add/remove 用户源经 RPC，写盘由 daemon 负责；浏览器不缓存跨渲染周期。
 */
import type { CuratedSourceEntry } from "$shared/curated-sources.js";
import type { UserSource } from "../types";
import { getConnectionGeneration, getRpc } from "./connection.svelte";
import { createRequestGenerationGate } from "./request-generation.js";

const sourcesRequests = createRequestGenerationGate(getConnectionGeneration);
const sourceMutationRequests = createRequestGenerationGate(getConnectionGeneration);

/** 一次源列表加载的终态。 */
export type SourcesLoadOutcome = "loaded" | "superseded" | "failed";

/** home Tab 投影的源列表（仅当前会话可见，刷新会重新从 RPC 拉取）。 */
export const repositorySourcesState = $state<{
  builtIn: CuratedSourceEntry[];
  user: UserSource[];
  loading: boolean;
  error: string | null;
}>({ builtIn: [], user: [], loading: false, error: null });

/** 从 daemon 刷新 Discover 源列表。 */
export async function loadSources(): Promise<SourcesLoadOutcome> {
  const request = sourcesRequests.issue();
  const rpc = getRpc();
  if (!rpc) {
    if (request.isLatest()) repositorySourcesState.loading = false;
    return "failed";
  }
  repositorySourcesState.loading = true;
  repositorySourcesState.error = null;
  try {
    const { builtIn, user } = await rpc.repository.sources.list({});
    if (!request.isCurrent()) return "superseded";
    repositorySourcesState.builtIn = builtIn;
    repositorySourcesState.user = user;
    return "loaded";
  } catch (error) {
    if (!request.isCurrent()) return "superseded";
    repositorySourcesState.error = error instanceof Error ? error.message : String(error);
    return "failed";
  } finally {
    if (request.isLatest()) repositorySourcesState.loading = false;
  }
}

/** 增加一条用户自定义源（经 daemon RPC 写盘）。 */
export async function addSource(input: {
  label: string;
  gitUrl: string;
  description?: string;
}): Promise<UserSource | null> {
  const request = sourceMutationRequests.issue();
  let source: UserSource;
  try {
    ({ source } = await getRpcThrow().repository.sources.add(input));
  } catch (error) {
    if (!request.isCurrent()) return null;
    throw error;
  }
  if (!request.isCurrent()) return null;
  await loadSources();
  return request.isCurrent() ? source : null;
}

/** 移除一条用户自定义源（经 daemon RPC 写盘）。 */
export async function removeSource(id: string): Promise<boolean> {
  const request = sourceMutationRequests.issue();
  try {
    await getRpcThrow().repository.sources.remove({ id: id as UserSource["id"] });
  } catch (error) {
    if (!request.isCurrent()) return false;
    throw error;
  }
  if (!request.isCurrent()) return false;
  await loadSources();
  return request.isCurrent();
}

function getRpcThrow() {
  const rpc = getRpc();
  if (!rpc) throw new Error("The Skill Creator daemon is not connected.");
  return rpc;
}
