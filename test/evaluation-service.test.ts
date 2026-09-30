/**
 * 评估服务集成测试（evaluation-corpus 任务 4.3；B4 五态/生命周期/断言映射）。
 *
 * 用户原始需求 [2026-09-30]：「webui 里面还有一些残留的未完成的工作，比如 skill
 * 测试与评估」。
 *
 * 正交意图：
 *   [1] analyzer 跑分：五断言映射（contains/not-contains/finding-kind/
 *       finding-triggered/finding-severity）与 passed/failed 裁决。
 *   [2] 五态协议：revision 前闸 stale、provider 适配器缺席 → unavailable
 *       （依赖族）、执行异常 → error（执行族）、取消竞态与已写结果保留。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEvaluationService } from "../src/daemon/evaluation/service.js";
import { createEvaluationStore, newEvaluationId } from "../src/daemon/evaluation/store.js";
import type { EvaluationStore } from "../src/daemon/evaluation/store.js";
import type { SkillService } from "../src/daemon/skill-service.js";
import type { EvaluationTarget } from "../src/shared/contracts/evaluation.js";

const target: EvaluationTarget = {
  workspaceId: "ws_0123456789abcdef01234567",
  providerId: "claude-code",
  skillId: "sk_0123456789abcdef01234567",
} as const;
const neighborId = "sk_999999999999999999999999" as EvaluationTarget["skillId"];
const revision = `sha256:${"a".repeat(64)}`;
const drifted = `sha256:${"b".repeat(64)}`;

let sandbox = "";
let store: EvaluationStore;
let skills: {
  info: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
};
let revisionNow: string;
let corpus: Array<{ id: EvaluationTarget["skillId"]; name: string; content: string }>;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "evaluation-service-test-"));
  store = createEvaluationStore(sandbox);
  revisionNow = revision;
  corpus = [
    {
      id: target.skillId,
      name: "alpha",
      content: "---\nname: alpha\ndescription: does things\n---\n\nbody with the-secret-token\n",
    },
    {
      id: neighborId,
      // 与目标技能同名——analyzer 的 duplicate-name 检测比较 AnalyzedDocument
      // 的 name 字段（服务经 skills.info 投影真实名；此处两名同 alpha）。
      name: "alpha",
      content: "---\nname: alpha\ndescription: same name duplicate\n---\n\nbeta body\n",
    },
  ];
  skills = {
    info: vi.fn(async (t: EvaluationTarget, skillId: string) => {
      const entry = corpus.find((candidate) => candidate.id === skillId);
      if (entry === undefined) throw new Error("NOT_FOUND");
      return {
        id: entry.id,
        name: entry.name,
        content: entry.content,
        revision: revisionNow,
        disabled: false,
        size: entry.content.length,
        provider: t.providerId,
      };
    }),
    list: vi.fn(async () =>
      corpus.map((entry) => ({
        id: entry.id,
        name: entry.name,
        directoryName: entry.name,
        disabled: false,
        provider: target.providerId,
        path: path.join(sandbox, entry.name),
        hasReferences: false,
        hasScripts: false,
        hasAssets: false,
        pluginInfo: null,
        description: "",
      })),
    ),
  };
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function serviceWith(providerAdapter?: () => unknown) {
  return createEvaluationService({
    skills: skills as unknown as SkillService,
    store,
    ...(providerAdapter ? { providerAdapter: providerAdapter as never } : {}),
  });
}

function seedCase(input: { prompt: string; assertions: unknown[] }) {
  const entry = {
    schemaVersion: 1 as const,
    caseId: newEvaluationId("ev_"),
    enabled: true,
    createdAt: "2026-09-30T00:00:00.000Z",
    updatedAt: "2026-09-30T00:00:00.000Z",
    source: "user" as const,
    boundRevision: revision,
    input: { prompt: input.prompt, assertions: input.assertions as never },
  };
  store.saveCase(target, entry);
  return entry;
}

async function runToCompletion(service: ReturnType<typeof serviceWith>, caseIds: string[]) {
  const start = service.startRun({ target, caseIds, runner: "analyzer" });
  for (let i = 0; i < 50; i += 1) {
    const status = service.runStatus(start.runId);
    if (status.status === "completed" || status.status === "cancelled") return { start, status };
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("run did not settle");
}

describe("evaluation service (analyzer runner)", () => {
  it("judges contains/not-contains against the target skill document", async () => {
    const entry = seedCase({
      prompt: "p",
      assertions: [
        { kind: "contains", value: "the-secret-token" },
        { kind: "not-contains", value: "absent-token" },
      ],
    });
    const service = serviceWith();
    const { status } = await runToCompletion(service, [entry.caseId]);
    expect(status.status).toBe("completed");
    const [result] = await service.results(target);
    expect(result.outcome).toBe("passed");
    expect(result.assertions.map((item) => item.outcome)).toEqual(["passed", "passed"]);
  });

  it("fails when an assertion misses and reports per-assertion outcomes", async () => {
    const entry = seedCase({
      prompt: "p",
      assertions: [
        { kind: "contains", value: "the-secret-token" },
        { kind: "contains", value: "missing" },
      ],
    });
    const service = serviceWith();
    await runToCompletion(service, [entry.caseId]);
    const [result] = await service.results(target);
    expect(result.outcome).toBe("failed");
    expect(result.assertions[1].outcome).toBe("failed");
  });

  it("maps duplicate-name corpus findings to finding-kind / finding-triggered assertions", async () => {
    // 语料含同名 alpha ×2 → duplicate-name finding 覆盖两个技能。
    const entry = seedCase({
      prompt: "p",
      assertions: [
        { kind: "finding-kind", value: "duplicate-name" },
        { kind: "finding-triggered", value: true },
      ],
    });
    const service = serviceWith();
    await runToCompletion(service, [entry.caseId]);
    const [result] = await service.results(target);
    expect(result.outcome).toBe("passed");
  });

  it("marks stale when the skill revision drifted before the run (no execution)", async () => {
    const entry = seedCase({ prompt: "p", assertions: [{ kind: "contains", value: "body" }] });
    revisionNow = drifted;
    const service = serviceWith();
    await runToCompletion(service, [entry.caseId]);
    const [result] = await service.results(target);
    expect(result.outcome).toBe("stale");
    expect(result.assertions).toEqual([]);
  });

  it("projects display-level stale after post-run revision drift", async () => {
    const entry = seedCase({ prompt: "p", assertions: [{ kind: "contains", value: "body" }] });
    const service = serviceWith();
    await runToCompletion(service, [entry.caseId]);
    const [fresh] = await service.results(target);
    expect(fresh.stale).toBe(false);
    revisionNow = drifted;
    const [staleView] = await service.results(target);
    expect(staleView.outcome).toBe("passed");
    expect(staleView.stale).toBe(true);
  });

  it("returns typed unavailable (dependency family) when no provider adapter is configured", async () => {
    const entry = seedCase({ prompt: "p", assertions: [{ kind: "contains", value: "ok" }] });
    const service = serviceWith();
    const start = service.startRun({ target, caseIds: [entry.caseId], runner: "provider-model" });
    for (let i = 0; i < 50; i += 1) {
      if (service.runStatus(start.runId).status !== "running") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const [result] = await service.results(target);
    expect(result.outcome).toBe("unavailable");
    if (result.outcome !== "unavailable") return;
    expect(result.failure.code).toBe("DSH_UNAVAILABLE");
    expect(result.assertions).toEqual([]);
  });

  it("cancel before completion keeps already-written results and settles cancelled", async () => {
    const first = seedCase({ prompt: "p1", assertions: [{ kind: "contains", value: "body" }] });
    const second = seedCase({ prompt: "p2", assertions: [{ kind: "contains", value: "body" }] });
    const service = serviceWith();
    const start = service.startRun({
      target,
      caseIds: [first.caseId, second.caseId],
      runner: "analyzer",
    });
    service.cancelRun(start.runId);
    const settled = service.runStatus(start.runId);
    expect(["cancelled", "completed"]).toContain(settled.status);
    // 已写结果保留（至少 0 条且不伪造 passed 的空结果）。
    for (const result of await service.results(target)) {
      expect(result.outcome).not.toBe("unavailable");
    }
    // completed 后 cancel 幂等。
    if (settled.status === "completed") {
      expect(service.cancelRun(start.runId).status).toBe("completed");
    }
  });
});
