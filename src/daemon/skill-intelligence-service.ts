/**
 * 用户原始需求 [2026-09-06]（openspec skill-intelligence）：
 * 「所有优化只产生 Manager-owned draft/patch，必须经过 validation、revision check 和显式 approval。」
 * 正交意图：
 *   [1] analyze：读取选定技能并锁定 revision，产出只读报告（不写任何状态）。
 *   [2] propose/list/reject：daemon 内存草稿库（有界），不触碰 Provider。
 *   [3] approve：把草稿路由回 creator.save / skills.toggle / creator.remove，
 *       全部复用既有 revision 与路径安全边界，逐项 typed 结果。
 */
import { randomBytes } from "node:crypto";
import type {
  AnalyzeFailure,
  AnalyzeInput,
  ApproveResult,
  Finding,
  FindingId,
  IntelligenceReport,
  ProposalDraft,
  ProposalId,
} from "../shared/contracts/skill-intelligence.js";
import {
  FindingIdSchema,
  IntelligenceReportSchema,
  ProposalIdSchema,
} from "../shared/contracts/skill-intelligence.js";
import type { SkillService } from "./skill-service.js";
import type { CreatorService } from "./creator-service.js";
import { DomainError } from "./domain-error.js";
import { analyzeDocuments, type AnalyzedDocument } from "./skill-intelligence/analyzer.js";

/** 草稿库容量上限；超出淘汰最旧草稿（分析草稿是短生命周期审查材料）。 */
const MAX_DRAFTS = 20;

