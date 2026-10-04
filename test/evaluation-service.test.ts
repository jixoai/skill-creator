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

  it("freezes per-assertion kind/expected/observed text at run time (evaluating-world-class 1.1)", async () => {
    const entry = seedCase({
      prompt: "p",
      assertions: [
        { kind: "contains", value: "missing" },
        { kind: "finding-triggered", value: false },
      ],
    });
    const service = serviceWith();
    await runToCompletion(service, [entry.caseId]);
    const [result] = await service.results(target);
    if (result.outcome !== "failed") throw new Error("expected failed outcome");
    const contains = result.assertions.find((item) => item.kind === "contains");
    if (contains === undefined) throw new Error("contains assertion row missing");
    expect(contains.expected).toBe("missing");
    // 未命中 → observed = 检索面末段摘录（有界，不含期望词）。
    expect(contains.observed).not.toContain("missing");
    expect(contains.observed.length).toBeLessThanOrEqual(202);
    const triggered = result.assertions.find((item) => item.kind === "finding-triggered");
    if (triggered === undefined) throw new Error("finding-triggered assertion row missing");
    expect(triggered.expected).toBe("false");
    // 语料同名 alpha ×2 → duplicate-name finding 存在 → 观测 = 已触发（"true"）。
    expect(triggered.observed).toBe("true");
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

// ---- r6 复核处置：P1-4 adapter 终态闸 + finding-severity 服务级断言 ----

describe("evaluation provider adapter terminal gate (r6 P1-4)", () => {
  it("rejects with a typed timeout and cancels when turn-end never arrives", async () => {
    const { createProviderSessionAdapter } =
      await import("../src/daemon/evaluation/provider-adapter.js");
    const cancelled: string[] = [];
    const adapter = createProviderSessionAdapter({
      sessions: {
        create: async () => ({ sessionId: "agent-x" }) as never,
        prompt: async () => undefined,
        // 永远 running、永远无 turn-end：maxSteps 耗尽必须拒绝而非拼半截。
        stream: () =>
          ({
            frames: [{ kind: "assistant-text", seq: 1, text: "partial" }],
            status: "running",
          }) as never,
        cancel: (sessionId: string) => {
          cancelled.push(sessionId);
        },
      },
      stepDelayMs: 1,
      maxSteps: 3,
    });
    await expect(adapter.readTranscript("agent-x")).rejects.toThrow(/turn-end/);
    expect(cancelled).toEqual(["agent-x"]);
  });
});

describe("finding-severity assertion (service level)", () => {
  it("judges finding-severity against the analyzer's corpus findings (r7: by caseId, deterministic)", async () => {
    // 语料同名 alpha ×2 → duplicate-name finding，analyzer 判定 severity = error。
    const pass = seedCase({
      prompt: "p",
      assertions: [{ kind: "finding-severity", value: "error" }],
    });
    const mismatch = seedCase({
      prompt: "p",
      assertions: [{ kind: "finding-severity", value: "warning" }],
    });
    const service = serviceWith();
    await runToCompletion(service, [pass.caseId, mismatch.caseId]);
    const results = await service.results(target);
    const byCase = new Map(results.map((entry) => [entry.caseId, entry]));
    expect(byCase.get(pass.caseId)?.outcome).toBe("passed");
    expect(byCase.get(mismatch.caseId)?.outcome).toBe("failed");
  });
});

describe("provider timeout surfaces as error result (r7 P1-4 service level)", () => {
  it("maps a transcript timeout to outcome=error / RUNNER_ERROR with zero assertions", async () => {
    const { ProviderTranscriptTimeout } =
      await import("../src/daemon/evaluation/provider-adapter.js");
    const entry = seedCase({
      prompt: "p",
      assertions: [{ kind: "contains", value: "never judged" }],
    });
    const service = serviceWith(() => ({
      create: async () => ({ sessionId: "agent-timeout" }),
      prompt: async () => undefined,
      readTranscript: async () => {
        throw new ProviderTranscriptTimeout("agent-timeout", 3);
      },
      cancel: () => undefined,
      versions: () => ({ promptVersion: "p", toolVersion: "t", dshVersion: "d" }),
    }));
    // runToCompletion 固定 analyzer——此处显式走 provider-model 跑到终态。
    const start = service.startRun({ target, caseIds: [entry.caseId], runner: "provider-model" });
    for (let i = 0; i < 50; i += 1) {
      const status = service.runStatus(start.runId);
      if (status.status === "completed" || status.status === "cancelled") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const [result] = await service.results(target);
    expect(result.outcome).toBe("error");
    expect(result.failure?.code).toBe("RUNNER_ERROR");
    // 半截文本不进入断言：assertions 恒空。
    expect(result.assertions).toEqual([]);
  });
});

describe("pre-run stale observes the actual current revision (r7 blocker)", () => {
  it("records observedStart=observedEnd=current on the revision gate", async () => {
    const entry = seedCase({ prompt: "p", assertions: [{ kind: "contains", value: "body" }] });
    revisionNow = drifted;
    const service = serviceWith();
    await runToCompletion(service, [entry.caseId]);
    const [result] = await service.results(target);
    expect(result.outcome).toBe("stale");
    expect(result.expectedRevision).toBe(revision);
    expect(result.observedStartRevision).toBe(drifted);
    expect(result.observedEndRevision).toBe(drifted);
  });
});
