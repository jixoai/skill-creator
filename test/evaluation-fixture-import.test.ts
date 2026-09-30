/**
 * builtin fixture 导入器测试（evaluation-corpus 任务 2.2；B4 细则）。
 *
 * 用户原始需求 [2026-09-30]：「webui 里面还有一些残留的未完成的工作，比如 skill
 * 测试与评估」。
 *
 * 正交意图：
 *   [1] 十条期望矩阵 → case 映射（expectTrigger 布尔断言 + expectedKinds）+
 *       幂等（corpusDigest 重复跳过）+ 双 hash 域分离。
 *   [2] fixture 语料分析分支：digest 定位 → analyzer 确定性跑分（期望矩阵
 *       的判定面迁移到评估协议上的实证）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEvaluationStore } from "../src/daemon/evaluation/store.js";
import {
  createFixtureImporter,
  fixtureCorpusDocuments,
} from "../src/daemon/evaluation/fixture-import.js";
import { createEvaluationService } from "../src/daemon/evaluation/service.js";
import type { SkillService } from "../src/daemon/skill-service.js";
import type { EvaluationTarget } from "../src/shared/contracts/evaluation.js";

const target: EvaluationTarget = {
  workspaceId: "ws_0123456789abcdef01234567",
  providerId: "claude-code",
  skillId: "sk_0123456789abcdef01234567",
} as const;

let sandbox = "";

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "evaluation-fixture-test-"));
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

const skills = {
  info: vi.fn(async () => {
    throw new Error("NOT_FOUND");
  }),
  list: vi.fn(async () => []),
} as unknown as SkillService;

describe("fixture importer (B4 细则)", () => {
  it("imports the ten-corpus expectation matrix with boolean trigger assertions", () => {
    const store = createEvaluationStore(sandbox);
    const importer = createFixtureImporter({ store, skills });
    const result = importer.importAll(target);
    expect(result.imported + result.skipped).toBeGreaterThanOrEqual(10);
    const cases = store.listCases(target);
    expect(cases.length).toBeGreaterThanOrEqual(10);
    for (const entry of cases) {
      expect(entry.source).toBe("builtin-fixture");
      expect(entry.corpusDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(entry.boundRevision).toMatch(/^sha256:[a-f0-9]{64}$/);
      // 首断言恒为布尔触发断言（expectTrigger 域）。
      expect(entry.input.assertions[0]).toMatchObject({ kind: "finding-triggered" });
      expect(typeof (entry.input.assertions[0] as { value: unknown }).value).toBe("boolean");
    }
  });

  it("is idempotent by corpus digest (second import skips all)", () => {
    const store = createEvaluationStore(sandbox);
    const importer = createFixtureImporter({ store, skills });
    const first = importer.importAll(target);
    const second = importer.importAll(target);
    expect(second.imported).toBe(0);
    expect(second.caseIds.sort()).toEqual(first.caseIds.sort());
  });

  it("runs the fixture corpus deterministically through the analyzer runner (expectation matrix migration)", async () => {
    const store = createEvaluationStore(sandbox);
    const importer = createFixtureImporter({ store, skills });
    const { caseIds } = importer.importAll(target);
    const service = createEvaluationService({ skills, store });
    const start = service.startRun({ target, caseIds, runner: "analyzer" });
    for (let i = 0; i < 100; i += 1) {
      const status = service.runStatus(start.runId);
      if (status.status === "completed" || status.status === "cancelled") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const results = await service.results(target);
    expect(results.length).toBeGreaterThanOrEqual(10);
    // 确定性回归面：全部 fixture case 跑出终态且非 error/unavailable。
    for (const result of results) {
      expect(["passed", "failed", "stale"]).toContain(result.outcome);
    }
    // 期望矩阵的判定语义保留：should-trigger 组的全部 passed（期望触发且
    // 期望 kind 命中）。抽取一个 duplicate-name 断言实证。
    const duplicateCase = store
      .listCases(target)
      .find((entry) =>
        entry.input.assertions.some(
          (a) => a.kind === "finding-kind" && a.value === "duplicate-name",
        ),
      );
    expect(duplicateCase).toBeDefined();
    const duplicateResult = results.find((result) => result.caseId === duplicateCase!.caseId);
    expect(duplicateResult?.outcome).toBe("passed");
  });

  it("resolves fixture corpus documents by digest (primary-first projection)", () => {
    const store = createEvaluationStore(sandbox);
    const importer = createFixtureImporter({ store, skills });
    const { caseIds } = importer.importAll(target);
    const first = store.listCases(target).find((entry) => entry.caseId === caseIds[0]);
    const docs = fixtureCorpusDocuments(first!.corpusDigest!);
    expect(docs).not.toBeNull();
    expect(docs!.length).toBeGreaterThan(0);
    expect(docs![0].content).toContain("---");
    expect(fixtureCorpusDocuments(`${"0".repeat(64)}`)).toBeNull();
  });
});
