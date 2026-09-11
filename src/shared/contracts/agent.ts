/**
 * Agent 面板契约（dsh-kernel-rebase task 2.2）。
 *
 * 用户原始需求 [2026-09-08]：「你可以简单理解成，我们在 skill creator 的右侧嵌入
 * 了一个聊天对话框。」——`agent.*` 是面板消费内核会话的唯一 RPC namespace；
 * 旧 `dsh.*`（settings/credentials/sessions）收敛并入此处，不保留双投影。
 *
 * 正交意图：
 *   [1] 会话生命周期投影：list/create/prompt/cancel/stream（内核 ctx.agents +
 *       ctx.sessions 的脱敏投影；durable 真相归 session event log）。
 *   [2] settings/credentials 平移：model/preset/permission/approval 与凭据状态
 *       （schema 复用 dsh-runtime 契约源，无第二份手写镜像）。
 * 妥协声明：stream 帧复用 DshSessionStreamFrame（面板场景 runId 恒等于
 *   sessionId）——面板不是 MCP client，内核会话经 daemon 进程内消费。
 */
import { z } from "zod";
import {
  DshAgentModeSchema,
  DshCredentialClearInputSchema,
  DshCredentialSetInputSchema,
  DshCredentialSetResultSchema,
  DshSessionStreamFrameSchema,
  DshSettingsUpdateResultSchema,
  DshSettingsUpdateSchema,
  DshStewardSettingsViewSchema,
} from "./dsh-runtime.js";

/** 面板可见的 agent 生命周期状态（AgentStatus 两态 + 服务层 disposed 投影）。 */
export const AgentSessionStatusSchema = z.enum(["idle", "running", "disposed"]);
/** agent 会话状态。 */
export type AgentSessionStatus = z.infer<typeof AgentSessionStatusSchema>;

/** 会话摘要（list/create/setMode 返回）。 */
export const AgentSessionSummarySchema = z.object({
  sessionId: z.string().min(1),
  /** 自动标题（内核 session-title；首 prompt 前为空串）。 */
  title: z.string(),
  status: AgentSessionStatusSchema,
  cwd: z.string(),
  createdAt: z.string().min(1),
  /** 会话模式（旧转录缺失读 free——其创建时即全工具面的事实投影）。 */
  mode: DshAgentModeSchema,
});
/** 会话摘要。 */
export type AgentSessionSummary = z.infer<typeof AgentSessionSummarySchema>;

/** 会话创建输入。 */
export const AgentSessionCreateInputSchema = z.object({
  /** 会话工作目录（缺省 daemon cwd；产品面通常传 Workspace 目录）。 */
  cwd: z.string().min(1).optional(),
  /** 首条消息（可选；提供则创建后立即驱动一轮）。 */
  prompt: z.string().min(1).max(20_000).optional(),
  /** 会话模式（缺省取 settings.defaultMode）。 */
  mode: DshAgentModeSchema.optional(),
});
/** 会话创建输入。 */
export type AgentSessionCreateInput = z.infer<typeof AgentSessionCreateInputSchema>;

/** 会话创建结果。 */
export const AgentSessionCreateResultSchema = z.object({
  session: AgentSessionSummarySchema,
});
/** 会话创建结果。 */
export type AgentSessionCreateResult = z.infer<typeof AgentSessionCreateResultSchema>;

/** prompt 的图片附件（wire 层 base64；daemon 经内核 attachment 准入升格 durable ref）。 */
export const AgentPromptImageSchema = z.object({
  mediaType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
  /** canonical base64（≤4MiB 解码后；超限 schema 拒绝）。 */
  data: z.string().min(1),
  name: z.string().min(1).max(120).optional(),
});
/** prompt 图片附件。 */
export type AgentPromptImage = z.infer<typeof AgentPromptImageSchema>;

/** prompt 输入（多模态：文本 + 可选图片；无图片时与纯文本等价）。 */
export const AgentSessionPromptInputSchema = z
  .object({
    sessionId: z.string().min(1),
    text: z.string().max(20_000),
    images: z.array(AgentPromptImageSchema).max(4).default([]),
  })
  .refine((input) => input.text.trim().length > 0 || input.images.length > 0, {
    message: "prompt needs text or at least one image",
  })
  .refine(
    // 4MiB 解码后 = base64 长度上限 5,592,406（×4/3 向上取整；browser-safe 无 Buffer）。
    (input) => input.images.every((image) => image.data.length <= 5_592_406),
    { message: "each image must decode to ≤4MiB" },
  );
/** prompt 输入。 */
export type AgentSessionPromptInput = z.infer<typeof AgentSessionPromptInputSchema>;

/** prompt 结果（accepted = 已入队驱动；终态经 stream 轮询观察）。 */
export const AgentSessionPromptResultSchema = z.object({ accepted: z.literal(true) });

/** setMode 输入（运行中会话返回 typed INVALID_OPERATION，不改状态）。 */
export const AgentSessionSetModeInputSchema = z.object({
  sessionId: z.string().min(1),
  mode: DshAgentModeSchema,
});
/** setMode 输入。 */
export type AgentSessionSetModeInput = z.infer<typeof AgentSessionSetModeInputSchema>;

