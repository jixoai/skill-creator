/**
 * 用户原始需求 [2026-09-30]（self-skill-symlink）：「如果发现 ~/.agents/skills/
 * skill-creator-v2 的源头不是 git/npm……只能在 cli 或者 webui 启动之后提醒用户，
 * 存在 skill 冲突。给它几个选择：覆盖安装我们自己的版本（可选备份）；坚持使用
 * 用户自己已有的版本。」
 *
 * 正交意图：
 *   [1] selfSkill.state/resolve/keep 三过程的 browser-safe 输入输出契约。
 *   [2] 冲突条目的运行时形状（kind 判别 + 备份可用性由 kind 推导）。
 */
import { z } from "zod";

/** 冲突条目种类（与 daemon SelfSkillConflict.kind 同值域）。 */
export const SelfSkillConflictKindSchema = z.enum([
  "user-directory",
  "foreign-link",
  "foreign-entry",
]);

/** 冲突条目投影。 */
export const SelfSkillConflictSchema = z.object({
  kind: SelfSkillConflictKindSchema,
  entryPath: z.string(),
  targetPath: z.string().optional(),
  /** 真目录才有可备份的内容；foreign-link/foreign-entry 的用户内容在别处。 */
  backupAvailable: z.boolean(),
});
export type SelfSkillConflictView = z.infer<typeof SelfSkillConflictSchema>;

/** 自举技能状态面（inspect 透传 + kept 折叠；transient 态在 daemon ensure 后罕见）。 */
export const SelfSkillStatusSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("linked"),
    linkPath: z.string(),
    sourcePath: z.string(),
    viaGit: z.boolean(),
  }),
  z.object({ state: z.literal("missing") }),
  z.object({ state: z.literal("stale-link") }),
  z.object({ state: z.literal("dangling") }),
  z.object({ state: z.literal("legacy-copy") }),
  z.object({ state: z.literal("conflict"), conflict: SelfSkillConflictSchema }),
  z.object({ state: z.literal("kept"), conflict: SelfSkillConflictSchema }),
  z.object({ state: z.literal("failed"), reason: z.string() }),
]);
export type SelfSkillStatus = z.infer<typeof SelfSkillStatusSchema>;

/** resolve 输入。 */
export const SelfSkillResolveInputSchema = z
  .object({
    /** 仅 user-directory 冲突有意义：先把用户目录移入 skills-backup。 */
    backup: z.boolean(),
  })
  .strict();

/** resolve 输出（typed 失败；不走 RpcError 词表）。 */
export const SelfSkillResolveResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), backupPath: z.string().optional() }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);

/** keep 输出。 */
export const SelfSkillKeepResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);
