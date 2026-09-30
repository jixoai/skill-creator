/**
 * 评估跑分编排（evaluation-corpus B4/B5/B′4；工作计划 Ch3）。
 *
 * 用户原始需求 [2026-09-30]：「webui 里面还有一些残留的未完成的工作，比如 skill
 * 测试与评估」。
 *
 * 正交意图：
 *   [1] run 生命周期：start→{runId,queued}；内存态表 + 结果落盘；cancel 竞态
 *       胜者（completed 后幂等、running→终态 cancelled 且已写结果保留）。
 *   [2] 五态裁决：revision 闸（前/中漂移→stale）；passed 仅来自全部断言通过；
 *       unavailable（依赖族）/error（执行族）互斥。
 *   [3] analyzer runner：provider 语料全量分析 → 断言映射（finding-triggered/
 *       kind/severity/contains/not-contains）。
 */
import type { SkillService } from "../skill-service.js";
import type {
  EvaluationAssertion,
  EvaluationCase,
  EvaluationResult,
  EvaluationRunStatus,
  EvaluationTarget,
  EvaluationRunner,
} from "../../shared/contracts/evaluation.js";
import { createEvaluationStore, newEvaluationId, type EvaluationStore } from "./store.js";
import { analyzeDocuments, type AnalyzerFinding } from "../skill-intelligence/analyzer.js";

/** analyzer 路径的冻结版本常量（B3：结构化三元组；analyzer 不触内核）。 */
const ANALYZER_VERSION = {
  promptVersion: "analyzer-fixture-v1",
  toolVersion: "skill-intelligence-analyzer-v1",
  dshVersion: "n/a",
} as const;

/** provider-model 会话适配器（B7 冻结接口；daemon 进程内驱动内核会话）。 */
export interface ProviderSessionAdapter {
  create(input: { cwd?: string; metadata?: unknown }): Promise<{ sessionId: string }>;
  prompt(input: {
    sessionId: string;
    text: string;
    references: Array<{ kind: "skill"; workspaceId: string; providerId: string; skillId: string }>;
  }): Promise<void>;
  readTranscript(sessionId: string): Promise<string>;
  cancel(sessionId: string): Promise<void>;
  versions(): { promptVersion: string; toolVersion: string; dshVersion: string };
}

interface RunEntry {
  runId: string;
  status: EvaluationRunStatus;
  resultIds: string[];
  cancelTarget: string | null;
}

export interface EvaluationService {
  startRun(input: {
    target: EvaluationTarget;
    caseIds: string[];
    runner: "analyzer" | "provider-model";
  }): { runId: string; status: "queued" };
  runStatus(runId: string): { status: EvaluationRunStatus; resultIds: string[] };
  cancelRun(runId: string): { runId: string; status: EvaluationRunStatus };
  results(target: EvaluationTarget): Promise<Array<EvaluationResult & { stale: boolean }>>;
  listCases(target: EvaluationTarget): ReturnType<EvaluationStore["listCases"]>;
  createCase(input: {
    target: EvaluationTarget;
    input: { prompt: string; assertions: EvaluationAssertion[] };
    boundRevision: string;
    enabled?: boolean;
  }): EvaluationCase;
  updateCase(input: {
    target: EvaluationTarget;
    caseId: string;
    input: { prompt: string; assertions: EvaluationAssertion[] };
    boundRevision: string;
    enabled?: boolean;
  }): EvaluationCase;
  removeCase(input: { target: EvaluationTarget; caseId: string }): boolean;
}

export interface EvaluationServiceDeps {
  skills: SkillService;
  store?: EvaluationStore;
  /** provider runner 的会话适配器（缺省时 provider-model run → typed unavailable）。 */
  providerAdapter?: () => ProviderSessionAdapter | null;
}

interface SkillDocument {
  info: {
    revision: string;
    name: string;
    content: string;
    id: string;
    disabled: boolean;
  };
}

