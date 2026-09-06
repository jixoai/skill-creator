/**
 * Skill Steward 领域契约（provider-neutral boundary）。
 *
 * 用户原始需求 [2026-09-06]（openspec skill-steward-contracts）：
 * 「定义 Manager-owned 的上下文快照、任务、结构化响应、专属工具调用与 patch 契约。」
 * 「Agent 是技能管家；不得直接修改 Provider；每个建议必须引用 skill id、revision 和
 * evidence；不确定时输出 needs-review。」
 *
 * DSH 集成边界（依据 openspec/changes/skill-steward-contracts/artifacts/dsh-webui-audit.md，
 * 官方源码证据：deepseek-ai/deepseek-harness commit d347e703908d0406b7a7ef80e3a0e594d86b2215，
 * 根版本 0.1.3-alpha.1，MIT；可组合 seam 为 @deepseek-ai/dsh-agent、dsh-agent-loop、dsh-session、
 * dsh-tools（defineTool/register/restrict/guard）、dsh-system-prompt、dsh-agent-presets、
 * dsh-user-approval、dsh-sandbox、dsh-api-session-controller、dsh-client-*）：
 * 本阶段【不 import 任何 DSH 包】——这些 seam 只约束后续 dsh-runtime-integration 阶段的
 * adapter 实现选择；DSH store/profile/session log 不是 Manager 事实源。
 *
 * 正交意图：
 *   [1] 不可变上下文快照：scope + 身份 + observed revisions + 有界内容 + 版本 + 能力。
 *   [2] 有限 typed 域工具调用记录：七个 Manager 工具 + principal 边界 + 拒绝记录。
 *   [3] Agent 结构化响应与闭合 patch union：edit/disable/split/merge，缺身份/revision/
 *       evidence/version、非法目的地、身份不一致一律在解析层拒绝。
 *   [4] 审批/审计事实形状：grant 一次性、validation 只出报告、audit 记录 mutation 终态。
 * 妥协声明：无——纯契约层，零 runtime 依赖，可被 fixture/DSH/Codex runtime 共同消费。
 */
import { z } from "zod";
import { SkillDirectoryNameSchema, SkillFrontmatterSchema } from "./creator.js";
import { FindingIdSchema, SeveritySchema } from "./skill-intelligence.js";
import { SkillIdSchema, type SkillId } from "./skills.js";
import { WorkspaceProviderTargetSchema } from "./workspaces.js";

/**
 * 本模块契约版本；Agent 输出必须携带同一版本才可解析。
 * 1.5.0（Codex R4 复核整改）：资源映射拒绝 targetPath 指向主文档 SKILL.md
 * （控制面/资源面冲突；大小写不敏感，含大小写文件系统归一的重复 targetPath 检测）
 * （P1-2/P2-2）；edit 的 frontmatter.name 必须等于快照条目 directoryName——bind 层
 * 新增 EDIT_IDENTITY_MISMATCH（P1-3）；快照 directoryName/name 与 manifest
 * (skillId, relPath) 唯一（P2-1）。
 * 1.4.0（Codex R3 复核整改）：proposal.observedRevisions 与 proposal.skillIds
 * 精确相等（P1-1，额外观察身份在解析层拒绝）；split/merge 目标资源映射拒绝
 * 重复 targetPath（P1-2，杜绝 apply 顺序性静默覆盖）；finding.evidence.skillId
 * 必须属于 finding.skillIds（P2-1）。
 * 1.3.0（Codex R2 复核整改）：快照资源清单 relPath 复用共享安全路径校验
 * （P1-1）；资源映射 sourceSkillId 按 patch kind 闭合且 bind 对齐 snapshot
 * 资源 manifest（P1-2）；enable 收敛为 Manager 派生专用——普通 agent bind 在
 * 任何 scope 都拒绝 enable，Global 只允许 disable，Manager 走
 * bindManagerDerivedProposalToSnapshot（P1-3）；evidence.skillId 必须属于
 * proposal.skillIds 且 bind 时属于 snapshot；finding.observedRevisions 与
 * skillIds 精确相等；split/merge 新目标不得撞快照现有目录名（bind 的
 * TARGET_COLLISION；活体 absent 检查仍在 approval 层保留）。
 * 1.2.0（Codex 复核 P1/P2 整改）：共享安全相对路径校验（拒绝嵌套穿越/反斜杠/
 * 盘符/UNC）；observedRevisions 与 patch 期望 revision 一一且相等；身份唯一性；
 * byteSize 与内容 UTF-8 字节一致且预算按计算值强制；目标 frontmatter.name 与
 * directoryName 一致；scopeKind 与 workspaceId 交叉校验；grant 增加 runId；
 * audit 禁 agent principal；资源映射绑定 sourceSkillId；新增 bindTaskToSnapshot。
 * 1.1.0：patch union 增加 enable（rollback-of-disable 的逆操作语义）。
 */
export const SKILL_STEWARD_CONTRACT_VERSION = "1.5.0" as const;
/** 契约版本字符串约束（稳定语义化字符串）。 */
export const ContractVersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/);
/** 契约版本。 */
export type ContractVersion = z.infer<typeof ContractVersionSchema>;

// ---------------------------------------------------------------------------
// branded IDs
// ---------------------------------------------------------------------------

/** daemon 签发的不可变快照 ID。 */
export const StewardSnapshotIdSchema = z
  .string()
  .regex(/^snap_[a-f0-9]{16}$/)
  .brand<"StewardSnapshotId">();
/** 快照 ID。 */
export type StewardSnapshotId = z.infer<typeof StewardSnapshotIdSchema>;

/** daemon 签发的 steward run ID。 */
export const StewardRunIdSchema = z
  .string()
  .regex(/^sr_[a-f0-9]{24}$/)
  .brand<"StewardRunId2">();
/** run ID。 */
export type StewardRunId2 = z.infer<typeof StewardRunIdSchema>;

/** daemon 签发的任务实例 ID。 */
export const StewardTaskIdSchema = z
  .string()
  .regex(/^task_[a-f0-9]{16}$/)
  .brand<"StewardTaskId">();
/** 任务 ID。 */
export type StewardTaskId = z.infer<typeof StewardTaskIdSchema>;

/** daemon 签发的工具调用记录 ID。 */
export const SkillToolCallIdSchema = z
  .string()
  .regex(/^call_[a-f0-9]{16}$/)
  .brand<"SkillToolCallId">();
/** 工具调用 ID。 */
export type SkillToolCallId = z.infer<typeof SkillToolCallIdSchema>;

/** Manager 签发的 proposal ID（Agent 输出无 ID；由 Manager 校验后分配）。 */
export const StewardProposalIdSchema = z
  .string()
  .regex(/^spp_[a-f0-9]{16}$/)
  .brand<"StewardProposalId">();
/** proposal ID。 */
export type StewardProposalId = z.infer<typeof StewardProposalIdSchema>;

/** Manager 签发的一次性授权 grant ID。 */
export const StewardGrantIdSchema = z
  .string()
  .regex(/^grant_[a-f0-9]{16}$/)
  .brand<"StewardGrantId">();
