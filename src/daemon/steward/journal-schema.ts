/**
 * Skill Steward journal 事实层：闭合 Zod union + 严格读取（Codex R7 P1-3/P1-4）。
 *
 * 用户原始需求 [2026-09-06]（transaction-contract.md）：「每步记账并持久化，再推进
 * 下一步」「补偿遇到外部修改或 I/O 错误时进入 recovery-required」。
 * Codex R7 复核（/tmp/stage1-contracts-review-round7.md）：「journal replay 仍可对
 * 部分、坏或未知内容假成功」「journal 中的相对路径字段可以穿越 Provider 根」。
 *
 * 正交意图：
 *   [1] journal 行的闭合 discriminated union：step/detail 逐字面量收窄，相对路径与
 *       目录名复用共享契约 schema（穿越在解析层即死，绝不进入回放）。
 *   [2] 严格读取：缺失/不可读/坏行/未知 step/seq 断裂一律 typed 错误；终态 commit
 *       行是回放闸——没有完整 journal 就没有 rolled-back。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  ContentRevisionSchema,
  RelPathSchema,
  type SkillProposal,
  type SkillStewardContextSnapshot,
} from "../../shared/contracts/skill-steward.js";
import { SkillIdSchema } from "../../shared/contracts/skills.js";
import { SkillDirectoryNameSchema } from "../../shared/contracts/creator.js";
import { DomainError } from "../domain-error.js";
import { assertCanonicalDirectory, verifyDirIdentity } from "./dir-identity.js";

/** Manager 生成的 move 备份文件名（`<seq>-<sha12>.bin`；manifest 与 journal 共用）。 */
export const BackupRefSchema = z.string().regex(/^\d+-[0-9a-f]{12}\.bin$/, {
  message: "Manager backup reference must match `<seq>-<sha12>.bin`.",
});

const Sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/);

/** move 步骤必须携带 Manager 生成的备份事实；非 move 步骤禁止携带。 */
const ResourceDetailSchema = z
  .strictObject({
    kind: z.literal("resource"),
    strategy: z.enum(["copy", "move", "reference"]),
    from: RelPathSchema,
    to: RelPathSchema,
    /** Codex R10 P1-2/P1-7：apply 时记录的落盘字节 sha256（回滚删除前逐项校验）。 */
    sha256: Sha256HexSchema,
    backupRef: BackupRefSchema.optional(),
    sourceSha256: Sha256HexSchema.optional(),
  })
  .superRefine((detail, ctx) => {
    if (detail.strategy === "move") {
      if (detail.backupRef === undefined || detail.sourceSha256 === undefined) {
        ctx.addIssue({
          code: "custom",
          message: "move journal step must carry manager backupRef + sourceSha256.",
        });
      }
      return;
    }
    if (detail.backupRef !== undefined || detail.sourceSha256 !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "non-move journal step must not carry backup facts.",
      });
    }
  });

