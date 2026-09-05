/**
 * 用户原始需求 [2026-09-06]（openspec agent-steward tasks 1.2/1.4 + spec）：「串联
 * analyze -> recommend -> draft -> validate -> approval -> apply；每一步可取消且有
 * terminal result。」「Agent 建议映射为 edit/disable/split/merge ProposalDraft；
 * 不允许 adapter 直接调用 filesystem mutation。」「daemon MUST 处理 cancel、disconnect、
 * process exit、shutdown 为显式终态。」
 * 正交意图：
 *   [1] Manager 编排：阶段推进、事件审计流、一次性授权中介、有界 run/事件存储。
 *   [2] 安全边界：execution root 隔离 + 推荐 payload 只能经 intelligence.propose 进入
 *       draft store；apply 权力留在 approveProposal（intelligence.approve）。
 *   [3] 生命周期：cancel/dispose 把运行折叠为 cancelled/stopped 并回收隔离根，
 *       不保留 orphan 目录或悬挂 promise。
 * 妥协声明：三组状态共享同一 run 生命周期，必须聚合在单一服务模块；
 *   WebUI 通过轮询 events 读取进度（不引入新的 WS 推送通道）。
 */
import { promises as fs } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import type {
  BackendStatus,
  PermissionDecision,
  PermissionRequest,
  Recommendation,
  RunEvent,
  RunPhase,
  RunStatus,
  StewardBackendId,
  StewardPermissionRequestId,
  StewardRun,
  StewardRunId,
} from "../shared/contracts/agent-steward.js";
import {
  RecommendationSchema,
  StewardPermissionRequestIdSchema,
  StewardRunIdSchema,
} from "../shared/contracts/agent-steward.js";
import type { ApproveResult, ProposalId } from "../shared/contracts/skill-intelligence.js";
import type { SkillId, SkillMetadata } from "../shared/contracts/skills.js";
import type { WorkspaceProviderTarget } from "../shared/contracts/workspaces.js";
import { runDir } from "../shared/paths.js";
import { DomainError } from "./domain-error.js";
import type { SkillService } from "./skill-service.js";
import type { SkillIntelligenceService } from "./skill-intelligence-service.js";
import {
  HarnessProcessLostError,
  type HarnessAdapter,
  type HarnessAgentEvent,
  type HarnessEventSink,
  type HarnessFindingSnapshot,
  type HarnessPrompt,
} from "./steward/harness-adapter.js";

const MAX_RUNS = 20;
const MAX_EVENTS_PER_RUN = 500;

/** 内部 run 条目：投影 + 管线状态。 */
interface RunEntry {
  run: StewardRun;
  events: RunEvent[];
  controller: AbortController;
  pipeline: Promise<void>;
  pendingPermissions: Map<
    StewardPermissionRequestId,
    { request: PermissionRequest; resolve: (decision: "granted" | "denied") => void }
  >;
  decidedPermissions: Set<StewardPermissionRequestId>;
  decidedProposals: Set<ProposalId>;
  /** awaiting-approval 完成信号（全部 proposal 裁决后 resolve）。 */
  approvalDone: Promise<void> | null;
  signalApprovalDone: (() => void) | null;
  /** dispose 设置的终态覆盖（daemon stop → stopped，而非 cancelled）。 */
  terminalOverride: RunStatus | null;
}

/** steward 服务依赖。 */
export interface StewardServiceOptions {
  adapters: HarnessAdapter[];
  /** 测试覆盖隔离根父目录。 */
  executionRootParent?: string;
}

function brandRunId(id: string): StewardRunId {
  return StewardRunIdSchema.parse(id);
}

function brandPermissionRequestId(id: string): StewardPermissionRequestId {
  return StewardPermissionRequestIdSchema.parse(id);
}

/** 从 agent 最终文本中提取推荐 JSON 数组（不可信输入，safeParse 收窄）。 */
function parseRecommendationsFromText(text: string): {
  recommendations: Recommendation[];
  rejected: number;
} {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return { recommendations: [], rejected: 0 };
  let value: unknown;
  try {
    value = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { recommendations: [], rejected: 1 };
  }
  if (!Array.isArray(value)) return { recommendations: [], rejected: 1 };
  const recommendations: Recommendation[] = [];
  let rejected = 0;
  for (const item of value) {
    const parsed = RecommendationSchema.safeParse(item);
    if (parsed.success) recommendations.push(parsed.data);
    else rejected += 1;
  }
  return { recommendations, rejected };
}