/** grant ID。 */
export type StewardGrantId = z.infer<typeof StewardGrantIdSchema>;

/** Manager 审计记录 ID。 */
export const StewardAuditIdSchema = z
  .string()
  .regex(/^aud_[a-f0-9]{16}$/)
  .brand<"StewardAuditId">();
/** 审计 ID。 */
export type StewardAuditId = z.infer<typeof StewardAuditIdSchema>;

// ---------------------------------------------------------------------------
// revisions & capabilities
// ---------------------------------------------------------------------------

/** 内容 revision（与 contentRevision 一致：sha256 + 64 hex）。 */
export const ContentRevisionSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
/** 内容 revision。 */
export type ContentRevision = z.infer<typeof ContentRevisionSchema>;

/** 单技能 revision 观察。 */
export const RevisionObservationSchema = z.object({
  skillId: SkillIdSchema,
  revision: ContentRevisionSchema,
});
/** revision 观察。 */
export type RevisionObservation = z.infer<typeof RevisionObservationSchema>;

/** Agent runtime 能力声明（backend 无关；真实能力必须有 handler 测试支撑）。 */
export const AgentRuntimeCapabilitiesSchema = z.object({
  /** backend 标识（fixture / dsh / codex / …；契约层不封闭，由 runtime 阶段锁版本）。 */
  backendId: z.string().min(1).max(64),
  /** backend 报告的协议/产品版本证据。 */
  version: z.string().min(1).max(200),
  streamingEvents: z.boolean(),
  cancellation: z.boolean(),
  permissionRequests: z.boolean(),
  /** Agent 只允许在隔离根或 Manager 批准的 patch 上下文内工作。 */
  executionRoot: z.enum(["isolated", "patch-context"]),
});
/** Agent runtime 能力。 */
export type AgentRuntimeCapabilities = z.infer<typeof AgentRuntimeCapabilitiesSchema>;

// ---------------------------------------------------------------------------
// [1] 不可变上下文快照
// ---------------------------------------------------------------------------

/**
 * 共享安全相对路径校验（Codex P1-1）：逐段拒绝 `.`/`..`、反斜杠、NUL、
 * POSIX 根、盘符根与 UNC 形态；只允许多段普通名称。
 */
export function isSafeRelativePath(value: string): boolean {
  if (value.length === 0 || value.length > 500) return false;
  if (value.includes("\\") || value.includes("\0")) return false;
  if (/^[a-zA-Z]:/.test(value)) return false; // Windows 盘符
  if (value.startsWith("//")) return false; // UNC
  const segments = value.split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/** 技能目录内相对路径（资源映射/审计/证据共用同一安全校验）。 */
const RelPathSchema = z.string().refine(isSafeRelativePath, {
  message: "Relative path inside the skill directory (segment-safe, no traversal/backslash/roots).",
});

/** 快照预算：技能数、单技能内容与总内容上限（超出即拒绝，不静默截断）。 */
const utf8ByteLength = (content: string): number => new TextEncoder().encode(content).length;

export const SNAPSHOT_MAX_SKILLS = 100;
export const SNAPSHOT_MAX_CONTENT_BYTES_PER_SKILL = 256 * 1024;
export const SNAPSHOT_MAX_TOTAL_CONTENT_BYTES = 2 * 1024 * 1024;

/** 快照读取容忍的既有目录名：任意单段名称，仅禁止穿越（.. / 分隔符）。 */
export const SnapshotDirectoryNameSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^(?!\.\.$)[^/\\\0]+$/, "Snapshot directory name must be one plain path segment.");

/** 快照内单个技能的只读条目（读取容忍：新目的地仍由 SkillDirectoryNameSchema 严格约束）。 */
export const StewardSkillSnapshotEntrySchema = z.object({
  skillId: SkillIdSchema,
  name: z.string().min(1).max(200),
  directoryName: SnapshotDirectoryNameSchema,
  revision: ContentRevisionSchema,
  disabled: z.boolean(),
  /** SKILL.md 全文（UTF-8；builder 保证字节预算）。 */
  content: z.string().max(SNAPSHOT_MAX_CONTENT_BYTES_PER_SKILL),
  byteSize: z.number().int().nonnegative(),
});
/** 快照技能条目。 */
export type StewardSkillSnapshotEntry = z.infer<typeof StewardSkillSnapshotEntrySchema>;

/** 技能配套资源清单条目（相对路径 + hash + 类型 + 大小；不跟随目录外 symlink）。 */
export const StewardResourceEntrySchema = z.object({
  skillId: SkillIdSchema,
  /** 技能目录内的相对路径（Codex R2 P1-1：复用共享 isSafeRelativePath，拒绝嵌套穿越/反斜杠/盘符/UNC）。 */
  relPath: RelPathSchema,
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  byteSize: z.number().int().nonnegative(),
  kind: z.enum(["file", "other"]),
});
/** 资源清单条目。 */
export type StewardResourceEntry = z.infer<typeof StewardResourceEntrySchema>;

/**
 * 一次 steward run 的不可变上下文快照：runtime 收到任务前必须已存在。
 * revision 漂移后引用该快照的 proposal 全部 stale，不允许 mutation。
 */
