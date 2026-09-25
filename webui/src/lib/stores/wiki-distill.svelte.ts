/**
 * 用户原始需求 [2026-09-25]（skill-wiki-maintainer tasks 1.6 / design §4）：
 * 「GUI 入口（WikiScopeView workspace scope『Distill to global』：start→进度→
 * 跳 proposal 面）」。
 * 用户原始需求 [2026-09-22]（wiki-directory-standard）：Wiki 面板 detail = 双级
 * scope 呈现（本 store 只服务 workspace scope 的蒸馏入口——global 无 source
 * patterns 可蒸馏，不消费本面）。
 * 正交意图：
 *   [1] 蒸馏 run 的启动/轮询/取消投影：latest-request-wins + connection owner
 *       代次（新请求/路由离开/断线作废在途响应的提交资格）；1.5s 轮询、终态停；
 *       全内存 $state，不落 localStorage。
 *   [2] awaiting-approval 的决定面投影：agent.proposals.list 按 runId 过滤的
 *       wiki.distill_apply proposal 只读列表（input 外部形状经 safeParse 收窄）；
 *       决定动作由 AgentProposalCard 经 agent.proposals.approve/reject 执行，
 *       本 store 只负责列表刷新。
 *   [3] start 的 typed 错误分类：DISTILL_ACTIVE_RUN/DISTILL_LIMIT/DISTILL_IO
 *       等以 { code, message } 投影（视图呈现人读文案而非崩栈）。
 * 妥协声明：wiki.distill.start 阻塞到 admission（design §4）——runId 在 kernel
 *   阶段完成前不可知，collecting/kernel-running 期间无从轮询，进度以 starting
 *   不定态呈现；该窗口无取消向量（daemon cancel 以 runId 为键，GUI 拿到 runId
 *   时 run 已过 kernel 阶段）。
 */
import { z } from "zod";
import { ORPCError } from "@orpc/client";
import type { AgentMcpProposalView } from "$shared/contracts/agent.js";
import type {
  DistillCancelOutput,
  DistillCounters,
  DistillFailReason,
  DistillRunId,
  DistillStatusOutput,
  RunState,
} from "$shared/contracts/wiki-distill.js";
import type { WorkspaceId } from "../types";
import { getConnectionGeneration, requireRpc } from "./connection.svelte";
import { createRequestGenerationGate } from "./request-generation.js";

const startGate = createRequestGenerationGate(getConnectionGeneration);
const pollGate = createRequestGenerationGate(getConnectionGeneration);
const cancelGate = createRequestGenerationGate(getConnectionGeneration);
const proposalsGate = createRequestGenerationGate(getConnectionGeneration);

/** 轮询间隔（ms）：brief 1-2s 窗口的中点；与 agent 面板待答审批节奏同量级。 */
const WIKI_DISTILL_POLL_INTERVAL_MS = 1500;

/** RunState 终态谓词（completed/failed/cancelled；终态幂等可轮询但无需再轮）。 */
export function isTerminalWikiDistillState(state: RunState): boolean {
  return state === "completed" || state === "failed" || state === "cancelled";
}

/** start 对调用方可见的终态（rejected 携带 typed code 供视图区分呈现）。 */
export type WikiDistillStartOutcome =
  | { outcome: "started"; runId: DistillRunId }
  | { outcome: "rejected"; code: string; message: string }
  | null;

/** 当前蒸馏 run 投影（无 run 时 runId/state 为 null；终态保留到显式 reset）。 */
export const wikiDistillState = $state<{
  source: WorkspaceId | null;
  runId: DistillRunId | null;
  state: RunState | null;
  reason: DistillFailReason | null;
  counters: DistillCounters | null;
  proposalRefs: DistillStatusOutput["proposalRefs"];
  starting: boolean;
  cancelling: boolean;
  errorCode: string | null;
  error: string | null;
  pollError: string | null;
}>({
  source: null,
  runId: null,
  state: null,
  reason: null,
  counters: null,
  proposalRefs: [],
  starting: false,
  cancelling: false,
  errorCode: null,
  error: null,
  pollError: null,
});

/** 决定面列表行：proposal view + 安全收窄出的 ordinal（ordinal 升序渲染）。 */
export interface WikiDistillProposalRow {
  view: AgentMcpProposalView;
  ordinal: number;
}

/** awaiting-approval 的决定面投影（open = 用户展开「View proposals」区）。 */
export const wikiDistillProposals = $state<{
  open: boolean;
  loading: boolean;
  error: string | null;
  proposals: WikiDistillProposalRow[];
}>({ open: false, loading: false, error: null, proposals: [] });

