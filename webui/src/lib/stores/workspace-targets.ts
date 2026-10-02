/**
 * 用户原始需求 [2026-09-05]：「用户可以导入 Workspace……下载到某个 Workspace.provider，且能多选。」
 * 修订 [2026-10-02]（ux-polish-walkthrough-residue #7）：默认落点优先第一个
 * 有技能的 provider——落 0-skill 空页是走查确认的挫败点（全空则维持首个）。
 * 正交意图：
 *   [1] 纯函数派生可写 Workspace Provider 安装目标（Global 与不可用 Workspace 永不入选）。
 *   [2] 纯函数派生 Workspace 的默认导航落点路径。
 * 妥协声明：无。store 层（workspaces.svelte.ts）持响应态并薄包装本模块。
 */
import type { Workspace, WorkspaceProvider, WorkspaceProviderTarget } from "../types";

/** 已投影的可写 Workspace Provider 目的地。 */
export interface WritableWorkspaceProvider {
  target: WorkspaceProviderTarget;
  workspace: Workspace;
  provider: WorkspaceProvider;
  label: string;
}

/** 展开 Imported Workspaces 的所有可写 Provider 目的地（Global `~` 与不可用目录被排除）。 */
export function writableWorkspaceProviders(
  workspaces: readonly Workspace[],
): WritableWorkspaceProvider[] {
  const targets: WritableWorkspaceProvider[] = [];
  for (const workspace of workspaces) {
    if (workspace.kind !== "directory" || !workspace.available) continue;
    for (const provider of workspace.providers) {
      if (!provider.writable) continue;
      targets.push({
        target: { workspaceId: workspace.id, providerId: provider.id },
        workspace,
        provider,
        label: `${workspace.label} / ${provider.label}`,
      });
    }
  }
  return targets;
}

/**
 * Workspace 在 Workspaces App 内的默认落点路径。
 * 落点选择（走查 #7）：第一个 skillCount > 0 的 provider；全部为空时维持首个
 * provider；无 provider 回 home。
 */
export function workspaceEntryPath(workspace: Workspace): string {
  if (workspace.kind === "directory" && workspace.providers.length > 0) {
    const provider =
      workspace.providers.find((candidate) => candidate.skillCount > 0) ?? workspace.providers[0];
    if (!provider) return "/workspaces";
    return `/workspaces/${encodeURIComponent(workspace.id)}/${encodeURIComponent(provider.id)}`;
  }
  return "/workspaces";
}
