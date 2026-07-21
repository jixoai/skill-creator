/**
 * 用户原始需求 [2026-07-22]：「GlobalWorkspace 能识别市面上有哪些 Agent；一个 Workspace 下可以包含多个 providers。」
 * 正交意图：
 *   [1] 固化社区 Agent skills 地址目录的浏览器安全目录。
 *   [2] 为 daemon 的 Global 与 Imported Workspace 根目录解析提供无副作用事实源。
 * 妥协声明：catalog 从 `references/skills/src/agents.ts` 提炼；不在运行时依赖其 CLI，避免把外部 Git checkout 变成发布依赖。
 */

/** Provider 的稳定目录约定；`null` 表示该 Agent 不支持全局 skills。 */
export interface ProviderCatalogEntry {
  id: string;
  label: string;
  workspacePath: string;
  globalPath: string | null;
}

/**
 * Vercel Labs skills Agent catalog snapshot (2026-07-22).
 * Source: https://github.com/vercel-labs/skills/src/agents.ts
 */
export const PROVIDER_CATALOG: readonly ProviderCatalogEntry[] = [
  {
    id: "aider-desk",
    label: "AiderDesk",
    workspacePath: ".aider-desk/skills",
    globalPath: ".aider-desk/skills",
  },
  { id: "amp", label: "Amp", workspacePath: ".agents/skills", globalPath: ".config/agents/skills" },
  {
    id: "antigravity",
    label: "Antigravity",
    workspacePath: ".agents/skills",
    globalPath: ".gemini/antigravity/skills",
  },
  {
    id: "antigravity-cli",
    label: "Antigravity CLI",
    workspacePath: ".agents/skills",
    globalPath: ".gemini/antigravity-cli/skills",
  },
  {
    id: "astrbot",
    label: "AstrBot",
    workspacePath: "data/skills",
    globalPath: ".astrbot/data/skills",
  },
  {
    id: "autohand-code",
    label: "Autohand Code CLI",
    workspacePath: ".autohand/skills",
    globalPath: ".autohand/skills",
  },
  {
    id: "augment",
    label: "Augment",
    workspacePath: ".augment/skills",
    globalPath: ".augment/skills",
  },
  { id: "bob", label: "IBM Bob", workspacePath: ".bob/skills", globalPath: ".bob/skills" },
  {
    id: "claude-code",
    label: "Claude Code",
    workspacePath: ".claude/skills",
    globalPath: ".claude/skills",
  },
  { id: "openclaw", label: "OpenClaw", workspacePath: "skills", globalPath: ".openclaw/skills" },
  { id: "cline", label: "Cline", workspacePath: ".agents/skills", globalPath: ".agents/skills" },
  {
    id: "codearts-agent",
    label: "CodeArts Agent",
    workspacePath: ".codeartsdoer/skills",
    globalPath: ".codeartsdoer/skills",
  },
  {
    id: "codebuddy",
    label: "CodeBuddy",
    workspacePath: ".codebuddy/skills",
    globalPath: ".codebuddy/skills",
  },
  {
    id: "codemaker",
    label: "Codemaker",
    workspacePath: ".codemaker/skills",
    globalPath: ".codemaker/skills",
  },
  {
    id: "codestudio",
    label: "Code Studio",
    workspacePath: ".codestudio/skills",
    globalPath: ".codestudio/skills",
  },
  { id: "codex", label: "Codex", workspacePath: ".agents/skills", globalPath: ".codex/skills" },
  {
    id: "command-code",
    label: "Command Code",
    workspacePath: ".commandcode/skills",
    globalPath: ".commandcode/skills",
  },
  {
    id: "continue",
    label: "Continue",
    workspacePath: ".continue/skills",
    globalPath: ".continue/skills",
  },
  {
    id: "cortex",
    label: "Cortex Code",
    workspacePath: ".cortex/skills",
    globalPath: ".snowflake/cortex/skills",
  },
  {
    id: "crush",
    label: "Crush",
    workspacePath: ".crush/skills",
    globalPath: ".config/crush/skills",
  },
  { id: "cursor", label: "Cursor", workspacePath: ".agents/skills", globalPath: ".cursor/skills" },
  {
    id: "deepagents",
    label: "Deep Agents",
    workspacePath: ".agents/skills",
    globalPath: ".deepagents/agent/skills",
  },
  {
    id: "devin",
    label: "Devin for Terminal",
    workspacePath: ".devin/skills",
    globalPath: ".config/devin/skills",
  },
  { id: "dexto", label: "Dexto", workspacePath: ".agents/skills", globalPath: ".agents/skills" },
  { id: "droid", label: "Droid", workspacePath: ".factory/skills", globalPath: ".factory/skills" },
  { id: "eve", label: "Eve", workspacePath: "agent/skills", globalPath: null },
  {
    id: "firebender",
    label: "Firebender",
    workspacePath: ".agents/skills",
    globalPath: ".firebender/skills",
  },
  {
    id: "forgecode",
    label: "ForgeCode",
    workspacePath: ".forge/skills",
    globalPath: ".forge/skills",
  },
  {
    id: "gemini-cli",
    label: "Gemini CLI",
    workspacePath: ".agents/skills",
    globalPath: ".gemini/skills",
  },
  {
    id: "github-copilot",
    label: "GitHub Copilot",
    workspacePath: ".agents/skills",
    globalPath: ".copilot/skills",
  },
  {
    id: "goose",
    label: "Goose",
    workspacePath: ".goose/skills",
    globalPath: ".config/goose/skills",
  },
  { id: "grok", label: "Grok Build", workspacePath: ".grok/skills", globalPath: ".grok/skills" },
  {
    id: "hermes-agent",
    label: "Hermes Agent",
    workspacePath: ".hermes/skills",
    globalPath: ".hermes/skills",
  },
  {
    id: "inference-sh",
    label: "inference.sh",
    workspacePath: ".inferencesh/skills",
    globalPath: ".inferencesh/skills",
  },
  { id: "jazz", label: "Jazz", workspacePath: ".jazz/skills", globalPath: ".jazz/skills" },
  { id: "junie", label: "Junie", workspacePath: ".junie/skills", globalPath: ".junie/skills" },
  {
    id: "iflow-cli",
    label: "iFlow CLI",
    workspacePath: ".iflow/skills",
    globalPath: ".iflow/skills",
  },
  {
    id: "kilo",
    label: "Kilo Code",
    workspacePath: ".kilocode/skills",
    globalPath: ".kilocode/skills",
  },
  {
    id: "kimchi",
    label: "Kimchi",
    workspacePath: ".kimchi/skills",
    globalPath: ".config/kimchi/harness/skills",
  },
  {
    id: "kimi-code-cli",
    label: "Kimi Code CLI",
    workspacePath: ".agents/skills",
    globalPath: ".agents/skills",
  },
  { id: "kiro-cli", label: "Kiro CLI", workspacePath: ".kiro/skills", globalPath: ".kiro/skills" },
  { id: "kode", label: "Kode", workspacePath: ".kode/skills", globalPath: ".kode/skills" },
  { id: "lingma", label: "Lingma", workspacePath: ".lingma/skills", globalPath: ".lingma/skills" },
  { id: "loaf", label: "Loaf", workspacePath: ".agents/skills", globalPath: ".agents/skills" },
  { id: "mcpjam", label: "MCPJam", workspacePath: ".mcpjam/skills", globalPath: ".mcpjam/skills" },
  {
    id: "mistral-vibe",
    label: "Mistral Vibe",
    workspacePath: ".vibe/skills",
    globalPath: ".vibe/skills",
  },
  { id: "moxby", label: "Moxby", workspacePath: ".moxby/skills", globalPath: ".moxby/skills" },
  { id: "mux", label: "Mux", workspacePath: ".mux/skills", globalPath: ".mux/skills" },
  {
    id: "opencode",
    label: "OpenCode",
    workspacePath: ".agents/skills",
    globalPath: ".config/opencode/skills",
  },
  {
    id: "openhands",
    label: "OpenHands",
    workspacePath: ".openhands/skills",
    globalPath: ".openhands/skills",
  },
  { id: "ona", label: "Ona", workspacePath: ".ona/skills", globalPath: ".ona/skills" },
  { id: "pi", label: "Pi", workspacePath: ".pi/skills", globalPath: ".pi/agent/skills" },
  { id: "qoder", label: "Qoder", workspacePath: ".qoder/skills", globalPath: ".qoder/skills" },
  {
    id: "qoder-cn",
    label: "Qoder CN",
    workspacePath: ".qoder/skills",
    globalPath: ".qoder-cn/skills",
  },
  {
    id: "qwen-code",
    label: "Qwen Code",
    workspacePath: ".qwen/skills",
    globalPath: ".qwen/skills",
  },
  {
    id: "replit",
    label: "Replit",
    workspacePath: ".agents/skills",
    globalPath: ".config/agents/skills",
  },
  {
    id: "reasonix",
    label: "Reasonix",
    workspacePath: ".reasonix/skills",
    globalPath: ".reasonix/skills",
  },
  {
    id: "rovodev",
    label: "Rovo Dev",
    workspacePath: ".rovodev/skills",
    globalPath: ".rovodev/skills",
  },
  { id: "roo", label: "Roo Code", workspacePath: ".roo/skills", globalPath: ".roo/skills" },
  {
    id: "tabnine-cli",
    label: "Tabnine CLI",
    workspacePath: ".tabnine/agent/skills",
    globalPath: ".tabnine/agent/skills",
  },
  {
    id: "terramind",
    label: "Terramind",
    workspacePath: ".terramind/skills",
    globalPath: ".terramind/skills",
  },
  {
    id: "tinycloud",
    label: "Tinycloud",
    workspacePath: ".tinycloud/skills",
    globalPath: ".tinycloud/skills",
  },
  { id: "trae", label: "Trae", workspacePath: ".trae/skills", globalPath: ".trae/skills" },
  { id: "trae-cn", label: "Trae CN", workspacePath: ".trae/skills", globalPath: ".trae-cn/skills" },
  { id: "warp", label: "Warp", workspacePath: ".agents/skills", globalPath: ".agents/skills" },
  {
    id: "windsurf",
    label: "Windsurf",
    workspacePath: ".windsurf/skills",
    globalPath: ".codeium/windsurf/skills",
  },
  { id: "zed", label: "Zed", workspacePath: ".agents/skills", globalPath: ".agents/skills" },
  { id: "zcode", label: "ZCode", workspacePath: ".zcode/skills", globalPath: ".zcode/skills" },
  {
    id: "zencoder",
    label: "Zencoder",
    workspacePath: ".zencoder/skills",
    globalPath: ".zencoder/skills",
  },
  {
    id: "zenflow",
    label: "Zenflow",
    workspacePath: ".zencoder/skills",
    globalPath: ".zencoder/skills",
  },
  {
    id: "neovate",
    label: "Neovate",
    workspacePath: ".neovate/skills",
    globalPath: ".neovate/skills",
  },
  { id: "pochi", label: "Pochi", workspacePath: ".pochi/skills", globalPath: ".pochi/skills" },
  { id: "promptscript", label: "PromptScript", workspacePath: ".agents/skills", globalPath: null },
  { id: "adal", label: "AdaL", workspacePath: ".adal/skills", globalPath: ".adal/skills" },
  {
    id: "universal",
    label: "Universal",
    workspacePath: ".agents/skills",
    globalPath: ".config/agents/skills",
  },
];

/** Return the known catalog entry or `undefined` for an untrusted provider ID. */
export function providerCatalogEntry(id: string): ProviderCatalogEntry | undefined {
  return PROVIDER_CATALOG.find((provider) => provider.id === id);
}
