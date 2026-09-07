/**
 * 用户原始需求 [2026-09-07]（openspec steward-product-workflow tasks 4.1/4.2）：
 * 「只实现 task/target/selected-skills/runtime-config stores 和对应 workflow view；
 * 复用阶段 4 已注册的 plugin/root/connection/RPC owner。」4.2 追加：
 * 「timeline, tool calls, evidence graph, diff, validation, approval, rollback and
 * recovery states work」——全部经既有 skillSteward/dsh.sessions RPC 面。
 *
 * 正交意图：
 *   [1] 任务/范围选择（taskKind + selectedSkillIds + instructions）按 provider
 *       target 键控，模块级状态跨 island 卸载/重连存活；不写 localStorage。
 *   [2] runtime config（dsh.settings 视图/补丁）与 run 投影走 latest-request-wins
 *       代次门：断线重连、新请求或路由切换都会撤销旧响应的提交资格。
 *   [3] 提案工作流（validate→approve→apply→rollback）与 timeline/agent stream：
 *       逐提案状态 + 追加式时间线，同样受代次门；typed 终态（stale/
 *       recovery-required/compensated）原样投影，不吞成通用错误。
 * 妥协声明：run 投影只保留最近一次（列表与 durable 审计归 daemon/audit store）；
 *   diff 呈现为 Manager mutation 事实（relPath + semantic + before→after revision），
 *   RPC 面不暴露逐字节内容差异，不伪造内容级 diff。
 */
import type {
  DshSettingsUpdate,
  DshSettingsUpdateResult,
  DshStewardSettingsView,
  DshSessionStreamFrame,
} from "$shared/contracts/dsh-runtime.js";
import type {
  SkillStewardApproveResult,
  SkillStewardApplyResult,
  SkillStewardRollbackResult,
  SkillStewardRunResult,
  StewardAuditId,
  StewardProposalId,
  StewardTaskKind,
  SkillValidationResult,
} from "$shared/contracts/skill-steward.js";
import type { SkillId } from "$shared/contracts/skills.js";
import type { WorkspaceProviderTarget } from "$shared/contracts/workspaces.js";
import { getConnectionGeneration, requireRpc } from "./connection.svelte";
import { createRequestGenerationGate } from "./request-generation.js";

/** 与 SkillStewardTaskSchema.instructions 同界的补充指令上限。 */
export const STEWARD_INSTRUCTIONS_MAX = 2000;

/** 一个 provider target 的任务/范围选择。 */
export interface StewardWorkflowSelection {
  taskKind: StewardTaskKind;
  selectedSkillIds: SkillId[];
  instructions: string;
}

/** selection 归属键（同一 target 的选择跨导航/重连存活）。 */
export function workflowTargetKey(target: WorkspaceProviderTarget): string {
  return `${target.workspaceId}/${target.providerId}`;
}

/** 按 target 键控的选择表（模块级 $state：跨组件卸载与重连存活）。 */
const workflowSelections = $state<Record<string, StewardWorkflowSelection>>({});

/** 取（或初始化）一个 target 的选择；返回响应式引用供视图双向绑定。 */
export function selectionFor(target: WorkspaceProviderTarget): StewardWorkflowSelection {
  const key = workflowTargetKey(target);
  let selection = workflowSelections[key];
  if (!selection) {
    selection = { taskKind: "check", selectedSkillIds: [], instructions: "" };
    workflowSelections[key] = selection;
  }
  // 必须返回 record 内的 proxy：返回裸对象时，store 函数对裸目标的修改不会
  // 触发信号（视图的 busy/validation 更新会丢失——4.2 实测 spinner 卡死）。
  return workflowSelections[key]!;
}

/** 测试与显式重置用：清空全部选择。 */
export function resetStewardWorkflowSelections(): void {
  for (const key of Object.keys(workflowSelections)) delete workflowSelections[key];
}

/** 选择性勾选/取消一个技能（去重；不排序——顺序由勾选时间决定，仅作身份集合）。 */
export function toggleSelectedSkill(target: WorkspaceProviderTarget, skillId: SkillId): void {
  const selection = selectionFor(target);
  const index = selection.selectedSkillIds.indexOf(skillId);
  if (index === -1) selection.selectedSkillIds.push(skillId);
  else selection.selectedSkillIds.splice(index, 1);
}

