/**
 * 原始需求 [2026-09-21]：「global 能承载 workspace 泛化出来的 skill……P1 本质上
 * 是在收集一些碎片的认知……是 skill-wiki 输入的一部分」。
 * 正交意图：
 * 1. 双级 scope 的 wiki 列表投影（latest-request-wins + connection owner 代次）。
 * 2. 碎片追加 mutation（当前 scope 就地插入；幂等去重结果对调用方可见）。
 */
import type { PatternListItem } from "skill-wiki/schema";
import type { WikiAppendResult, WikiReadResult } from "$shared/contracts/wiki.js";
import type { WorkspaceId } from "../types";
import { getConnectionGeneration, getRpc, requireRpc } from "./connection.svelte";
import { createRequestGenerationGate } from "./request-generation.js";

const wikiRequests = createRequestGenerationGate(getConnectionGeneration);
const wikiMutationRequests = createRequestGenerationGate(getConnectionGeneration);

/** 一次 wiki 列表加载对调用方可见的终态。 */
export type WikiLoadOutcome = "loaded" | "superseded" | "failed";

/** 当前 wiki 视图持有的列表状态（scope 由最近一次 loadWiki 拥有）。 */
export const wikiState = $state<{
  scope: WorkspaceId;
  patterns: PatternListItem[];
  loading: boolean;
  error: string | null;
}>({ scope: "~", patterns: [], loading: false, error: null });

/** 加载某 scope 的 pattern 列表（新请求作废旧响应的提交资格）。 */
export async function loadWiki(scope: WorkspaceId): Promise<WikiLoadOutcome> {
  const request = wikiRequests.issue();
  const rpc = getRpc();
  if (!rpc) {
    if (request.isLatest()) wikiState.loading = false;
    wikiState.error = "The Skill Creator daemon is not connected.";
    return "failed";
  }
  wikiState.scope = scope;
  wikiState.loading = true;
  wikiState.error = null;
  try {
    const { patterns } = await rpc.wiki.list({ scope });
    if (!request.isCurrent()) return "superseded";
    wikiState.patterns = patterns;
    return "loaded";
  } catch (error) {
    if (!request.isCurrent()) return "superseded";
    wikiState.error = error instanceof Error ? error.message : String(error);
    return "failed";
  } finally {
    if (request.isLatest()) wikiState.loading = false;
  }
}

/**
 * 追加一条碎片认知（幂等：同正文 contentHash 命中时 daemon 不新建页）。
 * 成功且仍 current 时作废在途列表请求的提交资格（其快照早于本次写入，返回也
 * 不得覆盖就地插入的新条目——codex 复核 P1 修复），再就地前插非重复结果；
 * stale 成功/rejection 投影为 null。
 */
export async function appendWikiFragment(
  scope: WorkspaceId,
  input: { title: string; body: string },
): Promise<WikiAppendResult | null> {
  const request = wikiMutationRequests.issue();
  let result: WikiAppendResult;
  try {
    result = await requireRpc().wiki.append({ scope, ...input });
  } catch (error) {
    if (!request.isCurrent()) return null;
    throw error;
  }
  if (!request.isCurrent()) return null;
  // 作废在途列表请求（其快照早于本次写入）：它们不能再提交 patterns，finally
  // 也不会再清 loading——loading 由本路径无条件收尾，即使 append scope 与当前
  // 视图 scope 不同（否则作废后的在途请求让 loading 永久悬挂——codex r3 P1）。
  wikiRequests.invalidate();
  wikiState.loading = false;
  if (wikiState.scope === scope) {
    if (!result.deduplicated && !wikiState.patterns.some((p) => p.name === result.item.name)) {
      wikiState.patterns = [result.item, ...wikiState.patterns];
    }
  }
  return result;
}

/** 单 pattern 全文读取（单发；展开态由调用方持有，不驻留列表状态）。 */
export async function readWikiPattern(scope: WorkspaceId, name: string): Promise<WikiReadResult> {
  return requireRpc().wiki.read({ scope, name });
}

/** 复位（路由离开与测试隔离用）。 */
export function resetWiki(): void {
  wikiRequests.invalidate();
  wikiMutationRequests.invalidate();
  wikiState.scope = "~";
  wikiState.patterns = [];
  wikiState.loading = false;
  wikiState.error = null;
}
