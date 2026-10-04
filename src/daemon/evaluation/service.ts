/**
 * 评估跑分编排（evaluation-corpus B4/B5/B′4；工作计划 Ch3）。
 *
 * 用户原始需求 [2026-09-30]：「webui 里面还有一些残留的未完成的工作，比如 skill
 * 测试与评估」。
 * 修订 [2026-10-03]（evaluating-dashboard task 1.1）：补 `overview` 聚合（targets
 * 字典序 cursor 分页 + recentRuns 固定窗口 20 + staleRatio revision 现读）与
 * Global run 前置闸（design §2 r2：排队/runner 之前拒绝——不产生 run entry、
 * 不触 adapter、零落盘）。
 * 修订 [2026-10-04]（evaluating-world-class task 1.1）：断言裁决补冻结文本
 * kind/expected/observed（contains 族 = 有界摘录；finding 族 = 规范化值列表
 * /布尔）——期望 vs 观测 diff 双栏的 run 时数据源。
 *
 * 正交意图：
 *   [1] run 生命周期：start→{runId,queued}；内存态表 + 结果落盘；cancel 竞态
 *       胜者（completed 后幂等、running→终态 cancelled 且已写结果保留）。
 *   [2] 五态裁决：revision 闸（前/中漂移→stale）；passed 仅来自全部断言通过；
 *       unavailable（依赖族）/error（执行族）互斥。
 *   [3] analyzer runner：provider 语料全量分析 → 断言映射（finding-triggered/
 *       kind/severity/contains/not-contains）。
 *   [4] overview 聚合：per-target 评估状态摘要（单 target IO 失败 typed 降级，
 *       整页不失败；recentRuns = 持久结果行 + 内存 running/queued 组合）。
 */
import type { SkillService } from "../skill-service.js";
import type {
  EvaluationAssertion,
  EvaluationCase,
  EvaluationResult,
  EvaluationRunStatus,
  EvaluationTarget,
  EvaluationRunner,
  EvaluationOverviewOutput,
  EvaluationOverviewRecentRun,
} from "../../shared/contracts/evaluation.js";
import {
  decodeEvaluationOverviewCursor,
  encodeEvaluationOverviewCursor,
} from "../../shared/contracts/evaluation.js";
import { GLOBAL_WORKSPACE_ID, type WorkspaceId } from "../../shared/contracts/workspaces.js";
import { DomainError } from "../domain-error.js";
import {
  createEvaluationStore,
  EvaluationStoreError,
  newEvaluationId,
  type EvaluationStore,
} from "./store.js";
import { analyzeDocuments, type AnalyzerFinding } from "../skill-intelligence/analyzer.js";
import { fixtureCorpusDocuments } from "./fixture-import.js";

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
  target: EvaluationTarget;
  status: EvaluationRunStatus;
  resultIds: string[];
  cancelTarget: string | null;
  /** overview 的内存投影源（recentRuns 排序键；startedAt = startRun 时刻）。 */
  startedAt: string;
  endedAt: string | null;
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
  /** Evaluating 总览聚合（targets 摘要 + recentRuns 固定窗口；readonly）。 */
  overview(input: {
    wsId: WorkspaceId;
    cursor?: string;
    limit: number;
  }): Promise<EvaluationOverviewOutput>;
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

/** recentRuns 固定窗口（design §1 r3：不分页，startedAt 降序 + runId tie-break）。 */
const RECENT_RUNS_WINDOW = 20;

/** overview 枚举行：正常（cases+results 就绪）或 typed error（IO 失败降级）。 */
type OverviewTargetRow =
  | {
      kind: "ok";
      target: EvaluationTarget;
      cases: EvaluationCase[];
      results: EvaluationResult[];
    }
  | {
      kind: "error";
      target: EvaluationTarget;
      error: { code: "unavailable" | "io-error"; message: string };
    };

/** 单 target 技能读取失败 → typed code 闭集（DomainError=不可解析/fs 错误=io）。 */
function classifyTargetError(error: unknown): {
  code: "unavailable" | "io-error";
  message: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof DomainError) return { code: "unavailable", message };
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (
    code === "EACCES" ||
    code === "EPERM" ||
    code === "EIO" ||
    code === "ENOSPC" ||
    code === "EROFS"
  ) {
    return { code: "io-error", message };
  }
  return { code: "unavailable", message };
}

