/**
 * 用户原始需求 [2026-09-07]（openspec steward-product-workflow task 4.1）：
 * 「只实现 task/target/selected-skills/runtime-config stores 和对应 workflow view；
 * 复用阶段 4 已注册的 plugin/root/connection/RPC owner。」
 *
 * 正交意图：
 *   [1] 任务/范围选择（taskKind + selectedSkillIds + instructions）按 provider
 *       target 键控，模块级状态跨 island 卸载/重连存活；不写 localStorage。
 *   [2] runtime config（dsh.settings 视图/补丁）与 run 投影走 latest-request-wins
 *       代次门：断线重连、新请求或路由切换都会撤销旧响应的提交资格。
 * 妥协声明：run 投影只保留最近一次（列表与 durable 审计归 daemon/audit store）；
 *   审批/apply/rollback 的产品工作流是 4.2 的边界，本 store 不提前实现。
 */
import type {
  DshSettingsUpdate,
  DshSettingsUpdateResult,
  DshStewardSettingsView,
} from "$shared/contracts/dsh-runtime.js";
import type { SkillStewardRunResult, StewardTaskKind } from "$shared/contracts/skill-steward.js";
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
  return selection;
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
    return result;
  } catch (error) {
    if (!request.isCurrent()) return null;
    workflowRunState.error = error instanceof Error ? error.message : String(error);
    return null;
  } finally {
    // starting 清理只需 isLatest；run/错误提交要求 isCurrent。
    if (request.isLatest()) workflowRunState.starting = false;
  }
}
