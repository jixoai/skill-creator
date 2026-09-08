/**
 * DSH runtime 集成契约（openspec dsh-runtime-integration task 3.1）。
 *
 * 用户原始需求 [2026-09-06]：「建立 DSH adapter handshake，锁定官方 commit/version、
 * composition rows 与 capability matrix。missing packages, version mismatch and
 * missing plugin rows return typed unavailable; no implicit fallback。」
 * 事实源：docs/research/2026-09-06-dsh-integration.md（官方仓库 commit
 * d347e703 的源码审计）与 npm 上实际安装的 0.1.2-rc.1 包。
 *
 * 正交意图：
 *   [1] 锁定声明：五个官方 package 的精确版本 + 审计 commit（运行时只认这套组合）。
 *   [2] composition row：每个 package 在 Skill Steward 组合中的具体 seam。
 *   [3] 类型化可用性：缺失/版本漂移/组合行缺失 → unavailable，绝不静默 fallback。
 *   [4] agent 面契约源：settings/credentials/stream 帧/模式目录（add-agent-settings-modes；
 *       WebUI 从此处推导类型，不维护第二份手写镜像）。
 */
import { z } from "zod";

/** 锁定的官方 package 集合（npm 精确版本；与审计 commit 的源码同族）。 */
export const DSH_LOCKED_PACKAGES = {
  "@deepseek-ai/dsh-agent": "0.1.2-rc.1",
  "@deepseek-ai/dsh-agent-loop": "0.1.2-rc.1",
  "@deepseek-ai/dsh-tools": "0.1.2-rc.1",
  "@deepseek-ai/dsh-system-prompt": "0.1.2-rc.1",
  "@deepseek-ai/dsh-session": "0.1.2-rc.1",
} as const;
/** 锁定 package 名集合。 */
export type DshLockedPackageName = keyof typeof DSH_LOCKED_PACKAGES;

/** 源码审计锚定的官方仓库 commit（证据：docs/research/2026-09-06-dsh-integration.md）。 */
export const DSH_AUDITED_COMMIT = "d347e703908d0406b7a7ef80e3a0e594d86b2215";

/**
 * MCP 桥锁定包（dsh-kernel-rebase task 4.1b）：内核组合的官方 MCP client 及其
 * peer 闭包四包（README 依赖事实，2026-09-08 实测）。漂移 → typed unavailable。
 */
export const DSH_MCP_BRIDGE_PACKAGES = {
  "@deepseek-ai/dsh-mcp-client": "0.1.2-rc.1",
  "@deepseek-ai/dsh-scope": "0.1.2-rc.1",
  "@deepseek-ai/dsh-timeout": "0.1.2-rc.1",
  "@deepseek-ai/dsh-attachment": "0.1.2-rc.1",
  "@deepseek-ai/dsh-subprocess": "0.1.2-rc.1",
} as const;
/** MCP 桥锁定包名集合。 */
export type DshMcpBridgePackageName = keyof typeof DSH_MCP_BRIDGE_PACKAGES;

/** 每个 package 在 Skill Steward 组合中必须存在的 seam（composition row）。 */
export const DSH_COMPOSITION_ROWS: Record<DshLockedPackageName, string> = {
  "@deepseek-ai/dsh-agent": "AgentRegistry service (ctx.agents create/resume + AgentSetup scope)",
  "@deepseek-ai/dsh-agent-loop": "AgentLoop service (AgentFactory; turn driving + followup/cancel)",
  "@deepseek-ai/dsh-tools": "ToolRuntime service (ctx.tools register/restrict + execute pipeline)",
  "@deepseek-ai/dsh-system-prompt":
    "SystemPrompt service (ordered sections + tool schema provider)",
  "@deepseek-ai/dsh-session": "SessionStore service (durable session event log)",
};

/** 单个 composition row 的解析结果。 */
export const DshCompositionRowSchema = z.object({
  packageName: z.string().min(1),
  lockedVersion: z.string().min(1),
  resolvedVersion: z.string().min(1),
  /** 该 row 依赖的具体导出成员名（运行时校验存在）。 */
  exportName: z.string().min(1),
  seam: z.string().min(1),
});
/** composition row。 */
export type DshCompositionRow = z.infer<typeof DshCompositionRowSchema>;

/** 能力矩阵：每项都由对应 export 的真实解析支撑，不硬编码 true。 */
export const DshCapabilityMatrixSchema = z.object({
  agentRegistry: z.boolean(),
  agentLoop: z.boolean(),
  toolRuntime: z.boolean(),
  systemPrompt: z.boolean(),
  sessionStore: z.boolean(),
});
/** 能力矩阵。 */
export type DshCapabilityMatrix = z.infer<typeof DshCapabilityMatrixSchema>;