/** instructions 超界时截断（store 入口统一钳制，视图不做第二套规则）。 */
export function clampInstructions(text: string): string {
  return text.length > STEWARD_INSTRUCTIONS_MAX ? text.slice(0, STEWARD_INSTRUCTIONS_MAX) : text;
}

/** runtime config 投影（dsh.settings 视图 + 补丁结果）。 */
export const runtimeConfigState = $state<{
  view: DshStewardSettingsView | null;
  loading: boolean;
  error: string | null;
}>({ view: null, loading: false, error: null });

/** run 投影（最近一次 skillSteward.startRun 的终态）。 */
export const workflowRunState = $state<{
  run: SkillStewardRunResult | null;
  /** run 归属的 target 键（迟到响应不得跨 target 覆盖）。 */
  targetKey: string | null;
  starting: boolean;
  error: string | null;
}>({ run: null, targetKey: null, starting: false, error: null });

const settingsGate = createRequestGenerationGate(getConnectionGeneration);
const startGate = createRequestGenerationGate(getConnectionGeneration);

/** 拉取 runtime config（模型/预设/权限 + 凭据状态投影）。 */
export async function loadStewardRuntimeConfig(): Promise<void> {
  const request = settingsGate.issue();
  runtimeConfigState.loading = true;
  try {
    const result = await requireRpc().dsh.settings.get({});
    if (!request.isCurrent()) return;
    runtimeConfigState.view = result;
    runtimeConfigState.error = null;
  } catch (error) {
    if (!request.isCurrent()) return;
    runtimeConfigState.error = error instanceof Error ? error.message : String(error);
  } finally {
    // loading 清理只需 isLatest（代次协议：提交数据才要求 isCurrent）。
    if (request.isLatest()) runtimeConfigState.loading = false;
  }
}

/** 应用 runtime config 补丁；typed rejected 原样返回（视图呈现拒绝码）。 */
export async function applyStewardRuntimeConfigPatch(
  patch: DshSettingsUpdate,
): Promise<DshSettingsUpdateResult | null> {
  const request = settingsGate.issue();
  try {
    const result = await requireRpc().dsh.settings.update(patch);
    if (!request.isCurrent()) return null;
    if (result.outcome === "updated") {
      runtimeConfigState.view = result.view;
      runtimeConfigState.error = null;
    }
    return result;
  } catch (error) {
    if (!request.isCurrent()) return null;
    runtimeConfigState.error = error instanceof Error ? error.message : String(error);
    return null;
  }
}

/** 启动一次 steward run（taskKind + 选中技能来自 target 键控的选择）。 */
export async function startStewardWorkflowRun(
  target: WorkspaceProviderTarget,
): Promise<SkillStewardRunResult | null> {
  const request = startGate.issue();
  const selection = selectionFor(target);
  const targetKey = workflowTargetKey(target);
  workflowRunState.starting = true;
  try {
    const result = await requireRpc().skillSteward.startRun({
      target,
      ...(selection.selectedSkillIds.length > 0
        ? { skillIds: [...selection.selectedSkillIds] }
        : {}),
      taskKind: selection.taskKind,
    });
    if (!request.isCurrent()) return null;
    workflowRunState.run = result;
    workflowRunState.targetKey = targetKey;
    workflowRunState.error = null;
    appendTimeline("run-started", {
      text: `${selection.taskKind} run: ${result.terminal} · ${result.toolCalls} tool calls · ${result.proposals.length} proposals`,
    });
    return result;
  } catch (error) {
    if (!request.isCurrent()) return null;
    workflowRunState.error = error instanceof Error ? error.message : String(error);
    appendTimeline("error", { text: workflowRunState.error });
    return null;
  } finally {
    // starting 清理只需 isLatest；run/错误提交要求 isCurrent。
    if (request.isLatest()) workflowRunState.starting = false;
  }
}

// ---------------------------------------------------------------------------
// 4.2：提案工作流（timeline / validation / approval / apply / rollback / stream）
// ---------------------------------------------------------------------------

/** 时间线事件（append-only；跨卸载/重连存活，不持久化）。 */
export interface WorkflowTimelineEvent {
  at: string;
  kind:
    | "run-started"
    | "validated"
    | "approved"
    | "applied"
    | "rollback-prepared"
    | "rolled-back"
    | "error";
  text: string;
  proposalId?: string;
  auditId?: string;
}

export const workflowTimeline = $state<WorkflowTimelineEvent[]>([]);