export const SkillStewardContextSnapshotSchema = z
  .object({
    id: StewardSnapshotIdSchema,
    createdAt: z.string().datetime(),
    target: WorkspaceProviderTargetSchema,
    /** Global 支持 只读分析 + 批准后 disable；edit/split/merge 由 bind 层拒绝。 */
    scopeKind: z.enum(["global", "imported"]),
    skills: z.array(StewardSkillSnapshotEntrySchema).min(1).max(SNAPSHOT_MAX_SKILLS),
    resources: z.array(StewardResourceEntrySchema).max(4000),
    promptVersion: ContractVersionSchema,
    toolVersion: ContractVersionSchema,
    capabilities: AgentRuntimeCapabilitiesSchema,
  })
  .superRefine((snapshot, ctx) => {
    // Codex R4 P2-1：快照是持久化/transport 边界，bind/apply 依赖 directoryName 与
    // manifest 查找——目录名、frontmatter name 与 (skillId, relPath) manifest key
    // 必须唯一，否则源目录/manifest 选择存在歧义。
    const directoryNames = new Set<string>();
    const frontmatterNames = new Set<string>();
    for (const skill of snapshot.skills) {
      const dirKey = skill.directoryName.toLowerCase();
      if (directoryNames.has(dirKey)) {
        ctx.addIssue({
          code: "custom",
          message: `Snapshot skills contain duplicate directoryName: ${skill.directoryName}.`,
        });
      }
      directoryNames.add(dirKey);
      const nameKey = skill.name.toLowerCase();
      if (frontmatterNames.has(nameKey)) {
        ctx.addIssue({
          code: "custom",
          message: `Snapshot skills contain duplicate frontmatter name: ${skill.name}.`,
        });
      }
      frontmatterNames.add(nameKey);
    }
    const manifestKeys = new Set<string>();
    for (const resource of snapshot.resources) {
      const key = `${resource.skillId}\u0000${resource.relPath}`;
      if (manifestKeys.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: `Snapshot resource manifest contains duplicate (skillId, relPath): ${resource.skillId} ${resource.relPath}.`,
        });
      }
      manifestKeys.add(key);
    }
    // Codex P1-4：预算按「计算出的 UTF-8 字节」强制，byteSize 必须与内容一致。
    let total = 0;
    for (const skill of snapshot.skills) {
      const actual = utf8ByteLength(skill.content);
      if (actual !== skill.byteSize) {
        ctx.addIssue({
          code: "custom",
          message: `Skill ${skill.directoryName} byteSize ${skill.byteSize} != computed ${actual}.`,
        });
      }
      if (actual > SNAPSHOT_MAX_CONTENT_BYTES_PER_SKILL) {
        ctx.addIssue({
          code: "custom",
          message: `Skill ${skill.directoryName} exceeds the per-skill byte budget (${actual}).`,
        });
      }
      total += actual;
    }
    if (total > SNAPSHOT_MAX_TOTAL_CONTENT_BYTES) {
      ctx.addIssue({
        code: "custom",
        message: `Snapshot content budget exceeded: ${total} > ${SNAPSHOT_MAX_TOTAL_CONTENT_BYTES} bytes.`,
      });
    }
    const ids = new Set(snapshot.skills.map((skill) => skill.skillId));
    if (ids.size !== snapshot.skills.length) {
      ctx.addIssue({ code: "custom", message: "Snapshot contains duplicate skill ids." });
    }
    // Codex P2-2：scopeKind 与 workspaceId 交叉绑定，杜绝伪造 imported 绕过 Global 写限制。
    const isGlobal = snapshot.target.workspaceId === "~";
    if (isGlobal !== (snapshot.scopeKind === "global")) {
      ctx.addIssue({
        code: "custom",
        message: "scopeKind must match the workspace identity (global iff workspaceId is '~').",
      });
    }
    for (const resource of snapshot.resources) {
      if (!ids.has(resource.skillId)) {
        ctx.addIssue({
          code: "custom",
          message: `Snapshot resource references unknown skill: ${resource.skillId}.`,
        });
      }
    }
  });
/** 上下文快照。 */
export type SkillStewardContextSnapshot = z.infer<typeof SkillStewardContextSnapshotSchema>;

// ---------------------------------------------------------------------------
// 任务（check / optimize / organize）
// ---------------------------------------------------------------------------

/** 三类维护任务。 */
export const StewardTaskKindSchema = z.enum(["check", "optimize", "organize"]);
/** 任务类别。 */
export type StewardTaskKind = z.infer<typeof StewardTaskKindSchema>;

/** 一次 steward 任务实例：绑定一个快照与技能子集。 */
export const SkillStewardTaskSchema = z
  .object({
    id: StewardTaskIdSchema,
    kind: StewardTaskKindSchema,
    snapshotId: StewardSnapshotIdSchema,
    /** 任务涉及的技能（必须是快照成员；bind 层校验）。 */
    skillIds: z.array(SkillIdSchema).min(1),
    /** 面向 Agent 的补充指令（可空；模板已含领域约束）。 */
    instructions: z.string().max(2000).optional(),
    promptVersion: ContractVersionSchema,
    toolVersion: ContractVersionSchema,
    createdAt: z.string().datetime(),
  })
  .superRefine((task, ctx) => {
    if (new Set(task.skillIds).size !== task.skillIds.length) {
      ctx.addIssue({ code: "custom", message: "Task skillIds contain duplicates." });
    }
  });
/** 任务实例。 */
export type SkillStewardTask = z.infer<typeof SkillStewardTaskSchema>;

// ---------------------------------------------------------------------------
// [2] 有限 typed 域工具调用
// ---------------------------------------------------------------------------

/** Manager 暴露给 steward 协议的全部域工具（闭合集合）。 */
export const SKILL_DOMAIN_TOOLS = [
  "skills.list_context",
  "skills.inspect",
  "skills.relations",
  "skills.propose",
  "skills.validate_proposal",
  "skills.apply_proposal",
  "skills.rollback",
] as const;
/** 域工具名。 */
export const SkillDomainToolSchema = z.enum(SKILL_DOMAIN_TOOLS);
/** 域工具名。 */
export type SkillDomainTool = z.infer<typeof SkillDomainToolSchema>;

/** Agent 可直接调用的子集；apply/rollback 只属于人类 UI / Manager 恢复代码。 */
export const AGENT_ALLOWED_TOOLS: readonly SkillDomainTool[] = [
  "skills.list_context",
  "skills.inspect",
  "skills.relations",
  "skills.propose",
  "skills.validate_proposal",
];

/** 调用主体：模型、人类 UI、Manager 恢复代码。 */
export const SkillToolPrincipalSchema = z.enum(["agent", "human-ui", "manager-recovery"]);
/** 调用主体。 */
export type SkillToolPrincipal = z.infer<typeof SkillToolPrincipalSchema>;

/** 工具调用的闭合结果 union：成功 / 类型化拒绝 / 类型化失败。 */
export const SkillToolCallResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ok"), value: z.unknown() }),
  z.object({
    kind: z.literal("denied"),
    /** 通用 fs/shell 请求 → unsupported-capability；越权主体 → principal-forbidden。 */
    reason: z.enum(["unsupported-capability", "principal-forbidden"]),
    requestedOperation: z.string().min(1).max(200),
  }),
  z.object({
    kind: z.literal("failed"),
    code: z.enum(["NOT_FOUND", "CONFLICT", "INVALID_OPERATION", "UNAVAILABLE", "STALE"]),
    message: z.string().min(1).max(2000),
  }),
]);
/** 工具调用结果。 */
export type SkillToolCallResult = z.infer<typeof SkillToolCallResultSchema>;

/**
 * 一次工具调用记录：input、result、observed revisions、principal、run 归属。
 * 非域工具（如 read_file/write_file/shell）只能以 denied 记录存在；
 * apply_proposal / rollback 永不允许 agent 主体。
 */
export const SkillToolCallSchema = z
  .object({
    id: SkillToolCallIdSchema,
    at: z.string().datetime(),
    runId: StewardRunIdSchema,
    /** 被请求的工具名；非域工具必须产生 denied 结果。 */
    tool: z.string().min(1).max(200),
    principal: SkillToolPrincipalSchema,
    input: z.unknown(),
    result: SkillToolCallResultSchema,
    observedRevisions: z.array(RevisionObservationSchema).default([]),
  })
  .superRefine((call, ctx) => {
    const isDomain = (SKILL_DOMAIN_TOOLS as readonly string[]).includes(call.tool);
    if (!isDomain && call.result.kind !== "denied") {
      ctx.addIssue({
        code: "custom",
        message: `Non-domain tool "${call.tool}" must record a denied result.`,
      });
    }
    if (
      (call.tool === "skills.apply_proposal" || call.tool === "skills.rollback") &&
      call.principal === "agent"
    ) {
      ctx.addIssue({
        code: "custom",
        message: `Agent principal cannot invoke ${call.tool}.`,
      });
    }
  });