/** Skill intelligence 分析与提案服务。 */
export function createSkillIntelligenceService(skills: SkillService, creator: CreatorService) {
  const drafts = new Map<ProposalId, ProposalDraft>();

  function brandFindingId(id: string): FindingId {
    const parsed = FindingIdSchema.safeParse(id);
    if (!parsed.success) {
      throw new DomainError("UNAVAILABLE", "Analyzer produced an invalid finding id.");
    }
    return parsed.data;
  }

  /** 只读分析：逐技能读取并锁定 revision；失败项以 typed failure 返回，不进入报告。 */
  async function analyze(input: AnalyzeInput): Promise<{
    report: IntelligenceReport;
    failures: AnalyzeFailure[];
  }> {
    const failures: AnalyzeFailure[] = [];
    const documents: AnalyzedDocument[] = [];
    for (const selection of input.selections) {
      try {
        const info = await skills.info(selection, selection.skillId);
        documents.push({
          workspaceId: selection.workspaceId,
          providerId: selection.providerId,
          skillId: selection.skillId,
          name: info.name,
          directoryName: info.directoryName,
          disabled: info.disabled,
          revision: info.revision,
          content: info.content,
        });
      } catch (error) {
        const code =
          error instanceof DomainError && error.code !== "INVALID_OPERATION"
            ? (error.code as AnalyzeFailure["code"])
            : "FAILED";
        failures.push({
          ...selection,
          code,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const result = analyzeDocuments(documents);
    // 分析器输出是进程内可信数据，但仍经契约 schema parse 一次：
    // 运行时校验 + 为 branded ID（SkillId/FindingId）建立类型通道。
    const parsedReport = IntelligenceReportSchema.safeParse({
      createdAt: new Date().toISOString(),
      snapshots: result.snapshots,
      findings: result.findings.map((finding) => ({
        ...finding,
        id: brandFindingId(finding.id),
      })),
      edges: result.edges.map((edge) => ({
        kind: edge.kind,
        skillIds: edge.skillIds,
        findingIds: edge.findingIds.map(brandFindingId),
      })),
    });
    if (!parsedReport.success) {
      throw new DomainError("UNAVAILABLE", "Analyzer produced a report that failed its contract.");
    }
    return { report: parsedReport.data, failures };
  }

  /** 读取草稿覆盖的全部现有技能选择（按 payload 类别展开）。 */
  function affectedSelections(payload: ProposalDraft["payload"]): AnalyzeInput["selections"] {
    switch (payload.kind) {
      case "edit":
        return payload.edits.map((edit) => edit.selection);
      case "disable":
        return payload.selections;
      case "split":
        return [payload.source];
      case "merge":
        return payload.sources;
    }
  }

  /** 现时刻为每个受影响技能重新读取 revision，构造 proposal 观察锁。 */
  async function observeRevisions(
    selections: AnalyzeInput["selections"],
  ): Promise<ProposalDraft["observedRevisions"]> {
    const observed: ProposalDraft["observedRevisions"] = [];
    for (const selection of selections) {
      const info = await skills.info(selection, selection.skillId);
      observed.push({ ...selection, revision: info.revision });
    }
    return observed;
  }

  /** 提案入草稿库；技能不存在时抛 NOT_FOUND，任何写入都不发生。 */
  async function propose(input: {
    payload: ProposalDraft["payload"];
    findingIds: FindingId[];
    rationale: string;
  }): Promise<{ proposal: ProposalDraft }> {
    const selections = affectedSelections(input.payload);
    // 先全部复核存在性并观察 revision，再入草稿库；部分失败不产生草稿。
    const observed = await observeRevisions(selections);
    const id = ProposalIdSchema.parse(`pr_${randomBytes(12).toString("hex")}`);
    const proposal: ProposalDraft = {
      id,
      payload: input.payload,
      observedRevisions: observed,
      findingIds: input.findingIds,
      rationale: input.rationale,
      createdAt: new Date().toISOString(),
    };
    drafts.set(id, proposal);
    // 有界淘汰：超过容量移除最旧草稿。
    if (drafts.size > MAX_DRAFTS) {
      const oldest = drafts.keys().next().value;
      if (oldest !== undefined) drafts.delete(oldest);
    }
    return { proposal };
  }

  /** 草稿列表（新→旧）。 */
  function list(): { proposals: ProposalDraft[] } {
    return { proposals: [...drafts.values()].reverse() };
  }

  /** 拒绝并删除草稿。 */
  function reject(proposalId: ProposalId): { rejected: true } {
    if (!drafts.delete(proposalId)) {
      throw new DomainError("NOT_FOUND", `Proposal not found: ${proposalId}`);
    }
    return { rejected: true as const };
  }

  function emptyResult(): ApproveResult {
    return { results: [], applied: 0, conflicts: 0, failed: 0, skipped: 0 };
  }

  function finalize(partial: ApproveResult): ApproveResult {
    return {
      ...partial,
      applied: partial.results.filter((entry) => entry.status === "applied").length,
      conflicts: partial.results.filter((entry) => entry.status === "conflict").length,
      failed: partial.results.filter((entry) => entry.status === "failed").length,
      skipped: partial.results.filter((entry) => entry.status === "skipped").length,
    };
  }

  /** 审批：revision 复核通过后路由回既有 mutation；逐项 typed 结果。 */
  async function approve(input: { proposalId: ProposalId }): Promise<ApproveResult> {
    const draft = drafts.get(input.proposalId);
    if (!draft) {
      throw new DomainError("NOT_FOUND", `Proposal not found: ${input.proposalId}`);
    }
    // 先逐项复核 revision；任何 stale 都让整份草稿停在 conflict，不部分应用。
    const current = new Map<string, string>();
    for (const observed of draft.observedRevisions) {
      try {
        const info = await skills.info(observed, observed.skillId);
        current.set(observed.skillId, info.revision);
      } catch (error) {
        const partial = emptyResult();
        partial.results.push({
          workspaceId: observed.workspaceId,
          providerId: observed.providerId,
          skillId: observed.skillId,
          name: observed.skillId,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
        return finalize(partial);
      }
    }
    const stale = draft.observedRevisions.filter(
      (observed) => current.get(observed.skillId) !== observed.revision,
    );
    if (stale.length > 0) {
      const partial = emptyResult();
      for (const observed of draft.observedRevisions) {
        partial.results.push({
          workspaceId: observed.workspaceId,
          providerId: observed.providerId,
          skillId: observed.skillId,
          name: observed.skillId,
          status: "conflict",
          error:
            stale.find((entry) => entry.skillId === observed.skillId) !== undefined
              ? "Skill changed after the proposal was created; re-analyze."
              : undefined,
        });
      }
      return finalize(partial);
    }

    const result = emptyResult();
    const revisionOf = (skillId: string): string | undefined =>
      draft.observedRevisions.find((entry) => entry.skillId === skillId)?.revision;

    switch (draft.payload.kind) {
      case "edit": {
        for (const edit of draft.payload.edits) {
          try {
            const saved = await creator.save({
              mode: "update",
              workspaceId: edit.selection.workspaceId,
              providerId: edit.selection.providerId,
              skillId: edit.selection.skillId,
              expectedRevision: revisionOf(edit.selection.skillId)!,
              frontmatter: edit.frontmatter,
              body: edit.body,
            });
            result.results.push({
              workspaceId: edit.selection.workspaceId,
              providerId: edit.selection.providerId,
              skillId: edit.selection.skillId,
              name: saved.document.frontmatter.name,
              status: "applied",
            });
          } catch (error) {
            result.results.push({
              workspaceId: edit.selection.workspaceId,
              providerId: edit.selection.providerId,
              skillId: edit.selection.skillId,
              name: edit.selection.skillId,
              status:
                error instanceof DomainError && error.code === "CONFLICT" ? "conflict" : "failed",
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        break;
      }
      case "disable": {
        for (const selection of draft.payload.selections) {
          try {
            const summary = await skills.toggle(selection, [selection.skillId], "disable");
            const entry = summary.results.find((item) => item.skillId === selection.skillId);
            result.results.push({
              workspaceId: selection.workspaceId,
              providerId: selection.providerId,
              skillId: selection.skillId,
              name: entry?.name ?? selection.skillId,
              status:
                entry === undefined
                  ? "failed"
                  : entry.status === "disabled"
                    ? "applied"
                    : entry.status === "conflict"
                      ? "conflict"
                      : entry.status === "failed"
                        ? "failed"
                        : "skipped",
              error: entry?.error,
            });
          } catch (error) {
            result.results.push({
              workspaceId: selection.workspaceId,
              providerId: selection.providerId,
              skillId: selection.skillId,
              name: selection.skillId,
              status: "failed",
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        break;
      }
      case "split": {
        const source = draft.payload.source;
        try {
          for (const target of draft.payload.targets) {
            await creator.save({
              mode: "create",
              workspaceId: source.workspaceId,
              providerId: source.providerId,
              directoryName: target.directoryName,
              frontmatter: target.frontmatter,
              body: target.body,
            });
          }
          result.results.push({
            workspaceId: source.workspaceId,
            providerId: source.providerId,
            skillId: source.skillId,
            name: source.skillId,
            status: "applied",
          });
        } catch (error) {
          result.results.push({
            workspaceId: source.workspaceId,
            providerId: source.providerId,
            skillId: source.skillId,
            name: source.skillId,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          });
        }
        break;
      }
      case "merge": {
        // merge：先创建目标草稿，再逐个 revision-safe 删除源；部分失败保留已完成项。
        let created = false;
        try {
          await creator.save({
            mode: "create",
            workspaceId: draft.payload.sources[0]!.workspaceId,
            providerId: draft.payload.sources[0]!.providerId,
            directoryName: draft.payload.target.directoryName,
            frontmatter: draft.payload.target.frontmatter,
            body: draft.payload.target.body,
          });
          created = true;
        } catch (error) {
          const first = draft.payload.sources[0]!;
          result.results.push({
            workspaceId: first.workspaceId,
            providerId: first.providerId,
            skillId: first.skillId,
            name: first.skillId,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          });
        }
        for (const source of draft.payload.sources) {
          if (!created) {
            result.results.push({
              workspaceId: source.workspaceId,
              providerId: source.providerId,
              skillId: source.skillId,
              name: source.skillId,
              status: "failed",
              error: "merge target creation failed",
            });
            continue;
          }
          try {
            await creator.remove(
              {
                workspaceId: source.workspaceId,
                providerId: source.providerId,
              },
              source.skillId,
              revisionOf(source.skillId)!,
            );
            result.results.push({
              workspaceId: source.workspaceId,
              providerId: source.providerId,
              skillId: source.skillId,
              name: source.skillId,
              status: "applied",
            });
          } catch (error) {
            result.results.push({
              workspaceId: source.workspaceId,
              providerId: source.providerId,
              skillId: source.skillId,
              name: source.skillId,
              status:
                error instanceof DomainError && error.code === "CONFLICT" ? "conflict" : "failed",
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        break;
      }
    }
    // 审批完成后草稿即消费；conflict 保留草稿供重新分析后对照。
    if (!result.results.some((entry) => entry.status === "conflict")) {
      drafts.delete(input.proposalId);
    }
    return finalize(result);
  }

  return { analyze, propose, list, reject, approve };
}

/** Skill intelligence 服务接口。 */
export type SkillIntelligenceService = ReturnType<typeof createSkillIntelligenceService>;