/** handshake 失败原因（闭合集合）。 */
export const DshUnavailableCodeSchema = z.enum([
  "MISSING_PACKAGE",
  "VERSION_MISMATCH",
  "COMPOSITION_ROW_MISSING",
]);
/** unavailable 原因码。 */
export type DshUnavailableCode = z.infer<typeof DshUnavailableCodeSchema>;

/** DSH runtime 可用性投影（typed unavailable；无隐式 fallback）。 */
export const DshRuntimeStatusSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("available"),
    auditedCommit: z.literal(DSH_AUDITED_COMMIT),
    rows: z.array(DshCompositionRowSchema),
    capabilities: DshCapabilityMatrixSchema,
  }),
  z.object({
    state: z.literal("unavailable"),
    code: DshUnavailableCodeSchema,
    packageName: z.string().min(1),
    detail: z.string().min(1),
  }),
]);
/** DSH runtime 状态。 */
export type DshRuntimeStatus = z.infer<typeof DshRuntimeStatusSchema>;

/*
 * ---------------------------------------------------------------------------
 * Steward DSH settings / credentials / session streams（task 3.3）
 * 研究事实源：docs/research/2026-09-06-dsh-integration.md「模型、profile 与流式事件」
 * 「Approval、permission 与 sandbox」「Session 与 persistence」三节。
 * ---------------------------------------------------------------------------
 */

/** 凭据形状键（大小写不敏感；命中即在投影中替换为 [redacted]）。 */
const CREDENTIAL_KEY_PATTERN =
  /api[-_]?key|authorization|credential|passphrase|password|secret|token/i;
/** 脱敏占位值。 */
export const DSH_REDACTED = "[redacted]";
/** 脱敏遍历的最大深度（防御异常深层外部输入）。 */
const REDACTION_MAX_DEPTH = 8;

/**
 * 深遍历脱敏：对象键命中凭据形状 → 值替换为 `"[redacted]"`。
 * 纯函数（无 I/O、浏览器安全），run/audit/session-stream 投影统一经过它，
 * 使「凭据永不进入 run/audit payload」成为结构不变量而非调用约定。
 */
export function redactDshPayload(value: unknown, depth = 0): unknown {
  if (depth >= REDACTION_MAX_DEPTH) return DSH_REDACTED;
  if (Array.isArray(value)) return value.map((item) => redactDshPayload(item, depth + 1));
  if (typeof value === "object" && value !== null) {
    const clone: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      clone[key] = CREDENTIAL_KEY_PATTERN.test(key)
        ? DSH_REDACTED
        : redactDshPayload(item, depth + 1);
    }
    return clone;
  }
  return value;
}

/** Steward 使用的模型选择（对应 DSH `agent-default-model` 语义，Manager 自持）。 */
export const DshStewardModelSelectionSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  /** adapter-owned reasoning effort（不透明 token；由所选 adapter 决定合法性）。 */
  reasoningEffort: z.string().min(1).optional(),
});
/** 模型选择。 */
export type DshStewardModelSelection = z.infer<typeof DshStewardModelSelectionSchema>;

/**
 * Agent 会话模式（openspec add-agent-settings-modes）。专有模式 = 版本化
 * system-prompt section + MCP 工具名单；free 无专有收窄（基础最佳实践即全部）。
 */
export const DshAgentModeSchema = z.enum(["create", "manage", "explore", "free"]);
/** Agent 会话模式。 */
export type DshAgentMode = z.infer<typeof DshAgentModeSchema>;

/** 模式目录条目（browser-safe：UI 渲染卡/chip 的单一事实源）。 */
export interface DshAgentModeCatalogEntry {
  id: DshAgentMode;
  label: string;
  description: string;
  /** true = 全工具面，token 消耗更高（UI 明示）。 */
  tokenHeavy: boolean;
}

/** 模式目录（顺序即 UI 展示序；与 daemon kernel 注册表对齐，单测校验一致性）。 */
export const DSH_AGENT_MODES: readonly DshAgentModeCatalogEntry[] = [
  {
    id: "create",
    label: "Create",
    description:
      "Author new skills: frontmatter law, progressive disclosure, validation-first workflow.",
    tokenHeavy: false,
  },
  {
    id: "manage",
    label: "Manage",
    description:
      "Curate the local library: dedupe, merge, optimize, toggle, and update installed skills.",
    tokenHeavy: false,
  },
  {
    id: "explore",
    label: "Explore",
    description:
      "Search skill sources, read candidates, and analyze fit against your requirements.",
    tokenHeavy: false,
  },
  {
    id: "free",
    label: "Free",
    description: "All capabilities in one session, no focused narrowing.",
    tokenHeavy: true,
  },
];

