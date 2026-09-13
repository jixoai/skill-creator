/**
 * DSH runtime 集成契约（openspec dsh-runtime-integration task 3.1）。
 *
 * 用户原始需求 [2026-09-06]：「建立 DSH adapter handshake，锁定官方 commit/version、
 * composition rows 与 capability matrix。missing packages, version mismatch and
 * missing plugin rows return typed unavailable; no implicit fallback。」
 * 事实源：docs/research/2026-09-06-dsh-integration.md（官方仓库 commit
 * d347e703 的 0.1.3-alpha.1 源码审计）与 npm 上实际安装的 0.1.5-rc.2 包
 * （2026-09-11 升级：行 id 与 seam 经 bootDshKernel 激活断言实测兼容）。
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
  "@deepseek-ai/dsh-agent": "0.1.5-rc.2",
  "@deepseek-ai/dsh-agent-loop": "0.1.5-rc.2",
  "@deepseek-ai/dsh-tools": "0.1.5-rc.2",
  "@deepseek-ai/dsh-system-prompt": "0.1.5-rc.2",
  "@deepseek-ai/dsh-session": "0.1.5-rc.2",
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
  "@deepseek-ai/dsh-mcp-client": "0.1.5-rc.2",
  "@deepseek-ai/dsh-scope": "0.1.5-rc.2",
  "@deepseek-ai/dsh-timeout": "0.1.5-rc.2",
  "@deepseek-ai/dsh-attachment": "0.1.5-rc.2",
  "@deepseek-ai/dsh-subprocess": "0.1.5-rc.2",
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
 * system-prompt section + MCP 工具名单；free（显示名 Open，2026-09-09 用户
 * 改名「开放模式」）无专有收窄——基础最佳实践即全部，且是唯一放行内核原生
 * bash 工具的模式。
 */
export const DshAgentModeSchema = z.enum(["create", "manage", "explore", "free"]);
/** Agent 会话模式。 */
export type DshAgentMode = z.infer<typeof DshAgentModeSchema>;

/** 模式目录条目（browser-safe：UI 渲染卡/chip 的单一事实源）。 */
export interface DshAgentModeCatalogEntry {
  id: DshAgentMode;
  label: string;
  description: string;
}

/** 模式目录（顺序即 UI 展示序；与 daemon kernel 注册表对齐，单测校验一致性）。 */
export const DSH_AGENT_MODES: readonly DshAgentModeCatalogEntry[] = [
  {
    id: "create",
    label: "Create",
    description:
      "Author new skills: frontmatter law, progressive disclosure, validation-first workflow.",
  },
  {
    id: "manage",
    label: "Manage",
    description:
      "Curate the local library: dedupe, merge, optimize, toggle, and update installed skills.",
  },
  {
    id: "explore",
    label: "Explore",
    description:
      "Search skill sources, read candidates, and analyze fit against your requirements.",
  },
  {
    id: "free",
    label: "General",
    description: "One session with everything available; focused modes are one switch away.",
  },
];

/** 模型 provider 预设档位条目（pi-ai 装配目录即 models.dev 数据的镜像，
 * 2026-09-11 实测提取；CN 端点为国内默认）。 */
export interface DshModelProviderPreset {
  /** 路由名（= pi-ai 目录 provider id，compat/协议自动对齐）。 */
  provider: string;
  label: string;
  api: string;
  baseURL: string;
  /** 目录内的当打模型（非全集——路由可后续手补）。 */
  models: readonly string[];
  /** 凭据环境变量惯例名（展示用；实际引用走 dshRouteApiKeyEnv）。 */
  envHint: string;
  /** true = 国内默认端点。 */
  cn: boolean;
}

/** 模型路由的模型级输入类型（text 为缺省必含）。 */
export const DshModelInputTypeSchema = z.enum(["text", "image", "video", "pdf"]);
export type DshModelInputType = z.infer<typeof DshModelInputTypeSchema>;

/** 模型路由的模型级输出类型（text 必含；image = 图像生成模型。pi-ai 镜像未带
 * output 模态数据（models.dev 有、镜像缺失，2026-09-12 实测 0/1354）——目录
 * 不投影 outputTypes，UI 以 ["text"] 为默认选中（codex R10 P1）。 */
export const DshModelOutputTypeSchema = z.enum(["text", "image"]);
export type DshModelOutputType = z.infer<typeof DshModelOutputTypeSchema>;