/** 按 runId 聚合结果行（run 绑定单一 target：startRun 契约保证）。 */
function groupResultsByRun(results: readonly EvaluationResult[]): Map<string, EvaluationResult[]> {
  const byRun = new Map<string, EvaluationResult[]>();
  for (const result of results) {
    const bucket = byRun.get(result.runId) ?? [];
    bucket.push(result);
    byRun.set(result.runId, bucket);
  }
  return byRun;
}

/** target 三元组字典序游标比较（含起始行）：row 是否位于 key 或其后。 */
function targetAtOrAfterKey(
  target: EvaluationTarget,
  key: { providerId: string; skillId: string },
): boolean {
  if (target.providerId !== key.providerId) return target.providerId > key.providerId;
  return target.skillId >= key.skillId;
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

  /** observed 摘录上限（evaluating-world-class design §5：有界，不含结果全文）。 */
  const OBSERVED_EXCERPT_MAX = 200;

  /**
   * contains 族观测摘录：命中处为中心的窗口（未命中 = 检索面末段）；空白
   * 折叠为单空格，越界加省略号。空文本 → 空串（UI 侧渲染「无输出」）。
   */
  const observedExcerpt = (text: string, needle: string): string => {
    const clean = text.replaceAll(/\s+/g, " ").trim();
    if (clean === "") return "";
    const at = clean.indexOf(needle);
    if (at === -1) {
      return clean.length <= OBSERVED_EXCERPT_MAX
        ? clean
        : `…${clean.slice(clean.length - OBSERVED_EXCERPT_MAX)}`;
    }
    const start = Math.max(0, at - Math.floor(OBSERVED_EXCERPT_MAX / 2));
    const end = start + OBSERVED_EXCERPT_MAX;
    return `${start > 0 ? "…" : ""}${clean.slice(start, end)}${end < clean.length ? "…" : ""}`;
  };

  /**
   * 单断言裁决 + 冻结文本（evaluating-world-class task 1.1）：outcome 与
   * observed 同源生成（永不矛盾）；expected = 断言定义规范化。finding 族
   * observed = 规范化值列表（逗号连接，缺席 = 空串）或 "true"/"false"。
   */
  const judgeAssertion = (
    assertion: EvaluationAssertion,
    ctx: { text: string; findings: AnalyzerFinding[] },
  ): {
    kind: EvaluationAssertion["kind"];
    expected: string;
    observed: string;
    outcome: "passed" | "failed";
  } => {
    const uniqueValues = (values: string[]): string => [...new Set(values)].sort().join(", ");
    switch (assertion.kind) {
      case "contains":
        return {
          kind: assertion.kind,
          expected: assertion.value,
          observed: observedExcerpt(ctx.text, assertion.value),
          outcome: ctx.text.includes(assertion.value) ? "passed" : "failed",
        };
      case "not-contains":
        return {
          kind: assertion.kind,
          expected: assertion.value,
          observed: observedExcerpt(ctx.text, assertion.value),
          outcome: ctx.text.includes(assertion.value) ? "failed" : "passed",
        };
      case "finding-kind":
        return {
          kind: assertion.kind,
          expected: assertion.value,
          observed: uniqueValues(ctx.findings.map((finding) => finding.kind)),
          outcome: ctx.findings.some((finding) => finding.kind === assertion.value)
            ? "passed"
            : "failed",
        };
      case "finding-triggered":
        return {
          kind: assertion.kind,
          expected: String(assertion.value),
          observed: String(ctx.findings.length > 0),
          outcome: ctx.findings.length > 0 === assertion.value ? "passed" : "failed",
        };
      case "finding-severity":
        return {
          kind: assertion.kind,
          expected: assertion.value,
          observed: uniqueValues(ctx.findings.map((finding) => finding.severity)),
          outcome: ctx.findings.some((finding) => finding.severity === assertion.value)
            ? "passed"
            : "failed",
        };
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
      source: "user" | "builtin-fixture";
      corpusDigest?: string;
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
      const isFixture = runCase.source === "builtin-fixture" && runCase.corpusDigest !== undefined;
      // fixture × analyzer：确定性回归分支先行——不触活技能加载（目标技能可能
      // 已被移动/删除，fixture 闸在 fixture 域自洽）。
      if (isFixture && runner.kind === "analyzer") {
        const fixtureDocs = fixtureCorpusDocuments(runCase.corpusDigest!);
        if (fixtureDocs === null) {
          return { ...base, outcome: "stale", assertions: [] };
        }
        const { findings } = analyzeDocuments(fixtureDocs);
        const primary = fixtureDocs[0];
        const mine = findings.filter((finding) => finding.skillIds.includes(primary.skillId));
        const assertions = runCase.input.assertions.map((assertion, index) => ({
          ref: index,
          ...judgeAssertion(assertion, { text: primary.content, findings: mine }),
        }));
        const allPassed = assertions.every((item) => item.outcome === "passed");
        return {
          ...base,
          observedStartRevision: runCase.boundRevision,
          observedEndRevision: runCase.boundRevision,
          outcome: allPassed ? "passed" : "failed",
          assertions,
        };
      }
      const current = await loadSkill(target);
      // 活技能域的 revision 前闸只约束 user case（fixture case 的闸在 fixture 域）。
      if (!isFixture && current.revision !== runCase.boundRevision) {
        // r7 阻塞修复：end 观察值 = 当前实际读到的 revision（base 模板回填的
        // bound 值会把「回滚后仍 stale」的展示语义弄丢）。
        return {
          ...base,
          observedStartRevision: current.revision,
          observedEndRevision: current.revision,
          outcome: "stale",
          assertions: [],
        };
      }
      if (isFixture) {
        // fixture × provider-model：依赖不匹配（fixture 是 analyzer 域回归样本）
        // ——依赖族 unavailable，不伪装通过；run.start 侧另有前置拒绝。
        return {
          ...base,
          observedStartRevision: runCase.boundRevision,
          outcome: "unavailable",
          assertions: [],
          failure: {
            code: "DSH_UNAVAILABLE",
            detail: "provider-model runner does not support builtin-fixture cases",
          },
        };
      }
      if (runner.kind === "analyzer") {
        const corpus = await providerCorpus(target);
        const { findings } = analyzeDocuments(corpus);
        const mine = findingsFor(findings, target.skillId);
        const text = corpus.find((doc) => doc.skillId === target.skillId)?.content ?? "";
        const assertions = runCase.input.assertions.map((assertion, index) => ({
          ref: index,
          ...judgeAssertion(assertion, { text, findings: mine }),
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
          ...judgeAssertion(assertion, { text: transcript, findings: [] }),
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
      // Global 前置闸（evaluating-dashboard design §2 r2）：在 runs.set 与排队
      // 之前拒绝——不产生 run entry、不触 provider adapter、零落盘（RPC 入口
      // 有同一闸先行；此处兜底所有进程内调用方）。
      if (input.target.workspaceId === GLOBAL_WORKSPACE_ID) {
        throw new DomainError(
          "INVALID_OPERATION",
          `Global Workspace ${GLOBAL_WORKSPACE_ID} is read-only; evaluation runs require an Imported Workspace target`,
        );
      }
      const runId = newEvaluationId("run_");
      const entry: RunEntry = {
        runId,
        target: input.target,
        status: "queued",
        resultIds: [],
        cancelTarget: null,
        startedAt: new Date().toISOString(),
        endedAt: null,
      };
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
        entry.endedAt = new Date().toISOString();
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
    async overview(input) {
      let enumerated: EvaluationTarget[];
      try {
        // 仅读取 input.wsId 的 evaluation 目录（不触碰其他 ws）。
        enumerated = store.listTargets(input.wsId);
      } catch (error) {
        // 枚举面 IO hard error → typed 整页失败（不伪装空态）。
        throw new DomainError(
          "UNAVAILABLE",
          `evaluation overview enumeration failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { cause: error },
        );
      }
      const rows: OverviewTargetRow[] = [];
      for (const target of enumerated) {
        try {
          const cases = store.listCases(target);
          const results = store.listResults(target);
          // 无语料目录（cases 与 results 皆空）不进 targets。
          if (cases.length === 0 && results.length === 0) continue;
          rows.push({ kind: "ok", target, cases, results });
        } catch (error) {
          // 单 target IO 失败降级：typed error 行 + 摘要缺席，整页不失败。
          const message = error instanceof Error ? error.message : String(error);
          rows.push({
            kind: "error",
            target,
            error: {
              code: error instanceof EvaluationStoreError ? "io-error" : "unavailable",
              message,
            },
          });
        }
      }

      // recentRuns 组合：持久结果行按 runId 聚合 + 内存 running/queued 投影
      // （同 runId 内存胜出——状态真相在 service；重启后内存部分自然消失）。
      const recentById = new Map<string, EvaluationOverviewRecentRun>();
      for (const row of rows) {
        if (row.kind !== "ok" || row.results.length === 0) continue;
        for (const [runId, bucket] of groupResultsByRun(row.results)) {
          const first = bucket[0];
          recentById.set(runId, {
            runId,
            target: row.target,
            status: "completed",
            startedAt: bucket.reduce(
              (min, item) => (item.startedAt < min ? item.startedAt : min),
              first.startedAt,
            ),
            endedAt: bucket.reduce(
              (max, item) => (item.endedAt > max ? item.endedAt : max),
              first.endedAt,
            ),
            resultIds: bucket.map((item) => item.resultId),
          });
        }
      }
      for (const entry of runs.values()) {
        if (entry.target.workspaceId !== input.wsId) continue;
        recentById.set(entry.runId, {
          runId: entry.runId,
          target: entry.target,
          status: entry.status,
          startedAt: entry.startedAt,
          ...(entry.endedAt === null ? {} : { endedAt: entry.endedAt }),
          resultIds: [...entry.resultIds],
        });
      }
      const recentRuns = [...recentById.values()]
        .sort((left, right) => {
          // startedAt 降序 + runId 字典序 tie-break（design §1 r3）。
          if (left.startedAt !== right.startedAt) return left.startedAt < right.startedAt ? 1 : -1;
          return left.runId < right.runId ? -1 : left.runId > right.runId ? 1 : 0;
        })
        .slice(0, RECENT_RUNS_WINDOW);

      // targets 分页：rows 已按 (providerId, skillId) 字典序；游标含起始行。
      let start = 0;
      if (input.cursor !== undefined) {
        const key = decodeEvaluationOverviewCursor(input.cursor);
        if (key === null) {
          throw new DomainError("INVALID_OPERATION", "malformed evaluation overview cursor");
        }
        const index = rows.findIndex((row) => targetAtOrAfterKey(row.target, key));
        start = index === -1 ? rows.length : index;
      }
      const pageRows = rows.slice(start, start + input.limit);
      const nextRow = rows[start + input.limit];

      const targets: EvaluationOverviewOutput["targets"] = [];
      for (const row of pageRows) {
        if (row.kind === "error") {
          targets.push({ target: row.target, error: row.error });
          continue;
        }
        // 当前 revision 现读（不缓存）；读取失败 → typed error 行 + 摘要缺席。
        let info: SkillDocument["info"];
        try {
          info = await loadSkill(row.target);
        } catch (error) {
          targets.push({ target: row.target, error: classifyTargetError(error) });
          continue;
        }
        // staleRatio：每 case 最新一条（caseId 分组、endedAt 最新、resultId
        // tie-break）；分母 = 有结果的 case 数，零分母缺席（不返回 0/NaN）。
        const latestByCase = new Map<string, EvaluationResult>();
        for (const result of row.results) {
          const existing = latestByCase.get(result.caseId);
          if (
            existing === undefined ||
            result.endedAt > existing.endedAt ||
            (result.endedAt === existing.endedAt && result.resultId > existing.resultId)
          ) {
            latestByCase.set(result.caseId, result);
          }
        }
        const staleRatio =
          latestByCase.size === 0
            ? undefined
            : [...latestByCase.values()].filter(
                (result) => result.observedEndRevision !== info.revision,
              ).length / latestByCase.size;
        // lastRun：已落盘结果中 endedAt 最大的 run（持久投影无 run 状态，
        // status=completed；overview 不承诺持久 run 历史）。
        let bestRun: { endedAt: string; results: EvaluationResult[] } | null = null;
        for (const bucket of groupResultsByRun(row.results).values()) {
          const first = bucket[0];
          const endedAt = bucket.reduce(
            (max, item) => (item.endedAt > max ? item.endedAt : max),
            first.endedAt,
          );
          if (bestRun === null || endedAt > bestRun.endedAt) bestRun = { endedAt, results: bucket };
        }
        const lastRun =
          bestRun === null
            ? undefined
            : {
                endedAt: bestRun.endedAt,
                status: "completed" as const,
                passedCount: bestRun.results.filter((result) => result.outcome === "passed").length,
                failedCount: bestRun.results.filter((result) => result.outcome === "failed").length,
                errorCount: bestRun.results.filter((result) => result.outcome === "error").length,
                unavailableCount: bestRun.results.filter(
                  (result) => result.outcome === "unavailable",
                ).length,
              };
        targets.push({
          target: row.target,
          skillName: info.name,
          caseCount: row.cases.length,
          ...(lastRun === undefined ? {} : { lastRun }),
          ...(staleRatio === undefined ? {} : { staleRatio }),
        });
      }

      return {
        targets,
        recentRuns,
        ...(nextRow === undefined
          ? {}
          : {
              nextCursor: encodeEvaluationOverviewCursor({
                providerId: nextRow.target.providerId,
                skillId: nextRow.target.skillId,
              }),
            }),
      };
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