/** 工具调用记录。 */
export type SkillToolCall = z.infer<typeof SkillToolCallSchema>;

// ---------------------------------------------------------------------------
// [3] evidence / finding / patch / proposal / response
// ---------------------------------------------------------------------------

/** 证据：技能内相对定位（path / 行范围 / 精确片段至少其一）。 */
export const StewardEvidenceSchema = z
  .object({
    skillId: SkillIdSchema,
    path: RelPathSchema.optional(),
    lineStart: z.number().int().positive().optional(),
    lineEnd: z.number().int().positive().optional(),
    snippet: z.string().max(2000).optional(),
    note: z.string().max(500).optional(),
  })
  .superRefine((evidence, ctx) => {
    const hasPath = evidence.path !== undefined;
    const hasSnippet = evidence.snippet !== undefined && evidence.snippet.length > 0;
    const hasRange = evidence.lineStart !== undefined && evidence.lineEnd !== undefined;
    if (!hasPath && !hasSnippet && !hasRange) {
      ctx.addIssue({ code: "custom", message: "Evidence needs a path, snippet, or line range." });
    }
    if (
      evidence.lineStart !== undefined &&
      evidence.lineEnd !== undefined &&
      evidence.lineEnd < evidence.lineStart
    ) {
      ctx.addIssue({ code: "custom", message: "Evidence line range is inverted." });
    }
  });
/** 证据。 */
export type StewardEvidence = z.infer<typeof StewardEvidenceSchema>;

/** finding 来源：确定性 analyzer 或 Agent 语义发现（后者由 Manager 校验后分配 ID）。 */
export const StewardFindingOriginSchema = z.enum(["deterministic", "agent-semantic"]);
/** finding 来源。 */
export type StewardFindingOrigin = z.infer<typeof StewardFindingOriginSchema>;

/** 结构化 finding：身份、revision、evidence、契约版本全部必填。 */
export const StewardFindingSchema = z
  .object({
    contractVersion: ContractVersionSchema,
    origin: StewardFindingOriginSchema,
    severity: SeveritySchema,
    /** deterministic 时必须取 intelligence 的封闭 FindingKind；agent-semantic 为自由类别。 */
    category: z.string().min(1).max(100),
    message: z.string().min(1).max(2000),
    skillIds: z.array(SkillIdSchema).min(1),
    observedRevisions: z.array(RevisionObservationSchema).min(1),
    evidence: z.array(StewardEvidenceSchema).min(1).max(20),
    /** 仅 Manager 分配；Agent 输出不得携带。 */
    findingId: FindingIdSchema.optional(),
  })
  .superRefine((finding, ctx) => {
    if (finding.origin === "deterministic" && finding.findingId === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "Deterministic findings must carry their Manager-assigned id.",
      });
    }
    const covered = new Set(finding.observedRevisions.map((observed) => observed.skillId));
    for (const skillId of finding.skillIds) {
      if (!covered.has(skillId)) {
        ctx.addIssue({
          code: "custom",
          message: `Finding references skill ${skillId} without an observed revision.`,
        });
      }
    }
    // Codex R2 P2-1：observedRevisions 与 skillIds 精确相等（多余观察/重复观察都是身份漂移）。
    if (
      covered.size !== finding.observedRevisions.length ||
      covered.size !== new Set(finding.skillIds).size
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Finding observedRevisions must equal skillIds exactly.",
      });
    }
    // Codex R3 P2-1：证据身份必须落在 finding 自己的 skillIds 内（与 proposal 证据同规则）。
    const findingScope = new Set(finding.skillIds);
    for (const evidence of finding.evidence) {
      if (!findingScope.has(evidence.skillId)) {
        ctx.addIssue({
          code: "custom",
          message: `Finding evidence references skill ${evidence.skillId} outside the finding skillIds scope.`,
        });
      }
    }
  });
/** 结构化 finding。 */
export type StewardFinding = z.infer<typeof StewardFindingSchema>;

/** split/merge 的显式资源映射：copy / move / reference。 */
export const StewardResourceMappingSchema = z.object({
  /** Codex P2-5：资源来源绑定到具体源技能身份（merge 多源时消除同名歧义）。 */
  sourceSkillId: SkillIdSchema,
  sourcePath: RelPathSchema,
  targetPath: RelPathSchema,
  strategy: z.enum(["copy", "move", "reference"]),
});
/** 资源映射。 */
export type StewardResourceMapping = z.infer<typeof StewardResourceMappingSchema>;

/**
 * split/merge 新目标的完整文档（安全目录名 + frontmatter + body + 显式资源映射）。
 * Codex P2-1：物理目录名必须与文档身份一致（frontmatter.name === directoryName）。
 */
export const StewardPatchTargetDocumentSchema = z
  .object({
    directoryName: SkillDirectoryNameSchema,
    frontmatter: SkillFrontmatterSchema,
    body: z.string().max(SNAPSHOT_MAX_CONTENT_BYTES_PER_SKILL),
    resources: z.array(StewardResourceMappingSchema).max(200).default([]),
  })
  .superRefine((target, ctx) => {
    if (target.frontmatter.name !== target.directoryName) {
      ctx.addIssue({
        code: "custom",
        message: `Target frontmatter name "${target.frontmatter.name}" must equal directoryName "${target.directoryName}".`,
      });
    }
    // Codex R3 P1-2：同一目标内重复 targetPath 会让真实 apply 以后写静默覆盖先写，
    // 属于 mutation 语义未定义；契约层直接拒绝（overwrite 若成为产品策略必须显式建模）。
    // Codex R4 P2-2：大小写不敏感文件系统（macOS/Windows）上不同大小写是同一物理
    // 文件——按小写归一比较。
    const targetPaths = new Set(
      target.resources.map((mapping) => mapping.targetPath.toLowerCase()),
    );
    if (targetPaths.size !== target.resources.length) {
      ctx.addIssue({
        code: "custom",
        message: "Target resource mappings contain duplicate targetPath.",
      });
    }
    // Codex R4 P1-2：资源映射是资源面；主文档 SKILL.md 由 create-target 步骤拥有。
    // 资源写入 SKILL.md 会静默丢弃声明的 frontmatter/body（控制面文件被资源面覆盖）。
    for (const mapping of target.resources) {
      const segments = mapping.targetPath.split("/");
      const basename = segments[segments.length - 1] ?? "";
      if (basename.toLowerCase() === "skill.md") {
        ctx.addIssue({
          code: "custom",
          message: `Resource targetPath must not target the skill document (SKILL.md): ${mapping.targetPath}`,
        });
      }
    }
  });
/** patch 目标文档。 */
export type StewardPatchTargetDocument = z.infer<typeof StewardPatchTargetDocumentSchema>;

/** patch 类别（闭合 union；与 proposal.action 必须一致）。enable 仅用于 Manager 派生的回滚反向方案。 */
export const StewardPatchKindSchema = z.enum(["edit", "disable", "enable", "split", "merge"]);
/** patch 类别。 */
export type StewardPatchKind = z.infer<typeof StewardPatchKindSchema>;

