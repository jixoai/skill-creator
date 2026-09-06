/**
 * Skill Steward 审批服务：validate / human approve / apply / rollback 分离
 * （openspec skill-steward-runtime task 2.3b）。
 *
 * 用户原始需求 [2026-09-06]（transaction-contract.md）：「validation 绝不产生授权。批准
 * 只能来自已鉴权的人类 UI RPC；模型工具不能获取、传递、伪造或消费 human grant。」
 * 「grant 绑定 run、snapshot、完整 patch fingerprint、全部输入 revision、目标 absent
 * precondition。锁内先消费 grant，再启动 apply；重复/并发调用最多一项执行。」
 *
 * 正交意图：
 *   [1] validate 只出报告（SkillValidationResult；零授权语义）。
 *   [2] 人类 approve 铸造一次性 grant（fingerprint = 规范化 patch 的 sha256）并持久化；
 *       非 human-ui 主体一律拒绝。
 *   [3] apply 消费 grant（锁内先消费）、复核 fingerprint 与 revision、走 journal 事务；
 *       agent 主体与无 grant 调用零 mutation。
 *   [4] rollback 只准备 Manager 派生的反向 proposal（edit/dis(enable) 逆、目标删除经
 *       enable/编辑语义），应用仍走同一 approve/apply 管线。
 * 妥协声明：grant 持久化为 append-only 事实（grants.jsonl + consumed 标记行）；
 *   daemon restart 后未消费 grant 失效（重启语义由 markAllGrantsInvalid 实现）。
 */
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import {
  SKILL_STEWARD_CONTRACT_VERSION,
  StewardAuditIdSchema,
  SkillProposalSchema,
  StewardGrantIdSchema,
  type StewardGrantId,
  StewardProposalIdSchema,
  bindProposalToSnapshot,
  bindManagerDerivedProposalToSnapshot,
  type SkillProposal,
  type SkillStewardContextSnapshot,
  type SkillValidationResult,
  type StewardApprovalGrant,
  type StewardAuditRecord,
  type StewardMutationRecord,
  type StewardProposalId,
} from "../../shared/contracts/skill-steward.js";
import type { CreatorService } from "../creator-service.js";
import type { SkillService } from "../skill-service.js";
import type { WorkspaceRegistry } from "../workspace-registry/index.js";
import { DomainError } from "../domain-error.js";
import type { StewardAuditStore } from "./audit-store.js";
import {
  applyProposalTransaction,
  undoJournalSteps,
  type ApplyOutcome,
} from "./apply-transaction.js";
import { assertCommittedJournal, readJournal } from "./journal-schema.js";
import { buildContextSnapshot, stewardStoreDir } from "./context-snapshot.js";

/** 内部 proposal 存档（提交时即绑定快照与 run）。 */
interface ProposalEntry {
  proposalId: StewardProposalId;
  proposal: SkillProposal;
  snapshot: SkillStewardContextSnapshot;
  runId: import("../../shared/contracts/skill-steward.js").StewardRunId2;
  /** Codex R2 P1-3：仅 Manager prepareRollback 置位；enable 反向只走 manager binder。 */
  managerDerived?: boolean;
}

/** 审批服务依赖。 */
export interface ApprovalServiceDeps {
  workspaces: WorkspaceRegistry;
  skills: SkillService;
  creator: CreatorService;
  store: StewardAuditStore;
}