/** journal 行闭合 union：未知 step / 未知字段在 safeParse 即失败。 */
export const JournalEntrySchema = z.discriminatedUnion("step", [
  z.strictObject({
    seq: z.number().int().positive(),
    step: z.literal("precheck"),
    detail: z.strictObject({
      kind: z.literal("precheck"),
      targets: z.array(SkillDirectoryNameSchema).min(1),
    }),
  }),
  z.strictObject({
    seq: z.number().int().positive(),
    step: z.literal("edit"),
    detail: z.strictObject({
      kind: z.literal("content"),
      skillId: SkillIdSchema,
      beforeRevision: ContentRevisionSchema,
    }),
  }),
  z.strictObject({
    seq: z.number().int().positive(),
    step: z.literal("disable"),
    detail: z.strictObject({
      kind: z.literal("enablement"),
      skillId: SkillIdSchema,
      /** Codex R10 P1-3：apply 捕获的启停前态——undo 只恢复捕获状态。 */
      wasDisabled: z.boolean(),
      revision: ContentRevisionSchema.optional(),
    }),
  }),
  z.strictObject({
    seq: z.number().int().positive(),
    step: z.literal("enable"),
    detail: z.strictObject({
      kind: z.literal("enablement"),
      skillId: SkillIdSchema,
      /** Codex R10 P1-3：apply 捕获的启停前态——undo 只恢复捕获状态。 */
      wasEnabled: z.boolean(),
      revision: ContentRevisionSchema.optional(),
    }),
  }),
  z.strictObject({
    seq: z.number().int().positive(),
    step: z.literal("create-target"),
    detail: z.strictObject({
      kind: z.literal("content"),
      directoryName: SkillDirectoryNameSchema,
      /** Codex R10 P1-2：创建后 SKILL.md 的 revision（sha256:…，回滚删除前校验）。 */
      revision: ContentRevisionSchema,
    }),
  }),
  z.strictObject({
    seq: z.number().int().positive(),
    step: z.literal("resource"),
    detail: ResourceDetailSchema,
  }),
  z.strictObject({
    seq: z.number().int().positive(),
    step: z.literal("commit"),
    detail: z.strictObject({
      kind: z.literal("commit"),
      /** 操作 ID（journal 文件名派生）；回放侧按与期望 operationId 全等比对。 */
      proposalId: z.string().min(1).max(200),
      status: z.literal("applied"),
      mutationCount: z.number().int().nonnegative(),
    }),
  }),
]);

/** journal 行（写入与回放共用同一事实形状）。 */
export type JournalEntry = z.infer<typeof JournalEntrySchema>;

/**
 * 读取 journal 文件为严格校验后的步骤列表。
 * 缺失 → NOT_FOUND；不可读/坏行/未知 step/字段不符/seq 断裂 → UNAVAILABLE；
 * 只有完整、连续、可解析的 journal 才允许进入回放（部分回放 = 假 rolled-back）。
 */
export async function readJournal(journalPath: string): Promise<JournalEntry[]> {
  // Codex R9 P1-4 / R10 P1-4：事实源读取先校验 journal 所在目录 canonical（parent
  // symlink 下的外部 JSONL 不是 Manager 事实），leaf 走 O_NOFOLLOW fd。
  const parentIdentity = await assertCanonicalDirectory(path.dirname(journalPath));
  let raw: string;
  let leafIdentity: { dev: number; ino: number };
  try {
    const handle = await fs.open(
      journalPath,
      fs.constants.O_RDONLY | (fs.constants as { O_NOFOLLOW?: number }).O_NOFOLLOW!,
    );
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) {
        throw new DomainError(
          "UNAVAILABLE",
          `Journal file is not a regular file; recovery required: ${journalPath}`,
        );
      }
      leafIdentity = { dev: stat.dev, ino: stat.ino };
      raw = await handle.readFile("utf8");
    } finally {
      await handle.close().catch(() => undefined);
    }
  } catch (error) {
    if (error instanceof DomainError) throw error;
    const code = (error as NodeJS.ErrnoException).code ?? "unknown";
    if (code === "ENOENT") {
      throw new DomainError("NOT_FOUND", `Journal file not found: ${journalPath}`);
    }
    throw new DomainError(
      "UNAVAILABLE",
      `Journal file unreadable (${code}); recovery required: ${journalPath}`,
    );
  }
  const after = await fs.lstat(journalPath).catch(() => null);
  if (
    after === null ||
    !after.isFile() ||
    after.dev !== leafIdentity.dev ||
    after.ino !== leafIdentity.ino
  ) {
    throw new DomainError(
      "UNAVAILABLE",
      `Journal leaf identity drifted after read; recovery required: ${journalPath}`,
    );
  }
  await verifyDirIdentity(path.dirname(journalPath), parentIdentity);
  const entries: JournalEntry[] = [];
  const lines = raw.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index]!.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new DomainError(
        "UNAVAILABLE",
        `Journal line ${index + 1} is corrupt (truncated or malformed); recovery required: ${journalPath}`,
      );
    }
    const checked = JournalEntrySchema.safeParse(parsed);
    if (!checked.success) {
      const reason = checked.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      throw new DomainError(
        "UNAVAILABLE",
        `Journal line ${index + 1} failed closed validation (${reason}); recovery required: ${journalPath}`,
      );
    }
    entries.push(checked.data);
  }
  for (let index = 0; index < entries.length; index += 1) {
    if (entries[index]!.seq !== index + 1) {
      throw new DomainError(
        "UNAVAILABLE",
        `Journal seq broken at line ${index + 1} (expected ${index + 1}, got ${entries[index]!.seq}; deleted or reordered lines); recovery required: ${journalPath}`,
      );
    }
  }
  return entries;
}