/** 单提案工作流状态（validation → grant → apply → rollback 全事实链）。 */
export interface ProposalWorkflowState {
  validation: SkillValidationResult | null;
  grant: SkillStewardApproveResult | null;
  apply: SkillStewardApplyResult | null;
  /** applyRollback 终态（recovery-required/compensated 的恢复横幅数据源）。 */
  rollbackResult: SkillStewardApplyResult | null;
  rollbackPrep: SkillStewardRollbackResult | null;
  /** 在途操作标签（视图禁用对应按钮）。 */
  busy: string | null;
  /** 最近一次操作的 typed/传输错误（与终态区分展示）。 */
  error: string | null;
}

export const proposalStates = $state<Record<string, ProposalWorkflowState>>({});

/** agent stream 投影（dsh.sessions.streams 脱敏帧）。 */
export const streamFramesState = $state<{
  frames: DshSessionStreamFrame[];
  loading: boolean;
  error: string | null;
}>({ frames: [], loading: false, error: null });

const proposalGate = createRequestGenerationGate(getConnectionGeneration);
const streamGate = createRequestGenerationGate(getConnectionGeneration);

function appendTimeline(
  kind: WorkflowTimelineEvent["kind"],
  event: Omit<WorkflowTimelineEvent, "at" | "kind">,
): void {
  workflowTimeline.push({ at: new Date().toISOString(), kind, ...event });
}

function proposalStateFor(proposalId: string): ProposalWorkflowState {
  let state = proposalStates[proposalId];
  if (!state) {
    state = {
      validation: null,
      grant: null,
      apply: null,
      rollbackResult: null,
      rollbackPrep: null,
      busy: null,
      error: null,
    };
    proposalStates[proposalId] = state;
  }
  // 同 selectionFor：store 侧 mutation 必须走 proxy，否则视图不更新。
  return proposalStates[proposalId]!;
}

/** 测试与显式重置用：清空时间线/提案状态/stream 投影。 */
export function resetStewardWorkflowEvidence(): void {
  workflowTimeline.length = 0;
  for (const key of Object.keys(proposalStates)) delete proposalStates[key];
  streamFramesState.frames = [];
  streamFramesState.loading = false;
  streamFramesState.error = null;
}

/** 拉取 agent stream 帧（脱敏；按当前 run 的 dshSession 过滤展示）。 */
export async function loadStewardStreamFrames(limit = 50): Promise<void> {
  const request = streamGate.issue();
  streamFramesState.loading = true;
  try {
    const result = await requireRpc().dsh.sessions.streams({ limit });
    if (!request.isCurrent()) return;
    streamFramesState.frames = result.frames;
    streamFramesState.error = null;
  } catch (error) {
    if (!request.isCurrent()) return;
    streamFramesState.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (request.isLatest()) streamFramesState.loading = false;
  }
}

/** 当前 run 关联的 stream 帧（有 dshSession 绑定时按 session 过滤，否则全量最新）。 */
export function framesForCurrentRun(): DshSessionStreamFrame[] {
  const sessionId = workflowRunState.run?.dshSessionId;
  if (!sessionId) return streamFramesState.frames;
  return streamFramesState.frames.filter((frame) => frame.sessionId === sessionId);
}

/** 校验一个提案（report only；stale/invalid 原样投影）。 */
export async function validateStewardProposal(
  proposalId: StewardProposalId,
): Promise<SkillValidationResult | null> {
  const request = proposalGate.issue();
  const state = proposalStateFor(proposalId);
  state.busy = "validate";
  state.error = null;
  try {
    const result = await requireRpc().skillSteward.validate({ proposalId });
    if (!request.isCurrent()) return null;
    state.validation = result;
    appendTimeline("validated", {
      proposalId,
      text: `validation: ${result.overall} (${result.checks.filter((c) => c.status === "passed").length}/${result.checks.length} checks passed)`,
    });
    return result;
  } catch (error) {
    if (!request.isCurrent()) return null;
    state.error = error instanceof Error ? error.message : String(error);
    appendTimeline("error", { proposalId, text: state.error });
    return null;
  } finally {
    if (request.isLatest()) state.busy = null;
  }
}