/** 已有技能的 revision 期望（stale 判定依据；inverse 由 Manager 从快照派生）。 */
export const PatchSkillRefSchema = z.object({
  skillId: SkillIdSchema,
  expectedRevision: ContentRevisionSchema,
});
/** patch 技能引用。 */
export type PatchSkillRef = z.infer<typeof PatchSkillRefSchema>;

/** edit：逐技能整文档替换（保留未知合法 frontmatter 由 apply 层执行）。 */
export const EditSkillPatchSchema = z
  .object({
    kind: z.literal("edit"),
    snapshotId: StewardSnapshotIdSchema,
    edits: z
      .array(
        z.object({
          skillId: SkillIdSchema,
          expectedRevision: ContentRevisionSchema,
          frontmatter: SkillFrontmatterSchema,
          body: z.string().max(SNAPSHOT_MAX_CONTENT_BYTES_PER_SKILL),
        }),
      )
      .min(1)
      .max(SNAPSHOT_MAX_SKILLS),
  })
  .superRefine((patch, ctx) => {
    if (new Set(patch.edits.map((edit) => edit.skillId)).size !== patch.edits.length) {
      ctx.addIssue({ code: "custom", message: "Edit patch contains duplicate skill ids." });
    }
  });

/** disable：仅启停语义（apply 走 Provider 真实启停机制，不是 UI flag）。 */
export const DisableSkillPatchSchema = z
  .object({
    kind: z.literal("disable"),
    snapshotId: StewardSnapshotIdSchema,
    selections: z.array(PatchSkillRefSchema).min(1).max(SNAPSHOT_MAX_SKILLS),
    reason: z.string().min(1).max(2000),
  })
  .superRefine((patch, ctx) => {
    if (
      new Set(patch.selections.map((selection) => selection.skillId)).size !==
      patch.selections.length
    ) {
      ctx.addIssue({ code: "custom", message: "Disable patch contains duplicate skill ids." });
    }
  });

/** enable：恢复启停（Manager 派生的 rollback 反向操作；Agent 不主动建议启用）。 */
export const EnableSkillPatchSchema = z
  .object({
    kind: z.literal("enable"),
    snapshotId: StewardSnapshotIdSchema,
    selections: z.array(PatchSkillRefSchema).min(1).max(SNAPSHOT_MAX_SKILLS),
    reason: z.string().min(1).max(2000),
  })
  .superRefine((patch, ctx) => {
    if (
      new Set(patch.selections.map((selection) => selection.skillId)).size !==
      patch.selections.length
    ) {
      ctx.addIssue({ code: "custom", message: "Enable patch contains duplicate skill ids." });
    }
  });

/** split：一个源拆为 >=2 个不存在的新目标；源保留目录、校验后禁用。 */
export const SplitSkillPatchSchema = z
  .object({
    kind: z.literal("split"),
    snapshotId: StewardSnapshotIdSchema,
    source: PatchSkillRefSchema,
    targets: z.array(StewardPatchTargetDocumentSchema).min(2).max(20),
  })
  .superRefine((patch, ctx) => {
    const names = new Set(patch.targets.map((target) => target.directoryName));
    if (names.size !== patch.targets.length) {
      ctx.addIssue({ code: "custom", message: "Split targets must have unique directory names." });
    }
  });

/** merge：>=2 个源合并为一个新目标；源保留目录、验证后全部禁用。 */
export const MergeSkillPatchSchema = z
  .object({
    kind: z.literal("merge"),
    snapshotId: StewardSnapshotIdSchema,
    sources: z.array(PatchSkillRefSchema).min(2).max(SNAPSHOT_MAX_SKILLS),
    target: StewardPatchTargetDocumentSchema,
  })
  .superRefine((patch, ctx) => {
    if (new Set(patch.sources.map((source) => source.skillId)).size !== patch.sources.length) {
      ctx.addIssue({ code: "custom", message: "Merge patch contains duplicate source skill ids." });
    }
  });

/** patch 的闭合 union（edit/disable/enable/split/merge）；未知 action 在解析层被拒绝。 */
export const SkillPatchSchema = z.discriminatedUnion("kind", [
  EditSkillPatchSchema,
  DisableSkillPatchSchema,
  EnableSkillPatchSchema,
  SplitSkillPatchSchema,
  MergeSkillPatchSchema,
]);
/** patch。 */
export type SkillPatch = z.infer<typeof SkillPatchSchema>;

/** proposal：Agent 的结构化建议（契约版本 + action/patch 一致 + 证据必填）。 */
export const SkillProposalSchema = z
  .object({
    contractVersion: ContractVersionSchema,
    action: StewardPatchKindSchema,
    patch: SkillPatchSchema,
    rationale: z.string().min(1).max(4000),
    /** 引用的确定性 finding（可空：语义优化可自带新证据）。 */
    findingIds: z.array(FindingIdSchema).max(20).default([]),
    /** 语义证据至少一条；缺证据的 proposal 在解析层拒绝。 */
    evidence: z.array(StewardEvidenceSchema).min(1).max(20),
    /** 受影响身份必须与 patch 展开一致（superRefine）。 */
    skillIds: z.array(SkillIdSchema).min(1),
    observedRevisions: z.array(RevisionObservationSchema).min(1),
  })
  .superRefine((proposal, ctx) => {
    if (proposal.action !== proposal.patch.kind) {
      ctx.addIssue({
        code: "custom",
        message: `Proposal action "${proposal.action}" does not match patch kind "${proposal.patch.kind}".`,
      });
    }
    const affected = affectedSkillIdsOfPatch(proposal.patch);
    const declared = new Set(proposal.skillIds);
    for (const skillId of affected) {
      if (!declared.has(skillId)) {
        ctx.addIssue({
          code: "custom",
          message: `Patch affects skill ${skillId} missing from proposal skillIds.`,
        });
      }
    }
    for (const skillId of proposal.skillIds) {
      if (!affected.includes(skillId)) {
        ctx.addIssue({
          code: "custom",
          message: `Proposal declares skill ${skillId} which the patch does not affect.`,
        });
      }
    }
    const observedMap = new Map(
      proposal.observedRevisions.map((observed) => [observed.skillId, observed.revision]),
    );
    // Codex P1-2：观察集合与受影响身份一一对应。
    if (observedMap.size !== proposal.observedRevisions.length) {
      ctx.addIssue({
        code: "custom",
        message: "Proposal observedRevisions contain duplicate skill ids.",
      });
    }
    // Codex R3 P1-1：观察身份与 proposal.skillIds 精确相等——额外身份不受 patch
    // expected set 约束，等于允许审计声称观察了未被本 proposal 修改的技能。
    for (const skillId of observedMap.keys()) {
      if (!declared.has(skillId)) {
        ctx.addIssue({
          code: "custom",
          message: `Proposal observes skill ${skillId} outside the proposal skillIds scope.`,
        });
      }
    }
    for (const skillId of proposal.skillIds) {
      if (!observedMap.has(skillId)) {
        ctx.addIssue({
          code: "custom",
          message: `Proposal references skill ${skillId} without an observed revision.`,
        });
      }
    }
    if (new Set(proposal.skillIds).size !== proposal.skillIds.length) {
      ctx.addIssue({ code: "custom", message: "Proposal skillIds contain duplicates." });
    }
    // Codex P1-2：每个观察 revision 必须等于 patch 的 expectedRevision。
    for (const [skillId, revision] of expectedRevisionsOfPatch(proposal.patch)) {
      const observed = observedMap.get(skillId);
      if (observed !== undefined && observed !== revision) {
        ctx.addIssue({
          code: "custom",
          message: `Observed revision for ${skillId} (${observed}) differs from the patch expectation (${revision}).`,
        });
      }
    }
    // Codex R2 P2-1：证据身份必须落在 proposal 声明的受影响集合内。
    const declaredScope = new Set(proposal.skillIds);
    for (const evidence of proposal.evidence) {
      if (!declaredScope.has(evidence.skillId)) {
        ctx.addIssue({
          code: "custom",
          message: `Evidence references skill ${evidence.skillId} outside the proposal skillIds scope.`,
        });
      }
    }
    // Codex R2 P1-2：资源映射的源身份按 patch kind 闭合（snapshot 侧对齐在 bind 层）。
    if (proposal.patch.kind === "split" || proposal.patch.kind === "merge") {
      const targets =
        proposal.patch.kind === "split" ? proposal.patch.targets : [proposal.patch.target];
      const allowedSources =
        proposal.patch.kind === "split"
          ? new Set<SkillId>([proposal.patch.source.skillId])
          : new Set<SkillId>(proposal.patch.sources.map((source) => source.skillId));
      for (const target of targets) {
        for (const mapping of target.resources) {
          if (!allowedSources.has(mapping.sourceSkillId)) {
            ctx.addIssue({
              code: "custom",
              message: `Resource mapping source ${mapping.sourceSkillId} is not a patch source skill (kind ${proposal.patch.kind}).`,
            });
          }
        }
      }
    }
  });
