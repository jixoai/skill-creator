/**
 * 终端 tab 纯模型（skills-agent-page-zcode-parity 2.1）——ZCode tab 所有权语义的
 * Svelte 移植。逐函数对照：
 *   - formatShellLabel ↔ TerminalSession.tsx:66-81（formatShellLabel）
 *   - pathLeaf ↔ lib/path.ts getPathLeaf（反斜杠归一 + 尾斜杠裁剪 + 空段过滤）
 *   - formatTerminalTabTitle / nextSessionIndex ↔ terminalPanelState.ts:63-85
 *     （编号从现存 session 推导最小空位，不持只增计数器——关闭 2 后新建回到 2）
 *
 * 用户原始需求 [2026-10-04]（design §2）：「Terminal sessions 按 Workspace identity
 * 分区……tab 可新建、激活、关闭；header 显示当前 shell label。源码未提供
 * shell-type selector。」
 *
 * 正交意图：
 *   [1] 展示名派生：cwd leaf → projectName → tab title（index 1 无后缀）。
 *   [2] shell label 展示名（.exe 剥除 + powershell/pwsh → PowerShell）。
 *   [3] per-workspace 最小空位编号。
 * 妥协声明：无。
 */

/** ZCode Workspace 终端回退 key（Terminal.tsx:49 `workspaceIdentity || cwd || "__default__"`）。 */
export const TERMINAL_DEFAULT_WORKSPACE_KEY = "__default__";

/**
 * shell 路径 → 展示 label（ZCode TerminalSession.tsx formatShellLabel 字节级语义）：
 * 按 `/` 或 `\` 取末段、剥 `.exe`、小写；powershell/pwsh 归一为 "PowerShell"。
 */
export function formatShellLabel(shell: string | null): string | null {
  if (!shell) return null;
  const shellParts = shell.split(/[\\/]/);
  const lastPart = shellParts[shellParts.length - 1];
  const name = lastPart?.replace(/\.exe$/i, "").toLowerCase();
  if (!name) return shell;
  if (name === "powershell" || name === "pwsh") return "PowerShell";
  return name;
}

/** 路径末段（ZCode lib/path.ts getPathLeaf：反斜杠归一、裁尾斜杠、滤空段）。 */
export function terminalPathLeaf(path: string): string {
  const normalizedPath = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = normalizedPath.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

/** tab 标题（ZCode terminalPanelState.ts formatTerminalTabTitle：index 1 无后缀）。 */
export function formatTerminalTabTitle(projectName: string, index: number): string {
  return index === 1 ? projectName : `${projectName} ${index}`;
}

/** per-workspace 最小空位编号（ZCode getNextTerminalSessionIndex：从 1 起找第一个空闲位）。 */
export function nextSessionIndex(usedIndices: Iterable<number>): number {
  const used = new Set(usedIndices);
  for (let index = 1; ; index += 1) {
    if (!used.has(index)) return index;
  }
}