/** 模型目录条目（pi-ai 装配目录 = models.dev 镜像，daemon 投影；browser 画廊消费）。 */
export const ModelProviderCatalogEntrySchema = z.object({
  provider: z.string().min(1),
  label: z.string().min(1),
  api: z.string().min(1),
  baseURL: z.string().min(1),
  /** provider 图标（内联 dataURL；无图标为 null → UI 字母头像回退）。 */
  icon: z.string().nullable(),
  models: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().optional(),
        /** 模型声明接受图片输入。 */
        image: z.boolean(),
        /** 上下文窗口（pi-ai 目录 contextWindow，token 数；缺省由 UI 回退假值）。 */
        contextWindow: z.number().int().positive().optional(),
        /** 目录声明是否支持 reasoning effort（缺省未知；effort 补全的候选门）。 */
        supportsReasoningEffort: z.boolean().optional(),
        /** 输入模态（pi-ai 目录 input 数组过滤到产品域 text/image/video/pdf；R10-3）。 */
        inputTypes: z.array(DshModelInputTypeSchema).optional(),
        /** 最大输出 token（pi-ai 目录 maxTokens；R10-4）。 */
        maxOutputTokens: z.number().int().positive().optional(),
        /** thinking 档位键（pi-ai thinkingLevelMap 键，剔除 off；R10-5 补全源）。 */
        effortTiers: z.array(z.string().min(1)).optional(),
      }),
    )
    .min(1),
});
/** 模型目录条目。 */
export type ModelProviderCatalogEntry = z.infer<typeof ModelProviderCatalogEntrySchema>;

/**
 * LLM preset：deterministic = 脚本化 transport（CI/fixture）；live = 真实 provider。
 * 禁止自动 fallback：live 缺凭据时 resolve 失败，绝不静默回退 deterministic。
 */
/** pi-ai 装配目录实测的 wire 协议枚举（api 字段允许值；自定义路由必选其一）。 */
export const DSH_ROUTE_API_PROTOCOLS = [
  "anthropic-messages",
  "azure-openai-responses",
  "bedrock-converse-stream",
  "google-generative-ai",
  "google-vertex",
  "mistral-conversations",
  "openai-codex-responses",
  "openai-completions",
  "openai-responses",
] as const;
export type DshRouteApiProtocol = (typeof DSH_ROUTE_API_PROTOCOLS)[number];

/**
 * Token 简写解析（R7 用户需求 [2026-09-12]：「支持 `0.5M` `253k` 这样的写法」）。
 * 二进制量级（k = 1024、M = 1024²），与 context window 惯例一致（128k = 131072、
 * 200k = 204800）；纯数字原样通过；非法输入返回 null（不猜）。
 */
export function parseTokenShorthand(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?\s*[kKmM]?$/.test(trimmed)) return null;
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*([kKmM])?$/);
  if (match === null) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = match[2]?.toLowerCase();
  const scaled = unit === "k" ? value * 1024 : unit === "m" ? value * 1024 * 1024 : value;
  const rounded = Math.round(scaled);
  return Number.isSafeInteger(rounded) && rounded > 0 ? rounded : null;
}

/**
 * 模型路由（add-agent-settings-modes 迭代三 2026-09-11）：持久化 provider 端点，
 * 经 daemon 桥接写入 DSH 官方热加载面（$DSH_HOME/settings.yaml 的 llm-pi-ai: 段
 * + .credentials.yaml），路由与 key 均即时生效、无需重启内核。
 */
export const DshModelRouteSchema = z.object({
  /** 路由名 = llm-pi-ai providers 键（目录内既有路由按字段覆盖，否则整段声明）。 */
  provider: z.string().min(1),
  /** wire 协议（目录路由可省略；自定义路由必填，如 anthropic-messages）。 */
  api: z.string().min(1).optional(),
  baseURL: z.string().min(1),
  /** 本地 UI 字段：图标覆盖（dataURL；缺省回退目录图标/字母头像）。不写 DSH
   * settings.yaml（桥接层剥离——pi-ai profile 未知键会被内核拒）。 */
  icon: z.string().min(1).optional(),
  /** 本地 UI 字段：字母头像文字（用户可编辑；缺省按 provider 名取首字母）。 */
  iconLetter: z.string().min(1).max(2).optional(),
  /** 本地 UI 字段：字母头像底色（CSS color；与 icon 独立可换）。 */
  iconColor: z.string().min(1).optional(),
  /** 本地 UI 字段：抑制目录图标（true = 显式无图标，走 Letter 头像；否则
   * icon 缺省时回退目录图标）。解决目录 provider 无法选「无图标」的状态缺失。 */
  iconSuppressed: z.boolean().optional(),
  /** 该路由的模型目录（空缺字段继承 pi-ai 装配目录同名模型；name/efforts/
   * maxOutputTokens/inputTypes/outputTypes 为产品级配置，桥接层只向 DSH 写
   * id + contextWindow）。 */
  models: z
    .array(
      z.object({
        id: z.string().min(1),
        /** 展示名：缺省由 id 自动生成（UI 可改）。 */
        name: z.string().min(1).optional(),
        /** 可用 reasoning effort 档（会话 effort 选择的数据源；不再硬编码）。 */
        efforts: z.array(z.string().min(1)).optional(),
        contextWindow: z.number().int().positive().optional(),
        /** 最大输出 token（自动压缩时机的规划输入）。 */
        maxOutputTokens: z.number().int().positive().optional(),
        /** 输入类型多选（text 为缺省必含语义由 UI 保证）。 */
        inputTypes: z.array(DshModelInputTypeSchema).optional(),
        /** 输出类型（当前仅 text，UI 勾选态）。 */
        outputTypes: z.array(DshModelOutputTypeSchema).optional(),
      }),
    )
    .min(1),
});
/** 模型路由。 */
export type DshModelRoute = z.infer<typeof DshModelRouteSchema>;