/**
 * Codex R9 P1-3：从 proposal（rollback 时经 grant fingerprint 校验的独立不可变事实）
 * 展开期望的 journal mutation 步骤集合——journal 内部自报的 mutationCount 不是
 * 完整性证明；删行后同步伪造计数会被「与 proposal 双射」拒绝。
 */
export function expectedJournalStepsOf(
  proposal: SkillProposal,
  snapshot?: SkillStewardContextSnapshot,
): {
  kinds: Map<string, number>;
  directoryNames: Set<string>;
  skillIds: Set<string>;
  resourceMappings: string[];
} {
  const kinds = new Map<string, number>();
  const directoryNames = new Set<string>();
  const skillIds = new Set<string>();
  const resourceMappings: string[] = [];
  const bump = (kind: string, n = 1) => kinds.set(kind, (kinds.get(kind) ?? 0) + n);
  const patch = proposal.patch;
  if (patch.kind === "edit") {
    bump("edit", patch.edits.length);
    for (const edit of patch.edits) skillIds.add(edit.skillId);
  } else if (patch.kind === "disable" || patch.kind === "enable") {
    bump(patch.kind, patch.selections.length);
    for (const selection of patch.selections) skillIds.add(selection.skillId);
  } else {
    bump("precheck");
    const targets = patch.kind === "split" ? patch.targets : [patch.target];
    bump("create-target", targets.length);
    const directoryOf = new Map<string, string>();
    if (snapshot) {
      for (const skill of snapshot.skills) directoryOf.set(skill.skillId, skill.directoryName);
    }
    for (const target of targets) {
      directoryNames.add(target.directoryName);
      bump("resource", target.resources.length);
      for (const mapping of target.resources) {
        const fromDir = directoryOf.get(mapping.sourceSkillId) ?? "?";
        resourceMappings.push(
          `${fromDir}/${mapping.sourcePath}|${target.directoryName}/${mapping.targetPath}|${mapping.strategy}`,
        );
      }
    }
    const sources = patch.kind === "split" ? [patch.source] : patch.sources;
    bump("disable", sources.length);
    for (const source of sources) skillIds.add(source.skillId);
  }
  resourceMappings.sort();
  return { kinds, directoryNames, skillIds, resourceMappings };
}

/**
 * 回放闸：journal 必须以本 proposal 的 commit 终态行收尾。崩溃/截断/被删行的
 * journal 一律不得回放——没有完整 journal 就没有 rolled-back（Codex R7 P1-3）。
 * Codex R8 独立探针整改：commit 行必须恰好一条且为末行——重复 commit 记录
 * （伪造终态）与中途插入的 commit 一律拒绝。
 * Codex R9 P1-3：commit 携带 proposal；mutation 步骤集合必须与 proposal 展开的
 * 期望集合双射（kind 计数 + create-target 目录名 + mutation skillIds）。
 */
