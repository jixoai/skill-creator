/** Responsive state for the workspace-only mobile navigation drawer. */
export const workspaceNavigation = $state({ open: false });

export function toggleWorkspaceNavigation(): void {
  workspaceNavigation.open = !workspaceNavigation.open;
}

export function closeWorkspaceNavigation(): void {
  workspaceNavigation.open = false;
}
