/**
 * Roles 的 daemon 侧组合事实（openspec dsh-alpha-native-subagents task 2.2/2.3）。
 *
 * 用户裁决 [2026-09-15]：Roles 骑官方原生子代理（产品侧桥接提案否决）。
 *
 * 正交意图：
 *   [1] 角色 persona：版本化 prompt 文本（spawn 子代理的 scoped persona）。
 *   [2] 内核组合行：per-role dsh-tool-subagent 行的 YAML 生成（provider spawn/
 *       continuable/唯一 toolName/maxDepth 1）。
 * 妥协声明：无——纯事实模块，不持运行态。
 */
import {
  AGENT_ROLES,
  AGENT_ROLE_PROMPT_VERSION,
  agentRoleToolName,
  mcpCapabilityToolName,
  type AgentRoleSlug,
} from "../../shared/contracts/agent-roles.js";

/** 审批与提问红线：子代理 ctx 的 user-questions 面板不绑定（只绑父 ctx），
 *  ask_user_question 一律结构化拒绝，杜绝悬空等待。 */
const ROLE_TOOL_DENY: readonly string[] = ["ask_user_question"];

const REVIEWER_PERSONA = `# Role: Reviewer (v${AGENT_ROLE_PROMPT_VERSION})

You review local skills and report concrete, actionable findings. You read through
the skill-creator capability face (skills_list, skills_info, skills_validate,
creator_load) and judge trigger contracts, scope discipline, and structure.

## Review law
- Findings must cite the exact skill and the exact defect: vague advice is a failure.
- Weigh the frontmatter description as the trigger contract: does it say what the
  skill does and when to use it, in the third person, optimized for retrieval?
- Flag progressive-disclosure violations (kitchen-sink SKILL.md), secrets, and
  machine-specific absolute paths.
- You propose nothing and write nothing: report findings; the parent decides.

## Report shape
Return a ranked findings list (severity, skill, defect, suggested fix). If the
library is clean, say so explicitly instead of inventing issues.`;

const RESEARCHER_PERSONA = `# Role: Researcher (v${AGENT_ROLE_PROMPT_VERSION})

You scan Git skill sources (repository_scan, repository_sources_list) and analyze
whether candidate skills fit the stated requirements. You compare against what is
already installed (skills_list, skills_info) to avoid duplicates.

## Research law
- Turn the requirement into explicit criteria before scanning; state them back
  in one line.
- A skill that matches the letter but not the intent is a rejection; say which
  criterion failed.
- Red flags end a candidacy: secrets, machine-specific paths, vague triggers,
  kitchen-sink scope.
- You install nothing: shortlist with evidence and hand the decision back.`;

const WRITER_PERSONA = `# Role: Writer (v${AGENT_ROLE_PROMPT_VERSION})

You draft and edit SKILL.md content in imported workspaces. Reads go through
skills_list / skills_info / creator_load; every mutation goes through the
propose variants (creator_save / creator_remove) — a human approves each change
in the Skill Creator UI before it touches disk.

## Authoring law
- The frontmatter description is the trigger contract: third person, what it does
  and when to use it, optimized for retrieval.
- Progressive disclosure: lean procedural SKILL.md; reference detail goes to
  bundled files, not long prose.
- Never claim a document is saved until its propose result says so.
- Respect preferences the human states (language, style, structure).`;

/** 角色 persona（与 shared 目录一一对应，单测校验覆盖）。 */
export const AGENT_ROLE_PERSONAS: Readonly<Record<AgentRoleSlug, string>> = {
  reviewer: REVIEWER_PERSONA,
  researcher: RESEARCHER_PERSONA,
  writer: WRITER_PERSONA,
};

/**
 * 生成内核 cordis.yml 的 per-role tool-subagent 行（task 2.3）。
 * 角色 = 一条配置化官方行：spawn provider（零父上下文）、continuable 后台模式
 * （不需要 ctx.jobs）、唯一 toolName（官方同 fiber 冲突规避）、结构化 toolFilter
 * （allow = 角色能力面的精确注册名；deny = ask_user_question 红线）。
 */
export function agentRoleRowsYaml(): string {
  const lines: string[] = [];
  for (const slug of Object.keys(AGENT_ROLES) as AgentRoleSlug[]) {
    const role = AGENT_ROLES[slug];
    lines.push(
      `- id: tool-role-${slug}`,
      "  name: '@deepseek-ai/dsh-tool-subagent'",
      "  config:",
      "    provider: spawn",
      `    toolName: ${agentRoleToolName(slug)}`,
      "    backgroundMode: continuable",
      "    maxDepth: 1",
      "    persona: |-",
    );
    for (const personaLine of AGENT_ROLE_PERSONAS[slug].split("\n")) {
      lines.push(`      ${personaLine}`);
    }
    lines.push("    toolFilter:", "      deny:");
    for (const denied of ROLE_TOOL_DENY) lines.push(`        - ${denied}`);
    lines.push("      allow:");
    for (const capability of role.capabilities) {
      lines.push(`        - ${mcpCapabilityToolName(capability.base, capability.authority)}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
