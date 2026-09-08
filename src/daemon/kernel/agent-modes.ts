/**
 * Agent 会话模式注册表（openspec add-agent-settings-modes）。
 *
 * 用户原始需求 [2026-09-08]：「我们需要提供 创作模式 、 管理模式 、 探索模式 、
 * 自由模式 至少四种模式……每一种模式本质上都是一个 skill……前面 3 种专有模式
 * 毕竟是把 skill 灌成系统提示词，所以它们的专注度会更高一点。」
 *
 * 正交意图：
 *   [1] 模式即预设组合：专有模式 = 版本化 system-prompt section（skill 灌成
 *       提示词）+ MCP 工具名单；free 无专有收窄（基础最佳实践即全部）。
 *   [2] 工具面执行收窄：agent-scoped tools.guard 拒绝名单外的
 *       mcp__skill-creator__* 调用（restrict 管不到 scoped 注册，guard 是
 *       scoped 工具的正确 seam；no guard can force-allow）。
 *   [3] 目录单一事实源：模式目录文案由 shared 契约 DSH_AGENT_MODES 提供，
 *       本注册表只持有 daemon 侧组合事实（section/名单）。
 * 妥协声明：探索模式的「上网搜索」= Repository/Discover 的受控 Git 源扫描面
 *   （repository_* 与 sources_*），不启用内核通用 web 工具行（tool-web 保持
 *   disable）。
 */
import type { Context } from "@deepseek-ai/cordis";
import type { DshAgentMode } from "../../shared/contracts/dsh-runtime.js";

/** 模式提示词版本（任一模式 section 内容变更必 bump）。 */
export const AGENT_MODE_PROMPT_VERSION = "1";

/** MCP 工具全名前缀（dsh-mcp-client 注册命名）。 */
const MCP_TOOL_PREFIX = "mcp__skill-creator__";
/** approved-mutation 能力的 propose 变体后缀（in-process 面，task 4.4）。 */
const PROPOSE_SUFFIX = "_propose";

/** 一种模式的组合事实。 */
export interface AgentModeDefinition {
  /** 专有 prompt section 文本；free 为 null（无收窄即其定义）。 */
  sectionText: string | null;
  /**
   * 允许的 MCP capability 基名（creator_save 等；*_propose 变体随基名继承）。
   * free 以「前缀全放行」表达，名单不枚举。
   */
  tools: readonly string[] | null;
}

const CREATE_SECTION = `# Skill Creator mode: Create (v${AGENT_MODE_PROMPT_VERSION})

You are focused on authoring new skills. Work requirements into well-formed SKILL.md
documents in an imported workspace.

## Workflow
1. Clarify the intent: what task triggers this skill, and what a good result looks like.
  Ask through \`ask_user_question\` only when the gap blocks a usable draft.
2. Check for overlap first (\`skills_list\`, \`skills_info\`): extend an existing skill
  instead of creating a near-duplicate when one fits.
3. Draft through \`creator_load\` / \`creator_save\` (mutations propose; the human
  approves in the UI), then \`skills_validate\` and iterate until clean.

## Authoring law
- The frontmatter \`description\` is the trigger contract: third person, says what the
  skill does and when to use it. Optimize it for retrieval, not cleverness.
- Progressive disclosure: keep SKILL.md lean and procedural; push reference detail to
  bundled files instead of long prose.
- Prefer concrete examples and narrow scope over generic advice; never embed secrets
  or machine-specific absolute paths.
- Respect preferences the human states (language, style, structure) across the session.
- Never claim a document is saved until its propose result says so.`;

const MANAGE_SECTION = `# Skill Creator mode: Manage (v${AGENT_MODE_PROMPT_VERSION})

You are focused on curating the local skill library: dedupe, merge, optimize, toggle,
and update installed skills.

## Workflow
1. Build the inventory: \`skills_list\` per workspace/provider, then \`skills_info\` for
  candidates; compare descriptions, triggers, and overlapping instructions.
2. Propose a plan before writing: what to merge into what, what to disable, what to
  rewrite, and why. Summarize scope and impact first.
3. Execute through propose tools only (\`creator_save\`, \`creator_remove\`,
  \`skills_toggle\`, \`skills_update_apply\`); the human approves each change in the UI.
4. Re-validate after changes (\`skills_validate\`) and report the resulting library
  shape.

## Curation law
- Merge only when triggers truly overlap; otherwise keep skills separate and narrow.
- When merging, preserve each source's distinct value; the merged description must
  still be one precise trigger contract.
- Optimization is subtraction: tighter description, fewer words, same coverage.
- Toggling and removal are destructive to daily use: always propose, never assert.`;