/**
 * 路由 provider → DSH 凭据引用名（settings.yaml 的 apiKeyEnv / .credentials.yaml
 * 键）。0.1.5 内核对 credentials 文件做严格 key 校验：非白名单名直接打挂 boot
 * （2026-09-12 实测）。因此按 models.dev 官方 env 惯例映射知名 provider，兜底
 * <PROVIDER>_API_KEY（大写去非字母数字）。
 */
const ROUTE_API_KEY_ENVS: Readonly<Record<string, string>> = {
  zai: "ZAI_API_KEY",
  "zai-coding": "ZAI_API_KEY",
  "zai-coding-cn": "ZAI_API_KEY",
  moonshotai: "MOONSHOT_API_KEY",
  "moonshotai-cn": "MOONSHOT_API_KEY",
  "kimi-coding": "MOONSHOT_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  minimax: "MINIMAX_API_KEY",
  "minimax-cn": "MINIMAX_CN_API_KEY",
  "qwen-token-plan": "DASHSCOPE_API_KEY",
  "qwen-token-plan-cn": "DASHSCOPE_API_KEY",
  "qwen-token-plan-individual": "DASHSCOPE_API_KEY",
  openai: "OPENAI_API_KEY",
  "openai-codex": "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  "google-vertex": "GOOGLE_GENERATIVE_AI_API_KEY",
  "azure-openai-responses": "AZURE_OPENAI_API_KEY",
  "local-gateway": "SKILL_CREATOR_LLM_KEY",
};

/** 路由 provider → DSH 凭据引用名（确定性映射；知名 provider 走官方惯例）。 */
export function dshRouteApiKeyEnv(provider: string): string {
  return (
    ROUTE_API_KEY_ENVS[provider] ??
    `${provider.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}_API_KEY`
  );
}

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
  /**
   * 会话转录清理策略（R14-C 2026-09-12）：daemon 启动时自动删除目录日期早于
   * N 天的面板转录（产品转录层 sessions/YYYY/MM/DD；不触碰 $DSH_HOME 内核
   * 会话日志）。旧持久化缺字段经 default 读 30；running 会话跳过。
   */
  sessionCleanupDays: z.number().int().min(1).max(365).default(30),
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
  /** 新会话的默认模式（General/free——通用入口，旧文件缺失同读）。 */
  defaultMode: DshAgentModeSchema.default("free"),
  /** 持久化模型路由（桥接 DSH 热加载面；空 = 未配置自定义路由）。 */
  modelRoutes: z.array(DshModelRouteSchema).default([]),
});
/** steward DSH settings。 */
export type DshStewardSettings = z.infer<typeof DshStewardSettingsSchema>;

/**
 * provider 凭据状态 + key 材料。用户裁决 [2026-09-13]：「如果有 key，直接把
 * key 客观地显示在 input 里面」——password 掩码即展示保护（eye 可揭示），
 * 投影携带 apiKey（null = 未配置）。loopback + 启动 token 的单用户本地面。
 */
export const DshProviderCredentialStatusSchema = z.object({
  provider: z.string().min(1),
  configured: z.boolean(),
  apiKey: z.string().nullable(),
});
/** provider 凭据状态。 */
export type DshProviderCredentialStatus = z.infer<typeof DshProviderCredentialStatusSchema>;

/** 客户端可见的 settings 投影（凭据经用户裁决客观回显，见上）。 */
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
  /** 路由整表替换（add/remove/edit 均以全量补丁表达）。 */
  modelRoutes: z.array(DshModelRouteSchema).optional(),
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

