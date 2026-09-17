/**
 * 原始需求 [2026-07-14]：「skills manager 只是路由的一部分(`/workspace/~/`)；我们还需要支持导入 workspace」。
 * 正交意图：
 * 1. 按最新请求代次投影 Global 与导入 Workspace 的导航状态。
 * 2. 编排 workspace 导入、移除与当前目标切换。
 */
import type {
  ImportedWorkspace,
  Workspace,
  WorkspaceId,
  WorkspaceProvider,
  WorkspaceProviderTarget,
} from "../types";
import { ImportedWorkspaceIdSchema } from "$shared/contracts/workspaces.js";
import { getConnectionGeneration, getRpc, requireRpc } from "./connection.svelte";
import { createRequestGenerationGate } from "./request-generation.js";
import { writableWorkspaceProviders as deriveWritableWorkspaceProviders } from "./workspace-targets";
import type { WritableWorkspaceProvider } from "./workspace-targets";

const workspaceRequests = createRequestGenerationGate(getConnectionGeneration);
const workspaceMutationRequests = createRequestGenerationGate(getConnectionGeneration);

/** 一次 Workspace 投影请求对调用方可见的终态。 */
export type WorkspaceLoadOutcome = "loaded" | "superseded" | "failed";

// 在途合并（perf-firstscreen B-2）：workspace.list 在真实语料下是重 RPC
// （registry 投影全量扫描）；layout connected-effect 与组件挂载会在首屏
// 并发触发，重复请求会各自占用 daemon 事件循环。后来者共享同一在途
// Promise；代次门语义不变（新的显式加载仍作废旧响应的提交资格）。
// codex perf-review P1-2：在途项绑定创建时的 connection owner generation——
// 断线会让旧请求失去提交资格（且半开 WS 可能让它永不 settle），重连后的
// 调用不得复用跨代的悬死 Promise，必须发起新加载。
let inflightWorkspaces: { generation: number; promise: Promise<WorkspaceLoadOutcome> } | null =
  null;

/** Global 与导入 Workspace 的全局导航状态。 */
export const workspaceState = $state<{
  workspaces: Workspace[];
  activeId: WorkspaceId;
  loading: boolean;
  error: string | null;
}>({ workspaces: [], activeId: "~", loading: true, error: null });

/** 从 daemon 刷新 workspace registry 投影（同代在途共享，见 inflightWorkspaces）。 */
export async function loadWorkspaces(force = false): Promise<WorkspaceLoadOutcome> {
  const generation = getConnectionGeneration();
  const reusable =
    inflightWorkspaces !== null && inflightWorkspaces.generation === generation
      ? inflightWorkspaces.promise
      : null;
  if (!force && reusable !== null) return reusable;
  const promise = performLoadWorkspaces().finally(() => {
    if (inflightWorkspaces?.promise === promise) inflightWorkspaces = null;
  });
  inflightWorkspaces = { generation, promise };
  return promise;
}

async function performLoadWorkspaces(): Promise<WorkspaceLoadOutcome> {
  const request = workspaceRequests.issue();
  const rpc = getRpc();
  if (!rpc) {
    if (request.isLatest()) workspaceState.loading = false;
    return "failed";
  }
  workspaceState.loading = true;
  workspaceState.error = null;
  try {
    const { workspaces } = await rpc.workspace.list({});
    if (!request.isCurrent()) return "superseded";
    workspaceState.workspaces = workspaces;
    workspaceState.activeId = workspaces.find((workspace) => workspace.active)?.id ?? "~";
    return "loaded";
  } catch (error) {
    if (!request.isCurrent()) return "superseded";
    workspaceState.error = error instanceof Error ? error.message : String(error);
    return "failed";
  } finally {
    if (request.isLatest()) workspaceState.loading = false;
  }
}

/** 导入一个目录 workspace 并刷新 registry。 */
export async function addWorkspace(
  directoryPath: string,
  label?: string,
): Promise<Workspace | null> {
  const request = workspaceMutationRequests.issue();
  let workspace: Workspace;
  try {
    ({ workspace } = await requireRpc().workspace.add({ path: directoryPath, label }));
  } catch (error) {
    if (!request.isCurrent()) return null;
    throw error;
  }
  if (!request.isCurrent()) {
    // mutation 已成功落盘：stale 只取消返回值的提交资格，不让 UI 与盘失联。
    await loadWorkspaces(true);
    return null;
  }
  await loadWorkspaces(true);
  return workspace;
}

/** 从 registry 移除一个导入 workspace。 */
export async function removeWorkspace(id: string): Promise<boolean> {
  const importedId = ImportedWorkspaceIdSchema.parse(id);
  const request = workspaceMutationRequests.issue();
  let activeId: WorkspaceId;
  try {
    ({ activeId } = await requireRpc().workspace.remove({ id: importedId }));
  } catch (error) {
    if (!request.isCurrent()) return false;
    throw error;
  }
  if (!request.isCurrent()) return false;
  workspaceState.activeId = activeId;
  await loadWorkspaces(true);
  return request.isCurrent();
}

/** 将 workspace 设为 daemon 与界面的当前目标。 */
export async function setActiveWorkspace(id: WorkspaceId): Promise<boolean> {
  const request = workspaceMutationRequests.issue();
  let activeId: WorkspaceId;
  try {
    ({ activeId } = await requireRpc().workspace.setActive({ id }));
  } catch (error) {
    if (!request.isCurrent()) return false;
    throw error;
  }
  if (!request.isCurrent()) return false;
  workspaceRequests.invalidate();
  workspaceState.activeId = activeId;
  for (const workspace of workspaceState.workspaces) workspace.active = workspace.id === activeId;
  return true;
}

/** 返回当前 workspace 投影。 */
export function activeWorkspace(): Workspace | null {
  return (
    workspaceState.workspaces.find((workspace) => workspace.id === workspaceState.activeId) ?? null
  );
}

/** 返回可作为 Creator 或 Repository 目标的可写 Imported Workspace。 */
export function writableWorkspaces(): ImportedWorkspace[] {
  return workspaceState.workspaces.filter(isWritableWorkspace);
}

function isWritableWorkspace(workspace: Workspace): workspace is ImportedWorkspace {
  return workspace.kind === "directory" && workspace.available;
}

export type { WritableWorkspaceProvider } from "./workspace-targets";

/** 展开 Imported Workspaces 的所有可写 Provider 目的地（纯逻辑见 workspace-targets.ts）。 */
export function writableWorkspaceProviders(): WritableWorkspaceProvider[] {
  return deriveWritableWorkspaceProviders(workspaceState.workspaces);
}

/** Workspace 在 Workspaces App 内的默认落点路径（纯逻辑见 workspace-targets.ts）。 */
export { workspaceEntryPath } from "./workspace-targets";
