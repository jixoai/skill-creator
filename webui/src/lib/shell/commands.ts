/**
 * Shared command source for the command palette and shell omnibox.
 * 修订 [2026-10-04]（workspace-page-polish V2）：ws 作用域命令的目的地在执行时
 * 按激活 tab 的 wsId 解析（palette/omnibox 是全局浮层，但命令目的地必须跟随
 * 当前 tab——旧实现硬编码 /w/~/ 造成跨 ws 跳转）；「Repository」命令随一级
 * 导航退役移除（repos 屏经 /w/:wsId/skills?screen=repos 抵达）。
 * 修订 [2026-10-05]（workspace-page-polish）：新增「Workspaces」命令直达
 * /workspace 标准管理页；workspace/workspaces 关键词随之从 Skills 命令迁出。
 */
import { tabSession } from "./tab-session.svelte.js";

/** ws 作用域命令的区块目的地后缀（路径 = /w/<activeWs>/<block>）。 */
type WorkspaceBlock = "skills" | "creator" | "wiki" | "evaluating";

export const SHELL_COMMANDS = [
  {
    id: "skills",
    label: "Skills",
    keywords: ["manage skills", "global", "list"],
    action: { kind: "workspace", block: "skills" },
  },
  {
    // 工作区管理页（workspace-page-polish）：注册目录索引 + Remove 收口 +
    // Import 入口；IMPORTED 词汇从用户面退役后的标准管理面。
    id: "workspaces",
    label: "Workspaces",
    keywords: ["workspace", "import", "remove", "directory", "directories", "manage"],
    action: { kind: "navigate", path: "/workspace" },
  },
  {
    id: "creator",
    label: "Creator",
    keywords: ["create", "edit", "new skill"],
    action: { kind: "workspace", block: "creator" },
  },
  {
    id: "wiki",
    label: "Wiki",
    keywords: ["knowledge", "patterns"],
    action: { kind: "workspace", block: "wiki" },
  },
  {
    id: "evaluating",
    label: "Evaluating",
    keywords: ["evaluation", "tests", "cases"],
    action: { kind: "workspace", block: "evaluating" },
  },
  {
    id: "agent",
    label: "Agent",
    keywords: ["chat", "assistant"],
    action: { kind: "navigate", path: "/agent" },
  },
  {
    id: "settings",
    label: "Settings",
    keywords: ["preferences", "configuration"],
    action: { kind: "navigate", path: "/settings" },
  },
  {
    id: "search-config",
    label: "Open search config",
    keywords: ["search", "toml", "index exclusions"],
    action: { kind: "search-config" },
  },
] as const;

export type ShellCommand = (typeof SHELL_COMMANDS)[number];
export type ShellCommandId = ShellCommand["id"];

export interface ShellCommandHandlers {
  navigate(path: string): void;
  openSearchConfig(): void;
}

/** 当前激活 tab 的 workspace id（与 Omnibox pathSuggestions 同源派生：非 ws tab = Global "~"）。 */
export function currentTabWorkspaceId(): string {
  const tabId = tabSession.navigation.activeId;
  return tabId.startsWith("ws_") ? tabId : "~";
}

/** ws 作用域命令的目的地：执行时随激活 tab 解析（缺省当前 tab，可显式传 wsId 供测试）。 */
export function workspaceBlockPath(
  block: WorkspaceBlock,
  workspaceId: string = currentTabWorkspaceId(),
): string {
  return `/w/${encodeURIComponent(workspaceId)}/${block}`;
}

/** Filter commands with stable label-first ranking shared by both surfaces. */
export function filterShellCommands(query: string): ShellCommand[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...SHELL_COMMANDS];

  return SHELL_COMMANDS.map((command, order) => ({
    command,
    order,
    rank: command.label.toLocaleLowerCase().startsWith(needle)
      ? 0
      : command.keywords.some((keyword) => keyword.toLocaleLowerCase().startsWith(needle))
        ? 1
        : 2,
  }))
    .filter(({ command }) =>
      `${command.label} ${command.keywords.join(" ")}`.toLocaleLowerCase().includes(needle),
    )
    .sort((left, right) => left.rank - right.rank || left.order - right.order)
    .map(({ command }) => command);
}

/** Execute a registered command through the consuming surface's shell adapters. */
export function executeShellCommand(command: ShellCommand, handlers: ShellCommandHandlers): void {
  if (command.action.kind === "navigate") handlers.navigate(command.action.path);
  else if (command.action.kind === "workspace")
    handlers.navigate(workspaceBlockPath(command.action.block));
  else handlers.openSearchConfig();
}