/** 写入 provider 凭据（客观回显：R16 用户裁决，view.providers[].apiKey）。 */
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

/** 连接测试输入（路由草案即可测：未保存的表单也能探活）。 */
export const DshRouteConnectionTestInputSchema = z.object({
  api: z.string().min(1),
  baseURL: z.string().min(1),
  apiKey: z.string().min(1).optional(),
  /** 路由 provider：apiKey 缺省时 daemon 从已存凭据注入（UI 不回显 key）。 */
  provider: z.string().min(1).optional(),
  modelId: z.string().min(1),
});
/** 连接测试输入。 */
export type DshRouteConnectionTestInput = z.infer<typeof DshRouteConnectionTestInputSchema>;

/** 连接测试结果（typed，绝不抛：失败也是值）。 */
export const DshRouteConnectionTestResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("ok"),
    /** 请求往返毫秒（最小 completion 的真实耗时）。 */
    latencyMs: z.number().int().nonnegative(),
  }),
  z.object({
    outcome: z.literal("failed"),
    /** 有限诊断：HTTP 状态/网络错误首行，≤200ch，不含 key。 */
    detail: z.string().min(1),
  }),
]);
/** 连接测试结果。 */
export type DshRouteConnectionTestResult = z.infer<typeof DshRouteConnectionTestResultSchema>;

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
  /** 工具参数流式增量（assistant/chunk tool-call-delta 的合并投影；store 按
   * toolCallId 归并到 open 工具行，终帧 tool-call 以完整参数收敛）。 */
  "tool-args-delta",
  "assistant-text",
  /** 流式文本增量（assistant/chunk text-delta 的合并投影；终帧 assistant-text 整段替换）。 */
  "assistant-delta",
  /** 思考内容终帧（assistant/message 的 reasoning 块整段；面板折叠展示）。 */
  "assistant-reasoning",
  /** 流式思考增量（assistant/chunk reasoning-delta 的合并投影）。 */
  "assistant-reasoning-delta",
  "user-text",
  "turn-end",
  "approval-request",
  "approval-resolved",
  "mode-changed",
  /** 会话自动命名（session/title 事件投影；text = 新标题）。 */
  "session-title",
  /** Todo 列表快照（todo/write 事件投影；payload.todos = {content,status}[]）。 */
  "todo-snapshot",
  /** 自动压缩标记（daemon 在 turn-end 后按 inputTokens + maxOutputTokens ≥
   * contextWindow 阈值自动执行 compact；text = 触发说明，UI 以居中注记渲染）。 */
  "auto-compact",
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
  /** 工具调用关联键（tool-call / tool-args-delta / tool-result 共用；call+result
   * 合并行匹配的第一优先级，缺省时 store 回退同 turn 同名最近未闭合项）。 */
  toolCallId: z.string().min(1).optional(),
  text: z.string().optional(),
  /** 结构化附载（写入前已过 redactDshPayload）。 */
  payload: z.unknown().optional(),
});
/** session stream 帧。 */
export type DshSessionStreamFrame = z.infer<typeof DshSessionStreamFrameSchema>;

/**
 * user-text 帧的附件回显元数据（redesign-model-tabs-and-agent-panel §4.2）：仅
 * kind + 名字（+ 可选缩略 dataURL），不回传字节。UI 渲染优先级 = 乐观本地预览
 * > payload.attachments（回放）> 文件名 chip。
 */
export const DshUserTextAttachmentSchema = z.object({
  kind: z.enum(["image", "file"]),
  name: z.string().min(1).optional(),
  /** ≤96px 缩略 dataURL（仅 image；daemon 侧可选生成，缺省以名字 chip 回显）。
   * 形状加界（2026-09-12 codex 阻塞 4）：必须是指定 image MIME 的 base64 dataURL
   * 且总长 ≤256KiB；畸形 thumb 按领域投影为 undefined（条目存活，回退名字 chip），
   * 不炸整条 safeParse、不写回。 */
  thumb: z
    .string()
    .regex(/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/)
    .max(256 * 1024)
    .optional()
    .catch(undefined),
});
/** user-text 附件回显元数据。 */
export type DshUserTextAttachment = z.infer<typeof DshUserTextAttachmentSchema>;

/** session stream 查询输入。 */
export const DshSessionStreamsInputSchema = z.object({
  runId: z.string().min(1).optional(),
  /** 返回最新 N 帧（默认 50，上限 500）。 */
  limit: z.number().int().positive().max(500).optional(),
});
/** session stream 查询输入。 */
export type DshSessionStreamsInput = z.infer<typeof DshSessionStreamsInputSchema>;
