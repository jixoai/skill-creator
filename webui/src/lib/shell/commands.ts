/** Shared command source for the command palette and shell omnibox. */
export const SHELL_COMMANDS = [
  {
    id: "skills",
    label: "Skills",
    keywords: ["workspace", "workspaces", "manage skills", "global"],
    action: { kind: "navigate", path: "/w/~/skills" },
  },
  {
    id: "creator",
    label: "Creator",
    keywords: ["create", "edit", "new skill"],
    action: { kind: "navigate", path: "/w/~/creator" },
  },
  {
    id: "wiki",
    label: "Wiki",
    keywords: ["knowledge", "patterns"],
    action: { kind: "navigate", path: "/w/~/wiki" },
  },
  {
    id: "evaluating",
    label: "Evaluating",
    keywords: ["evaluation", "tests", "cases"],
    action: { kind: "navigate", path: "/w/~/evaluating" },
  },
  {
    id: "repository",
    label: "Repository",
    keywords: ["repos", "sources", "install", "browse remote"],
    action: { kind: "navigate", path: "/w/~/skills?screen=repos" },
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
  else handlers.openSearchConfig();
}