let pollTimer: ReturnType<typeof setTimeout> | null = null;

function stopWikiDistillPoll(): void {
  if (pollTimer !== null) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

function scheduleWikiDistillPoll(): void {
  stopWikiDistillPoll();
  pollTimer = setTimeout(() => {
    void pollWikiDistill();
  }, WIKI_DISTILL_POLL_INTERVAL_MS);
}

/** start 错误的人读文案（typed code 区分；未知 code 落 message 原文）。 */
function startRejectionOf(error: unknown): { code: string; message: string } {
  if (error instanceof ORPCError) {
    switch (error.code) {
      case "DISTILL_ACTIVE_RUN":
        return {
          code: error.code,
          message:
            "A distillation is already running for this workspace. Wait for it to finish or cancel it first.",
        };
      case "DISTILL_LIMIT":
        return {
          code: error.code,
          message:
            "The proposal store is at capacity, so every proposal was refused. Decide or clear older proposals, then retry.",
        };
      case "DISTILL_IO":
        return {
          code: error.code,
          message: `A distill registry IO error occurred: ${error.message}`,
        };
      case "INVALID_OPERATION":
        return {
          code: error.code,
          message: "Only an imported workspace can be distilled to the global wiki.",
        };
      case "NOT_FOUND":
        return {
          code: error.code,
          message: "The workspace is no longer registered. Re-import it and retry.",
        };
      default:
        return { code: String(error.code), message: error.message };
    }
  }
  return {
    code: "UNAVAILABLE",
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * 启动一次蒸馏（阻塞到 admission；成功后进入 1.5s 轮询，终态自停）。
 * typed 拒绝（含 DISTILL_ACTIVE_RUN）以 { outcome: "rejected" } 返回——错误面
 * 由调用方呈现，不抛栈；stale（路由切换/断线/新请求作废）返回 null。
 */
export async function startWikiDistill(source: WorkspaceId): Promise<WikiDistillStartOutcome> {
  if (wikiDistillState.starting || (wikiDistillState.runId !== null && !runTerminal())) {
    return {
      outcome: "rejected",
      code: "INVALID_OPERATION",
      message: "A distillation run is already in progress.",
    };
  }
  const request = startGate.issue();
  wikiDistillState.starting = true;
  wikiDistillState.error = null;
  wikiDistillState.errorCode = null;
  wikiDistillState.pollError = null;
  wikiDistillState.source = source;
  // 新 run 拥有投影：清掉上一轮（终态卡/错误面）的残留，runId 回到未知。
  wikiDistillState.runId = null;
  wikiDistillState.state = null;
  wikiDistillState.reason = null;
  wikiDistillState.counters = null;
  wikiDistillState.proposalRefs = [];
  wikiDistillProposals.open = false;
  wikiDistillProposals.proposals = [];
  wikiDistillProposals.error = null;
  stopWikiDistillPoll();
  try {
    const { runId } = await requireRpc().wiki.distill.start({ source });
    if (!request.isCurrent()) return null;
    wikiDistillState.runId = runId;
    void pollWikiDistill();
    return { outcome: "started", runId };
  } catch (error) {
    if (!request.isCurrent()) return null;
    const rejection = startRejectionOf(error);
    wikiDistillState.errorCode = rejection.code;
    wikiDistillState.error = rejection.message;
    return { outcome: "rejected", ...rejection };
  } finally {
    if (request.isLatest()) wikiDistillState.starting = false;
  }
}

function runTerminal(): boolean {
  return wikiDistillState.state !== null && isTerminalWikiDistillState(wikiDistillState.state);
}

/** 单轮 status 拉取：提交投影并按终态/awaiting-approval 决定后续轮询与刷新。 */
async function pollWikiDistill(): Promise<void> {
  const runId = wikiDistillState.runId;
  if (runId === null) return;
  const request = pollGate.issue();
  try {
    const status = await requireRpc().wiki.distill.status({ runId });
    if (!request.isCurrent()) return;
    if (wikiDistillState.runId !== runId) return;
    wikiDistillState.state = status.state;
    wikiDistillState.reason = status.reason;
    wikiDistillState.counters = status.counters;
    wikiDistillState.proposalRefs = [...status.proposalRefs];
    wikiDistillState.pollError = null;
    if (isTerminalWikiDistillState(status.state)) {
      // 终态：停轮询；决定面展开时补一次刷新让 executed/rejected/failed 落定。
      stopWikiDistillPoll();
      if (wikiDistillProposals.open) void loadWikiDistillProposals();
      return;
    }
    if (status.state === "awaiting-approval" && wikiDistillProposals.open) {
      // 决定面开着：随轮询刷新列表（决定后的状态与 counters 同步落定）。
      void loadWikiDistillProposals();
    }
    scheduleWikiDistillPoll();
  } catch (error) {
    if (!request.isCurrent()) return;
    wikiDistillState.pollError = error instanceof Error ? error.message : String(error);
    stopWikiDistillPoll();
  }
}

/**
 * 取消当前 run（kernel-running → dispose；awaiting-approval → 失效语义；终态
 * 幂等返回既有终态）。成功立即投影 state 并按终态停轮询；typed 失败进错误面。
 */
export async function cancelWikiDistill(): Promise<boolean> {
  const runId = wikiDistillState.runId;
  if (runId === null || wikiDistillState.cancelling) return false;
  const request = cancelGate.issue();
  wikiDistillState.cancelling = true;
  try {
    const result: DistillCancelOutput = await requireRpc().wiki.distill.cancel({ runId });
    if (!request.isCurrent()) return false;
    if (wikiDistillState.runId !== runId) return false;
    wikiDistillState.state = result.state;
    wikiDistillState.error = null;
    wikiDistillState.errorCode = null;
    if (isTerminalWikiDistillState(result.state)) {
      stopWikiDistillPoll();
      if (wikiDistillProposals.open) void loadWikiDistillProposals();
    } else {
      void pollWikiDistill();
    }
    return true;
  } catch (error) {
    if (!request.isCurrent()) return false;
    const rejection = startRejectionOf(error);
    wikiDistillState.errorCode = rejection.code;
    wikiDistillState.error = rejection.message;
    return false;
  } finally {
    if (request.isLatest()) wikiDistillState.cancelling = false;
  }
}

/** proposal input 的路由键收窄（外部 unknown → { runId, ordinal }；畸形丢弃）。 */
const DistillProposalInputSchema = z.strictObject({
  runId: z.string(),
  ordinal: z.number().int().nonnegative(),
});

/**
 * 加载本 run 的决定面列表：agent.proposals.list 全量拉取后按
 * capability=wiki.distill_apply + input.runId 过滤，ordinal 升序。
 * latest-request-wins；失败保留上一投影并记 error。
 */
export async function loadWikiDistillProposals(): Promise<void> {
  const runId = wikiDistillState.runId;
  if (runId === null) return;
  const request = proposalsGate.issue();
  wikiDistillProposals.loading = true;
  try {
    const result = await requireRpc().agent.proposals.list({});
    if (!request.isCurrent()) return;
    if (wikiDistillState.runId !== runId) return;
    const rows: WikiDistillProposalRow[] = [];
    for (const view of result.proposals) {
      if (view.capability !== "wiki.distill_apply") continue;
      const input = DistillProposalInputSchema.safeParse(view.input);
      if (!input.success || input.data.runId !== runId) continue;
      rows.push({ view, ordinal: input.data.ordinal });
    }
    rows.sort((a, b) => a.ordinal - b.ordinal);
    wikiDistillProposals.proposals = rows;
    wikiDistillProposals.error = null;
  } catch (error) {
    if (!request.isCurrent()) return;
    wikiDistillProposals.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (request.isLatest()) wikiDistillProposals.loading = false;
  }
}

/** 展开/收起决定面（展开即拉一次列表；轮询在 awaiting-approval 时随之刷新）。 */
export function setWikiDistillProposalsOpen(open: boolean): void {
  wikiDistillProposals.open = open;
  if (open && wikiDistillState.runId !== null) void loadWikiDistillProposals();
}

/** 复位（路由离开与测试隔离）：作废全部在途代次、停轮询、清决定面。 */
export function resetWikiDistill(): void {
  startGate.invalidate();
  pollGate.invalidate();
  cancelGate.invalidate();
  proposalsGate.invalidate();
  stopWikiDistillPoll();
  wikiDistillState.source = null;
  wikiDistillState.runId = null;
  wikiDistillState.state = null;
  wikiDistillState.reason = null;
  wikiDistillState.counters = null;
  wikiDistillState.proposalRefs = [];
  wikiDistillState.starting = false;
  wikiDistillState.cancelling = false;
  wikiDistillState.errorCode = null;
  wikiDistillState.error = null;
  wikiDistillState.pollError = null;
  wikiDistillProposals.open = false;
  wikiDistillProposals.loading = false;
  wikiDistillProposals.error = null;
  wikiDistillProposals.proposals = [];
}