/** setMode 结果（返回切换后的摘要；live 句柄已释放，下一次 prompt 以新模式复活）。 */
export const AgentSessionSetModeResultSchema = z.object({
  session: AgentSessionSummarySchema,
});
/** setMode 结果。 */
export type AgentSessionSetModeResult = z.infer<typeof AgentSessionSetModeResultSchema>;

/** cancel 输入/结果。 */
export const AgentSessionCancelInputSchema = z.object({ sessionId: z.string().min(1) });
export const AgentSessionCancelResultSchema = z.object({ canceled: z.literal(true) });

/** stream 查询输入（afterSeq 游标 + 有界 limit；终态停轮询由 WebUI 代次门持有）。 */
export const AgentSessionStreamInputSchema = z.object({
  sessionId: z.string().min(1),
  afterSeq: z.number().int().nonnegative().default(0),
  limit: z.number().int().positive().max(200).default(50),
});
/** stream 查询输入。 */
export type AgentSessionStreamInput = z.infer<typeof AgentSessionStreamInputSchema>;

/** stream 查询结果。 */
export const AgentSessionStreamResultSchema = z.object({
  frames: z.array(DshSessionStreamFrameSchema),
  status: AgentSessionStatusSchema,
});
/** stream 查询结果。 */
export type AgentSessionStreamResult = z.infer<typeof AgentSessionStreamResultSchema>;

/** 跨会话帧查询输入（原 dsh.sessions.streams 语义平移；steward run 投影消费）。 */
export const AgentSessionsStreamsInputSchema = z.object({
  runId: z.string().min(1).optional(),
  /** 返回最新 N 帧（默认 50，上限 500）。 */
  limit: z.number().int().positive().max(500).optional(),
});
/** 跨会话帧查询输入。 */
export type AgentSessionsStreamsInput = z.infer<typeof AgentSessionsStreamsInputSchema>;

/** ask_user_question 的单个问题（dsh-user-questions 结构的浏览器安全投影）。 */
export const AgentApprovalQuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  detail: z.string().optional(),
  header: z.string().optional(),
  multiSelect: z.boolean().optional(),
  options: z
    .array(z.object({ label: z.string().min(1), description: z.string().optional() }))
    .optional(),
});
/** 单个问题。 */
export type AgentApprovalQuestion = z.infer<typeof AgentApprovalQuestionSchema>;

/** 回答输入（agent.session.answer）。 */
export const AgentSessionAnswerInputSchema = z.object({
  sessionId: z.string().min(1),
  /** 待答请求的帧 seq（幂等键：已解决的请求返回 resolved:false）。 */
  requestSeq: z.number().int().nonnegative(),
  answers: z
    .array(
      z.object({
        id: z.string().min(1),
        selected: z.array(z.string().min(1)),
        custom: z.string().optional(),
      }),
    )
    .min(1),
});
/** 回答输入。 */
export type AgentSessionAnswerInput = z.infer<typeof AgentSessionAnswerInputSchema>;

/** 回答结果。 */
export const AgentSessionAnswerResultSchema = z.object({ answered: z.boolean() });

/** ui:// 卡片资源代理（task 4.2：面板不是 MCP client，经 daemon 读取）。 */
export const AgentCardGetInputSchema = z.object({
  uri: z.string().regex(/^ui:\/\/card\/[a-z-]+\/[a-z0-9-]+$/),
});
/** 卡片获取输入。 */
export type AgentCardGetInput = z.infer<typeof AgentCardGetInputSchema>;

/** 卡片获取结果（html 为渲染就绪的沙箱文档；未知/淘汰 uri 返回 null）。 */
export const AgentCardGetResultSchema = z.object({
  html: z.string().nullable(),
});

/** MCP mutation proposal 的浏览器安全投影（task 4.4）。 */
export const AgentMcpProposalViewSchema = z.object({
  proposalId: z.string().min(1),
  capability: z.string().min(1),
  input: z.unknown(),
  status: z.enum(["pending", "approved", "rejected", "executed", "failed"]),
  createdAt: z.string().min(1),
  decidedAt: z.string().optional(),
});
/** proposal 投影。 */
export type AgentMcpProposalView = z.infer<typeof AgentMcpProposalViewSchema>;

/** 审批输入。 */
export const AgentProposalDecisionInputSchema = z.object({
  proposalId: z.string().min(1),
});

export {
  DshStewardSettingsViewSchema as AgentSettingsViewSchema,
  DshSettingsUpdateSchema as AgentSettingsUpdateSchema,
  DshSettingsUpdateResultSchema as AgentSettingsUpdateResultSchema,
  DshCredentialSetInputSchema as AgentCredentialSetInputSchema,
  DshCredentialSetResultSchema as AgentCredentialSetResultSchema,
  DshCredentialClearInputSchema as AgentCredentialClearInputSchema,
};
