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
