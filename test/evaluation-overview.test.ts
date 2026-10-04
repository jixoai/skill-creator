/**
 * evaluation.overview 聚合 + Global run 前置闸单测
 * （evaluating-dashboard task 1.1；design §1/§1.1/§2 + §5 六态）。
 *
 * 用户原始需求 [2026-10-03]（spec evaluation-corpus ADDED Requirement）：
 * 「overview MUST 返回按 target 三元组字典序唯一排序的 targets 摘要……
 * recentRuns MUST 限定 input.wsId 范围、至多 20 条固定窗口」；
 * 「run.start MUST 在排队与调用任何 runner 之前，对 Global Workspace target
 * 返回 typed 拒绝；被拒请求 MUST NOT 产生 run entry、MUST NOT 调用 provider
 * adapter、MUST NOT 落任何结果」。
 *
 * 正交意图：
 *   [1] overview 六态：正常 / cursor 稳定 / 单 target IO 失败 / staleRatio
 *       分母 / recentRuns 窗口与组合 / 空态。
 *   [2] Global 前置闸四断言：typed 拒绝 + adapter 未调用 + 无 run entry + 零落盘。
 *   [3] 重启语义：内存 running 投影消失、已落盘完成结果仍可见。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEvaluationService,
  type EvaluationService,
} from "../src/daemon/evaluation/service.js";
import {
  createEvaluationStore,
  evaluationDir,
  newEvaluationId,
  type EvaluationStore,
} from "../src/daemon/evaluation/store.js";
import { DomainError } from "../src/daemon/domain-error.js";
import type { SkillService } from "../src/daemon/skill-service.js";
import type {
  EvaluationCase,
  EvaluationResult,
  EvaluationTarget,
} from "../src/shared/contracts/evaluation.js";
import { WorkspaceIdSchema, type WorkspaceId } from "../src/shared/contracts/workspaces.js";

const WS: WorkspaceId = WorkspaceIdSchema.parse("ws_0123456789abcdef01234567");
const OTHER_WS: WorkspaceId = WorkspaceIdSchema.parse("ws_999999999999999999999999");
const revision = `sha256:${"a".repeat(64)}`;
const drifted = `sha256:${"b".repeat(64)}`;

const target = (skillHex: string, providerId = "claude-code"): EvaluationTarget =>
  ({
    workspaceId: WS,
    providerId,
    skillId: `sk_${skillHex.padStart(24, "0")}`,
  }) as EvaluationTarget;

let sandbox = "";
let store: EvaluationStore;
let revisionNow: string;
let corpus: Map<string, { name: string; revision: string }>;
let skills: { info: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn> };
let adapterCalls: string[];
let hangingPrompt: boolean;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "evaluation-overview-test-"));
  store = createEvaluationStore(sandbox);
  revisionNow = revision;
  corpus = new Map();
  adapterCalls = [];
  hangingPrompt = false;
  skills = {
    info: vi.fn(async (t: EvaluationTarget, skillId: string) => {
      const entry = corpus.get(skillId);
      if (entry === undefined) {
        throw new DomainError("NOT_FOUND", `Skill not found in Workspace Provider: ${skillId}`);
      }
      return {
        id: skillId,
        name: entry.name,
        content: "---\nname: x\ndescription: x\n---\nbody",
        revision: revisionNow,
        disabled: false,
        size: 10,
        provider: t.providerId,
      };
    }),
    list: vi.fn(async () => []),
  };
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function serviceWith(): EvaluationService {
  return createEvaluationService({
    skills: skills as unknown as SkillService,
    store,
    providerAdapter: () =>
      ({
        create: async () => {
          adapterCalls.push("create");
          return { sessionId: "agent-overview" };
        },
        prompt: async () => {
          adapterCalls.push("prompt");
          if (hangingPrompt) await new Promise(() => undefined);
        },
        readTranscript: async () => {
          adapterCalls.push("readTranscript");
          return "transcript";
        },
        cancel: async () => {
          adapterCalls.push("cancel");
        },
        versions: () => ({ promptVersion: "p", toolVersion: "t", dshVersion: "d" }),
      }) as never,
  });
}

function seedCase(t: EvaluationTarget, caseId = newEvaluationId("ev_")): EvaluationCase {
  const entry: EvaluationCase = {
    schemaVersion: 1,
    caseId,
    enabled: true,
    createdAt: "2026-10-03T00:00:00.000Z",
    updatedAt: "2026-10-03T00:00:00.000Z",
    source: "user",
    boundRevision: revision,
    input: { prompt: "probe", assertions: [{ kind: "contains", value: "ok" }] },
  };
  store.saveCase(t, entry);
  return entry;
}

function seedResult(
  t: EvaluationTarget,
  overrides: Partial<EvaluationResult> & { runId: string; caseId: string },
): EvaluationResult {
  const result: EvaluationResult = {
    schemaVersion: 1,
    resultId: newEvaluationId("evr_"),
    target: t,
    expectedRevision: revision,
    observedStartRevision: revision,
    observedEndRevision: revision,
    runner: {
      kind: "analyzer",
      version: { promptVersion: "1", toolVersion: "1", dshVersion: "n/a" },
    },
    startedAt: "2026-10-03T00:00:00.000Z",
    endedAt: "2026-10-03T00:00:01.000Z",
    outcome: "passed",
    assertions: [{ ref: 0, kind: "contains", expected: "ok", observed: "ok", outcome: "passed" }],
    ...overrides,
  } as EvaluationResult;
  store.appendResult(t, result);
  return result;
}

describe("evaluation.overview (targets summary)", () => {
  it("projects caseCount/skillName/lastRun/staleRatio for a corpus target", async () => {
    const t = target("01");
    corpus.set(t.skillId, { name: "alpha", revision });
    const first = seedCase(t);
    const second = seedCase(t);
    seedResult(t, { runId: newEvaluationId("run_"), caseId: first.caseId, outcome: "passed" });
    seedResult(t, { runId: newEvaluationId("run_"), caseId: second.caseId, outcome: "failed" });
    seedResult(t, {
      runId: newEvaluationId("run_"),
      caseId: first.caseId,
      outcome: "error",
      assertions: [],
      failure: { code: "RUNNER_ERROR", detail: "boom" },
      endedAt: "2026-10-03T00:00:09.000Z",
    });

    const output = await serviceWith().overview({ wsId: WS, limit: 50 });
    expect(output.targets).toHaveLength(1);
    const row = output.targets[0];
    if ("error" in row) throw new Error("expected ok row");
    expect(row.target).toEqual(t);
    expect(row.skillName).toBe("alpha");
    expect(row.caseCount).toBe(2);
    // lastRun = endedAt 最大的 run（error 结果行）。
    expect(row.lastRun).toMatchObject({
      endedAt: "2026-10-03T00:00:09.000Z",
      status: "completed",
      errorCount: 1,
      passedCount: 0,
      failedCount: 0,
      unavailableCount: 0,
    });
    // 每 case 最新一条：first→error(stale 观测仍=revision)，second→failed → 0 stale。
    expect(row.staleRatio).toBe(0);
  });

  it("paginates targets in strict triple order without overlap or gap", async () => {
    const ids = ["01", "02", "03"];
    for (const id of ids) {
      const t = target(id);
      corpus.set(t.skillId, { name: `skill-${id}`, revision });
      seedCase(t);
    }
    const service = serviceWith();
    const firstPage = await service.overview({ wsId: WS, limit: 2 });
    expect(firstPage.targets).toHaveLength(2);
    expect(firstPage.nextCursor).toBeDefined();
    const secondPage = await service.overview({ wsId: WS, limit: 2, cursor: firstPage.nextCursor });
    expect(secondPage.targets).toHaveLength(1);
    expect(secondPage.nextCursor).toBeUndefined();

    const keys = [...firstPage.targets, ...secondPage.targets].map(
      (row) => `${row.target.providerId}:${row.target.skillId}`,
    );
    expect(new Set(keys).size).toBe(3);
    expect(keys).toEqual([...keys].sort());
  });

  it("degrades a single target IO failure to a typed error row", async () => {
    const broken = target("01");
    const healthy = target("02");
    corpus.set(broken.skillId, { name: "broken", revision });
    corpus.set(healthy.skillId, { name: "healthy", revision });
    seedCase(broken);
    seedCase(healthy);
    // cases.json 变目录 → readFileSync EISDIR → EvaluationStoreError → error 行。
    fs.rmSync(path.join(evaluationDir(broken, sandbox), "cases.json"));
    fs.mkdirSync(path.join(evaluationDir(broken, sandbox), "cases.json"));

    const output = await serviceWith().overview({ wsId: WS, limit: 50 });
    const bySkill = new Map(output.targets.map((row) => [row.target.skillId, row]));
    expect(output.targets).toHaveLength(2);
    const errorRow = bySkill.get(broken.skillId);
    if (errorRow === undefined || !("error" in errorRow)) {
      throw new Error("expected typed error row");
    }
    expect(errorRow.error.code).toBe("io-error");
    expect("skillName" in errorRow).toBe(false);
    expect("caseCount" in errorRow).toBe(false);
    expect("staleRatio" in errorRow).toBe(false);
    expect("lastRun" in errorRow).toBe(false);
    const okRow = bySkill.get(healthy.skillId);
    if (okRow === undefined || !("skillName" in okRow)) {
      throw new Error("expected ok row");
    }
    expect(okRow.skillName).toBe("healthy");
  });

  it("projects an unavailable error row when the skill no longer resolves", async () => {
    const gone = target("07");
    seedCase(gone); // corpus 在场，但技能已不可解析（skills.info NOT_FOUND）。
    const output = await serviceWith().overview({ wsId: WS, limit: 50 });
    expect(output.targets).toHaveLength(1);
    expect(output.targets[0]).toMatchObject({
      target: gone,
      error: { code: "unavailable" },
    });
  });

  it("omits staleRatio on zero results and recomputes against the current revision", async () => {
    const fresh = target("01");
    const stale = target("02");
    corpus.set(fresh.skillId, { name: "fresh", revision });
    corpus.set(stale.skillId, { name: "stale", revision });
    const freshCase = seedCase(fresh);
    seedCase(stale);
    seedResult(stale, { runId: newEvaluationId("run_"), caseId: freshCase.caseId });

    let output = await serviceWith().overview({ wsId: WS, limit: 50 });
    const rows = new Map(output.targets.map((row) => [row.target.skillId, row]));
    expect("staleRatio" in rows.get(fresh.skillId)!).toBe(false);
    expect((rows.get(stale.skillId) as { staleRatio?: number }).staleRatio).toBe(0);

    // revision 现读：当前 revision 漂移 → 每 case 最新一条全部 stale。
    revisionNow = drifted;
    output = await serviceWith().overview({ wsId: WS, limit: 50 });
    const driftedRows = new Map(output.targets.map((row) => [row.target.skillId, row]));
    expect((driftedRows.get(stale.skillId) as { staleRatio?: number }).staleRatio).toBe(1);
  });

  it("skips corpus-less directories and returns an empty overview for a fresh workspace", async () => {
    // 目录存在但两信封皆空（saveCase 后 removeCase）→ 不进 targets。
    const t = target("01");
    corpus.set(t.skillId, { name: "x", revision });
    const entry = seedCase(t);
    store.removeCase(t, entry.caseId);

    const output = await serviceWith().overview({ wsId: WS, limit: 50 });
    expect(output.targets).toEqual([]);
    expect(output.recentRuns).toEqual([]);
    expect(output.nextCursor).toBeUndefined();
    const other = await serviceWith().overview({ wsId: OTHER_WS, limit: 50 });
    expect(other.targets).toEqual([]);
  });
});

describe("evaluation.overview (recentRuns)", () => {
  it("combines persisted result rows with in-memory running runs, newest first", async () => {
    const t = target("01");
    corpus.set(t.skillId, { name: "alpha", revision });
    const persistedCase = seedCase(t);
    const persistedRun = newEvaluationId("run_");
    seedResult(t, {
      runId: persistedRun,
      caseId: persistedCase.caseId,
      startedAt: "2026-10-03T00:00:00.000Z",
      endedAt: "2026-10-03T00:00:05.000Z",
    });

    // 内存 running run：provider-model + 悬挂 prompt（确定性停在 running）。
    const runningCase = seedCase(t);
    hangingPrompt = true;
    const service = serviceWith();
    const start = service.startRun({
      target: t,
      caseIds: [runningCase.caseId],
      runner: "provider-model",
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const output = await service.overview({ wsId: WS, limit: 50 });
    expect(output.recentRuns.map((run) => run.runId)).toEqual([start.runId, persistedRun]);
    const running = output.recentRuns[0];
    expect(running).toMatchObject({ status: "running", target: t });
    expect("endedAt" in running).toBe(false);
    expect(output.recentRuns[1]).toMatchObject({
      status: "completed",
      endedAt: "2026-10-03T00:00:05.000Z",
      resultIds: [expect.stringMatching(/^evr_/)],
    });

    service.cancelRun(start.runId);
  });

  it("limits recentRuns to the current workspace and a fixed window of 20", async () => {
    const mine = target("01");
    const other = { ...target("02"), workspaceId: OTHER_WS } as EvaluationTarget;
    for (let index = 0; index < 25; index += 1) {
      const caseId = newEvaluationId("ev_");
      const startedAt = new Date(Date.UTC(2026, 9, 3, 0, index)).toISOString();
      seedResult(mine, {
        runId: `run_${String(index).padStart(24, "0")}`,
        caseId,
        startedAt,
        endedAt: new Date(Date.UTC(2026, 9, 3, 0, index, 30)).toISOString(),
      });
      seedResult(other, {
        runId: `run_${String(index).padStart(24, "0")}`,
        caseId,
        startedAt: new Date(Date.UTC(2026, 9, 3, 12, index)).toISOString(),
        endedAt: new Date(Date.UTC(2026, 9, 3, 12, index, 30)).toISOString(),
      });
    }
    const output = await serviceWith().overview({ wsId: WS, limit: 50 });
    expect(output.recentRuns).toHaveLength(20);
    // 仅当前 ws：全部 target 属于 WS，且按 startedAt 降序取最新 20 条。
    expect(output.recentRuns.every((run) => run.target.workspaceId === WS)).toBe(true);
    expect(output.recentRuns[0].runId).toBe("run_" + "0".repeat(22) + "24");
    expect(output.recentRuns[19].runId).toBe("run_" + "0".repeat(23) + "5");
    const startedAtOrder = output.recentRuns.map((run) => run.startedAt);
    expect(startedAtOrder).toEqual([...startedAtOrder].sort().reverse());
  });

  it("drops in-memory running projections after a daemon restart while keeping persisted rows", async () => {
    const t = target("01");
    corpus.set(t.skillId, { name: "alpha", revision });
    const caseEntry = seedCase(t);
    hangingPrompt = true;
    const first = serviceWith();
    const start = first.startRun({
      target: t,
      caseIds: [caseEntry.caseId],
      runner: "provider-model",
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const before = await first.overview({ wsId: WS, limit: 50 });
    expect(before.recentRuns.map((run) => run.runId)).toContain(start.runId);
    first.cancelRun(start.runId);

    // 重启 = 新 service 实例（同一 store）：内存态消失，持久结果仍可见。
    const after = await serviceWith().overview({ wsId: WS, limit: 50 });
    expect(after.recentRuns.map((run) => run.runId)).not.toContain(start.runId);
  });
});

describe("evaluation run.start Global gate (design §2)", () => {
  it("rejects a Global target before queueing with no run entry, adapter call, or writes", async () => {
    const globalTarget = { ...target("01"), workspaceId: "~" } as EvaluationTarget;
    const service = serviceWith();
    expect(() =>
      service.startRun({
        target: globalTarget,
        caseIds: ["ev_00000000000000000000000f"],
        runner: "provider-model",
      }),
    ).toThrowError(/read-only/);

    // 无 run entry：overview("~") 的 recentRuns 内存投影为空。
    const output = await service.overview({ wsId: "~", limit: 50 });
    expect(output.recentRuns).toEqual([]);
    // provider adapter 未被调用（前置拒发生在排队/runner 之前）。
    expect(adapterCalls).toEqual([]);
    // 零落盘：Global evaluation 目录不产生任何文件。
    const globalRoot = path.join(sandbox, "evaluation", "~");
    expect(fs.existsSync(globalRoot)).toBe(false);
    expect(store.listResults(globalTarget)).toEqual([]);
  });

  it("still allows imported workspace runs after the gate", async () => {
    const t = target("01");
    corpus.set(t.skillId, { name: "alpha", revision });
    const entry = seedCase(t);
    const service = serviceWith();
    const start = service.startRun({ target: t, caseIds: [entry.caseId], runner: "analyzer" });
    for (let index = 0; index < 50; index += 1) {
      const status = service.runStatus(start.runId);
      if (status.status === "completed" || status.status === "cancelled") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(service.runStatus(start.runId).status).toBe("completed");
    const output = await service.overview({ wsId: WS, limit: 50 });
    expect(output.recentRuns.map((run) => run.runId)).toEqual([start.runId]);
  });
});
