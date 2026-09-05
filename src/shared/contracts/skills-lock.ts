/**
 * Vendored vercel-labs/skills lock-file Zod schemas (daemon 侧读写)。
 *
 * 用户原始需求 [2026-07-27]：「让 Skill Creator 主动对齐 skills-CLI：识别哪些技能是经它装的、标记可升级、并直接在 Skill Creator 里一键升级。」
 * 正交意图：
 *   [1] 表达全局锁 .skill-lock.json（schema v3）的结构。
 *   [2] 表达项目锁 skills-lock.json（schema v1）的结构。
 *   [3] 提供把不可信外部 JSON 降级为 `null` 的解析入口（绝不抛错、不迁移）。
 * 妥协声明：两份 schema 来自第三方且随时可能 schema drift；按 D1，所有读取一律 `safeParse`，失败降级为「无 provenance」，由调用方决定如何投影。
 */
import { z } from "zod";

/**
 * 全局锁单条记录（vercel-labs/skills `src/skill-lock.ts` schema v3）。
 * `skillFolderHash` 是 GitHub tree SHA；`sourceUrl` 用于升级时重新拉取。
 */
export const SkillLockEntrySchema = z.object({
  /** 规范化源标识（如 `owner/repo`、`mintlify/bun.com`）。 */
  source: z.string(),
  /** 源类型（`github`、`mintlify`、`huggingface`、`local` 等）。 */
  sourceType: z.string(),
  /** 安装时使用的原始 URL，升级时用于重新拉取。 */
  sourceUrl: z.string(),
  /** 安装时使用的分支或 tag ref。 */
  ref: z.string().optional(),
  /** 源仓库内的子路径（可选）。 */
  skillPath: z.string().optional(),
  /**
   * 技能整个目录的 GitHub tree SHA；任一文件变更即变化。
   * 由 telemetry server 通过 GitHub Trees API 取得。
   */
  skillFolderHash: z.string(),
  /** 首次安装的 ISO 时间戳。 */
  installedAt: z.string(),
  /** 最近一次更新的 ISO 时间戳。 */
  updatedAt: z.string(),
  /** 所属插件名（可选）。 */
  pluginName: z.string().optional(),
});
/** 全局锁单条记录。 */
export type SkillLockEntry = z.infer<typeof SkillLockEntrySchema>;

/** 全局锁中的「已忽略提示」集合，仅作投影用，daemon 不写。 */
const DismissedPromptsSchema = z.object({ findSkillsPrompt: z.boolean().optional() }).optional();

/**
 * 全局锁文件结构（schema v3）。
 * 位置：`$XDG_STATE_HOME/skills/.skill-lock.json` 或 `~/.agents/.skill-lock.json`。
 */
export const SkillLockFileSchema = z.object({
  /** schema 版本；当前固定为 3。 */
  version: z.literal(3),
  /** 技能名 → 记录的映射。 */
  skills: z.record(z.string(), SkillLockEntrySchema),
  /** 已忽略的提示集合（可选）。 */
  dismissed: DismissedPromptsSchema,
  /** 最近一次选中的 agents（可选）。 */
  lastSelectedAgents: z.array(z.string()).optional(),
});
/** 全局锁文件结构。 */
export type SkillLockFile = z.infer<typeof SkillLockFileSchema>;

/**
 * 项目锁单条记录（vercel-labs/skills `src/local-lock.ts` schema v1）。
 * `computedHash` 是 on-disk 文件 SHA-256，与全局锁的 tree SHA 不同。
 */
export const LocalSkillLockEntrySchema = z.object({
  /** 技能来源（npm 包名、owner/repo、本地路径等）。 */
  source: z.string(),
  /** 当 source 被规范化时，保留原始远端 URL（可选）。 */
  sourceUrl: z.string().optional(),
  /** 安装时使用的分支或 tag ref（可选）。 */
  ref: z.string().optional(),
  /** 源类型（`github`、`node_modules`、`local` 等）。 */
  sourceType: z.string(),
  /**
   * 源仓库内 SKILL.md 的路径（如 `skills/pdf/SKILL.md`）。
   * 升级时按它定向重装；非仓库源可缺省。
   */
  skillPath: z.string().optional(),
  /**
   * 由技能目录所有文件计算的 SHA-256。
   * 与全局锁的 GitHub tree SHA 不同。
   */
  computedHash: z.string(),
  /** Eve subagent 目标（可选），daemon 不消费。 */
  subagents: z.array(z.string()).optional(),
});
/** 项目锁单条记录。 */
export type LocalSkillLockEntry = z.infer<typeof LocalSkillLockEntrySchema>;

/**
 * 项目锁文件结构（schema v1）。
 * 位置：cwd 根下的 `skills-lock.json`，可纳入版本控制。
 */
export const LocalSkillLockFileSchema = z.object({
  /** schema 版本；当前固定为 1。 */
  version: z.literal(1),
  /** 技能名 → 记录的映射。 */
  skills: z.record(z.string(), LocalSkillLockEntrySchema),
});
/** 项目锁文件结构。 */
export type LocalSkillLockFile = z.infer<typeof LocalSkillLockFileSchema>;

/**
 * 把不可信外部值解析为全局锁；结构不兼容返回 `null`，绝不抛错。
 * 用于 daemon 侧读取 `.skill-lock.json`，调用方负责路径与降级投影。
 */
export function parseGlobalSkillLock(value: unknown): SkillLockFile | null {
  const parsed = SkillLockFileSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * 把不可信外部值解析为项目锁；结构不兼容返回 `null`，绝不抛错。
 * 用于 daemon 侧读取 `skills-lock.json`，调用方负责路径与降级投影。
 */
export function parseProjectSkillLock(value: unknown): LocalSkillLockFile | null {
  const parsed = LocalSkillLockFileSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