/**
 * LLM preset：deterministic = 脚本化 transport（CI/fixture）；live = 真实 provider。
 * 禁止自动 fallback：live 缺凭据时 resolve 失败，绝不静默回退 deterministic。
 */
export const DshStewardPresetSchema = z.enum(["deterministic", "live"]);
/** LLM preset。 */
export type DshStewardPreset = z.infer<typeof DshStewardPresetSchema>;

/**
 * 权限控制：approvalPolicy 只投影到 agent runtime context 与 run record；
 * 它绝不构成 Manager apply 授权（apply 永远要求 human-only grant）。
 */
export const DshStewardPermissionsSchema = z.object({
  /** ask = 人工审批流；never = headless/CI 分析。 */
  approvalPolicy: z.enum(["ask", "never"]),
});
/** 权限控制。 */
export type DshStewardPermissions = z.infer<typeof DshStewardPermissionsSchema>;

/** 会话控制（驱动 session stream 投影的保留策略）。 */
export const DshStewardSessionControlsSchema = z.object({
  /** 内存流环形缓冲保留的帧数上限（client plugin 实时投影窗口）。 */
  streamRetention: z.number().int().min(10).max(500),
  /** disabled 时投影入口拒绝新帧（回放事实仍归 session/audit 持久层）。 */
  streamProjection: z.enum(["enabled", "disabled"]),
});
/** 会话控制。 */
export type DshStewardSessionControls = z.infer<typeof DshStewardSessionControlsSchema>;

/** 持久化的 steward DSH settings（revision 每次被接受的变更 +1）。 */
export const DshStewardSettingsSchema = z.object({
  configVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  model: DshStewardModelSelectionSchema,
  preset: DshStewardPresetSchema,
  permissions: DshStewardPermissionsSchema,
  session: DshStewardSessionControlsSchema,
  /** 新会话的默认模式（旧文件缺失读 create——additive 字段）。 */
  defaultMode: DshAgentModeSchema.default("create"),
});
/** steward DSH settings。 */
export type DshStewardSettings = z.infer<typeof DshStewardSettingsSchema>;

/** provider 凭据状态（无 key 材料）。 */
export const DshProviderCredentialStatusSchema = z.object({
  provider: z.string().min(1),
  configured: z.boolean(),
});
/** provider 凭据状态。 */
export type DshProviderCredentialStatus = z.infer<typeof DshProviderCredentialStatusSchema>;

/** 客户端可见的 settings 投影（含凭据状态，永不包含凭据值）。 */
export const DshStewardSettingsViewSchema = z.object({
  settings: DshStewardSettingsSchema,
  providers: z.array(DshProviderCredentialStatusSchema),
});
/** settings 投影。 */
export type DshStewardSettingsView = z.infer<typeof DshStewardSettingsViewSchema>;

/** settings 更新补丁（全字段可选；空补丁为 no-op，不动 revision）。 */
export const DshSettingsUpdateSchema = z.object({
  model: DshStewardModelSelectionSchema.optional(),
  preset: DshStewardPresetSchema.optional(),
  permissions: DshStewardPermissionsSchema.partial().optional(),
  session: DshStewardSessionControlsSchema.partial().optional(),
  defaultMode: DshAgentModeSchema.optional(),
});
/** settings 更新补丁。 */
export type DshSettingsUpdate = z.infer<typeof DshSettingsUpdateSchema>;

/** settings 更新拒绝码（闭合集合）。 */
export const DshSettingsFailureCodeSchema = z.enum([
  /** preset=live 要求所选 provider 已配置凭据。 */
  "PRESET_REQUIRES_CREDENTIAL",
  /** live preset 下切换 model 到未配置凭据的 provider。 */
  "MODEL_PROVIDER_WITHOUT_CREDENTIAL",
]);
/** settings 更新拒绝码。 */
export type DshSettingsFailureCode = z.infer<typeof DshSettingsFailureCodeSchema>;

