/**
 * Agent Roles 目录（openspec dsh-alpha-native-subagents task 2.1）。
 *
 * 用户裁决 [2026-09-15]：「关于 dsh 原生子代理，官方不是已经支持了吗？……
 * 把子代理的能力对接上来就好。」Roles 骑官方 @deepseek-ai/dsh-tool-subagent
 * 行——本目录是 UI 与 daemon 共用的单一事实源（WebUI 不手抄）。
 *
 * 正交意图：
 *   [1] 角色目录：slug/名称/描述/能力面（MCP capability 精确注册名）。
 *   [2] 模式暴露矩阵：每模式放行的角色（free 全放）。
 *   [3] 模型面命名法：role_<slug> 工具名（每角色唯一，官方同 fiber 冲突规避）。
 */

/** 角色 prompt 版本（任一角色 persona 文本变更必 bump）。 */
export const AGENT_ROLE_PROMPT_VERSION = "1";

/** 角色 slug 集合。 */
export const AGENT_ROLE_SLUGS = ["reviewer", "researcher", "writer"] as const;
export type AgentRoleSlug = (typeof AGENT_ROLE_SLUGS)[number];

/** 模型面角色工具名前缀。 */
export const AGENT_ROLE_TOOL_PREFIX = "role_";

/** 角色工具名（模型调用面）：role_reviewer 等。 */
export function agentRoleToolName(slug: AgentRoleSlug): string {
  return `${AGENT_ROLE_TOOL_PREFIX}${slug}`;
}

/**
 * MCP capability 全名（子代理 toolFilter 的 allow 必须是精确注册名）：
 * readonly 能力注册基名；approved-mutation 只注册 `*_propose` 变体
 * （skill-creator-mcp 4.4 authority 法则）。
 */
export function mcpCapabilityToolName(
  capabilityBase: string,
  authority: "readonly" | "mutation",
): string {
  return `mcp__skill-creator__${capabilityBase}${authority === "mutation" ? "_propose" : ""}`;
}

/** 一个角色的目录事实。 */
export interface AgentRoleDefinition {
  /** 面板展示名。 */
  name: string;
  /** 一句话用途（UI 与模型可见的目录文案）。 */
  description: string;
  /** 角色能力面：MCP capability 基名 + authority（daemon 侧展开为精确注册名）。 */
  capabilities: ReadonlyArray<{ base: string; authority: "readonly" | "mutation" }>;
}

/** Roles 目录（与 daemon kernel agent-roles.ts 的 persona 一一对应，单测校验）。 */
export const AGENT_ROLES: Readonly<Record<AgentRoleSlug, AgentRoleDefinition>> = {
  reviewer: {
    name: "Reviewer",
    description: "Reads local skills and reports concrete improvement findings (read-only).",
    capabilities: [
      { base: "workspace_list", authority: "readonly" },
      { base: "skills_list", authority: "readonly" },
      { base: "skills_info", authority: "readonly" },
      { base: "skills_validate", authority: "readonly" },
      { base: "creator_load", authority: "readonly" },
    ],
  },
  researcher: {
    name: "Researcher",
    description: "Scans Git skill sources and analyzes fit against requirements (read-only).",
    capabilities: [
      { base: "workspace_list", authority: "readonly" },
      { base: "skills_list", authority: "readonly" },
      { base: "skills_info", authority: "readonly" },
      { base: "skills_validate", authority: "readonly" },
      { base: "repository_scan", authority: "readonly" },
      { base: "repository_sources_list", authority: "readonly" },
    ],
  },
  writer: {
    name: "Writer",
    description:
      "Drafts and edits SKILL.md content; every mutation lands as a proposal for human approval.",
    capabilities: [
      { base: "workspace_list", authority: "readonly" },
      { base: "skills_list", authority: "readonly" },
      { base: "skills_info", authority: "readonly" },
      { base: "skills_validate", authority: "readonly" },
      { base: "creator_load", authority: "readonly" },
      { base: "creator_revisions", authority: "readonly" },
      { base: "creator_save", authority: "mutation" },
      { base: "creator_remove", authority: "mutation" },
    ],
  },
};

/** 每种会话模式放行的角色（free 全放；专注模式按域裁决）。 */
export const AGENT_MODE_ROLES: Readonly<
  Record<"create" | "manage" | "explore" | "free", readonly AgentRoleSlug[]>
> = {
  create: ["reviewer", "writer"],
  manage: ["reviewer", "writer"],
  explore: ["researcher", "reviewer"],
  free: ["reviewer", "researcher", "writer"],
};
