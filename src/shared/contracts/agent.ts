/**
 * Agent 面板契约（dsh-kernel-rebase task 2.2）。
 *
 * 用户原始需求 [2026-09-08]：「你可以简单理解成，我们在 skill creator 的右侧嵌入
 * 了一个聊天对话框。」——`agent.*` 是面板消费内核会话的唯一 RPC namespace；
 * 旧 `dsh.*`（settings/credentials/sessions）收敛并入此处，不保留双投影。
 * 修订 [2026-09-13]（R17-B）：附件选择去 web 化——新增 `agent.files.*`（后端
 * 文件浏览/预览：真实路径选择器）+ prompt 图片/文件附件双通道（base64 wire 或
 * 后端真实路径，daemon 读盘替代浏览器上传）。
 *
 * 正交意图：
 *   [1] 会话生命周期投影：list/create/prompt/cancel/stream（内核 ctx.agents +
 *       ctx.sessions 的脱敏投影；durable 真相归 session event log）。
 *   [2] settings/credentials 平移：model/preset/permission/approval 与凭据状态
 *       （schema 复用 dsh-runtime 契约源，无第二份手写镜像）。
 *   [3] 后端文件选择器 IO（R17-B）：目录浏览投影 + 单文件预览（图片缩略/
 *       文本头/二进制名）——用户本机自由浏览是功能目的，无 Workspace containment。
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
  /** 产品转录归属（R15 codex P1-3）：false = kernel/steward-only 会话——清理
   * RPC 只管产品转录层，这类行 UI 禁删并以 kernel-only 标记呈现。 */
  hasTranscript: z.boolean().optional(),
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

/**
 * prompt 图片附件（R17-B 双通道，strict 互斥）：
 * - base64 通道：mediaType 必填（webui 粘贴/drop 的本地 File 对象）；
 * - path 通道：后端文件选择器的真实路径——daemon 读盘 + magic 字节嗅探 mediaType，
 *   浏览器不经手原始字节（前端更轻）。两条通路统一经内核 attachment 准入。
 */
export const AgentPromptImageSchema = z.union([
  z.strictObject({
    mediaType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
    /** canonical base64（≤4MiB 解码后；超限 schema 拒绝）。 */
    data: z.string().min(1),
    name: z.string().min(1).max(120).optional(),
  }),
  z.strictObject({
    /** daemon 可读的绝对路径（源文件 ≤4MiB，daemon 读盘时校验）。 */
    path: z.string().min(1),
    name: z.string().min(1).max(120).optional(),
  }),
]);
/** prompt 图片附件。 */
export type AgentPromptImage = z.infer<typeof AgentPromptImageSchema>;

/**
 * prompt 文件附件（R17-B 双通道，strict 互斥）：base64（≤512KiB）或后端真实
 * 路径（daemon 读盘，源文件 ≤512KiB；name 取 basename）。
 */
export const AgentPromptFileSchema = z.union([
  z.strictObject({
    name: z.string().min(1).max(200),
    /** canonical base64（≤512KiB 解码后）。 */
    data: z.string().min(1).max(710_000),
  }),
  z.strictObject({
    /** daemon 可读的绝对路径。 */
    path: z.string().min(1),
  }),
]);
/** prompt 文件附件。 */
export type AgentPromptFile = z.infer<typeof AgentPromptFileSchema>;

