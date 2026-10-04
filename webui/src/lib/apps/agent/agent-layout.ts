/** Agent 主工作区尺寸约束（skills-agent-page-zcode-parity 1.3/5.1/5.2）。 */

export const AGENT_TREE_DEFAULT_WIDTH = 264;
export const AGENT_TREE_MIN_WIDTH = 264;
export const AGENT_TREE_MAX_WIDTH_RATIO = 0.5;
export const AGENT_TREE_COLLAPSED_WIDTH = 36;
export const AGENT_LAYOUT_KEYBOARD_STEP = 16;
export const AGENT_CHAT_MIN_WIDTH = 320;
export const AGENT_RIGHT_PANEL_MIN_WIDTH = 240;
export const AGENT_RIGHT_PANEL_MIN_RATIO = 0.15;
export const AGENT_RIGHT_PANEL_MAX_RATIO = 0.65;
export const AGENT_RIGHT_PANEL_DEFAULT_RATIO = 0.45;

export function maxAgentTreeWidth(containerWidth: number): number {
  return Math.max(AGENT_TREE_MIN_WIDTH, Math.floor(containerWidth * AGENT_TREE_MAX_WIDTH_RATIO));
}

export function clampAgentTreeWidth(width: number, containerWidth: number): number {
  if (!Number.isFinite(width)) return AGENT_TREE_DEFAULT_WIDTH;
  return Math.min(
    maxAgentTreeWidth(containerWidth),
    Math.max(AGENT_TREE_MIN_WIDTH, Math.round(width)),
  );
}

export function resizeAgentTreeWidth(
  width: number,
  key: string,
  containerWidth: number,
): number | null {
  if (key === "Home") return AGENT_TREE_MIN_WIDTH;
  if (key === "End") return maxAgentTreeWidth(containerWidth);
  if (key === "ArrowLeft")
    return clampAgentTreeWidth(width - AGENT_LAYOUT_KEYBOARD_STEP, containerWidth);
  if (key === "ArrowRight")
    return clampAgentTreeWidth(width + AGENT_LAYOUT_KEYBOARD_STEP, containerWidth);
  return null;
}

/** Side pane consumes 45% by default, may grow to 65%, and preserves a 320px chat. */
export function agentRightPanelWidth(ratio: number, availableWidth: number): number {
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return AGENT_RIGHT_PANEL_MIN_WIDTH;
  const { minWidth, maxWidth } = rightPanelBounds(availableWidth);
  const resolvedRatio = Number.isFinite(ratio) ? ratio : AGENT_RIGHT_PANEL_DEFAULT_RATIO;
  return Math.round(Math.min(maxWidth, Math.max(minWidth, availableWidth * resolvedRatio)));
}

export function agentRightPanelRatio(width: number, availableWidth: number): number {
  if (!Number.isFinite(availableWidth) || availableWidth <= 0)
    return AGENT_RIGHT_PANEL_DEFAULT_RATIO;
  const { minWidth, maxWidth } = rightPanelBounds(availableWidth);
  const minRatio = Math.max(AGENT_RIGHT_PANEL_MIN_RATIO, minWidth / availableWidth);
  const maxRatio = Math.min(AGENT_RIGHT_PANEL_MAX_RATIO, maxWidth / availableWidth);
  return Math.min(maxRatio, Math.max(minRatio, width / availableWidth));
}

function rightPanelBounds(availableWidth: number): { minWidth: number; maxWidth: number } {
  const maxWidth = Math.max(
    AGENT_RIGHT_PANEL_MIN_WIDTH,
    Math.min(availableWidth * AGENT_RIGHT_PANEL_MAX_RATIO, availableWidth - AGENT_CHAT_MIN_WIDTH),
  );
  return { minWidth: Math.min(AGENT_RIGHT_PANEL_MIN_WIDTH, maxWidth), maxWidth };
}

export type AgentShellShortcut =
  | "toggle-sidebar"
  | "toggle-terminal"
  | "toggle-side-pane"
  | "new-session"
  | "previous-session"
  | "next-session";

export function matchAgentShellShortcut(
  event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  platform: "mac" | "other",
): AgentShellShortcut | null {
  const command =
    platform === "mac" ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!command) return null;
  if (event.shiftKey && !event.altKey && (event.code === "BracketLeft" || event.key === "{")) {
    return "previous-session";
  }
  if (event.shiftKey && !event.altKey && (event.code === "BracketRight" || event.key === "}")) {
    return "next-session";
  }
  if (event.shiftKey) return null;
  if (event.key.toLowerCase() === "b") return event.altKey ? "toggle-side-pane" : "toggle-sidebar";
  if (event.altKey) return null;
  if (event.key.toLowerCase() === "j") return "toggle-terminal";
  if (event.key.toLowerCase() === "n") return "new-session";
  return null;
}
