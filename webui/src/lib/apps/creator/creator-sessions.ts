/**
 * Creator 会话面纯逻辑（creator-agent-chat 1.1/1.2/1.4/1.5）。
 * 用户原始需求 [2026-10-03]（design §1/§2 + specs/creator）：「Creator 首屏是
 * workspace 会话工作台」「resume 查找键 = target + seedSkill 精确匹配（命中
 * 续聊/无匹配新建；不续上他技能的对话）」「capture → draft → test → review →
 * improve 的 seed 与流程护栏」。
 * 正交意图：
 *   [1] 会话过滤与查找键：creator 会话 = summary 投影前端过滤
 *       （target.workspaceId = 当前 ws 且 seedSkill 非空）——零新 RPC、零平行
 *       schema；技能维度续聊查找 = target（ws+provider）+ seedSkill 精确匹配，
 *       createdAt 降序取最近一条。
 *   [2] seed 模板冻结：引导三输入 → 结构化首条 prompt（循环措辞沿 $skill-creator
 *       参考件）；技能聊天引言（正文携带 `$name` token——芯片出现配对前提，
 *       与 probe-recall/finding-propose 同法则）；测试话术建议 prompt。
 *   [3] 会话内护栏投影：循环阶段目录（提示性不阻塞）；assistant 建议列表解析
 *       （编号行）；creator_save_propose 工具帧 → 草稿卡数据（args 经 Zod
 *       safeParse + proposalId 深扫提取——帧 payload 是外部输入）。
 * 妥协声明：无（纯函数；i18n 文案由组件层解析；PanelItem 仅 type-only 导入）。
 */
import { z } from "zod";
import type { AgentSessionSummary } from "$shared/contracts/agent.js";
import type { SkillId } from "$shared/contracts/skills.js";
import type { PanelItem } from "$lib/stores/agent.svelte";

/** 创作循环阶段（$skill-creator 参考件措辞；design §2——提示性不阻塞自由对话）。 */
export const CREATOR_LOOP_STAGES = ["capture", "draft", "test", "review", "improve"] as const;
/** 创作循环阶段类型。 */
export type CreatorLoopStage = (typeof CREATOR_LOOP_STAGES)[number];

/** 组内排序：createdAt 降序（新会话在上；非法日期沉底稳定排序）。 */
function sortByRecent(sessions: readonly AgentSessionSummary[]): AgentSessionSummary[] {
  return [...sessions].sort((a, b) => {
    const at = Date.parse(a.createdAt);
    const bt = Date.parse(b.createdAt);
    const av = Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at;
    const bv = Number.isNaN(bt) ? Number.NEGATIVE_INFINITY : bt;
    return bv - av;
  });
}

/**
 * creator 会话过滤（design §1 r2；specs/creator「会话列表按 summary 过滤」）：
 * target.workspaceId = 当前 ws 且 seedSkill 非空——会话真相仍一份
 * （Agent 页 / Panel / Creator 同源），Creator 只做前端投影。
 */
export function creatorSessionsForWorkspace(
  sessions: readonly AgentSessionSummary[],
  workspaceId: string,
): AgentSessionSummary[] {
  return sortByRecent(
    sessions.filter(
      (session) => session.target?.workspaceId === workspaceId && session.seedSkill !== null,
    ),
  );
}

/**
 * 技能维度续聊查找键（specs/creator「技能维度的续聊精确匹配」）：
 * target（workspaceId + providerId 双段精确）+ seedSkill = 该技能——命中最近
 * 一条即续聊；无 seedSkill 匹配返回 null（调用方新建）。MUST NOT 命中仅
 * target 相同但 seed 指向其他技能（或无 seed）的会话；target 缺 providerId
 * 的全 ws 会话不参与 provider 级匹配。
 */
export function findSkillChatSession(
  sessions: readonly AgentSessionSummary[],
  target: { workspaceId: string; providerId: string },
  skillId: SkillId,
): AgentSessionSummary | null {
  const hits = sortByRecent(
    sessions.filter(
      (session) =>
        session.target?.workspaceId === target.workspaceId &&
        session.target.providerId === target.providerId &&
        session.seedSkill === skillId,
    ),
  );
  return hits[0] ?? null;
}

/** 引导卡三输入（capture 阶段；intent 必填，trigger/examples 可空段省略）。 */
export interface CreatorSeedPromptInput {
  intent: string;
  trigger: string;
  examples: string;
  /** 模板 seed 选项（design §3：模板退位为 capture 起点；frontmatter 作起点）。 */
  templateName?: string;
  templateDescription?: string;
}

/**
 * 「让 agent 起草」首条结构化 prompt（design §2 seed；逐字冻结——测试逐字断言）。
 * 循环措辞沿 $skill-creator 参考件：弄清意图 → 草稿 → 2–3 条真实测试话术 →
 * 共读产出修订 → 循环到足够好；落盘一律走 creator_save_propose 提案链。
 */
export function buildCreatorSeedPrompt(input: CreatorSeedPromptInput): string {
  const sections: string[] = [
    "我想创建一个新技能。请按 skill-creator 循环推进：先弄清技能要做什么（capture），写出 SKILL.md 草稿（draft），用 2–3 条真实测试话术试跑（test），和我一起读产出并修订（review → improve），循环到足够好为止。",
    "",
    "## 意图：它该让模型做到什么",
    input.intent.trim(),
  ];
  if (input.trigger.trim().length > 0) {
    sections.push("", "## 触发：什么用户措辞或上下文该触发它", input.trigger.trim());
  }
  if (input.examples.trim().length > 0) {
    sections.push("", "## 示例：输入与期望输出", input.examples.trim());
  }
  if (input.templateName !== undefined && input.templateName.length > 0) {
    sections.push(
      "",
      "## 模板起点",
      `以内置模板 ${input.templateName} 的 frontmatter 与正文为起点改造${input.templateDescription ? `：${input.templateDescription}` : "。"}`,
    );
  }
  sections.push(
    "",
    "现在从 draft 开始：给出完整 SKILL.md（frontmatter name/description + 正文）。落盘一律走 creator_save_propose 工具提案（不直接写文件），等待我在审批面确认。",
  );
  return sections.join("\n");
}