/** settings 更新结果。 */
export const DshSettingsUpdateResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("updated"),
    view: DshStewardSettingsViewSchema,
    /** 是否发生真实变更（no-op 更新 accepted 但不递增 revision）。 */
    changed: z.boolean(),
    previousRevision: z.number().int().nonnegative(),
    revision: z.number().int().nonnegative(),
  }),
  z.object({
    outcome: z.literal("rejected"),
    code: DshSettingsFailureCodeSchema,
    detail: z.string().min(1),
  }),
]);
/** settings 更新结果。 */
export type DshSettingsUpdateResult = z.infer<typeof DshSettingsUpdateResultSchema>;

/** 写入 provider 凭据（仅在 daemon 内存/私有文件中出现，永不回显）。 */
export const DshCredentialSetInputSchema = z.object({
  provider: z.string().min(1),
  apiKey: z.string().min(1),
});
/** 凭据写入输入。 */
export type DshCredentialSetInput = z.infer<typeof DshCredentialSetInputSchema>;

/** 凭据写入结果（rejected = DSH normalizeApiKey 判定非法）。 */
export const DshCredentialSetResultSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("stored"), view: DshStewardSettingsViewSchema }),
  z.object({
    outcome: z.literal("rejected"),
    code: z.literal("INVALID_API_KEY"),
    detail: z.string().min(1),
  }),
]);
/** 凭据写入结果。 */
export type DshCredentialSetResult = z.infer<typeof DshCredentialSetResultSchema>;

/** 凭据清除输入。 */
export const DshCredentialClearInputSchema = z.object({ provider: z.string().min(1) });
/** 凭据清除输入。 */
export type DshCredentialClearInput = z.infer<typeof DshCredentialClearInputSchema>;

/** 运行时 preset 解析失败码。 */
export const DshRuntimePresetFailureCodeSchema = z.enum([
  /** live preset 但所选 provider 无凭据（禁止回退 deterministic）。 */
  "CREDENTIAL_MISSING",
]);
/** 运行时 preset 解析失败码。 */
export type DshRuntimePresetFailureCode = z.infer<typeof DshRuntimePresetFailureCodeSchema>;

/**
 * 运行时 preset 解析（dsh-agent-runtime 消费）：成功给出 adapter 构造事实；
 * 失败为类型化错误——调用方必须失败，不得静默 fallback。
 */
export const DshRuntimePresetResolutionSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("deterministic"),
    model: DshStewardModelSelectionSchema,
  }),
  z.object({
    outcome: z.literal("live"),
    model: DshStewardModelSelectionSchema,
    /** 仅 daemon 进程内使用；任何投影出口前必须脱敏。 */
    apiKey: z.string().min(1),
  }),
  z.object({
    outcome: z.literal("failed"),
    code: DshRuntimePresetFailureCodeSchema,
    detail: z.string().min(1),
  }),
]);
/** 运行时 preset 解析。 */
export type DshRuntimePresetResolution = z.infer<typeof DshRuntimePresetResolutionSchema>;

/** session stream 帧类别（agent 轮次的结构化实时投影）。 */
export const DshSessionStreamFrameKindSchema = z.enum([
  "turn-start",
  "status",
  "tool-call",
  "tool-result",
  "assistant-text",
  /** 流式文本增量（assistant/chunk text-delta 的合并投影；终帧 assistant-text 整段替换）。 */
  "assistant-delta",
  "user-text",
  "turn-end",
  "approval-request",
  "approval-resolved",
  "mode-changed",
]);
/** session stream 帧类别。 */
export type DshSessionStreamFrameKind = z.infer<typeof DshSessionStreamFrameKindSchema>;

/**
 * session stream 帧：给后续 DSH client plugin 的进程内实时投影。
 * durable 回放事实归 session event log / Manager audit；本帧只做 live 视图。
 */
export const DshSessionStreamFrameSchema = z.object({
  /** 进程内单调序号（投影视角排序用，非持久协议）。 */
  seq: z.number().int().nonnegative(),
  at: z.string().min(1),
  runId: z.string().min(1),
  sessionId: z.string().min(1),
  kind: DshSessionStreamFrameKindSchema,
  toolName: z.string().min(1).optional(),
  text: z.string().optional(),
  /** 结构化附载（写入前已过 redactDshPayload）。 */
  payload: z.unknown().optional(),
});
/** session stream 帧。 */
export type DshSessionStreamFrame = z.infer<typeof DshSessionStreamFrameSchema>;

/** session stream 查询输入。 */
export const DshSessionStreamsInputSchema = z.object({
  runId: z.string().min(1).optional(),
  /** 返回最新 N 帧（默认 50，上限 500）。 */
  limit: z.number().int().positive().max(500).optional(),
});
/** session stream 查询输入。 */
export type DshSessionStreamsInput = z.infer<typeof DshSessionStreamsInputSchema>;