export function assertCommittedJournal(
  entries: JournalEntry[],
  expected: { proposalId: string; proposal: SkillProposal; snapshot: SkillStewardContextSnapshot },
): void {
  const commits = entries.filter((entry) => entry.step === "commit");
  const last = entries.at(-1);
  if (commits.length !== 1 || !last || last.step !== "commit") {
    throw new DomainError(
      "INVALID_OPERATION",
      `Journal must end with exactly one terminal commit record (found ${commits.length}, last step ${last?.step ?? "none"}); recovery required (expected proposal ${expected.proposalId}).`,
    );
  }
  if (last.detail.proposalId !== expected.proposalId) {
    throw new DomainError(
      "CONFLICT",
      `Journal commit record belongs to proposal ${last.detail.proposalId}, expected ${expected.proposalId}; recovery required.`,
    );
  }
  // Codex R8 P1-4：commit 的 mutationCount 必须等于 journal 中的 mutation 步骤数——
  // 删除任一 mutation 行后重编号（seq 仍连续）会让计数失配，终态闸拒绝假 rolled-back。
  const mutationSteps = entries.filter(
    (entry) =>
      entry.step === "edit" ||
      entry.step === "disable" ||
      entry.step === "enable" ||
      entry.step === "create-target" ||
      entry.step === "resource",
  ).length;
  if (last.detail.mutationCount !== mutationSteps) {
    throw new DomainError(
      "INVALID_OPERATION",
      `Journal commit mutationCount ${last.detail.mutationCount} does not match the ${mutationSteps} mutation steps on disk (deleted or forged lines); recovery required.`,
    );
  }
  // Codex R9 P1-3：与 proposal 展开的期望步骤双射——journal 是自报事实，proposal
  // 才是独立不可变锚（grant fingerprint 在 rollback 前已复核）。
  const expectedSteps = expectedJournalStepsOf(expected.proposal, expected.snapshot);
  const observedKinds = new Map<string, number>();
  const observedDirs = new Set<string>();
  const observedSkillIds = new Set<string>();
  for (const entry of entries) {
    if (entry.step === "commit" || entry.step === "precheck") {
      if (entry.step === "precheck") {
        observedKinds.set("precheck", (observedKinds.get("precheck") ?? 0) + 1);
      }
      continue;
    }
    observedKinds.set(entry.step, (observedKinds.get(entry.step) ?? 0) + 1);
    if (entry.step === "create-target") observedDirs.add(entry.detail.directoryName);
    if (entry.step === "edit" || entry.step === "disable" || entry.step === "enable") {
      observedSkillIds.add(entry.detail.skillId);
    }
  }
  const kindsMatch =
    observedKinds.size === expectedSteps.kinds.size &&
    [...expectedSteps.kinds.entries()].every(
      ([kind, count]) => observedKinds.get(kind) === count,
    ) &&
    [...observedKinds.entries()].every(([kind, count]) => expectedSteps.kinds.get(kind) === count);
  if (!kindsMatch) {
    throw new DomainError(
      "INVALID_OPERATION",
      `Journal step kinds do not match the proposal expansion (expected ${JSON.stringify([...expectedSteps.kinds])}, observed ${JSON.stringify([...observedKinds])}); deleted, forged, or substituted lines; recovery required.`,
    );
  }
  const dirMismatch =
    observedDirs.size !== expectedSteps.directoryNames.size ||
    [...expectedSteps.directoryNames].some((name) => !observedDirs.has(name));
  if (dirMismatch) {
    throw new DomainError(
      "INVALID_OPERATION",
      `Journal create-target directories do not match the proposal targets; recovery required.`,
    );
  }
  const skillMismatch =
    observedSkillIds.size !== expectedSteps.skillIds.size ||
    [...expectedSteps.skillIds].some((id) => !observedSkillIds.has(id));
  if (skillMismatch) {
    throw new DomainError(
      "INVALID_OPERATION",
      `Journal mutation skillIds do not match the proposal affected set; recovery required.`,
    );
  }
  // Codex R11/R12 P1-1：每条 resource mapping 的 from/to/strategy 与 proposal+snapshot
  // 展开结果精确双射（多重集合）——同集合内的路径交换/策略替换在此拒绝。
  {
    const observedMappings = entries
      .filter((entry) => entry.step === "resource")
      .map((entry) =>
        entry.step === "resource"
          ? `${entry.detail.from}|${entry.detail.to}|${entry.detail.strategy}`
          : "",
      )
      .sort();
    const wanted = expectedSteps.resourceMappings;
    const same =
      observedMappings.length === wanted.length &&
      observedMappings.every((value, index) => value === wanted[index]);
    if (!same) {
      throw new DomainError(
        "INVALID_OPERATION",
        `Journal resource mappings do not match the proposal expansion (from/to/strategy tampering); recovery required.`,
      );
    }
  }
}