/** proposal。 */
export type SkillProposal = z.infer<typeof SkillProposalSchema>;

/** patch 展开的受影响已有技能身份（新目标目录不是已有身份，不在此列）。 */
export function affectedSkillIdsOfPatch(patch: SkillPatch): SkillId[] {
  switch (patch.kind) {
    case "edit":
      return patch.edits.map((edit) => edit.skillId);
    case "disable":
      return patch.selections.map((selection) => selection.skillId);
    case "enable":
      return patch.selections.map((selection) => selection.skillId);
    case "split":
      return [patch.source.skillId];
    case "merge":
      return patch.sources.map((source) => source.skillId);
  }
}

/** Agent 终态原因（闭合集合；needs-review 表示模型不确定，禁止臆断）。 */
export const StewardTerminalReasonSchema = z.enum([
  "completed",
  "needs-review",
  "scope-limit",
  "failed",
]);
/** 终态原因。 */
export type StewardTerminalReason = z.infer<typeof StewardTerminalReasonSchema>;

/** Agent 阶段事件（仅进度展示；不驱动 mutation）。 */
export const StewardStageSchema = z.enum([
  "started",
  "collecting",
  "analyzing",
  "proposing",
  "validating",
  "done",
]);
/** 阶段。 */
export type StewardStage = z.infer<typeof StewardStageSchema>;

/**
 * Agent 输出的唯一合法形态：闭合 discriminated union。
 * 自然语言只能作为 transcript 展示；未知 kind / 缺字段在解析层整体拒绝。
 */
export const SkillStewardResponseSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("stage"),
    stage: StewardStageSchema,
    note: z.string().max(1000).optional(),
  }),
  z.object({ kind: z.literal("finding"), finding: StewardFindingSchema }),
  z.object({ kind: z.literal("proposal"), proposal: SkillProposalSchema }),
  z.object({
    kind: z.literal("question"),
    question: z.string().min(1).max(2000),
    options: z.array(z.string().min(1).max(500)).max(10).optional(),
  }),
  z.object({
    kind: z.literal("terminal"),
    reason: StewardTerminalReasonSchema,
    message: z.string().max(2000).optional(),
  }),
]);
/** Agent 结构化响应。 */
export type SkillStewardResponse = z.infer<typeof SkillStewardResponseSchema>;

// ---------------------------------------------------------------------------
// [4] validation / approval grant / audit
// ---------------------------------------------------------------------------

/** validation 检查项。 */
export const StewardValidationCheckSchema = z.object({
  name: z.string().min(1).max(100),
  status: z.enum(["passed", "failed", "skipped"]),
  detail: z.string().max(2000).optional(),
});
/** 检查项。 */
export type StewardValidationCheck = z.infer<typeof StewardValidationCheckSchema>;

/**
 * validation 结果：只出报告，不签发授权（authorization 只来自人类 UI RPC）。
 * overall=stale 表示 revision 漂移，proposal 必须重新快照与审批。
 */
export const SkillValidationResultSchema = z.object({
  proposalId: StewardProposalIdSchema,
  overall: z.enum(["valid", "invalid", "stale"]),
  checks: z.array(StewardValidationCheckSchema).min(1).max(50),
});
/** validation 结果。 */
export type SkillValidationResult = z.infer<typeof SkillValidationResultSchema>;

/**
 * Manager-owned 一次性授权 grant：绑定 run、snapshot、完整 patch fingerprint、
 * 全部输入 revision 与 absent precondition；消费即失效。
 */
export const StewardApprovalGrantSchema = z.object({
  id: StewardGrantIdSchema,
  proposalId: StewardProposalIdSchema,
  snapshotId: StewardSnapshotIdSchema,
  /** Codex P2-5：grant 绑定 run（重启/取消语义以此失效）。 */
  runId: StewardRunIdSchema,
  /** 规范化 patch 的 sha256 fingerprint；apply 时必须再次匹配。 */
  fingerprint: ContentRevisionSchema,
  /** 只能是已鉴权人类 UI（或 Manager 恢复代码的显式 principal）。 */
  principal: z.enum(["human-ui", "manager-recovery"]),
  issuedAt: z.string().datetime(),
  consumedAt: z.string().datetime().nullable(),
  inputRevisions: z.array(RevisionObservationSchema).min(1),
  /** split/merge 目标目录必须不存在的 precondition 列表。 */
  absentPreconditions: z.array(SkillDirectoryNameSchema).max(20).default([]),
});
/** 授权 grant。 */
export type StewardApprovalGrant = z.infer<typeof StewardApprovalGrantSchema>;

/** 单个 mutation 的前后状态（审计证据；beforeRevision=null 表示创建，afterRevision=null 表示删除/禁用语义见 status）。 */
export const StewardMutationRecordSchema = z.object({
  skillId: SkillIdSchema.optional(),
  relPath: RelPathSchema,
  beforeRevision: ContentRevisionSchema.nullable(),
  afterRevision: ContentRevisionSchema.nullable(),
  /** disable/enable 等启停语义也以 mutation 记录。 */
  semantic: z.enum(["content", "enablement", "resource"]).default("content"),
});
/** mutation 记录。 */
export type StewardMutationRecord = z.infer<typeof StewardMutationRecordSchema>;

