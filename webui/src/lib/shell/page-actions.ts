/** Page-owned shell actions. */
export type ShellPageKind = "workspace" | "agent" | "settings";
export type ShellPageActionId = "agent-panel" | "terminal" | "right-panel" | "theme";

export interface ShellPageAction {
  readonly id: ShellPageActionId;
  readonly label: string;
}

export const SHELL_PAGE_ACTIONS: Readonly<Record<ShellPageKind, readonly ShellPageAction[]>> = {
  workspace: [{ id: "agent-panel", label: "Agent panel" }],
  agent: [
    { id: "terminal", label: "Terminal" },
    { id: "right-panel", label: "Extension panel" },
  ],
  settings: [{ id: "theme", label: "Theme" }],
};
