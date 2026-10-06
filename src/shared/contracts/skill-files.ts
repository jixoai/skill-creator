/**
 * 用户原始需求 [2026-10-06]（skills-tabs-redesign 批 3，design.md Δ2 定稿）：
 * 「skills.files / skills.fileRead 有界文件树与内容读；每次调用重解析（不信任
 * 先前列表）；lstat 拒文档 symlink + O_NOFOLLOW + fstat 身份校验；预算 4 深/
 * 300 项/树 64KB/单文件 256KiB 超限截断；二进制 typed 拒读；conflict 双文件
 * 展示；typed errors 客户端不解析字符串」。
 * 正交意图：
 *   [1] 文件树条目与输出契约（排序/预算/symlink 省略/conflict 双文件语义）。
 *   [2] 文件读结果契约（有界 UTF-8 内容 + 全量尺寸 + typed 内容截断标志）。
 * 妥协声明：TOO_LARGE（树预算截断）与 TRUNCATED（内容截断）是带内 typed
 * 字段而非可抛错误（截断内容照常返回），故不进 RpcErrorCodeSchema 闭集；
 * INVALID_PATH/BINARY 两码已扩入（contracts/errors.ts）。
 */
import { z } from "zod";

/**
 * 文件树条目。`path` 是 `/` 分隔的相对路径（目录条目无尾斜杠）；排序在服务端
 * 冻结：目录优先、组内字典序（前序 DFS 展平，父目录先于子条目）；`size` 是
 * 文件字节数（目录恒 0）。symlink 分量（子目录/文件级）与 broken link 按三层
 * 策略从树中省略（顶层技能目录 symlink 已在发现层跟进一次，不在本树表达）。
 */
export const SkillFileEntrySchema = z.strictObject({
  path: z.string().min(1),
  kind: z.enum(["file", "dir"]),
  size: z.number().int().nonnegative(),
  /**
   * conflict 双身份文件标记：SKILL.md 与 .SKILL.md 并存时，非激活份携带
   * `disabled:true`（激活份由技能启停态决定）；两份都展示，不静默择一。
   */
  disabled: z.literal(true).optional(),
});
/** 文件树条目。 */
export type SkillFileEntry = z.infer<typeof SkillFileEntrySchema>;

/**
 * skills.files 输出：有界文件树（遍历 ≤4 深、≤300 entries、响应 ≤64KB）。
 * `truncationReason` 是 typed 截断原因（当前仅 TOO_LARGE：条目数或响应字节
 * 预算截断枚举），独立于 fileRead 的内容截断标志——两量纲不混用（Codex 评审
 * Δ2：枚举截断原因和内容截断原因不要混成一个 truncated）。
 */
export const SkillFilesResultSchema = z.strictObject({
  entries: z.array(SkillFileEntrySchema),
  truncationReason: z.enum(["TOO_LARGE"]).optional(),
});
/** skills.files 输出。 */
export type SkillFilesResult = z.infer<typeof SkillFilesResultSchema>;

/**
 * skills.fileRead 输出：UTF-8 文本内容（≤256KiB 字节有界读取；二进制在
 * 有界读取内检测并 typed 拒读）。`size` 是磁盘全量字节数（fstat 真相），
 * `truncated:true` 表示内容被 256KiB 预算截断（返回前 256KiB，不拒读）。
 */
export const SkillFileReadResultSchema = z.strictObject({
  content: z.string(),
  size: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
/** skills.fileRead 输出。 */
export type SkillFileReadResult = z.infer<typeof SkillFileReadResultSchema>;