/** 终态审计记录：apply / rollback / recovery 的逐项事实（不随 transcript 淘汰）。 */
export const StewardAuditRecordSchema = z.object({
  id: StewardAuditIdSchema,
  runId: StewardRunIdSchema,
  proposalId: StewardProposalIdSchema,
  snapshotId: StewardSnapshotIdSchema,
  action: StewardPatchKindSchema,
  /** Codex P2-5：审计只记录人类/恢复主体；agent 永不出现在 mutation 审计。 */
  principal: z.enum(["human-ui", "manager-recovery"]),
  appliedAt: z.string().datetime(),
  status: z.enum(["applied", "rolled-back", "recovery-required"]),
  mutations: z.array(StewardMutationRecordSchema).min(1).max(500),
  /** Manager 保存的 inverse manifest 引用（回滚方案的输入；非 Agent 提供）。 */
  inverseManifestRef: z.string().min(1).optional(),
});
/** 审计记录。 */
export type StewardAuditRecord = z.infer<typeof StewardAuditRecordSchema>;

// ---------------------------------------------------------------------------
// bind 层：task/proposal ↔ snapshot 的确定性校验（纯函数）
// ---------------------------------------------------------------------------

/** task bind 失败（闭合原因）。 */
export type TaskBindFailure =
  | { code: "SNAPSHOT_MISMATCH"; message: string }
  | { code: "UNKNOWN_SKILL"; message: string };

/**
 * 把任务绑定到快照（Codex P2-3）：skillIds 必须全部属于快照；
 * runtime 接收任务前必须通过本检查。
 */
export function bindTaskToSnapshot(
  task: SkillStewardTask,
  snapshot: SkillStewardContextSnapshot,
): { ok: true } | { ok: false; failure: TaskBindFailure } {
  if (task.snapshotId !== snapshot.id) {
    return {
      ok: false,
      failure: { code: "SNAPSHOT_MISMATCH", message: "Task references a different snapshot." },
    };
  }
  const ids = new Set(snapshot.skills.map((skill) => skill.skillId));
  for (const skillId of task.skillIds) {
    if (!ids.has(skillId)) {
      return {
        ok: false,
        failure: {
          code: "UNKNOWN_SKILL",
          message: `Skill ${skillId} is not part of the snapshot.`,
        },
      };
    }
  }
  return { ok: true };
}

/** bind 失败的类型化结果（闭合原因；不产生任何 mutation）。 */
export type ProposalBindFailure =
  | { code: "SNAPSHOT_MISMATCH"; message: string }
  | { code: "UNKNOWN_SKILL"; message: string }
  | { code: "STALE_REVISION"; message: string }
  | { code: "UNSUPPORTED_WRITE_SCOPE"; message: string }
  | { code: "CONTRACT_VERSION"; message: string }
  /** Codex R4 P1-3：edit 的 frontmatter.name 与快照条目 directoryName 不一致（身份伪造）。 */
  | { code: "EDIT_IDENTITY_MISMATCH"; message: string }
  /** Codex R2 P2-2：split/merge 新目标撞上快照现有目录（absent precondition 的确定性层）。 */
  | { code: "TARGET_COLLISION"; message: string }
  /** Codex R2 P1-2：映射源技能不在快照，或 sourcePath 不在该源的快照资源 manifest 内。 */
  | { code: "RESOURCE_MAPPING"; message: string };

/** bind 结果。 */
export type ProposalBindResult = { ok: true } | { ok: false; failure: ProposalBindFailure };

/**
 * 把 proposal 绑定到不可变快照（Agent 面）：
 * - snapshotId 一致；contractVersion 与本模块版本一致；
 * - 全部受影响身份属于快照；expectedRevision 必须等于快照 revision；
 * - evidence 身份属于快照（Codex R2 P2-1）；
 * - Global scope 只允许 disable（Codex R2 P1-3：enable 收敛为 Manager 派生专用，
 *   任何 scope 的普通 agent proposal 都不能 enable）；
 * - split/merge 新目标不得撞快照现有目录名；资源映射源/路径必须在快照 manifest 内
 *   （Codex R2 P1-2/P2-2；活体 absent/hash 复核仍在 approval/apply 层保留）。
 */
export function bindProposalToSnapshot(
  proposal: SkillProposal,
  snapshot: SkillStewardContextSnapshot,
): ProposalBindResult {
  return bindProposalCore(proposal, snapshot, { managerDerived: false });
}

/**
 * Manager 派生反向 proposal 的内部 bind（Codex R2 P1-3）：
 * 仅由 Manager approval/recovery 代码路径调用（入口不可被 Agent 构造），
 * 允许 enable（含 Global 的 rollback-of-disable 逆），其余约束与 Agent bind 相同。
 */
export function bindManagerDerivedProposalToSnapshot(
  proposal: SkillProposal,
  snapshot: SkillStewardContextSnapshot,
): ProposalBindResult {
  return bindProposalCore(proposal, snapshot, { managerDerived: true });
}

