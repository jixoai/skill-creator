/**
 * 原始需求 [2026-09-05]：「用户可以导入 Workspace……Remove 只删除 registry entry。」
 * 正交意图：[1] 导入对话框的全局打开状态（sidebar 与 Workspaces home 共享同一实例）。
 */
export const importWorkspaceUi = $state({ open: false });

/** 请求打开 workspace 导入对话框（幂等）。 */
export function requestImportWorkspace(): void {
  importWorkspaceUi.open = true;
}