/** 人类审批（铸一次性 grant；stale/unknown 提案由 typed RPC 失败呈现）。 */
export async function approveStewardProposal(
  proposalId: StewardProposalId,
): Promise<SkillStewardApproveResult | null> {
  const request = proposalGate.issue();
  const state = proposalStateFor(proposalId);
  state.busy = "approve";
  state.error = null;
  try {
    const result = await requireRpc().skillSteward.approve({ proposalId });
    if (!request.isCurrent()) return null;
    state.grant = result;
    appendTimeline("approved", {
      proposalId,
      text: `grant ${result.grantId} (fingerprint ${result.fingerprint.slice(0, 12)}…)`,
    });
    return result;
  } catch (error) {
    if (!request.isCurrent()) return null;
    state.error = error instanceof Error ? error.message : String(error);
    appendTimeline("error", { proposalId, text: state.error });
    return null;
  } finally {
    if (request.isLatest()) state.busy = null;
  }
}

/** 消费 grant 执行 journaled apply（applied/compensated/recovery-required 全终态投影）。 */
export async function applyStewardProposal(
  proposalId: StewardProposalId,
): Promise<SkillStewardApplyResult | null> {
  const request = proposalGate.issue();
  const state = proposalStateFor(proposalId);
  state.busy = "apply";
  state.error = null;
  try {
    const result = await requireRpc().skillSteward.apply({ proposalId });
    if (!request.isCurrent()) return null;
    state.apply = result;
    appendTimeline("applied", {
      proposalId,
      auditId: result.auditId,
      text: `apply: ${result.outcomeStatus} · ${result.mutations.length} mutations${result.failure ? ` · ${result.failure}` : ""}`,
    });
    return result;
  } catch (error) {
    if (!request.isCurrent()) return null;
    state.error = error instanceof Error ? error.message : String(error);
    appendTimeline("error", { proposalId, text: state.error });
    return null;
  } finally {
    if (request.isLatest()) state.busy = null;
  }
}

/**
 * prepareRollback 的两类返回（approval-service 实测）：
 * - disable/enable：真实 reverse proposal id，note 要求「separate human approval」
 *   → UI 走 approve(reverseId) + apply(reverseId)。
 * - split/merge 等：铸造 rollback grant，reverseProposalId 是占位零 id
 *   （`spp_` + 16 个 `0`）→ UI 直接 applyRollback(auditId) 消费 grant。
 */
export function isReverseProposalPlaceholder(proposalId: string | undefined): boolean {
  return proposalId === `spp_${"0".repeat(16)}`;
}

/** 准备 rollback（Manager 派生 reverse proposal / rollback grant，note 原样呈现）。 */
export async function prepareStewardRollback(
  proposalId: StewardProposalId,
  auditId: StewardAuditId,
): Promise<SkillStewardRollbackResult | null> {
  const request = proposalGate.issue();
  const state = proposalStateFor(proposalId);
  state.busy = "prepare-rollback";
  state.error = null;
  try {
    const result = await requireRpc().skillSteward.prepareRollback({ auditId });
    if (!request.isCurrent()) return null;
    state.rollbackPrep = result;
    appendTimeline("rollback-prepared", {
      proposalId,
      auditId,
      text:
        !isReverseProposalPlaceholder(result.reverseProposalId) && result.reverseProposalId
          ? `reverse proposal ${result.reverseProposalId}: ${result.note}`
          : result.note,
    });
    return result;
  } catch (error) {
    if (!request.isCurrent()) return null;
    state.error = error instanceof Error ? error.message : String(error);
    appendTimeline("error", { proposalId, auditId, text: state.error });
    return null;
  } finally {
    if (request.isLatest()) state.busy = null;
  }
}

/** 执行 rollback（消费 rollback grant 反向重放 journal；终态同 apply）。 */
export async function applyStewardRollback(
  proposalId: StewardProposalId,
  auditId: StewardAuditId,
): Promise<SkillStewardApplyResult | null> {
  const request = proposalGate.issue();
  const state = proposalStateFor(proposalId);
  state.busy = "apply-rollback";
  state.error = null;
  try {
    const result = await requireRpc().skillSteward.applyRollback({ auditId });
    if (!request.isCurrent()) return null;
    state.rollbackResult = result;
    appendTimeline("rolled-back", {
      proposalId,
      auditId,
      text: `rollback: ${result.outcomeStatus} · ${result.mutations.length} mutations${result.failure ? ` · ${result.failure}` : ""}`,
    });
    return result;
  } catch (error) {
    if (!request.isCurrent()) return null;
    state.error = error instanceof Error ? error.message : String(error);
    appendTimeline("error", { proposalId, auditId, text: state.error });
    return null;
  } finally {
    if (request.isLatest()) state.busy = null;
  }
}