const EXPLORE_SECTION = `# Skill Creator mode: Explore (v${AGENT_MODE_PROMPT_VERSION})

You are focused on finding skills from Git sources and analyzing whether they fit the
human's requirements. Searching happens through the repository capability face
(\`repository_scan\`, \`repository_preview\`, \`repository_sources_*\`), not free web
browsing.

## Workflow
1. Turn the requirement into explicit criteria (task shape, must-have behaviors,
  deal-breakers) before searching; state them back in one line.
2. Scan sources (\`repository_scan\` with a Git URL and optional ref, or add a source
  with \`repository_sources_add\` first); preview candidates with
  \`repository_preview\` from the same pinned session.
3. Analyze fit per candidate: requirement coverage, description quality, scope
  discipline, red flags (secrets, machine-specific paths, vague triggers). Compare
  against what is already installed (\`skills_list\`, \`skills_info\`) to avoid
  duplicates.
4. Recommend with evidence: shortlist with reasons, then propose
  \`repository_install\` for the winners and name the target workspace/provider.

## Analysis law
- A skill that matches the letter but not the intent is a rejection; say which
  criterion failed.
- Never install silently; installs are proposals the human approves.
- Prefer two well-scoped skills over one that does everything badly.`;

/** 模式注册表（daemon 侧组合事实；与 DSH_AGENT_MODES 目录一一对应，单测校验）。 */
export const AGENT_MODES: Readonly<Record<DshAgentMode, AgentModeDefinition>> = {
  create: {
    sectionText: CREATE_SECTION,
    tools: [
      "workspace_list",
      "skills_list",
      "skills_info",
      "skills_validate",
      "creator_load",
      "creator_save",
      "creator_remove",
      "creator_revisions",
    ],
  },
  manage: {
    sectionText: MANAGE_SECTION,
    tools: [
      "workspace_list",
      "skills_list",
      "skills_info",
      "skills_validate",
      "skills_toggle",
      "skills_update_check",
      "skills_update_apply",
      "creator_load",
      "creator_save",
      "creator_revisions",
    ],
  },
  explore: {
    sectionText: EXPLORE_SECTION,
    tools: [
      "workspace_list",
      "skills_list",
      "skills_info",
      "skills_validate",
      "repository_scan",
      "repository_preview",
      "repository_install",
      "repository_sources_list",
      "repository_sources_add",
      "repository_sources_remove",
    ],
  },
  free: { sectionText: null, tools: null },
};

/** 模式专有 section 名（base best-practices 段之外）。 */
export function agentModeSectionName(mode: DshAgentMode): string {
  return `skill-creator-mode-${mode}`;
}

/** MCP 工具全名 → 该模式下是否放行（free 前缀全放行；propose 变体随基名继承）。 */
export function mcpToolAllowedInMode(mode: DshAgentMode, toolName: string): boolean {
  if (!toolName.startsWith(MCP_TOOL_PREFIX)) return true; // 非 MCP 工具不归模式管。
  const definition = AGENT_MODES[mode];
  if (definition.tools === null) return true;
  let base = toolName.slice(MCP_TOOL_PREFIX.length);
  if (base.endsWith(PROPOSE_SUFFIX)) base = base.slice(0, -PROPOSE_SUFFIX.length);
  return definition.tools.includes(base);
}

/** guard 拒绝理由（模型可读的模式切换指引）。 */
export function agentModeGuardReason(mode: DshAgentMode, toolName: string): string | undefined {
  if (mcpToolAllowedInMode(mode, toolName)) return undefined;
  return `${toolName} is not available in "${mode}" mode; switch modes from the Agent panel header.`;
}

/**
 * 在 agent scope 注册模式专有 section（free 无操作）+ 模式工具 guard。
 * setup 内调用；scoped 注册随 agent 生命周期回收。
 */
export function applyAgentMode(agentCtx: Context, mode: DshAgentMode): void {
  const definition = AGENT_MODES[mode];
  if (definition.sectionText !== null) {
    (
      agentCtx as Context & {
        systemPrompt?: { section(section: unknown): () => void };
      }
    ).systemPrompt?.section({
      name: agentModeSectionName(mode),
      order: 40,
      text: definition.sectionText,
    });
  }
  const tools = (
    agentCtx as Context & {
      tools?: {
        guard?: (guard: (exec: { name?: string }) => string | undefined) => () => void;
      };
    }
  ).tools;
  tools?.guard?.((exec) => {
    const name = typeof exec?.name === "string" ? exec.name : "";
    return agentModeGuardReason(mode, name);
  });
}