/** prompt 输入（多模态：文本 + 可选图片；无图片时与纯文本等价）。 */
export const AgentSessionPromptInputSchema = z
  .object({
    sessionId: z.string().min(1),
    text: z.string().max(20_000),
    images: z.array(AgentPromptImageSchema).max(4).default([]),
    files: z.array(AgentPromptFileSchema).max(2).default([]),
  })
  .refine(
    // R17 codex P1：files-only 也是合法 prompt（后端文件选择器的主路径）。
    (input) => input.text.trim().length > 0 || input.images.length > 0 || input.files.length > 0,
    { message: "prompt needs text, an image, or a file attachment" },
  )
  .refine(
    // 4MiB 解码后 = base64 长度上限 5,592,406（×4/3 向上取整；browser-safe 无
    // Buffer）；path 通道不在此限（daemon 读盘时按源文件字节校验）。
    (input) => input.images.every((image) => !("data" in image) || image.data.length <= 5_592_406),
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

/**
 * 会话清理输入（R14-C 2026-09-12；R15 codex P1 收紧）：三种**互斥**形状——
 * 按保留天数（目录日期早于 now - beforeDays 的转录删除）、全量（running 跳
 * 过）、显式 ID 列表（Settings 会话列表的逐行删除）。三形状均 strict：任何
 * 多键组合（如 {all:true, sessionIds:[…]}）直接 parse 失败，杜绝删除范围静
 * 默扩大；all 只接受字面量 true。
 */
export const AgentSessionsCleanupInputSchema = z.union([
  z.strictObject({ beforeDays: z.number().int().min(0).max(365) }),
  z.strictObject({ all: z.literal(true) }),
  z.strictObject({ sessionIds: z.array(z.string().min(1)).min(1).max(200) }),
]);
/** 会话清理输入。 */
export type AgentSessionsCleanupInput = z.infer<typeof AgentSessionsCleanupInputSchema>;

/**
 * 会话清理结果：kept = 清理后仍留存的持久会话数（太新 / running 被跳过 /
 * 删除失败都在内）；errors 有界（≤20 条）且出现时表示部分条目删除失败。
 * deletedIds（R15）：实际删除的会话 ID 有界清单——客户端据此失效当前会话。
 */
export const AgentSessionsCleanupResultSchema = z.object({
  kind: z.literal("summary"),
  deleted: z.number().int().nonnegative(),
  kept: z.number().int().nonnegative(),
  deletedIds: z.array(z.string().min(1)).max(1000).optional(),
  /** deletedIds 达到 1000 上限被截断（客户端需以列表复核失效当前会话）。 */
  deletedIdsTruncated: z.boolean().optional(),
  errors: z.array(z.string().min(1)).optional(),
});
/** 会话清理结果。 */
export type AgentSessionsCleanupResult = z.infer<typeof AgentSessionsCleanupResultSchema>;

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

/**
 * 后端文件浏览输入（R17-B）：dir 缺省 = daemon 默认起始目录（home）；显式传入
 * 必须是绝对路径（相对路径 typed INVALID_OPERATION，不做 cwd 相对解析）。
 * 本浏览面是用户本机自由选择器（读面，无 Workspace containment——功能目的
 * 就是拿到任意真实路径），不进 MCP/capability 面。
 */
export const AgentFilesListInputSchema = z.object({
  dir: z.string().min(1).optional(),
});
/** 文件浏览输入。 */
export type AgentFilesListInput = z.infer<typeof AgentFilesListInputSchema>;

/** 单个目录条目（dir 无 size；file size = 字节）。 */
export const AgentFilesEntrySchema = z.object({
  name: z.string().min(1),
  kind: z.enum(["file", "dir"]),
  size: z.number().int().nonnegative().optional(),
});
/** 目录条目。 */
export type AgentFilesEntry = z.infer<typeof AgentFilesEntrySchema>;

/**
 * 目录浏览结果：dir 为 canonical 绝对路径（realpath）；entries 目录优先、
 * 字典序；超出上限截断并置 truncated（超大目录如 node_modules 的有界投影）。
 */
export const AgentFilesListResultSchema = z.object({
  dir: z.string().min(1),
  /** 上一级目录（文件系统根为 null）。 */
  parent: z.string().min(1).nullable(),
  entries: z.array(AgentFilesEntrySchema).max(2000),
  truncated: z.boolean().optional(),
});
/** 目录浏览结果。 */
export type AgentFilesListResult = z.infer<typeof AgentFilesListResultSchema>;

/** 单文件预览输入（绝对路径；目录/缺失分别是 typed INVALID_OPERATION/NOT_FOUND）。 */
export const AgentFilesPreviewInputSchema = z.object({
  path: z.string().min(1),
});
/** 预览输入。 */
export type AgentFilesPreviewInput = z.infer<typeof AgentFilesPreviewInputSchema>;

/**
 * 单文件预览结果（判别联合）：
 * - image：png/jpeg 源（magic 字节判定）≤8MiB → jSquash 解码 → 长边 ≤256px 缩略
 *   → png 源回编 png（保 alpha）/ jpeg 源回编 jpeg → dataURL（前端零解码负担）；
 * - text：≤2MiB 源文件的前 4KiB UTF-8 头（首 4KiB 含 NUL → binary）；
 * - binary：其余一切（gif/webp/超大/不可解码）——仅名字与大小，不伪装成功预览。
 */
export const AgentFilesPreviewResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("image"),
    name: z.string().min(1),
    size: z.number().int().nonnegative(),
    mediaType: z.enum(["image/png", "image/jpeg"]),
    /** data:image/(png|jpeg);base64,… 缩略图（≤256px 长边）。 */
    dataUrl: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  z.strictObject({
    kind: z.literal("text"),
    name: z.string().min(1),
    size: z.number().int().nonnegative(),
    text: z.string(),
    truncated: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal("binary"),
    name: z.string().min(1),
    size: z.number().int().nonnegative(),
  }),
]);
/** 预览结果。 */
export type AgentFilesPreviewResult = z.infer<typeof AgentFilesPreviewResultSchema>;

export {
  DshStewardSettingsViewSchema as AgentSettingsViewSchema,
  DshSettingsUpdateSchema as AgentSettingsUpdateSchema,
  DshSettingsUpdateResultSchema as AgentSettingsUpdateResultSchema,
  DshCredentialSetInputSchema as AgentCredentialSetInputSchema,
  DshCredentialSetResultSchema as AgentCredentialSetResultSchema,
  DshCredentialClearInputSchema as AgentCredentialClearInputSchema,
};
