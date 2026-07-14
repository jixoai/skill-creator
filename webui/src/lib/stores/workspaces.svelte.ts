/**
 * 原始需求 [2026-07-14]：「skills manager 只是路由的一部分(`/workspace/~/`)；我们还需要支持导入 workspace」。
 * 正交意图：
 * 1. 投影 home 与导入 workspace 的导航状态。
 * 2. 编排 workspace 导入、移除与当前目标切换。
 */
import type { ImportedWorkspace, Workspace, WorkspaceId } from "../types";
import { ImportedWorkspaceIdSchema } from "$shared/contracts/workspaces.js";
import { getRpc, requireRpc } from "./connection.svelte";

/** home 与导入 workspace 的全局导航状态。 */
export const workspaceState = $state<{
  workspaces: Workspace[];
  activeId: WorkspaceId;
  loading: boolean;
  error: string | null;
}>({ workspaces: [], activeId: "~", loading: true, error: null });

/** 从 daemon 刷新 workspace registry 投影。 */
export async function loadWorkspaces(): Promise<void> {
  const rpc = getRpc();
  if (!rpc) {
    workspaceState.loading = false;
    return;
  }
  workspaceState.loading = true;
  workspaceState.error = null;
  try {
    const { workspaces } = await rpc.workspace.list({});
    workspaceState.workspaces = workspaces;
    workspaceState.activeId = workspaces.find((workspace) => workspace.active)?.id ?? "~";
  } catch (error) {
    workspaceState.error = error instanceof Error ? error.message : String(error);
  } finally {
    workspaceState.loading = false;
  }
}

/** 导入一个目录 workspace 并刷新 registry。 */
export async function addWorkspace(directoryPath: string, label?: string): Promise<Workspace> {
  const { workspace } = await requireRpc().workspace.add({ path: directoryPath, label });
  await loadWorkspaces();
  return workspace;
}

/** 从 registry 移除一个导入 workspace。 */
export async function removeWorkspace(id: string): Promise<void> {
  const importedId = ImportedWorkspaceIdSchema.parse(id);
  const { activeId } = await requireRpc().workspace.remove({ id: importedId });
  workspaceState.activeId = activeId;
  await loadWorkspaces();
}

/** 将 workspace 设为 daemon 与界面的当前目标。 */
export async function setActiveWorkspace(id: WorkspaceId): Promise<void> {
  const result = await requireRpc().workspace.setActive({ id });
  workspaceState.activeId = result.activeId;
  for (const workspace of workspaceState.workspaces)
    workspace.active = workspace.id === result.activeId;
}

/** 返回当前 workspace 投影。 */
export function activeWorkspace(): Workspace | null {
  return (
    workspaceState.workspaces.find((workspace) => workspace.id === workspaceState.activeId) ?? null
  );
}

/** 返回可作为 Creator 或 Repository 目标的可写 workspace。 */
export function writableWorkspaces(): ImportedWorkspace[] {
  return workspaceState.workspaces.filter(isWritableWorkspace);
}

function isWritableWorkspace(workspace: Workspace): workspace is ImportedWorkspace {
  return workspace.kind === "directory" && workspace.available;
}