/** 创建 daemon-owned steward 编排服务。 */
export function createStewardService(
  workspaces: import("./workspace-registry/index.js").WorkspaceRegistry,
  skills: SkillService,
  intelligence: SkillIntelligenceService,
  options: StewardServiceOptions,
) {
  const adapters = new Map<StewardBackendId, HarnessAdapter>(
    options.adapters.map((adapter) => [adapter.backendId, adapter]),
  );
  const runs = new Map<StewardRunId, RunEntry>();
  let disposed = false;

  const executionParent = options.executionRootParent ?? path.join(runDir(), "steward");

  /** 追加一条 run 事件（有界，seq 单调）。 */
  const appendEvent = (entry: RunEntry, event: Omit<RunEvent, "seq" | "at" | "runId">): void => {
    const seq = entry.events.length > 0 ? entry.events[entry.events.length - 1]!.seq + 1 : 1;
    entry.events.push({ ...event, seq, at: new Date().toISOString(), runId: entry.run.runId });
    if (entry.events.length > MAX_EVENTS_PER_RUN) {
      entry.events.splice(0, entry.events.length - MAX_EVENTS_PER_RUN);
    }
  };

  const setPhase = (entry: RunEntry, phase: RunPhase): void => {
    entry.run.phase = phase;
    appendEvent(entry, { kind: "phase", phase });
  };

  /** 终结一个 run：统一回收隔离根与待决授权。 */
  const terminate = async (
    entry: RunEntry,
    status: RunStatus,
    error: string | null,
  ): Promise<void> => {
    if (entry.run.status !== "running") return;
    entry.run.status = status;
    entry.run.phase = null;
    entry.run.endedAt = new Date().toISOString();
    entry.run.error = error;
    for (const [, pending] of entry.pendingPermissions) pending.resolve("denied");
    entry.pendingPermissions.clear();
    appendEvent(entry, {
      kind: "run-terminal",
      terminalStatus: status,
      message: error ?? undefined,
    });
    await cleanupExecutionRoot(entry.run.executionRoot);
  };

  const cleanupExecutionRoot = async (root: string): Promise<void> => {
    try {
      await fs.rm(root, { recursive: true, force: true });
    } catch {
      // 目录可能已被回收；终态不变。
    }
  };

  /** 淘汰最旧 run（终态优先）。 */
  const evictOldRuns = (): void => {
    if (runs.size <= MAX_RUNS) return;
    const ordered = [...runs.values()].sort((left, right) =>
      left.run.startedAt.localeCompare(right.run.startedAt),
    );
    for (const entry of ordered) {
      if (runs.size <= MAX_RUNS) break;
      if (entry.run.status === "running") continue;
      runs.delete(entry.run.runId);
    }
  };

  /** 探测全部 backend：成功携带 capability，失败折叠为 typed unavailable。 */
  const backends = async (): Promise<{ backends: BackendStatus[] }> => {
    const statuses: BackendStatus[] = [];
    for (const [backendId, adapter] of adapters) {
      try {
        const capabilities = await adapter.handshake();
        statuses.push({ state: "available", capabilities });
      } catch (error) {
        statuses.push({
          state: "unavailable",
          capabilities: { backendId },
          reason:
            error instanceof DomainError
              ? error.message
              : `Handshake failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
    return { backends: statuses };
  };

  const list = (): { runs: StewardRun[] } => ({
    runs: [...runs.values()].map((entry) => structuredCloneProjection(entry.run)).reverse(),
  });

  /** 深拷贝投影，避免调用方持有内部可变状态。 */
  const structuredCloneProjection = (run: StewardRun): StewardRun =>
    JSON.parse(JSON.stringify(run)) as StewardRun;

  const requireEntry = (runId: StewardRunId): RunEntry => {
    const entry = runs.get(runId);
    if (!entry) throw new DomainError("NOT_FOUND", `Steward run not found: ${runId}`);
    return entry;
  };

  const events = (input: { runId: StewardRunId; afterSeq?: number }) => {
    const entry = requireEntry(input.runId);
    const after = input.afterSeq ?? 0;
    return {
      runId: input.runId,
      events: entry.events.filter((event) => event.seq > after),
      status: entry.run.status,
      phase: entry.run.phase,
    };
  };

  /** 等待 run 管线 settle（测试/审计用）。 */
  const settled = (runId: StewardRunId): Promise<StewardRun> => {
    const entry = requireEntry(runId);
    return entry.pipeline.then(() => structuredCloneProjection(entry.run));
  };

  /** 启动一次 run：校验 backend/target，创建隔离根，异步推进管线。 */
  const start = async (input: {
    backendId: StewardBackendId;
    target: WorkspaceProviderTarget;
    skillIds?: SkillId[];
    objective?: string;
  }): Promise<{ run: StewardRun }> => {
    if (disposed) {
      throw new DomainError("UNAVAILABLE", "Steward service is shutting down.");
    }
    const adapter = adapters.get(input.backendId);
    if (!adapter) {
      throw new DomainError(
        "NOT_FOUND",
        `Unknown steward backend: ${input.backendId}. No fallback is performed.`,
      );
    }
    // handshake 显式失败 → typed unavailable，不创建 run（不自动 fallback）。
    const capabilities = await adapter.handshake();
    // 只有 Imported Workspace.Provider 可写；Global(~) 在 resolveWritable 处拒绝。
    workspaces.resolveWritable(input.target);
    const discovered: SkillMetadata[] = await skills.list(input.target);
    const selected = input.skillIds
      ? discovered.filter((skill) => input.skillIds!.includes(skill.id))
      : discovered;
    if (selected.length === 0) {
      throw new DomainError("INVALID_OPERATION", "No skills selected for the steward run.");
    }
    await fs.mkdir(executionParent, { recursive: true });
    const executionRoot = await fs.mkdtemp(path.join(executionParent, "run-"));
    const runId = brandRunId(`sr_${randomBytes(12).toString("hex")}`);
    const run: StewardRun = {
      runId,
      backendId: input.backendId,
      target: input.target,
      skillIds: selected.map((skill) => skill.id),
      observedRevisions: [],
      capabilities,
      executionRoot,
      objective: input.objective ?? "Analyze skills and propose safe maintenance recommendations.",
      startedAt: new Date().toISOString(),
      endedAt: null,
      status: "running",
      phase: "analyzing",
      error: null,
      recommendations: [],
      proposalIds: [],
      permissionRequests: [],
      permissionDecisions: [],
    };
    const entry: RunEntry = {
      run,
      events: [],
      controller: new AbortController(),
      pipeline: Promise.resolve(),
      pendingPermissions: new Map(),
      decidedPermissions: new Set(),
      decidedProposals: new Set(),
      approvalDone: null,
      signalApprovalDone: null,
      terminalOverride: null,
    };
    appendEvent(entry, { kind: "run-started", phase: "analyzing" });
    runs.set(runId, entry);
    evictOldRuns();
    entry.pipeline = executePipeline(entry, adapter, skills, selected).catch(() => {
      // 管线内部已统一 terminate；这里只兜底防 unhandled rejection。
    });
    return { run: structuredCloneProjection(run) };
  };

  /** analyze → recommend → draft → validate → await approval → apply。 */
  const executePipeline = async (
    entry: RunEntry,
    adapter: HarnessAdapter,
    skillsService: SkillService,
    selected: SkillMetadata[],
  ): Promise<void> => {
    const { run, controller } = entry;
    try {
      // ---- analyzing ----
      const selections = selected.map((skill) => ({
        workspaceId: run.target.workspaceId,
        providerId: run.target.providerId,
        skillId: skill.id,
      }));
      const analyzed = await intelligence.analyze({ selections });
      for (const snapshot of analyzed.report.snapshots) {
        run.observedRevisions.push({ skillId: snapshot.skillId, revision: snapshot.revision });
      }
      // 只读快照复制进隔离根（agent 的唯一可见文档）。
      for (const skill of selected) {
        const info = await skillsService.info(run.target, skill.id);
        const destination = path.join(entry.run.executionRoot, "skills", skill.directoryName);
        await fs.mkdir(destination, { recursive: true });
        await fs.writeFile(path.join(destination, "SKILL.md"), info.content, "utf8");
      }
      const findingSnapshots: HarnessFindingSnapshot[] = analyzed.report.findings.map(
        (finding) => ({
          findingId: finding.id,
          kind: finding.kind,
          severity: finding.severity,
          message: finding.message,
          skillIds: finding.skillIds,
          evidence: finding.evidence.map((item) => `${item.label}: ${item.snippet}`),
        }),
      );
      controller.signal.throwIfAborted();

      // ---- recommending ----
      setPhase(entry, "recommending");
      // Agent 输出一律是不可信输入：sink/返回值/文本三条通道都先过契约 safeParse。
      const ingestRecommendation = (candidate: unknown): void => {
        const parsed = RecommendationSchema.safeParse(candidate);
        if (!parsed.success) {
          appendEvent(entry, {
            kind: "agent-message",
            message: "Agent recommendation failed contract validation and was dropped.",
          });
          return;
        }
        run.recommendations.push(parsed.data);
        appendEvent(entry, {
          kind: "recommendation",
          recommendationId: parsed.data.id,
          message: parsed.data.rationale,
        });
      };
      const sink: HarnessEventSink = {
        emit: (event: HarnessAgentEvent) => {
          if (run.status !== "running") return;
          if (event.kind === "message") {
            appendEvent(entry, { kind: "agent-message", message: event.text });
            return;
          }
          if (event.kind === "item") {
            appendEvent(entry, {
              kind: "agent-item",
              itemKind: event.itemKind,
              message: event.text,
            });
            return;
          }
          ingestRecommendation(event.recommendation);
        },
        permission: (request) =>
          new Promise<"granted" | "denied">((resolve) => {
            if (run.status !== "running") {
              resolve("denied");
              return;
            }
            const id = brandPermissionRequestId(`prm_${randomBytes(8).toString("hex")}`);
            const permissionRequest: PermissionRequest = {
              id,
              runId: run.runId,
              at: new Date().toISOString(),
              summary: request.summary,
              detail: request.detail,
            };
            run.permissionRequests.push(permissionRequest);
            entry.pendingPermissions.set(id, { request: permissionRequest, resolve });
            appendEvent(entry, {
              kind: "permission-request",
              permissionRequestId: id,
              message: request.summary,
            });
            // run 取消/停止时未决授权一律以 denied 收尾，管线不悬挂。
            const onAbort = (): void => {
              if (entry.pendingPermissions.delete(id)) resolve("denied");
            };
            controller.signal.addEventListener("abort", onAbort, { once: true });
          }),
      };
      const prompt: HarnessPrompt = {
        runId: run.runId,
        target: { workspaceId: run.target.workspaceId, providerId: run.target.providerId },
        objective: run.objective,
        executionRoot: run.executionRoot,
        skills: selected.map((skill) => {
          const revision =
            run.observedRevisions.find((observed) => observed.skillId === skill.id)?.revision ?? "";
          return {
            skillId: skill.id,
            name: skill.name,
            directoryName: skill.directoryName,
            revision,
            disabled: skill.disabled,
            documentPath: path.join("skills", skill.directoryName, "SKILL.md"),
          };
        }),
        findings: findingSnapshots,
        outputContract: [
          "Return recommendations as structured output.",
          "Each recommendation: kind (edit|disable|split|merge), affected skillIds, rationale,",
          "findingIds, and a payload matching the Skill Creator proposal schema for that kind.",
          `workspaceId must be "${run.target.workspaceId}" and providerId "${run.target.providerId}".`,
          "Do not modify files; the Manager applies approved proposals.",
        ].join(" "),
      };
      const outcome = await adapter.run(prompt, sink, controller.signal);
      // adapter 返回值与 sink 流可能重复携带同一推荐：按 id 去重后经契约收窄合并。
      const known = new Set(run.recommendations.map((recommendation) => recommendation.id));
      for (const candidate of outcome.recommendations) {
        if (known.has(candidate.id)) continue;
        known.add(candidate.id);
        ingestRecommendation(candidate);
      }
      // 进程型 backend 的最终文本可能携带 JSON 推荐：不可信输入先收窄。
      if (outcome.recommendations.length === 0 && outcome.finalMessage.trim().length > 0) {
        const parsed = parseRecommendationsFromText(outcome.finalMessage);
        for (const recommendation of parsed.recommendations) {
          if (known.has(recommendation.id)) continue;
          known.add(recommendation.id);
          ingestRecommendation(recommendation);
        }
        if (parsed.rejected > 0) {
          appendEvent(entry, {
            kind: "agent-message",
            message: `${parsed.rejected} agent recommendation(s) failed contract validation and were dropped.`,
          });
        }
      }
      controller.signal.throwIfAborted();

      // ---- drafting：Agent payload 只能经 intelligence.propose 进入 draft store。 ----
      setPhase(entry, "drafting");
      for (const recommendation of run.recommendations) {
        try {
          const { proposal } = await intelligence.propose({
            payload: recommendation.payload,
            findingIds: recommendation.findingIds,
            rationale: recommendation.rationale,
          });
          run.proposalIds.push(proposal.id);
          appendEvent(entry, {
            kind: "draft-created",
            proposalId: proposal.id,
            recommendationId: recommendation.id,
          });
        } catch (error) {
          appendEvent(entry, {
            kind: "draft-failed",
            recommendationId: recommendation.id,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // ---- validating：draft 仍存在且 revision 锁有效。 ----
      setPhase(entry, "validating");
      const { proposals } = intelligence.list();
      const liveIds = new Set(proposals.map((proposal) => proposal.id));
      run.proposalIds = run.proposalIds.filter((proposalId) => {
        if (liveIds.has(proposalId)) return true;
        appendEvent(entry, {
          kind: "draft-failed",
          proposalId,
          message: "Draft no longer exists at validation time.",
        });
        return false;
      });

      if (run.proposalIds.length === 0) {
        await terminate(entry, "completed", null);
        return;
      }

      // ---- awaiting-approval：等待全部 proposal 被裁决（abort 感知）。 ----
      setPhase(entry, "awaiting-approval");
      entry.approvalDone = new Promise<void>((resolve) => {
        entry.signalApprovalDone = resolve;
      });
      const aborted = new Promise<never>((_, reject) => {
        const onAbort = (): void =>
          reject(new DomainError("INVALID_OPERATION", "Steward run cancelled."));
        controller.signal.addEventListener("abort", onAbort, { once: true });
      });
      await Promise.race([entry.approvalDone, aborted]);
      controller.signal.throwIfAborted();

      // ---- applying：approveProposal 已逐项路由 Manager mutation。 ----
      setPhase(entry, "applying");
      await terminate(entry, "completed", null);
    } catch (error) {
      if (controller.signal.aborted) {
        await terminate(entry, entry.terminalOverride ?? "cancelled", null);
        return;
      }
      if (error instanceof HarnessProcessLostError) {
        await terminate(entry, "disconnected", error.message);
        return;
      }
      await terminate(entry, "failed", error instanceof Error ? error.message : String(error));
    }
  };

  /** 检查是否全部 proposal 已裁决；是则放行 applying。 */
  const maybeFinishApproval = (entry: RunEntry): void => {
    if (entry.run.proposalIds.every((proposalId) => entry.decidedProposals.has(proposalId))) {
      entry.signalApprovalDone?.();
    }
  };

  /** 取消一个 run（幂等；terminal 后 NOT_FOUND 语义保持温和：直接返回投影）。 */
  const cancel = async (input: { runId: StewardRunId }): Promise<{ run: StewardRun }> => {
    const entry = requireEntry(input.runId);
    if (entry.run.status !== "running") {
      return { run: structuredCloneProjection(entry.run) };
    }
    // abort 级联到 adapter run（进程型 backend 的子进程随之有界 kill）；
    // 不 dispose 共享 adapter——backend 能力不属于单个 run。
    entry.controller.abort();
    await entry.pipeline;
    return { run: structuredCloneProjection(entry.run) };
  };

  /** 一次性授权裁决。 */
  const decidePermission = async (input: {
    runId: StewardRunId;
    requestId: StewardPermissionRequestId;
    decision: "granted" | "denied";
    note?: string;
  }): Promise<{ run: StewardRun }> => {
    const entry = requireEntry(input.runId);
    const pending = entry.pendingPermissions.get(input.requestId);
    if (!pending) {
      throw new DomainError(
        "CONFLICT",
        "Permission request is not pending (unknown or already decided).",
      );
    }
    entry.pendingPermissions.delete(input.requestId);
    entry.decidedPermissions.add(input.requestId);
    const decision: PermissionDecision = {
      requestId: input.requestId,
      at: new Date().toISOString(),
      decision: input.decision,
      note: input.note,
    };
    entry.run.permissionDecisions.push(decision);
    appendEvent(entry, {
      kind: "permission-decision",
      permissionRequestId: input.requestId,
      message: input.decision,
    });
    pending.resolve(input.decision);
    return { run: structuredCloneProjection(entry.run) };
  };

  /** run 内审批 proposal：Manager apply（intelligence.approve）。 */
  const approveProposal = async (input: {
    runId: StewardRunId;
    proposalId: ProposalId;
  }): Promise<{ run: StewardRun; result: ApproveResult }> => {
    const entry = requireEntry(input.runId);
    if (entry.run.status !== "running") {
      throw new DomainError("INVALID_OPERATION", "Steward run is terminal; re-run the analysis.");
    }
    if (entry.run.phase !== "awaiting-approval" && entry.run.phase !== "applying") {
      throw new DomainError(
        "INVALID_OPERATION",
        "Steward run has not reached the approval gate yet.",
      );
    }
    if (!entry.run.proposalIds.includes(input.proposalId)) {
      throw new DomainError("NOT_FOUND", "Proposal does not belong to this steward run.");
    }
    if (entry.decidedProposals.has(input.proposalId)) {
      throw new DomainError("CONFLICT", "Proposal already decided in this run.");
    }
    const result = await intelligence.approve({ proposalId: input.proposalId });
    entry.decidedProposals.add(input.proposalId);
    appendEvent(entry, {
      kind: "approval",
      proposalId: input.proposalId,
      message: `applied=${result.applied} conflicts=${result.conflicts} failed=${result.failed}`,
    });
    appendEvent(entry, { kind: "apply", proposalId: input.proposalId });
    maybeFinishApproval(entry);
    return { run: structuredCloneProjection(entry.run), result };
  };

  /** run 内拒绝 proposal。 */
  const rejectProposal = async (input: {
    runId: StewardRunId;
    proposalId: ProposalId;
  }): Promise<{ run: StewardRun }> => {
    const entry = requireEntry(input.runId);
    if (entry.run.status !== "running") {
      throw new DomainError("INVALID_OPERATION", "Steward run is terminal; re-run the analysis.");
    }
    if (entry.run.phase !== "awaiting-approval" && entry.run.phase !== "applying") {
      throw new DomainError(
        "INVALID_OPERATION",
        "Steward run has not reached the approval gate yet.",
      );
    }
    if (!entry.run.proposalIds.includes(input.proposalId)) {
      throw new DomainError("NOT_FOUND", "Proposal does not belong to this steward run.");
    }
    if (entry.decidedProposals.has(input.proposalId)) {
      throw new DomainError("CONFLICT", "Proposal already decided in this run.");
    }
    intelligence.reject(input.proposalId);
    entry.decidedProposals.add(input.proposalId);
    appendEvent(entry, { kind: "approval", proposalId: input.proposalId, message: "rejected" });
    maybeFinishApproval(entry);
    return { run: structuredCloneProjection(entry.run) };
  };

  /** daemon stop：全部 run 折叠为 stopped，回收隔离根，dispose adapter。 */
  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    const entries = [...runs.values()];
    for (const entry of entries) {
      if (entry.run.status === "running") {
        entry.terminalOverride = "stopped";
        entry.controller.abort();
      }
    }
    for (const [, adapter] of adapters) {
      await adapter.dispose().catch(() => undefined);
    }
    await Promise.all(entries.map((entry) => entry.pipeline));
    for (const entry of entries) {
      if (entry.run.status === "running") {
        await terminate(entry, "stopped", null);
      }
    }
  };

  return {
    backends,
    list,
    events,
    start,
    settled,
    cancel,
    decidePermission,
    approveProposal,
    rejectProposal,
    dispose,
  };
}

/** steward 服务实例接口。 */
export type StewardService = ReturnType<typeof createStewardService>;
