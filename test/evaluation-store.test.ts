/**
 * 评估存储单测（evaluation-corpus B1/B′6 任务 4.1/4.2）。
 *
 * 用户原始需求 [2026-09-30]：「webui 里面还有一些残留的未完成的工作，比如 skill
 * 测试与评估」。
 *
 * 正交意图：
 *   [1] Zod 正负例：case/result 全字段（判别联合 + 失败码互斥 refine + 空
 *       assertions 语义）。
 *   [2] 存储纪律：空信封重建、Global 只读门、有界保留、幂等追加、原子写
 *       hard error 不静默。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EvaluationCaseSchema,
  EvaluationResultSchema,
} from "../src/shared/contracts/evaluation.js";
import {
  corpusDigestOf,
  createEvaluationStore,
  evaluationDir,
  EvaluationStoreError,
  newEvaluationId,
} from "../src/daemon/evaluation/store.js";

const target = {
  workspaceId: "ws_0123456789abcdef01234567",
  providerId: "claude-code",
  skillId: "sk_0123456789abcdef01234567",
} as const;
const globalTarget = { ...target, workspaceId: "~" as const };
const revision = `sha256:${"a".repeat(64)}`;

let sandbox = "";

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "evaluation-store-test-"));
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function makeCase(overrides: Partial<Parameters<typeof EvaluationCaseSchema.parse>[0]> = {}) {
  return {
    schemaVersion: 1 as const,
    caseId: newEvaluationId("ev_"),
    enabled: true,
    createdAt: "2026-09-30T00:00:00.000Z",
    updatedAt: "2026-09-30T00:00:00.000Z",
    source: "user" as const,
    boundRevision: revision,
    input: {
      prompt: "probe",
      assertions: [{ kind: "contains" as const, value: "ok" }],
    },
    ...overrides,
  };
}

function makeResult(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    resultId: newEvaluationId("evr_"),
    runId: newEvaluationId("run_"),
    caseId: newEvaluationId("ev_"),
    target,
    expectedRevision: revision,
    observedStartRevision: revision,
    observedEndRevision: revision,
    runner: {
      kind: "analyzer",
      version: { promptVersion: "1", toolVersion: "1", dshVersion: "n/a" },
    },
    outcome: "passed",
    assertions: [{ ref: 0, outcome: "passed" }],
    startedAt: "2026-09-30T00:00:00.000Z",
    endedAt: "2026-09-30T00:00:01.000Z",
    ...overrides,
  };
}

describe("evaluation schemas (task 4.1)", () => {
  it("accepts a valid case and result", () => {
    expect(EvaluationCaseSchema.safeParse(makeCase()).success).toBe(true);
    expect(EvaluationResultSchema.safeParse(makeResult()).success).toBe(true);
  });

  it("rejects an empty assertion set and illegal failure-code pairings", () => {
    expect(
      EvaluationCaseSchema.safeParse(makeCase({ input: { prompt: "p", assertions: [] } })).success,
    ).toBe(false);
    // error 携带依赖族码 / unavailable 携带执行族码 → refine 拒绝。
    expect(
      EvaluationResultSchema.safeParse(
        makeResult({ outcome: "error", failure: { code: "MODEL_UNAVAILABLE", detail: "x" } }),
      ).success,
    ).toBe(false);
    expect(
      EvaluationResultSchema.safeParse(
        makeResult({
          outcome: "unavailable",
          failure: { code: "RUNNER_ERROR", detail: "x" },
          assertions: [],
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects passed/failed without assertions and stale/unavailable with assertions", () => {
    expect(EvaluationResultSchema.safeParse(makeResult({ assertions: [] })).success).toBe(false);
    expect(
      EvaluationResultSchema.safeParse(
        makeResult({ outcome: "stale", assertions: [{ ref: 0, outcome: "passed" }] }),
      ).success,
    ).toBe(false);
    expect(
      EvaluationResultSchema.safeParse(
        makeResult({
          outcome: "unavailable",
          assertions: [],
          failure: { code: "MODEL_UNAVAILABLE", detail: "down" },
        }),
      ).success,
    ).toBe(true);
  });
});

describe("evaluation store (task 4.2)", () => {
  it("round-trips cases and rebuilds an empty envelope from corrupt content", () => {
    const store = createEvaluationStore(sandbox);
    const entry = makeCase();
    store.saveCase(target, entry);
    expect(store.listCases(target)).toHaveLength(1);
    // 腐坏 → 空信封；随后写入重建文件。
    fs.writeFileSync(path.join(evaluationDir(target, sandbox), "cases.json"), "{corrupt");
    expect(store.listCases(target)).toEqual([]);
    store.saveCase(target, entry);
    expect(store.listCases(target)).toHaveLength(1);
  });

  it("rejects writes on the global workspace and removes existing cases", () => {
    const store = createEvaluationStore(sandbox);
    expect(() => store.saveCase(globalTarget, makeCase())).toThrow(EvaluationStoreError);
    store.saveCase(target, makeCase());
    expect(store.removeCase(target, newEvaluationId("ev_"))).toBe(false);
    const [entry] = store.listCases(target);
    expect(store.removeCase(target, entry.caseId)).toBe(true);
    expect(store.listCases(target)).toEqual([]);
  });

  it("bounds results per case (20) and dedupes by resultId", () => {
    const store = createEvaluationStore(sandbox);
    const caseId = newEvaluationId("ev_");
    for (let i = 0; i < 25; i += 1) {
      store.appendResult(
        target,
        makeResult({ caseId, resultId: `evr_${String(i).padStart(24, "0")}` }),
      );
    }
    const results = store.listResults(target).filter((entry) => entry.caseId === caseId);
    expect(results).toHaveLength(20);
    expect(results[0].resultId).toBe("evr_" + "0".repeat(23) + "5");
    const before = store.listResults(target).length;
    store.appendResult(target, results[0]);
    expect(store.listResults(target)).toHaveLength(before);
  });

  it("freezes the corpus digest algorithm (sorted relative paths + byte concatenation)", () => {
    const digest = corpusDigestOf([
      { relativePath: "b.md", content: Buffer.from("B") },
      { relativePath: "a.md", content: Buffer.from("A") },
    ]);
    expect(digest).toBe(
      corpusDigestOf([
        { relativePath: "a.md", content: Buffer.from("A") },
        { relativePath: "b.md", content: Buffer.from("B") },
      ]),
    );
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });
});