export function createEvaluationService(deps: EvaluationServiceDeps): EvaluationService {
  const store = deps.store ?? createEvaluationStore();
  const runs = new Map<string, RunEntry>();

  const loadSkill = async (target: EvaluationTarget): Promise<SkillDocument["info"]> => {
    const info = await deps.skills.info(target, target.skillId);
    return {
      revision: info.revision,
      name: info.name,
      content: info.content,
      id: info.id,
      disabled: info.disabled,
    };
  };

  /** provider 语料全量（overlap/conflict 类 finding 需要邻技能在场）。 */
  const providerCorpus = async (target: EvaluationTarget) => {
    const list = await deps.skills.list(
      { workspaceId: target.workspaceId, providerId: target.providerId },
      true,
    );
    const documents = [];
    for (const skill of list) {
      const info = await deps.skills.info(
        { workspaceId: target.workspaceId, providerId: target.providerId },
        skill.id,
      );
      documents.push({
        workspaceId: target.workspaceId,
        providerId: target.providerId,
        skillId: skill.id,
        name: info.name,
        directoryName: skill.directoryName,
        disabled: skill.disabled,
        revision: info.revision,
        content: info.content,
      });
    }
    return documents;
  };

  const findingsFor = (findings: AnalyzerFinding[], skillId: string): AnalyzerFinding[] =>
    findings.filter((finding) => finding.skillIds.includes(skillId));

  const judgeAssertion = (
    assertion: EvaluationAssertion,
    ctx: { text: string; findings: AnalyzerFinding[] },
  ): "passed" | "failed" => {
    switch (assertion.kind) {
      case "contains":
        return ctx.text.includes(assertion.value) ? "passed" : "failed";
      case "not-contains":
        return ctx.text.includes(assertion.value) ? "failed" : "passed";
      case "finding-kind":
        return ctx.findings.some((finding) => finding.kind === assertion.value)
          ? "passed"
          : "failed";
      case "finding-triggered":
        return ctx.findings.length > 0 === assertion.value ? "passed" : "failed";
      case "finding-severity":
        return ctx.findings.some((finding) => finding.severity === assertion.value)
          ? "passed"
          : "failed";
    }
  };

  const baseResult = (
    target: EvaluationTarget,
    caseId: string,
    runId: string,
    runner: EvaluationRunner,
    expectedRevision: string,
    start: string,
  ) => ({
    schemaVersion: 1 as const,
    resultId: newEvaluationId("evr_"),
    runId,
    caseId,
    target,
    expectedRevision,
    observedStartRevision: expectedRevision,
    observedEndRevision: expectedRevision,
    runner,
    startedAt: start,
    endedAt: new Date().toISOString(),
  });

  const executeCase = async (
    entry: RunEntry,
    target: EvaluationTarget,
    runCase: {
      caseId: string;
      input: { prompt: string; assertions: EvaluationAssertion[] };
      boundRevision: string;
    },
    runner: EvaluationRunner,
  ): Promise<EvaluationResult> => {
    const startedAt = new Date().toISOString();
    const base = baseResult(
      target,
      runCase.caseId,
      entry.runId,
      runner,
      runCase.boundRevision,
      startedAt,
    );
    try {
      const current = await loadSkill(target);
      // revision 闸（run 前）：实测 ≠ bound → stale，不执行。
      if (current.revision !== runCase.boundRevision) {
        return {
          ...base,
          observedStartRevision: current.revision,
          outcome: "stale",
          assertions: [],
        };
      }
      if (runner.kind === "analyzer") {
        const corpus = await providerCorpus(target);
        const { findings } = analyzeDocuments(corpus);
        const mine = findingsFor(findings, target.skillId);
        const text = corpus.find((doc) => doc.skillId === target.skillId)?.content ?? "";
        const assertions = runCase.input.assertions.map((assertion, index) => ({
          ref: index,
          outcome: judgeAssertion(assertion, { text, findings: mine }),
        }));
        const end = await loadSkill(target);
        // run 中漂移 → stale 作废。
        if (end.revision !== current.revision) {
          return {
            ...base,
            observedStartRevision: current.revision,
            observedEndRevision: end.revision,
            outcome: "stale",
            assertions: [],
          };
        }
        const allPassed = assertions.every((item) => item.outcome === "passed");
        return {
          ...base,
          observedStartRevision: current.revision,
          observedEndRevision: end.revision,
          outcome: allPassed ? "passed" : "failed",
          assertions,
        };
      }
      // provider-model：经 B7 adapter 跑内核会话；缺适配器/依赖缺席 → unavailable。
      const adapter = deps.providerAdapter?.() ?? null;
      if (adapter === null) {
        return {
          ...base,
          observedStartRevision: current.revision,
          outcome: "unavailable",
          assertions: [],
          failure: {
            code: "DSH_UNAVAILABLE",
            detail: "provider session adapter is not configured",
          },
        };
      }
      const session = await adapter.create({
        metadata: {
          kind: "test-run",
          ...target,
          revision: runCase.boundRevision,
          templateId: "evaluation-provider-run",
          templateVersion: 1,
        },
      });
      entry.cancelTarget = session.sessionId;
      try {
        await adapter.prompt({
          sessionId: session.sessionId,
          text: runCase.input.prompt,
          references: [{ kind: "skill", ...target }],
        });
        const transcript = await adapter.readTranscript(session.sessionId);
        const assertions = runCase.input.assertions.map((assertion, index) => ({
          ref: index,
          outcome: judgeAssertion(assertion, { text: transcript, findings: [] }),
        }));
        const end = await loadSkill(target);
        if (end.revision !== current.revision) {
          return {
            ...base,
            observedStartRevision: current.revision,
            observedEndRevision: end.revision,
            outcome: "stale",
            assertions: [],
          };
        }
        const allPassed = assertions.every((item) => item.outcome === "passed");
        return {
          ...base,
          observedStartRevision: current.revision,
          observedEndRevision: end.revision,
          outcome: allPassed ? "passed" : "failed",
          assertions,
        };
      } finally {
        entry.cancelTarget = null;
      }
    } catch (error) {
      return {
        ...base,
        outcome: "error",
        assertions: [],
        failure: {
          code: "RUNNER_ERROR",
          detail: error instanceof Error ? error.message : String(error),
        },
      };
    }
  };

  return {
    startRun(input) {
      const runId = newEvaluationId("run_");
      const entry: RunEntry = { runId, status: "queued", resultIds: [], cancelTarget: null };
      runs.set(runId, entry);
      const runner: EvaluationRunner =
        input.runner === "analyzer"
          ? { kind: "analyzer", version: { ...ANALYZER_VERSION } }
          : (() => {
              const adapter = deps.providerAdapter?.() ?? null;
              return {
                kind: "provider-model",
                version: adapter
                  ? adapter.versions()
                  : { promptVersion: "n/a", toolVersion: "n/a", dshVersion: "n/a" },
              };
            })();
      void (async () => {
        entry.status = "running";
        // cancelRun 在外部并发改写 status——经读取函数比较，防 TS 窄化误报。
        const cancelled = (): boolean => entry.status === "cancelled";
        for (const caseId of input.caseIds) {
          if (cancelled()) break;
          const runCase = store
            .listCases(input.target)
            .find((candidate) => candidate.caseId === caseId && candidate.enabled);
          if (runCase === undefined) continue;
          const result = await executeCase(entry, input.target, runCase, runner);
          if (cancelled()) break;
          store.appendResult(input.target, result);
          entry.resultIds.push(result.resultId);
        }
        if (!cancelled()) entry.status = "completed";
        else if (entry.status === "running") entry.status = "cancelled";
      })();
      return { runId, status: "queued" };
    },
    runStatus(runId) {
      const entry = runs.get(runId);
      if (entry === undefined) throw new Error(`NOT_FOUND: unknown evaluation run ${runId}`);
      return { status: entry.status, resultIds: [...entry.resultIds] };
    },
    cancelRun(runId) {
      const entry = runs.get(runId);
      if (entry === undefined) throw new Error(`NOT_FOUND: unknown evaluation run ${runId}`);
      // 竞态胜者（B′4）：completed 后 cancel 幂等返终态；queued/running → cancelled
      //（已写结果保留）；provider 在途会话有界取消。
      if (entry.status === "completed" || entry.status === "cancelled") {
        return { runId, status: entry.status };
      }
      entry.status = "cancelled";
      if (entry.cancelTarget !== null && deps.providerAdapter) {
        void deps
          .providerAdapter()
          ?.cancel(entry.cancelTarget)
          .catch(() => undefined);
      }
      return { runId, status: entry.status };
    },
    async results(target) {
      // 展示层 stale（B′3）：当前技能文档 revision ≠ observedEndRevision → true；
      // 结果本体不可变，stale 只在投影层。技能消失（NOT_FOUND）→ 全部标 stale。
      let currentRevision: string | null = null;
      try {
        currentRevision = (await loadSkill(target)).revision;
      } catch {
        currentRevision = null;
      }
      return store.listResults(target).map((result) => ({
        ...result,
        stale: currentRevision === null || currentRevision !== result.observedEndRevision,
      }));
    },
    listCases(target) {
      return store.listCases(target);
    },
    createCase(input) {
      // 写门在 store（Global → EvaluationStoreError → RPC typed 拒绝）。
      const now = new Date().toISOString();
      const entry = {
        schemaVersion: 1 as const,
        caseId: newEvaluationId("ev_"),
        enabled: input.enabled ?? true,
        createdAt: now,
        updatedAt: now,
        source: "user" as const,
        boundRevision: input.boundRevision,
        input: input.input,
      };
      store.saveCase(input.target, entry);
      return entry;
    },
    updateCase(input) {
      const existing = store.listCases(input.target).find((entry) => entry.caseId === input.caseId);
      if (existing === undefined) {
        throw new Error(`NOT_FOUND: evaluation case ${input.caseId}`);
      }
      const next = {
        ...existing,
        enabled: input.enabled ?? existing.enabled,
        boundRevision: input.boundRevision,
        input: input.input,
        updatedAt: new Date().toISOString(),
      };
      store.saveCase(input.target, next);
      return next;
    },
    removeCase(input) {
      return store.removeCase(input.target, input.caseId);
    },
  };
}