function bindProposalCore(
  proposal: SkillProposal,
  snapshot: SkillStewardContextSnapshot,
  options: { managerDerived: boolean },
): ProposalBindResult {
  if (proposal.contractVersion !== SKILL_STEWARD_CONTRACT_VERSION) {
    return {
      ok: false,
      failure: {
        code: "CONTRACT_VERSION",
        message: `Proposal contract version ${proposal.contractVersion} != ${SKILL_STEWARD_CONTRACT_VERSION}.`,
      },
    };
  }
  if (proposal.patch.snapshotId !== snapshot.id) {
    return {
      ok: false,
      failure: {
        code: "SNAPSHOT_MISMATCH",
        message: "Proposal references a different context snapshot.",
      },
    };
  }
  if (proposal.patch.kind === "enable" && !options.managerDerived) {
    return {
      ok: false,
      failure: {
        code: "UNSUPPORTED_WRITE_SCOPE",
        message:
          "enable is a Manager-derived rollback inverse; agent proposals cannot enable skills.",
      },
    };
  }
  if (
    snapshot.scopeKind === "global" &&
    proposal.patch.kind !== "disable" &&
    !(proposal.patch.kind === "enable" && options.managerDerived)
  ) {
    return {
      ok: false,
      failure: {
        code: "UNSUPPORTED_WRITE_SCOPE",
        message: `Global workspace supports analysis and approved disable only; ${proposal.patch.kind} is rejected.`,
      },
    };
  }
  const byId = new Map(snapshot.skills.map((skill) => [skill.skillId, skill]));
  const expected = expectedRevisionsOfPatch(proposal.patch);
  for (const [skillId, revision] of expected) {
    const entry = byId.get(skillId);
    if (!entry) {
      return {
        ok: false,
        failure: {
          code: "UNKNOWN_SKILL",
          message: `Skill ${skillId} is not part of the snapshot.`,
        },
      };
    }
    if (entry.revision !== revision) {
      return {
        ok: false,
        failure: {
          code: "STALE_REVISION",
          message: `Skill ${skillId} expected ${revision} but snapshot holds ${entry.revision}.`,
        },
      };
    }
  }
  // Codex R4 P1-3：edit 只能改文档内容，不能伪造身份——frontmatter.name 必须与
  // 快照条目的物理 directoryName 一致（split/merge 目标的同名规则已由 target schema
  // 覆盖；edit 的既有目标在这里闭合）。
  if (proposal.patch.kind === "edit") {
    for (const edit of proposal.patch.edits) {
      const entry = byId.get(edit.skillId);
      if (entry && edit.frontmatter.name !== entry.directoryName) {
        return {
          ok: false,
          failure: {
            code: "EDIT_IDENTITY_MISMATCH",
            message: `Edit for ${edit.skillId} must keep frontmatter.name "${entry.directoryName}" (got "${edit.frontmatter.name}").`,
          },
        };
      }
    }
  }
  // Codex R2 P2-1：证据身份必须属于快照（proposal 层已限制在 skillIds 内）。
  for (const evidence of proposal.evidence) {
    if (!byId.has(evidence.skillId)) {
      return {
        ok: false,
        failure: {
          code: "UNKNOWN_SKILL",
          message: `Evidence references skill ${evidence.skillId} which is not part of the snapshot.`,
        },
      };
    }
  }
  if (proposal.patch.kind === "split" || proposal.patch.kind === "merge") {
    const patch = proposal.patch;
    const targets = patch.kind === "split" ? patch.targets : [patch.target];
    // Codex R2 P2-2：新目标撞快照现有目录名 → deterministic absent-precondition 失败。
    const existingNames = new Map(
      snapshot.skills.map((skill) => [skill.directoryName, skill.skillId]),
    );
    for (const target of targets) {
      if (existingNames.has(target.directoryName)) {
        return {
          ok: false,
          failure: {
            code: "TARGET_COLLISION",
            message: `Target directory "${target.directoryName}" already exists in the snapshot (skill ${existingNames.get(target.directoryName)}).`,
          },
        };
      }
    }
    // Codex R2 P1-2：每条映射的源技能必须在快照内，sourcePath 必须在该源的 manifest 中。
    for (const target of targets) {
      for (const mapping of target.resources) {
        if (!byId.has(mapping.sourceSkillId)) {
          return {
            ok: false,
            failure: {
              code: "RESOURCE_MAPPING",
              message: `Resource mapping source skill ${mapping.sourceSkillId} is not part of the snapshot.`,
            },
          };
        }
        const inManifest = snapshot.resources.some(
          (resource) =>
            resource.skillId === mapping.sourceSkillId && resource.relPath === mapping.sourcePath,
        );
        if (!inManifest) {
          return {
            ok: false,
            failure: {
              code: "RESOURCE_MAPPING",
              message: `Resource ${mapping.sourcePath} is not in the snapshot manifest of skill ${mapping.sourceSkillId}.`,
            },
          };
        }
      }
    }
  }
  return { ok: true };
}

/** patch 内全部 (skillId, expectedRevision) 对。 */
export function expectedRevisionsOfPatch(patch: SkillPatch): Map<SkillId, string> {
  const pairs = new Map<SkillId, string>();
  const put = (skillId: SkillId, revision: string): void => {
    pairs.set(skillId, revision);
  };
  switch (patch.kind) {
    case "edit":
      for (const edit of patch.edits) put(edit.skillId, edit.expectedRevision);
      break;
    case "disable":
    case "enable":
      for (const selection of patch.selections) put(selection.skillId, selection.expectedRevision);
      break;
    case "split":
      put(patch.source.skillId, patch.source.expectedRevision);
      break;
    case "merge":
      for (const source of patch.sources) put(source.skillId, source.expectedRevision);
      break;
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// RPC IO（阶段 2 的 human-UI 面向 surface；agent 永远只能走 tool registry）
// ---------------------------------------------------------------------------

/** 启动一次 fixture 管家 run（backend 锁定 fixture；DSH 属后续阶段）。 */
export const SkillStewardRunInputSchema = z.object({
  target: WorkspaceProviderTargetSchema,
  skillIds: z.array(SkillIdSchema).optional(),
  taskKind: StewardTaskKindSchema,
  scenario: z
    .enum([
      "valid-check",
      "valid-optimize",
      "valid-organize",
      "malformed",
      "stale",
      "disconnect",
      "cancel",
      "late-event",
      "approval-replay",
    ])
    .optional(),
});
/** run 输入。 */
export type SkillStewardRunInput = z.infer<typeof SkillStewardRunInputSchema>;

/** run 输出：终态 + 提案清单（审批由后续 RPC 完成）。 */
export const SkillStewardRunResultSchema = z.object({
  snapshotId: StewardSnapshotIdSchema,
  /** DSH session 绑定（宿主可用且绑定成功时存在；展示面，durable 事实在 Manager audit）。 */
  dshSessionId: z.string().min(1).optional(),
  terminal: z.string().min(1),
  acceptedResponses: z.number().int().nonnegative(),
  droppedLateResponses: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  proposals: z.array(
    z.object({ proposalId: StewardProposalIdSchema, action: StewardPatchKindSchema }),
  ),
});
/** run 结果。 */
export type SkillStewardRunResult = z.infer<typeof SkillStewardRunResultSchema>;

/** validation 输出直接复用 SkillValidationResultSchema。 */
export const SkillStewardProposalInputSchema = z.object({
  proposalId: StewardProposalIdSchema,
});
/** 单 proposal 输入。 */
export type SkillStewardProposalInput = z.infer<typeof SkillStewardProposalInputSchema>;

/** 人类批准输出：grant 事实（脱敏：不含消费状态之外的内部细节）。 */
export const SkillStewardApproveResultSchema = z.object({
  grantId: StewardGrantIdSchema,
  fingerprint: ContentRevisionSchema,
  issuedAt: z.string().datetime(),
});
/** 批准结果。 */
export type SkillStewardApproveResult = z.infer<typeof SkillStewardApproveResultSchema>;

/** apply 输出：事务终态 + 审计。 */
export const SkillStewardApplyResultSchema = z.object({
  outcomeStatus: z.enum(["applied", "compensated", "recovery-required"]),
  failure: z.string().optional(),
  auditId: StewardAuditIdSchema,
  auditStatus: z.enum(["applied", "rolled-back", "recovery-required"]),
  mutations: z.array(StewardMutationRecordSchema),
});
/** apply 结果。 */
export type SkillStewardApplyResult = z.infer<typeof SkillStewardApplyResultSchema>;

/** rollback 准备输入/输出。 */
export const SkillStewardRollbackInputSchema = z.object({
  auditId: StewardAuditIdSchema,
});
/** rollback 输入。 */
export type SkillStewardRollbackInput = z.infer<typeof SkillStewardRollbackInputSchema>;

export const SkillStewardRollbackResultSchema = z.object({
  reverseProposalId: StewardProposalIdSchema.optional(),
  note: z.string().min(1),
});
/** rollback 准备结果。 */
export type SkillStewardRollbackResult = z.infer<typeof SkillStewardRollbackResultSchema>;
