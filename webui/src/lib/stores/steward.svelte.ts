/**
 * 用户原始需求 [2026-09-06]（openspec agent-steward task 1.7）：
 * 「新增 steward UI：运行列表、实时事件、推荐队列、approval/reject、stale run 和失败原因；
 * 不把历史写入 localStorage。」
 * 正交意图：
 *   [1] 按连接所有权与最新请求代次投影 backend/run/事件（latest-request-wins）。
 *   [2] 审批/拒绝/授权裁决按同一代次门管理，失效结果投影为无结果。
 * 妥协声明：运行历史只存在于 daemon 内存（有界），UI 不做任何持久化。
 */
import type { ApproveResult, ProposalId } from "$shared/contracts/skill-intelligence.js";
import type {
  BackendStatus,
  RunEvent,
  StewardBackendId,
  StewardRun,
  StewardRunId,
} from "$shared/contracts/agent-steward.js";
import type { WorkspaceProviderTarget } from "$shared/contracts/workspaces.js";
import { getConnectionGeneration, requireRpc } from "./connection.svelte";
import { createRequestGenerationGate } from "./request-generation.js";

/** per-call 代次令牌（组件持结果前用以识别 stale 响应）。 */
interface RequestGeneration {
  isCurrent: () => boolean;
}

/** 模块级 latest-request-wins 代次门（按操作类别共享）。 */
const backendsGate = createRequestGenerationGate(getConnectionGeneration);
const runsGate = createRequestGenerationGate(getConnectionGeneration);
const eventsGate = createRequestGenerationGate(getConnectionGeneration);
const startGate = createRequestGenerationGate(getConnectionGeneration);
const cancelGate = createRequestGenerationGate(getConnectionGeneration);
const permissionGate = createRequestGenerationGate(getConnectionGeneration);
const approveGate = createRequestGenerationGate(getConnectionGeneration);
const rejectGate = createRequestGenerationGate(getConnectionGeneration);

/** 探测 backend 列表；结果交给调用方持有。 */
export async function loadStewardBackends(): Promise<{
  backends: BackendStatus[] | null;
  error: string | null;
}> {
  const request = backendsGate.issue();
  try {
    const result = await requireRpc().steward.backends({});
    return request.isCurrent()
      ? { backends: result.backends, error: null }
      : { backends: null, error: null };
  } catch (error) {
    if (!request.isCurrent()) return { backends: null, error: null };
    return { backends: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/** 拉取 run 列表（新→旧）；结果交给调用方持有。 */
export async function loadStewardRuns(): Promise<{
  runs: StewardRun[] | null;
  error: string | null;
}> {
  const request = runsGate.issue();
  try {
    const result = await requireRpc().steward.list({});
    return request.isCurrent() ? { runs: result.runs, error: null } : { runs: null, error: null };
  } catch (error) {
    if (!request.isCurrent()) return { runs: null, error: null };
    return { runs: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/** 轮询一个 run 的增量事件；结果交给调用方持有。 */
export async function pollStewardEvents(
  runId: StewardRunId,
  afterSeq: number,
): Promise<{
  events: RunEvent[];
  status: StewardRun["status"] | null;
  phase: StewardRun["phase"] | null;
  error: string | null;
}> {
  const request = eventsGate.issue();
  try {
    const result = await requireRpc().steward.events({ runId, afterSeq });
    return request.isCurrent()
      ? { events: result.events, status: result.status, phase: result.phase, error: null }
      : { events: [], status: null, phase: null, error: null };
  } catch (error) {
    if (!request.isCurrent()) return { events: [], status: null, phase: null, error: null };
    return {
      events: [],
      status: null,
      phase: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** 启动一次 run；结果交给调用方持有。 */
export async function startStewardRun(input: {
  backendId: StewardBackendId;
  target: WorkspaceProviderTarget;
  objective?: string;
}): Promise<{ run: StewardRun | null; error: string | null }> {
  const request = startGate.issue();
  try {
    const result = await requireRpc().steward.start(input);
    return request.isCurrent() ? { run: result.run, error: null } : { run: null, error: null };
  } catch (error) {
    if (!request.isCurrent()) return { run: null, error: null };
    return { run: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/** 取消一个 run；结果交给调用方持有。 */
export async function cancelStewardRun(
  runId: StewardRunId,
): Promise<{ run: StewardRun | null; error: string | null }> {
  const request = cancelGate.issue();
  try {
    const result = await requireRpc().steward.cancel({ runId });
    return request.isCurrent() ? { run: result.run, error: null } : { run: null, error: null };
  } catch (error) {
    if (!request.isCurrent()) return { run: null, error: null };
    return { run: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/** 一次性授权裁决；结果交给调用方持有。 */
export async function decideStewardPermission(input: {
  runId: StewardRunId;
  requestId: string;
  decision: "granted" | "denied";
}): Promise<{ decided: boolean; error: string | null }> {
  const request = permissionGate.issue();
  try {
    await requireRpc().steward.decidePermission(input);
    return request.isCurrent() ? { decided: true, error: null } : { decided: false, error: null };
  } catch (error) {
    if (!request.isCurrent()) return { decided: false, error: null };
    return { decided: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** run 内审批 proposal（Manager apply）；结果交给调用方持有。 */
export async function approveStewardProposal(input: {
  runId: StewardRunId;
  proposalId: ProposalId;
}): Promise<{ result: ApproveResult | null; error: string | null }> {
  const request = approveGate.issue();
  try {
    const response = await requireRpc().steward.approveProposal(input);
    return request.isCurrent()
      ? { result: response.result, error: null }
      : { result: null, error: null };
  } catch (error) {
    if (!request.isCurrent()) return { result: null, error: null };
    return { result: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/** run 内拒绝 proposal；结果交给调用方持有。 */
export async function rejectStewardProposal(input: {
  runId: StewardRunId;
  proposalId: ProposalId;
}): Promise<{ rejected: boolean; error: string | null }> {
  const request = rejectGate.issue();
  try {
    await requireRpc().steward.rejectProposal(input);
    return request.isCurrent() ? { rejected: true, error: null } : { rejected: false, error: null };
  } catch (error) {
    if (!request.isCurrent()) return { rejected: false, error: null };
    return { rejected: false, error: error instanceof Error ? error.message : String(error) };
  }
}