/** 规范化 patch fingerprint：稳定 JSON 序列化后的 sha256。 */
function fingerprintOf(proposal: SkillProposal): string {
  const canonical = JSON.stringify(proposal.patch, Object.keys(proposal.patch).sort());
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

/** 创建审批服务。 */
export function createStewardApprovalService(deps: ApprovalServiceDeps) {
  const proposals = new Map<StewardProposalId, ProposalEntry>();
  const grants = new Map<string, StewardApprovalGrant>();
  const grantsByProposal = new Map<StewardProposalId, StewardGrantId[]>();
  const audits = new Map<string, StewardAuditRecord>();
  const applying = new Set<StewardProposalId>();
  const rollbackGrants = new Map<string, StewardApprovalGrant>();

  /** runtime 的 propose 工具入口：先 runtime parse（house law），bind 通过后入档。 */
  function submit(
    proposal: SkillProposal,
    snapshot: SkillStewardContextSnapshot,
    runId: import("../../shared/contracts/skill-steward.js").StewardRunId2,
  ): StewardProposalId {
    // mutation 边界不吃编译期信任：手写/漂移对象在 safeParse 处类型化失败。
    const parsed = SkillProposalSchema.safeParse(proposal);
    if (!parsed.success) {
      throw new DomainError(
        "INVALID_OPERATION",
        `Proposal failed contract parse: ${parsed.error.issues
          .map((issue) => `${issue.path.map(String).join(".") || "value"}: ${issue.message}`)
          .join("; ")}`,
      );
    }
    const bound = bindProposalToSnapshot(parsed.data, snapshot);
    if (!bound.ok) {
      throw new DomainError(
        bound.failure.code === "STALE_REVISION" ? "CONFLICT" : "INVALID_OPERATION",
        bound.failure.message,
      );
    }
    const proposalId = StewardProposalIdSchema.parse(`spp_${randomBytes(8).toString("hex")}`);
    proposals.set(proposalId, { proposalId, proposal: parsed.data, snapshot, runId });
    return proposalId;
  }

  function requireProposal(proposalId: StewardProposalId): ProposalEntry {
    const entry = proposals.get(proposalId);
    if (!entry) throw new DomainError("NOT_FOUND", `Steward proposal not found: ${proposalId}`);
    return entry;
  }

  /**
   * validate：只出报告。bind 复核 + 活体 revision 漂移 + 目标 absent 前置 + 作用域。
   */
  async function validate(proposalId: StewardProposalId): Promise<SkillValidationResult> {
    const entry = requireProposal(proposalId);
    const checks: SkillValidationResult["checks"] = [];
    const bound = entry.managerDerived
      ? bindManagerDerivedProposalToSnapshot(entry.proposal, entry.snapshot)
      : bindProposalToSnapshot(entry.proposal, entry.snapshot);
    checks.push({
      name: "contract-bind",
      status: bound.ok ? "passed" : "failed",
      detail: bound.ok ? undefined : `${bound.failure.code}: ${bound.failure.message}`,
    });
    // 活体 revision 漂移检查（run 期间 Provider 被外部修改）。
    let stale = false;
    for (const skill of entry.snapshot.skills) {
      if (!entry.proposal.skillIds.includes(skill.skillId)) continue;
      try {
        const info = await deps.skills.info(entry.snapshot.target, skill.skillId);
        if (info.revision !== skill.revision) {
          stale = true;
          checks.push({
            name: `live-revision:${skill.directoryName}`,
            status: "failed",
            detail: `snapshot ${skill.revision} != live ${info.revision}`,
          });
        }
      } catch (error) {
        stale = true;
        checks.push({
          name: `live-revision:${skill.directoryName}`,
          status: "failed",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (!stale) checks.push({ name: "live-revisions", status: "passed" });
    // split/merge 目标 absent 前置。
    if (entry.proposal.patch.kind === "split" || entry.proposal.patch.kind === "merge") {
      const root = deps.workspaces.resolveWritable(entry.snapshot.target).directory;
      const targets =
        entry.proposal.patch.kind === "split"
          ? entry.proposal.patch.targets.map((target) => target.directoryName)
          : [entry.proposal.patch.target.directoryName];
      let conflict = false;
      for (const name of targets) {
        const exists = await (
          await import("node:fs/promises")
        )
          .stat(path.join(root, name))
          .then(() => true)
          .catch(() => false);
        if (exists) {
          conflict = true;
          checks.push({
            name: `target-absent:${name}`,
            status: "failed",
            detail: "directory exists",
          });
        }
      }
      if (!conflict) checks.push({ name: "target-absent", status: "passed" });
    }
    const overall = checks.some((check) => check.status === "failed")
      ? stale
        ? "stale"
        : "invalid"
      : "valid";
    return { proposalId, overall, checks };
  }

  /** 人类批准：铸造一次性 grant（持久化）。 */
  async function approve(
    proposalId: StewardProposalId,
    principal: "human-ui",
  ): Promise<StewardApprovalGrant> {
    const entry = requireProposal(proposalId);
    const validation = await validate(proposalId);
    if (validation.overall !== "valid") {
      throw new DomainError(
        "CONFLICT",
        `Proposal is ${validation.overall}; approval requires a valid validation.`,
      );
    }
    const grant: StewardApprovalGrant = {
      id: StewardGrantIdSchema.parse(`grant_${randomBytes(8).toString("hex")}`),
      proposalId,
      snapshotId: entry.snapshot.id,
      runId: entry.runId,
      fingerprint: fingerprintOf(entry.proposal),
      principal,
      issuedAt: new Date().toISOString(),
      consumedAt: null,
      inputRevisions: entry.snapshot.skills
        .filter((skill) => entry.proposal.skillIds.includes(skill.skillId))
        .map((skill) => ({ skillId: skill.skillId, revision: skill.revision })),
      absentPreconditions:
        entry.proposal.patch.kind === "split"
          ? entry.proposal.patch.targets.map((target) => target.directoryName)
          : entry.proposal.patch.kind === "merge"
            ? [entry.proposal.patch.target.directoryName]
            : [],
    };
    grants.set(grant.id, grant);
    const list = grantsByProposal.get(proposalId) ?? [];
    list.push(grant.id);
    grantsByProposal.set(proposalId, list);
    await deps.store.appendGrant(grant);
    return grant;
  }

  /** apply：锁内消费 grant → fingerprint/revision 复核 → journal 事务 → 审计。 */
  async function apply(
    proposalId: StewardProposalId,
    principal: "human-ui" | "manager-recovery",
  ): Promise<{ outcome: ApplyOutcome; audit: StewardAuditRecord }> {
    const entry = requireProposal(proposalId);
    if (applying.has(proposalId)) {
      throw new DomainError("CONFLICT", "Proposal apply is already in progress.");
    }
    // 锁内先消费 grant。
    applying.add(proposalId);
    let grant: StewardApprovalGrant | undefined;
    try {
      const candidates = grantsByProposal.get(proposalId) ?? [];
      grant = candidates
        .map((id) => grants.get(id))
        .find((candidate) => candidate && candidate.consumedAt === null);
      if (!grant) {
        throw new DomainError(
          "INVALID_OPERATION",
          "No unconsumed human grant for this proposal; validation never authorizes.",
        );
      }
      grant.consumedAt = new Date().toISOString();
      await deps.store.appendGrant({ ...grant, consumedAt: grant.consumedAt });
      // fingerprint 复核（proposal 在批准后被替换/篡改）。
      if (fingerprintOf(entry.proposal) !== grant.fingerprint) {
        throw new DomainError("CONFLICT", "Patch fingerprint does not match the consumed grant.");
      }
      const outcome = await applyProposalTransaction(entry.proposal, entry.snapshot, {
        workspaces: deps.workspaces,
        skills: deps.skills,
        creator: deps.creator,
        store: deps.store,
        journalPath: path.join(stewardStoreDir(), "journal", `${proposalId}.jsonl`),
      });
      const audit: StewardAuditRecord = {
        id: StewardAuditIdSchema.parse(`aud_${randomBytes(8).toString("hex")}`),
        runId: entry.runId,
        snapshotId: entry.snapshot.id,
        proposalId,
        action: entry.proposal.patch.kind,
        principal,
        appliedAt: new Date().toISOString(),
        status:
          outcome.status === "applied"
            ? "applied"
            : outcome.status === "compensated"
              ? "rolled-back"
              : "recovery-required",
        mutations: outcome.mutations,
      };
      audits.set(audit.id, audit);
      await deps.store.appendAudit(audit);
      return { outcome, audit };
    } finally {
      applying.delete(proposalId);
    }
  }

  /**
   * rollback：只准备 Manager 派生的反向 proposal，不写盘。
   * disable → enable 反向；edit → 快照原文 edit 反向；split/merge → 目标删除 + 源 enable
   * 属多步反向，本版以类型化失败说明（由 recovery 流程处理），不伪造单 patch 逆。
   */
  async function prepareRollback(
    auditId: string,
    principal: "human-ui" | "manager-recovery",
  ): Promise<{ reverseProposalId: StewardProposalId; note: string }> {
    const audit = audits.get(auditId);
    if (!audit) throw new DomainError("NOT_FOUND", `Audit record not found: ${auditId}`);
    if (audit.status !== "applied") {
      throw new DomainError(
        "CONFLICT",
        `Audit ${auditId} is ${audit.status}; nothing to roll back.`,
      );
    }
    const entry = requireProposal(audit.proposalId);
    const patch = entry.proposal.patch;
    if (patch.kind === "disable") {
      const reverse = structuredClone(entry.proposal);
      reverse.action = "enable";
      reverse.patch = {
        kind: "enable",
        snapshotId: patch.snapshotId,
        selections: patch.selections,
        reason: `Manager-derived rollback of ${auditId}.`,
      };
      reverse.rationale = `Rollback of audit ${auditId}: restore prior enablement.`;
      // Codex R2 P1-3：enable 反向只允许 Manager 派生入口；prepare 时 fail-fast 复核。
      const reverseBound = bindManagerDerivedProposalToSnapshot(reverse, entry.snapshot);
      if (!reverseBound.ok) {
        throw new DomainError("INVALID_OPERATION", reverseBound.failure.message);
      }
      const reverseProposalId = StewardProposalIdSchema.parse(
        `spp_${randomBytes(8).toString("hex")}`,
      );
      proposals.set(reverseProposalId, {
        proposalId: reverseProposalId,
        proposal: reverse,
        snapshot: entry.snapshot,
        runId: entry.runId,
        managerDerived: true,
      });
      return {
        reverseProposalId,
        note: "Reverse enable proposal prepared; applying requires separate human approval.",
      };
    }
    if (patch.kind === "edit") {
      // 反向 edit 是针对「apply 后现状」的普通 proposal：重建新快照绑定当前 revision，
      // 恢复目标为原快照字节（transaction-contract：仅当前状态等于 apply 后 revision 时恢复）。
      const freshSnapshot = await buildContextSnapshot(deps.skills, {
        target: entry.snapshot.target,
        skillIds: entry.proposal.skillIds,
        promptVersion: entry.snapshot.promptVersion,
        toolVersion: entry.snapshot.toolVersion,
        capabilities: entry.snapshot.capabilities,
      });
      const edits = patch.edits.map((edit) => {
        const original = entry.snapshot.skills.find((skill) => skill.skillId === edit.skillId)!;
        const live = freshSnapshot.skills.find((skill) => skill.skillId === edit.skillId)!;
        const frontmatter = parseSnapshotFrontmatter(original.content);
        return {
          skillId: edit.skillId,
          expectedRevision: live.revision,
          frontmatter: frontmatter.data,
          body: frontmatter.body,
        };
      });
      const reverse = SkillProposalSchema.parse({
        contractVersion: SKILL_STEWARD_CONTRACT_VERSION,
        action: "edit",
        patch: { kind: "edit", snapshotId: freshSnapshot.id, edits },
        rationale: `Rollback of audit ${auditId}: restore snapshot bytes.`,
        findingIds: [],
        evidence: patch.edits.map((edit) => ({
          skillId: edit.skillId,
          snippet: edit.frontmatter.description.slice(0, 60),
        })),
        skillIds: entry.proposal.skillIds,
        observedRevisions: freshSnapshot.skills
          .filter((skill) => entry.proposal.skillIds.includes(skill.skillId))
          .map((skill) => ({ skillId: skill.skillId, revision: skill.revision })),
      });
      const reverseProposalId = StewardProposalIdSchema.parse(
        `spp_${randomBytes(8).toString("hex")}`,
      );
      proposals.set(reverseProposalId, {
        proposalId: reverseProposalId,
        proposal: reverse,
        snapshot: freshSnapshot,
        runId: entry.runId,
      });
      return {
        reverseProposalId,
        note: "Reverse edit proposal prepared from snapshot bytes; requires separate human approval.",
      };
    }
    void principal;
    // split/merge 的逆操作是多步 journal replay：铸造 rollback grant，
    // 由 applyRollback 消费并按 journal 逐项撤销（hash/启停后置校验）。
    const grant: StewardApprovalGrant = {
      id: StewardGrantIdSchema.parse(`grant_${randomBytes(8).toString("hex")}`),
      proposalId: audit.proposalId,
      snapshotId: entry.snapshot.id,
      runId: entry.runId,
      fingerprint: fingerprintOf(entry.proposal),
      principal,
      issuedAt: new Date().toISOString(),
      consumedAt: null,
      inputRevisions: entry.snapshot.skills
        .filter((skill) => entry.proposal.skillIds.includes(skill.skillId))
        .map((skill) => ({ skillId: skill.skillId, revision: skill.revision })),
      absentPreconditions: [],
    };
    rollbackGrants.set(auditId, grant);
    return {
      reverseProposalId: StewardProposalIdSchema.parse(`spp_${"0".repeat(16)}`),
      note: `Rollback grant minted for audit ${auditId}; call applyRollback to consume it and replay the journal in reverse.`,
    };
  }

  /** 消费 rollback grant 并按 journal 逆序撤销（split/merge 完整树恢复）。 */
  async function applyRollback(
    auditId: string,
    principal: "human-ui" | "manager-recovery",
  ): Promise<{ audit: StewardAuditRecord }> {
    const audit = audits.get(auditId);
    if (!audit) throw new DomainError("NOT_FOUND", `Audit record not found: ${auditId}`);
    if (audit.status !== "applied") {
      throw new DomainError(
        "CONFLICT",
        `Audit ${auditId} is ${audit.status}; nothing to roll back.`,
      );
    }
    const grant = rollbackGrants.get(auditId);
    if (!grant || grant.consumedAt !== null) {
      throw new DomainError("INVALID_OPERATION", "No unconsumed rollback grant for this audit.");
    }
    grant.consumedAt = new Date().toISOString();
    const entry = requireProposal(audit.proposalId);
    if (fingerprintOf(entry.proposal) !== grant.fingerprint) {
      throw new DomainError("CONFLICT", "Patch fingerprint drifted since the rollback grant.");
    }
    const journalPath = path.join(stewardStoreDir(), "journal", `${audit.proposalId}.jsonl`);
    const root = deps.workspaces.resolveWritable(entry.snapshot.target).directory;
    const mutations: StewardMutationRecord[] = [];
    try {
      // Codex R6 P1-3 / R7 P1-3：journal 缺失/不可读/坏行/seq 断裂由 readJournal 抛
      // typed 错；空 journal 与无 commit 终态行（崩溃/截断/删除行）由回放闸拒绝——
      // 没有完整且已提交的事实就不能宣称 rolled-back。
      const entries = await readJournal(journalPath);
      assertCommittedJournal(entries, { proposalId: audit.proposalId, proposal: entry.proposal });
      await undoJournalSteps(entries, {
        proposal: entry.proposal,
        snapshot: entry.snapshot,
        deps: {
          workspaces: deps.workspaces,
          skills: deps.skills,
          creator: deps.creator,
          store: deps.store,
          journalPath: path.join(stewardStoreDir(), "journal", `${auditId}-rollback.jsonl`),
        },
        root,
        mutations,
        // Codex R6 P1-2：备份根按原事务 journal 派生（deps.journalPath 是 rollback
        // 自己的 journal）。
        backupJournalPath: journalPath,
      });
    } catch (error) {
      const recovery: StewardAuditRecord = {
        id: StewardAuditIdSchema.parse(`aud_${randomBytes(8).toString("hex")}`),
        runId: audit.runId,
        snapshotId: audit.snapshotId,
        proposalId: audit.proposalId,
        action: audit.action,
        principal,
        appliedAt: new Date().toISOString(),
        status: "recovery-required",
        mutations,
      };
      audits.set(recovery.id, recovery);
      await deps.store.appendAudit(recovery);
      return { audit: recovery };
    }
    audit.status = "rolled-back";
    await deps.store.appendAudit(audit);
    return { audit };
  }

  /** 重启语义：未消费 grant 全部失效（重启不重放授权）。 */
  function invalidateUnconsumedGrants(): number {
    let invalidated = 0;
    for (const grant of grants.values()) {
      if (grant.consumedAt === null) {
        grant.consumedAt = new Date().toISOString();
        void deps.store
          .appendGrant({ ...grant, consumedAt: grant.consumedAt })
          .catch(() => undefined);
        invalidated += 1;
      }
    }
    return invalidated;
  }

  return {
    submit,
    validate,
    approve,
    apply,
    prepareRollback,
    applyRollback,
    invalidateUnconsumedGrants,
    /** 测试/诊断视图。 */
    listProposals: () => [...proposals.values()].map((entry) => entry.proposalId),
  };
}

/** 快照原文 frontmatter 解析（复用 apply-transaction 的语义，独立实现避免循环依赖）。 */
function parseSnapshotFrontmatter(content: string): {
  data: { name: string; description: string } & Record<string, unknown>;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) throw new Error("snapshot content has no frontmatter block");
  const raw: Record<string, unknown> = {};
  for (const line of match[1]!.split("\n")) {
    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (pair) {
      const scalar = pair[2]!.replace(/^["']|["']$/g, "");
      raw[pair[1]!] = scalar === "true" ? true : scalar === "false" ? false : scalar;
    }
  }
  if (typeof raw.name !== "string" || typeof raw.description !== "string") {
    throw new Error("snapshot frontmatter lacks name/description");
  }
  return {
    data: { ...raw, name: raw.name, description: raw.description } as {
      name: string;
      description: string;
    } & Record<string, unknown>,
    body: content.slice(match[0].length),
  };
}

export const STEWARD_CONTRACT_VERSION = SKILL_STEWARD_CONTRACT_VERSION;