/**
 * 技能聊天引言（design §1 r3「无匹配新建」）：正文携带 `$name` token——
 * SessionFace seed 消费时据此注册技能引用芯片（首条消息携带技能上下文）。
 */
export function buildSkillChatIntro(skillName: string): string {
  return `我想和你聊聊引用的技能（$${skillName} 芯片）：先读它的文档，再围绕触发时机、行为与改进点和我讨论。需要修改时走 creator_save_propose 工具提案（update 模式必须带当前 expectedRevision），等待我审批后生效。`;
}

/** test 环节「生成测试话术建议」prompt（design §2：agent 产出 2–3 条编号话术）。 */
export function buildTestSuggestionPrompt(): string {
  return "请为当前技能草稿生成 3 条真实测试话术：用户会实际输入的口吻（含具体文件名/字段名/口语化措辞甚至错别字），每条一行、以「1.」「2.」「3.」编号开头，不要附加解释。";
}

/**
 * assistant 建议解析：编号行（1. / 1、 / 1)）提取为话术条目；上限 5 条防御
 * 长列表。仅在「生成测试话术建议」后的首条 assistant 终帧上调用（组件层
 * 一次性消费；普通编号列表不会被误提——解析时机由调用方持有）。
 */
export function parseTestSuggestions(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const match = /^([1-9])[.、)]\s*(.+)$/.exec(line);
    if (match === null) continue;
    const suggestion = match[2].trim();
    if (suggestion.length > 0 && out.length < 5) out.push(suggestion);
  }
  return out;
}

/** 草稿卡数据（creator_save_propose 工具帧的投影；design §2 草稿产出卡）。 */
export interface CreatorDraftCard {
  /** 帧序（列表 key；同帧幂等）。 */
  seq: number;
  mode: "create" | "update";
  name: string;
  description: string;
  body: string;
  directoryName?: string;
  skillId?: string;
  expectedRevision?: string;
  /** propose 结果里的统一审批键（mcp: 前缀）；calling 中/提取失败 = null。 */
  proposalId: string | null;
  phase: "calling" | "done" | "error";
}

/** propose 工具帧的判定（内核注册名 = mcp__skill-creator__creator_save_propose；兼容 . 分隔）。 */
export function isCreatorSaveProposeTool(toolName: string): boolean {
  return (
    toolName === "creator_save_propose" ||
    toolName.endsWith("__creator_save_propose") ||
    toolName.endsWith(".creator_save_propose")
  );
}

/** 草稿 args 收窄（帧 payload 是外部输入；safeParse 失败整卡丢弃）。 */
const DraftArgsSchema = z.object({
  mode: z.enum(["create", "update"]),
  workspaceId: z.string().min(1),
  providerId: z.string().min(1),
  directoryName: z.string().optional(),
  skillId: z.string().optional(),
  expectedRevision: z.string().optional(),
  frontmatter: z.object({ name: z.string(), description: z.string() }).passthrough(),
  body: z.string(),
});

/**
 * proposalId 深扫提取：MCP propose 结果的 content[].text 是 JSON 字符串
 * （{kind:"proposed", proposalId:"mcp:…"}），帧 payload 可能保留 content 数组
 * 或已解析对象——有界深度遍历两种形态，只认 kind=proposed 的 proposalId。
 */
function findProposalId(value: unknown, depth = 0): string | null {
  if (depth > 6) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
    try {
      return findProposalId(JSON.parse(trimmed), depth + 1);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const hit = findProposalId(entry, depth + 1);
      if (hit !== null) return hit;
    }
    return null;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    if (record.kind === "proposed" && typeof record.proposalId === "string") {
      return record.proposalId;
    }
    for (const entry of Object.values(record)) {
      const hit = findProposalId(entry, depth + 1);
      if (hit !== null) return hit;
    }
  }
  return null;
}

/**
 * 帧视图 → 草稿卡列表：creator_save_propose 工具行（args 可解析）逐卡投影；
 * proposalId 从 result 深扫（结果未回/calling 中 = null）。返回按帧序排列。
 */
export function draftCardsFromItems(items: readonly PanelItem[]): CreatorDraftCard[] {
  const cards: CreatorDraftCard[] = [];
  for (const item of items) {
    if (item.kind !== "tool" || !isCreatorSaveProposeTool(item.toolName)) continue;
    if (item.argsText === undefined) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(item.argsText);
    } catch {
      continue;
    }
    const parsed = DraftArgsSchema.safeParse(raw);
    if (!parsed.success) continue;
    cards.push({
      seq: item.seq,
      mode: parsed.data.mode,
      name: parsed.data.frontmatter.name,
      description: parsed.data.frontmatter.description,
      body: parsed.data.body,
      ...(parsed.data.directoryName !== undefined
        ? { directoryName: parsed.data.directoryName }
        : {}),
      ...(parsed.data.skillId !== undefined ? { skillId: parsed.data.skillId } : {}),
      ...(parsed.data.expectedRevision !== undefined
        ? { expectedRevision: parsed.data.expectedRevision }
        : {}),
      proposalId:
        item.phase !== "calling" && item.result !== undefined ? findProposalId(item.result) : null,
      phase: item.phase,
    });
  }
  return cards;
}
