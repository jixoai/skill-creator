/**
 * 蒸馏 DistillJobService 生命周期测试（skill-wiki-maintainer task 1.3 门禁）。
 *
 * 用户原始需求 [2026-09-25]（design §4/§5/H/I/J/M/N/Q/R/S + tasks 1.3 负测清单）：
 * 「stop/timeout/restart/cancel-awaiting 矩阵 / 容量事务字节级不变 / 决定 CAS
 * 三面终态唯一 / attempts 预留制 exact bytes + io-failed 终态 + 三崩溃点重算
 * 字节级一致 / rebuild-only 双预算 / 取消=expired vs 人工拒绝=rejected 二分 /
 * 末项终态触发 completed / 损坏 run 目录 pin fail-closed」。
 *
 * 正交意图：
 *   [1] 生命周期矩阵：start（ACTIVE_RUN/corpus/kernel/timeout/unavailable）、
 *       cancel（kernel/awaiting/终态幂等）、dispose（cancelled-by-shutdown）、
 *       重启扫描（awaiting→cancelled(restarted)、applying 恢复、io-failed 不复活）。
 *   [2] admission + 收敛：容量整批拒绝→failed(capacity)+typed DISTILL_LIMIT+store
 *       字节不变；零合法→no-valid-proposals；全终态→completed；终态后二次 start。
 *   [3] apply 双预算与崩溃协议：attempts 预留制（写前 +1 的 exact ledger bytes）、
 *       三崩溃点 run.json 字节级重算一致、store 投影异常不回滚不阻塞、
 *       rebuild-only ≤2 独立预算、R 二分 + reject IO fail-closed、伪造输入。
 *   [4] 契约同源：shared 枚举与 skill-wiki distill schema 同集同值（E 单源断言）。
 * 妥协声明：kernel 用 fake ephemeral session 工厂（真实 kernel 工具面在 1.3a
 *   单测覆盖；端到端 1.5）；apply 的 IO 故障经注入 seam（真实 SDK 矩阵在 1.2）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DISTILL_EVIDENCE_THRESHOLD,
  DISTILL_SCORE_VERSION,
  DistillItemStatusSchema as SdkItemStatusSchema,
  DistillLedgerStatusSchema as SdkLedgerStatusSchema,
  TerminalDistillLedgerStatusSchema as SdkTerminalStatusSchema,
  SkillWikiError,
  type DistillCorpus,
  type DistillItemResult,
  type DistillPlanItem,
  type DistillProvenance,
} from "skill-wiki";
import {
  CapabilityFailureDetailSchema,
  DistillApplyInputSchema,
  DistillItemStatusSchema,
  DistillLedgerStatusSchema,
  DistillRunIdSchema,
  McpProposalViewSchema,
  TerminalDistillLedgerStatusSchema,
} from "../src/shared/contracts/wiki-distill.js";
import { RpcErrorDefinitions } from "../src/shared/contracts/errors.js";
import { createCapabilityRegistry } from "../src/daemon/capability/core.js";
import { createMcpProposalStore, type McpProposalStore } from "../src/daemon/mcp/proposals.js";
import { DomainError } from "../src/daemon/domain-error.js";
import {
  createWikiDistillService,
  type DistillJobService,
} from "../src/daemon/wiki-distill-service.js";
import {
  EphemeralSessionError,
  type EphemeralSession,
} from "../src/daemon/kernel/ephemeral-session.js";

const WORKSPACE_ID = "ws_a1b2c3d4e5f6a7b8c9d0e1f2";
const WS_DIR_NAME = "ws-a";

interface FakeSessionPlan {
  /** prompt 结果（文本）；抛错用 promptError。 */
  text?: string;
  promptError?: EphemeralSessionError;
  /** 挂起 prompt 直到 resolve（cancel/dispose 矩阵）。 */
  hangUntil?: Promise<void>;
  disposed: number;
}

function fakeSession(plan: FakeSessionPlan): EphemeralSession {
  return {
    prompt: async (_input: string, opts?: { signal?: AbortSignal }) => {
      if (plan.hangUntil) {
        await new Promise<void>((resolve, reject) => {
          const done = (): void => resolve();
          plan.hangUntil.then(done, done);
          opts?.signal?.addEventListener("abort", () => {
            reject(new EphemeralSessionError("DISTILL_CANCELLED", "prompt signal aborted"));
          });
        });
      }
      if (plan.promptError) throw plan.promptError;
      return { text: plan.text ?? "[]" };
    },
    listTools: () => [],
    dispose: async () => {
      plan.disposed += 1;
    },
  };
}

/** apply seam 的故障剧本（真实 SDK 矩阵在 1.2；此处钉宿主协议）。 */
interface ApplyScript {
  /** onIntent 后抛 WIKI_IO 的次数（写页尝试失败；每次调用消耗一次）。 */
  writeFailures: number;
  /** 不经 onIntent 直接抛 WIKI_IO 的次数（preflight/rebuild-only IO）。 */
  rebuildFailures: number;
  /** onIntent 后抛非 typed 异常（craft applying 行 + 队列终态 failed）。 */
  crashAfterIntent: boolean;
  /** onIntent 后挂起直到该 promise settle（approved 瞬态窗口剧本）。 */
  hangAfterIntent?: Promise<void>;
  /** 直接成功（不消耗故障预算）的 ordinal 集合（mixed 收敛剧本）。 */
  succeedOrdinals?: number[];
  /** 每次调用后记录的磁盘 attempts 快照（onIntent 落盘后读文件）。 */
  onDiskAttempts: number[];
  /** ledger 文件路径（由 harness 注入）。 */
  ledgerFile?: string;
  calls: number;
  /** 末次成功是否走 onCommit。 */
  commits: number;
}

function scriptedApply(script: ApplyScript) {
  return async (
    _globalWikiDir: string,
    item: DistillPlanItem,
    _provenance: DistillProvenance,
    options?: {
      ledgerRecord?: unknown;
      hooks?: { onIntent?: (record: never) => void; onCommit?: (record: never) => void };
    },
  ): Promise<DistillItemResult> => {
    script.calls += 1;
    if (script.succeedOrdinals?.includes(item.ordinal)) {
      return { ordinal: item.ordinal, status: "applied", appliedHash: item.afterBodyHash };
    }
    const record = options?.ledgerRecord as { status?: string; attempts?: number } | undefined;
    const attempts = record?.status === "applying" ? (record.attempts ?? 0) : 0;
    const exhausted = record?.status === "applying" && (record.attempts ?? 0) >= 3;
    if (exhausted) {
      return { ordinal: item.ordinal, status: "io-failed", detail: "attempts-exhausted" };
    }
    if (script.rebuildFailures > 0) {
      script.rebuildFailures -= 1;
      throw new SkillWikiError("WIKI_IO", "scripted rebuild-only IO failure");
    }
    const intent = {
      kind: item.action,
      ordinal: item.ordinal,
      status: "applying",
      ...(item.action === "absorb"
        ? { beforeHash: "a".repeat(64), afterHash: item.afterBodyHash }
        : { targetPatternName: item.targetPatternName, afterHash: item.afterBodyHash }),
      attempts,
    } as never;
    options?.hooks?.onIntent?.(intent);
    if (script.ledgerFile) {
      // onIntent 已由宿主持久化（预留 +1 后的 bytes）——读回记录。
      const raw = fs.readFileSync(script.ledgerFile, "utf8");
      const first = raw.split("\n").find((row) => row.trim().length > 0);
      if (first) script.onDiskAttempts.push((JSON.parse(first) as { attempts: number }).attempts);
    }
    if (script.hangAfterIntent) {
      await new Promise<void>((resolve) => {
        script.hangAfterIntent?.then(resolve, resolve);
      });
    }
    if (script.crashAfterIntent) {
      throw new Error("scripted crash after intent (queue task ends failed, line stays applying)");
    }
    if (script.writeFailures > 0) {
      script.writeFailures -= 1;
      throw new SkillWikiError("WIKI_IO", "scripted page-write IO failure");
    }
    const commit = { ...intent, status: "applied", appliedHash: item.afterBodyHash } as never;
    options?.hooks?.onCommit?.(commit);
    script.commits += 1;
    return { ordinal: item.ordinal, status: "applied", appliedHash: item.afterBodyHash };
  };
}

interface Harness {
  service: DistillJobService;
  store: McpProposalStore;
  logs: string[];
  baseDir: string;
  globalDir: string;
  sessionPlan: FakeSessionPlan;
  activeScript?: ApplyScript;
  setModelOutput: (rawProposals: unknown[]) => void;
  setSessionError: (error: EphemeralSessionError | undefined) => void;
  start: () => Promise<{ runId: string }>;
}

async function createHarness(options?: { applyScript?: ApplyScript }): Promise<Harness> {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-distill-test-"));
  const baseDir = path.join(sandbox, "runs");
  const globalDir = path.join(sandbox, "global-wiki");
  fs.mkdirSync(globalDir, { recursive: true });
  const wsPath = path.join(sandbox, WS_DIR_NAME);
  fs.mkdirSync(wsPath, { recursive: true });
  const logs: string[] = [];
  const sessionPlan: FakeSessionPlan = { disposed: 0, text: "[]" };
  let sessionError: EphemeralSessionError | undefined;

  const corpus: DistillCorpus = {
    clusters: [],
    candidates: [],
    retrieval: { query: "fixture", limit: 5 },
    evidenceThreshold: DISTILL_EVIDENCE_THRESHOLD,
    budgets: { patternsIncluded: 0, totalBodyChars: 0 },
    scoreVersion: DISTILL_SCORE_VERSION,
    corpusDigest: "b".repeat(64),
  };

  const workspaces = {
    lookup: (id: string) =>
      id === WORKSPACE_ID ? { id: WORKSPACE_ID, label: "ws", path: wsPath } : null,
  };
  let service: DistillJobService;
  const registry = createCapabilityRegistry([
    {
      name: "wiki.distill_apply",
      description: "test apply entry",
      authority: "approved-mutation",
      input: DistillApplyInputSchema,
      handler: (input: unknown) => service.apply(input),
    },
  ]);
  const store = createMcpProposalStore(registry, {
    onRejected: (view, cause) => service.onProposalRejected(view, cause),
  });
  const activeScript = options?.applyScript;
  service = createWikiDistillService({
    workspaces,
    globalWikiDirectory: () => globalDir,
    baseDir,
    proposals: () => store,
    createSession: async () => {
      if (sessionError) throw sessionError;
      return fakeSession(sessionPlan);
    },
    buildCorpus: async () => corpus,
    ...(activeScript ? { apply: scriptedApply(activeScript) } : {}),
    log: (message) => logs.push(message),
  });
  const harness: Harness = {
    service,
    store,
    logs,
    baseDir,
    globalDir,
    sessionPlan,
    ...(activeScript ? { activeScript } : {}),
    setModelOutput: (rawProposals) => {
      sessionPlan.text = JSON.stringify(rawProposals);
    },
    setSessionError: (error) => {
      sessionError = error;
    },
    start: () => service.start(WORKSPACE_ID),
  };
  return harness;
}

const CREATE_PROPOSAL = {
  action: "create",
  title: "Generalized Pattern",
  body: "Distilled body.",
  sourcePatternIds: ["alpha-notes"],
};

function readLedgerLine(baseDir: string, runId: string, ordinal: number): Record<string, unknown> {
  const raw = fs.readFileSync(path.join(baseDir, runId, "proposals.jsonl"), "utf8");
  const line = raw
    .split("\n")
    .map((row) => row.trim())
    .filter((row) => row.length > 0)
    .map((row) => JSON.parse(row) as Record<string, unknown>)
    .find((row) => row.ordinal === ordinal);
  if (!line) throw new Error(`ledger line ${ordinal} not found`);
  return line;
}

function readRunJson(baseDir: string, runId: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(baseDir, runId, "run.json"), "utf8")) as Record<
    string,
    unknown
  >;
}

function readRunBytes(baseDir: string, runId: string): string {
  return fs.readFileSync(path.join(baseDir, runId, "run.json"), "utf8");
}

const sandboxes: string[] = [];

afterEach(() => {
  for (const sandbox of sandboxes.splice(0)) {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

function track<T extends { baseDir: string }>(harness: T): T {
  sandboxes.push(path.dirname(harness.baseDir));
  return harness;
}

describe("contract single-source sync (E)", () => {
  it("shared distill enums equal the skill-wiki SDK enums option-for-option", async () => {
    const sdk = await import("skill-wiki");
    expect(DistillItemStatusSchema.options).toEqual(
      (sdk.DistillItemStatusSchema as typeof SdkItemStatusSchema).options,
    );
    expect(DistillLedgerStatusSchema.options).toEqual(
      (sdk.DistillLedgerStatusSchema as typeof SdkLedgerStatusSchema).options,
    );
    expect(TerminalDistillLedgerStatusSchema.options).toEqual(
      (sdk.TerminalDistillLedgerStatusSchema as typeof SdkTerminalStatusSchema).options,
    );
    expect(DistillRunIdSchema.safeParse("wd_" + "a1b2c3d4e5f6".repeat(2)).success).toBe(true);
  });

  it("registers the six distill RPC error codes with their frozen transport statuses", () => {
    expect(RpcErrorDefinitions.DISTILL_RUN_NOT_FOUND.status).toBe(404);
    expect(RpcErrorDefinitions.DISTILL_STALE.status).toBe(409);
    expect(RpcErrorDefinitions.PROPOSAL_STALE.status).toBe(409);
    expect(RpcErrorDefinitions.DISTILL_ACTIVE_RUN.status).toBe(409);
    expect(RpcErrorDefinitions.DISTILL_LIMIT.status).toBe(422);
    expect(RpcErrorDefinitions.DISTILL_IO.status).toBe(503);
  });
});

describe("distill lifecycle (task 1.3)", () => {
  it("runs start → awaiting-approval with pending ledger rows, admission-linked proposals, and 0700/0600 artifacts", async () => {
    const h = track(await createHarness());
    h.setModelOutput([CREATE_PROPOSAL]);
    const { runId } = await h.start();
    const status = await h.service.status(runId);
    expect(status.state).toBe("awaiting-approval");
    expect(status.reason).toBeNull();
    // counters 全键（E：DistillItemStatus 九键；pending/applying 不是 item 结果）。
    expect(status.counters).toEqual({
      applied: 0,
      idempotent: 0,
      stale: 0,
      "patch-failed": 0,
      "model-invalid": 0,
      rejected: 0,
      expired: 0,
      "not-proposed": 0,
      "io-failed": 0,
    });
    expect(status.proposalRefs).toHaveLength(1);
    expect(status.proposalRefs[0]?.proposalId).toMatch(/^mcp_[0-9a-f]+$/);
    expect(status.proposalRefs[0]?.status).toBe("pending");
    // store 面与 ledger 面同批 admission。
    const pending = h.store.list().filter((view) => view.status === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0]?.capability).toBe("wiki.distill_apply");
    expect(pending[0]?.input).toEqual({ runId, ordinal: 0 });
    // 权限纪律（POSIX）：目录 0700、文件 0600。
    if (process.platform !== "win32") {
      const runDir = path.join(h.baseDir, runId);
      expect((fs.statSync(runDir).mode & 0o777).toString(8)).toBe("700");
      for (const file of ["run.json", "corpus.json", "proposals.jsonl", "diagnostics.json"]) {
        expect((fs.statSync(path.join(runDir, file)).mode & 0o777).toString(8)).toBe("600");
      }
    }
    // 严格 wire 契约：pending proposal view 经 McpProposalViewSchema 解析。
    expect(() => McpProposalViewSchema.parse(pending[0])).not.toThrow();
  });

  it("approves → applies through the per-run queue → converges completed (last-item transition)", async () => {
    const h = track(await createHarness());
    h.setModelOutput([CREATE_PROPOSAL]);
    const { runId } = await h.start();
    const ref = (await h.service.status(runId)).proposalRefs[0];
    expect(ref?.proposalId).toBeTruthy();
    // N：approve 阻塞到队列任务终态——executed 仅在 apply 完成后投影。
    const decision = await h.store.approve(ref!.proposalId!);
    expect(decision.view.status).toBe("executed");
    const status = await h.service.status(runId);
    expect(status.state).toBe("completed");
    expect(status.counters.applied).toBe(1);
    expect(status.proposalRefs[0]?.status).toBe("applied");
    // global wiki 出现泛化页 + promotedFrom 足迹；workspace 目录零写。
    const page = path.join(h.globalDir, "patterns", "generalized-pattern.md");
    expect(fs.existsSync(page)).toBe(true);
    expect(fs.readFileSync(page, "utf8")).toContain(`"runId":"${runId}"`);
    expect(fs.readdirSync(path.join(path.dirname(h.baseDir), WS_DIR_NAME))).toEqual([]);
  });

  it("rejects a second start for the same source while active, allows it after a terminal state", async () => {
    const h = track(await createHarness());
    h.setModelOutput([CREATE_PROPOSAL]);
    const { runId } = await h.start();
    await expect(h.start()).rejects.toMatchObject({ code: "DISTILL_ACTIVE_RUN" });
    const cancel = await h.service.cancel(runId);
    expect(cancel).toEqual({ runId, state: "cancelled" });
    const again = await h.start();
    expect(again.runId).toMatch(/^wd_[0-9a-f]{24}$/);
  });

  it("maps kernel timeout and kernel-unavailability to failed runs (kernel-local codes stay daemon-side)", async () => {
    const h = track(await createHarness());
    h.sessionPlan.promptError = new EphemeralSessionError("DISTILL_TIMEOUT", "deadline");
    const timeout = await h.start();
    expect((await h.service.status(timeout.runId)).state).toBe("failed");
    expect((await h.service.status(timeout.runId)).reason).toBe("timeout");

    const h2 = track(await createHarness());
    h2.setSessionError(new EphemeralSessionError("DISTILL_BRIDGE_NOT_READY", "no bridge"));
    const unavailable = await h2.start();
    const status = await h2.service.status(unavailable.runId);
    expect(status.state).toBe("failed");
    expect(status.reason).toBe("kernel-unavailable");
    expect(status.counters).toMatchObject({});
  });

  it("fails with no-valid-proposals on zero or all-invalid model output", async () => {
    const h = track(await createHarness());
    const empty = await h.start();
    expect((await h.service.status(empty.runId)).reason).toBe("no-valid-proposals");
    expect((await h.service.status(empty.runId)).counters).toEqual({
      applied: 0,
      idempotent: 0,
      stale: 0,
      "patch-failed": 0,
      "model-invalid": 0,
      rejected: 0,
      expired: 0,
      "not-proposed": 0,
      "io-failed": 0,
    });

    const h2 = track(await createHarness());
    h2.setModelOutput([{ action: "create", title: "!!!", body: "x", sourcePatternIds: ["a"] }]);
    const invalid = await h2.start();
    const status = await h2.service.status(invalid.runId);
    expect(status.state).toBe("failed");
    expect(status.reason).toBe("no-valid-proposals");
    expect(status.counters["model-invalid"]).toBe(1);
    expect(status.proposalRefs).toEqual([]);
  });

  it("refuses the whole admission batch at capacity: typed DISTILL_LIMIT, store byte-identical, run failed(capacity)", async () => {
    const h = track(await createHarness());
    // 预填满 store（pending 满载——pending 永不淘汰）。
    for (let index = 0; index < 64; index += 1) {
      h.store.create("other.capability", { index });
    }
    const before = JSON.stringify(h.store.list());
    h.setModelOutput([CREATE_PROPOSAL]);
    await expect(h.start()).rejects.toMatchObject({ code: "DISTILL_LIMIT" });
    // typed 拒绝后 run 仍在 registry（status 可轮询 failed(capacity)）。
    const runId = fs
      .readdirSync(h.baseDir)
      .find((name) => DistillRunIdSchema.safeParse(name).success);
    expect(runId).toMatch(/^wd_/);
    const status = await h.service.status(runId as string);
    expect(status.state).toBe("failed");
    expect(status.reason).toBe("capacity");
    expect(status.counters["not-proposed"]).toBe(1);
    expect(status.proposalRefs[0]?.status).toBe("not-proposed");
    expect(JSON.stringify(h.store.list())).toBe(before); // store 逐字节不变
  });

  it("cancels an awaiting-approval run: ledger expired + store proposals rejected(cause=cancelled)", async () => {
    const h = track(await createHarness());
    h.setModelOutput([CREATE_PROPOSAL, { ...CREATE_PROPOSAL, title: "Second Pattern" }]);
    const { runId } = await h.start();
    const refs = (await h.service.status(runId)).proposalRefs;
    expect(refs).toHaveLength(2);
    await h.service.cancel(runId);
    const status = await h.service.status(runId);
    expect(status.state).toBe("cancelled");
    expect(status.reason).toBeNull(); // 用户主动取消
    expect(status.counters.expired).toBe(2);
    for (const ref of status.proposalRefs) expect(ref.status).toBe("expired");
    for (const ref of refs) {
      const view = h.store.get(ref!.proposalId!);
      expect(view?.status).toBe("rejected");
      expect(view?.rejectedCause).toBe("cancelled");
    }
    // 终态幂等：cancel 再调返回既有终态。
    expect(await h.service.cancel(runId)).toEqual({ runId, state: "cancelled" });
  });

  it("splits user cancel (expired) from human rejection (rejected) on the same run", async () => {
    const h = track(await createHarness());
    h.setModelOutput([CREATE_PROPOSAL, { ...CREATE_PROPOSAL, title: "Second Pattern" }]);
    const { runId } = await h.start();
    const refs = (await h.service.status(runId)).proposalRefs;
    await h.store.reject(refs[0]!.proposalId!, "human");
    await h.service.cancel(runId);
    const status = await h.service.status(runId);
    expect(status.counters.rejected).toBe(1);
    expect(status.counters.expired).toBe(1);
    const byOrdinal = new Map(status.proposalRefs.map((ref) => [ref.ordinal, ref.status]));
    expect(byOrdinal.get(0)).toBe("rejected");
    expect(byOrdinal.get(1)).toBe("expired");
  });

  it("restart scan cancels awaiting-approval runs: expired rows, empty store, applied rows preserved", async () => {
    const h = track(await createHarness());
    h.setModelOutput([CREATE_PROPOSAL]);
    const { runId } = await h.start();
    const ref = (await h.service.status(runId)).proposalRefs[0];
    await h.store.approve(ref!.proposalId!);
    h.setModelOutput([{ ...CREATE_PROPOSAL, title: "Second Pattern" }]);
    const second = await h.start();
    const secondRef = (await h.service.status(second.runId)).proposalRefs[0];

    // 「重启」= 同一 baseDir 上的全新 service + store（内存 store 归零）。
    const logs: string[] = [];
    const workspaces = {
      lookup: (id: string) =>
        id === WORKSPACE_ID
          ? { id: WORKSPACE_ID, label: "ws", path: path.join(path.dirname(h.baseDir), WS_DIR_NAME) }
          : null,
    };
    let service2: DistillJobService;
    const registry2 = createCapabilityRegistry([
      {
        name: "wiki.distill_apply",
        description: "test apply entry",
        authority: "approved-mutation",
        input: DistillApplyInputSchema,
        handler: (input: unknown) => service2.apply(input),
      },
    ]);
    const store2 = createMcpProposalStore(registry2, {
      onRejected: (view, cause) => service2.onProposalRejected(view, cause),
    });
    service2 = createWikiDistillService({
      workspaces,
      globalWikiDirectory: () => h.globalDir,
      baseDir: h.baseDir,
      proposals: () => store2,
      createSession: async () => fakeSession({ disposed: 0, text: "[]" }),
      buildCorpus: async () => ({
        clusters: [],
        candidates: [],
        retrieval: { query: "fixture", limit: 5 },
        evidenceThreshold: DISTILL_EVIDENCE_THRESHOLD,
        budgets: { patternsIncluded: 0, totalBodyChars: 0 },
        scoreVersion: DISTILL_SCORE_VERSION,
        corpusDigest: "b".repeat(64),
      }),
      log: (message) => logs.push(message),
    });
    expect(store2.list()).toEqual([]); // store 空态
    const firstAfter = await service2.status(runId);
    expect(firstAfter.state).toBe("completed"); // 已收敛的 completed 不复活不回退
    const secondAfter = await service2.status(second.runId);
    expect(secondAfter.state).toBe("cancelled");
    expect(secondAfter.reason).toBe("restarted");
    expect(secondAfter.counters.expired).toBe(1);
    void secondRef;
  });
});

describe("apply crash protocol + dual IO budgets (task 1.3, design H/N/R)", () => {
  it("reserves attempts before each page write: exact ledger bytes 1 → 2 → 3 then applied", async () => {
    const script: ApplyScript = {
      writeFailures: 2,
      rebuildFailures: 0,
      crashAfterIntent: false,
      onDiskAttempts: [],
      calls: 0,
      commits: 0,
    };
    const h = track(await createHarness({ applyScript: script }));
    h.setModelOutput([CREATE_PROPOSAL]);
    const { runId } = await h.start();
    script.ledgerFile = path.join(h.baseDir, runId, "proposals.jsonl");
    const ref = (await h.service.status(runId)).proposalRefs[0];
    const decision = await h.store.approve(ref!.proposalId!);
    expect(decision.view.status).toBe("executed");
    // 预留制 exact bytes：每次写页尝试前 +1（1 首放 + 2 重试）。
    expect(script.onDiskAttempts).toEqual([1, 2, 3]);
    const line = readLedgerLine(h.baseDir, runId, 0);
    expect(line.attempts).toBe(3);
    expect(line.status).toBe("applied");
    expect(script.calls).toBe(3);
  });

  it("maps exhausted page-write budget to io-failed on all three faces; mixed keeps completed", async () => {
    const script: ApplyScript = {
      writeFailures: 99, // 永远失败：矩阵第 4 次调用返回 io-failed
      rebuildFailures: 0,
      crashAfterIntent: false,
      onDiskAttempts: [],
      calls: 0,
      commits: 0,
    };
    const h = track(await createHarness({ applyScript: script }));
    h.setModelOutput([CREATE_PROPOSAL]);
    const { runId } = await h.start();
    script.ledgerFile = path.join(h.baseDir, runId, "proposals.jsonl");
    const ref = (await h.service.status(runId)).proposalRefs[0];
    const decision = await h.store.approve(ref!.proposalId!);
    // ① ledger 面：io-failed 终态 + attempts=3。
    const line = readLedgerLine(h.baseDir, runId, 0);
    expect(line.status).toBe("io-failed");
    expect(line.attempts).toBe(3);
    // ② proposal 面：failed + failureDetail.code=DISTILL_IO（同一 schema 解析）。
    expect(decision.view.status).toBe("failed");
    const parsedView = McpProposalViewSchema.parse(decision.view);
    expect(parsedView.status).toBe("failed");
    const detail = CapabilityFailureDetailSchema.parse(parsedView.failureDetail);
    expect(detail.code).toBe("DISTILL_IO");
    // ③ run 面：单项全 io-failed → failed(io)。
    const status = await h.service.status(runId);
    expect(status.state).toBe("failed");
    expect(status.reason).toBe("io");
    expect(status.counters["io-failed"]).toBe(1);
  });

  it("keeps a mixed run completed with visible io-failed counters", async () => {
    const script: ApplyScript = {
      writeFailures: 99, // 第二项耗尽写页预算 → io-failed
      rebuildFailures: 0,
      crashAfterIntent: false,
      succeedOrdinals: [0], // 第一项直接成功
      onDiskAttempts: [],
      calls: 0,
      commits: 0,
    };
    const h = track(await createHarness({ applyScript: script }));
    h.setModelOutput([CREATE_PROPOSAL, { ...CREATE_PROPOSAL, title: "Second Pattern" }]);
    const { runId } = await h.start();
    script.ledgerFile = path.join(h.baseDir, runId, "proposals.jsonl");
    const refs = (await h.service.status(runId)).proposalRefs;
    await h.store.approve(refs[0]!.proposalId!); // applied
    await h.store.approve(refs[1]!.proposalId!); // io-failed
    const status = await h.service.status(runId);
    expect(status.state).toBe("completed"); // mixed：部分成功是有效收敛（S 规则 3）
    expect(status.counters.applied).toBe(1);
    expect(status.counters["io-failed"]).toBe(1);
  });

  it("rebuild-only failures never touch attempts and stop after 2 in-queue retries (io-failed)", async () => {
    const script: ApplyScript = {
      writeFailures: 0,
      rebuildFailures: 99, // 每次调用（无 onIntent）都抛 WIKI_IO
      crashAfterIntent: false,
      onDiskAttempts: [],
      calls: 0,
      commits: 0,
    };
    const h = track(await createHarness({ applyScript: script }));
    h.setModelOutput([CREATE_PROPOSAL]);
    const { runId } = await h.start();
    script.ledgerFile = path.join(h.baseDir, runId, "proposals.jsonl");
    const ref = (await h.service.status(runId)).proposalRefs[0];
    const decision = await h.store.approve(ref!.proposalId!);
    // 队列内 initial + 2 重试 = 3 次调用后 io-failed。
    expect(script.calls).toBe(3);
    const line = readLedgerLine(h.baseDir, runId, 0);
    expect(line.status).toBe("io-failed");
    expect(line.attempts).toBe(0); // 不占 attempts 预算
    expect(script.onDiskAttempts).toEqual([]); // 从未 onIntent
    expect(decision.view.status).toBe("failed");
    expect(
      CapabilityFailureDetailSchema.parse(
        (decision.view as { failureDetail?: unknown }).failureDetail,
      ).code,
    ).toBe("DISTILL_IO");
    const status = await h.service.status(runId);
    expect(status.state).toBe("failed");
    expect(status.reason).toBe("io");
  });

  it("recovers applying rows on restart but never revives io-failed rows", async () => {
    // craft applying 行：onIntent 后抛非 typed 异常（队列任务 failed，行保持 applying）。
    const script: ApplyScript = {
      writeFailures: 0,
      rebuildFailures: 0,
      crashAfterIntent: true,
      onDiskAttempts: [],
      calls: 0,
      commits: 0,
    };
    const h = track(await createHarness({ applyScript: script }));
    h.setModelOutput([CREATE_PROPOSAL]);
    const { runId } = await h.start();
    script.ledgerFile = path.join(h.baseDir, runId, "proposals.jsonl");
    const ref = (await h.service.status(runId)).proposalRefs[0];
    const crashed = await h.store.approve(ref!.proposalId!);
    expect(crashed.view.status).toBe("failed");
    expect(readLedgerLine(h.baseDir, runId, 0).status).toBe("applying");
    expect(readLedgerLine(h.baseDir, runId, 0).attempts).toBe(1);

    // 重启（新 service，真实 apply）：applying 行矩阵重放 → applied；run 收敛 completed。
    const workspaces = {
      lookup: (id: string) =>
        id === WORKSPACE_ID
          ? { id: WORKSPACE_ID, label: "ws", path: path.join(path.dirname(h.baseDir), WS_DIR_NAME) }
          : null,
    };
    const logs: string[] = [];
    let service2: DistillJobService;
    const registry2 = createCapabilityRegistry([
      {
        name: "wiki.distill_apply",
        description: "test apply entry",
        authority: "approved-mutation",
        input: DistillApplyInputSchema,
        handler: (input: unknown) => service2.apply(input),
      },
    ]);
    const store2 = createMcpProposalStore(registry2, {
      onRejected: (view, cause) => service2.onProposalRejected(view, cause),
    });
    service2 = createWikiDistillService({
      workspaces,
      globalWikiDirectory: () => h.globalDir,
      baseDir: h.baseDir,
      proposals: () => store2,
      createSession: async () => fakeSession({ disposed: 0, text: "[]" }),
      buildCorpus: async () => ({
        clusters: [],
        candidates: [],
        retrieval: { query: "fixture", limit: 5 },
        evidenceThreshold: DISTILL_EVIDENCE_THRESHOLD,
        budgets: { patternsIncluded: 0, totalBodyChars: 0 },
        scoreVersion: DISTILL_SCORE_VERSION,
        corpusDigest: "b".repeat(64),
      }),
      log: (message) => logs.push(message),
    });
    const recovered = await service2.status(runId);
    expect(recovered.state).toBe("completed");
    expect(recovered.counters.applied).toBe(1);
    expect(readLedgerLine(h.baseDir, runId, 0).status).toBe("applied");

    // io-failed 永久终态：重放零写、不复活（重启后 apply 不再被调）。
    const deadScript: ApplyScript = {
      writeFailures: 0,
      rebuildFailures: 0,
      crashAfterIntent: false,
      onDiskAttempts: [],
      calls: 0,
      commits: 0,
    };
    const h3 = track(await createHarness({ applyScript: deadScript }));
    h3.setModelOutput([CREATE_PROPOSAL]);
    const dead = await h3.start();
    const deadRef = (await h3.service.status(dead.runId)).proposalRefs[0];
    deadScript.rebuildFailures = 99; // 耗尽 rebuild 预算 → io-failed
    deadScript.ledgerFile = path.join(h3.baseDir, dead.runId, "proposals.jsonl");
    await h3.store.approve(deadRef!.proposalId!);
    expect(readLedgerLine(h3.baseDir, dead.runId, 0).status).toBe("io-failed");
    const bytesBefore = readRunBytes(h3.baseDir, dead.runId);
    const ledgerBefore = fs.readFileSync(
      path.join(h3.baseDir, dead.runId, "proposals.jsonl"),
      "utf8",
    );
    const callsAtDeath = deadScript.calls;
    // 重启：恢复仅限 applying 行——io-failed 行零调用零写。
    const workspaces3 = {
      lookup: (id: string) =>
        id === WORKSPACE_ID
          ? {
              id: WORKSPACE_ID,
              label: "ws",
              path: path.join(path.dirname(h3.baseDir), WS_DIR_NAME),
            }
          : null,
    };
    const service3 = createWikiDistillService({
      workspaces: workspaces3,
      globalWikiDirectory: () => h3.globalDir,
      baseDir: h3.baseDir,
      proposals: () => null,
      createSession: async () => fakeSession({ disposed: 0, text: "[]" }),
      apply: scriptedApply(deadScript),
      log: () => undefined,
    });
    const still = await service3.status(dead.runId);
    expect(still.state).toBe("failed");
    expect(still.reason).toBe("io");
    expect(deadScript.calls).toBe(callsAtDeath); // 零重放
    expect(fs.readFileSync(path.join(h3.baseDir, dead.runId, "proposals.jsonl"), "utf8")).toBe(
      ledgerBefore,
    );
    expect(readRunBytes(h3.baseDir, dead.runId)).toBe(bytesBefore); // run.json 字节不变
  });

  it("recomputes run.json byte-identically from the ledger across the three crash points", async () => {
    // 基准：完整收敛（③后）的 run.json 字节。
    const script: ApplyScript = {
      writeFailures: 99,
      rebuildFailures: 0,
      crashAfterIntent: false,
      onDiskAttempts: [],
      calls: 0,
      commits: 0,
    };
    const h = track(await createHarness({ applyScript: script }));
    h.setModelOutput([CREATE_PROPOSAL]);
    const { runId } = await h.start();
    script.ledgerFile = path.join(h.baseDir, runId, "proposals.jsonl");
    const ref = (await h.service.status(runId)).proposalRefs[0];
    await h.store.approve(ref!.proposalId!);
    const finalBytes = readRunBytes(h.baseDir, runId);
    const runDir = path.join(h.baseDir, runId);
    const ledgerBytes = fs.readFileSync(path.join(runDir, "proposals.jsonl"), "utf8");
    // ①后②前/②后③前（② 是内存 store——两态磁盘同形）：ledger 已终态、run.json 回退到
    // awaiting-approval 版本（重算前的盘上状态）。
    fs.copyFileSync(path.join(runDir, "run.json"), path.join(h.baseDir, "run.completed.json"));
    const staleRunJson = JSON.stringify(
      {
        ...(JSON.parse(
          fs.readFileSync(path.join(h.baseDir, "run.completed.json"), "utf8"),
        ) as object),
        state: "awaiting-approval",
        reason: null,
        counters: {
          applied: 0,
          idempotent: 0,
          stale: 0,
          "patch-failed": 0,
          "model-invalid": 0,
          rejected: 0,
          expired: 0,
          "not-proposed": 0,
          "io-failed": 1,
        },
      },
      null,
      2,
    );
    fs.writeFileSync(path.join(runDir, "run.json"), `${staleRunJson}\n`);
    expect(readRunBytes(h.baseDir, runId)).not.toBe(finalBytes); // 前置：确实回到旧态
    // 重启重算：run.json 收敛回与完整收敛逐字节一致。
    const workspaces = {
      lookup: (id: string) =>
        id === WORKSPACE_ID
          ? { id: WORKSPACE_ID, label: "ws", path: path.join(path.dirname(h.baseDir), WS_DIR_NAME) }
          : null,
    };
    const makeService = (): DistillJobService => {
      let svc: DistillJobService;
      const reg = createCapabilityRegistry([
        {
          name: "wiki.distill_apply",
          description: "test apply entry",
          authority: "approved-mutation",
          input: DistillApplyInputSchema,
          handler: (input: unknown) => svc.apply(input),
        },
      ]);
      const store = createMcpProposalStore(reg, {
        onRejected: (view, cause) => svc.onProposalRejected(view, cause),
      });
      svc = createWikiDistillService({
        workspaces,
        globalWikiDirectory: () => h.globalDir,
        baseDir: h.baseDir,
        proposals: () => store,
        createSession: async () => fakeSession({ disposed: 0, text: "[]" }),
        apply: scriptedApply(script),
        log: () => undefined,
      });
      return svc;
    };
    await makeService().status(runId);
    expect(readRunBytes(h.baseDir, runId)).toBe(finalBytes);
    // ③后：重复恢复幂等（字节不再变化）。
    await makeService().status(runId);
    expect(readRunBytes(h.baseDir, runId)).toBe(finalBytes);
    // ledger 真相未被重算触碰。
    expect(fs.readFileSync(path.join(runDir, "proposals.jsonl"), "utf8")).toBe(ledgerBytes);
    fs.rmSync(path.join(h.baseDir, "run.completed.json"));
  });

  it("keeps ledger committed and run.json converged when the store projection itself throws", async () => {
    const script: ApplyScript = {
      writeFailures: 99,
      rebuildFailures: 0,
      crashAfterIntent: false,
      onDiskAttempts: [],
      calls: 0,
      commits: 0,
    };
    const h = track(await createHarness({ applyScript: script }));
    h.setModelOutput([CREATE_PROPOSAL]);
    const { runId } = await h.start();
    script.ledgerFile = path.join(h.baseDir, runId, "proposals.jsonl");
    const ref = (await h.service.status(runId)).proposalRefs[0];
    // ② 故障注入：settle 抛错（store 为内存态非真相——不回滚①、不阻塞③）。
    const originalSettle = h.store.settle.bind(h.store);
    h.store.settle = () => {
      throw new Error("scripted store projection failure");
    };
    const decision = await h.store.approve(ref!.proposalId!);
    h.store.settle = originalSettle;
    const line = readLedgerLine(h.baseDir, runId, 0);
    expect(line.status).toBe("io-failed"); // ① 未回滚
    const status = await h.service.status(runId);
    expect(status.state).toBe("failed"); // ③ 未阻塞
    expect(status.reason).toBe("io");
    expect(h.logs.some((entry) => entry.includes("store projection failed"))).toBe(true);
    // approve 的汇合兜底收敛 proposal 面（异常路径后由下一次 store 写入收敛）。
    expect(decision.view.status).toBe("failed");
  });

  it("keeps the decision token under approve→cancel races: serialized outcome, terminal unique (R winner table)", async () => {
    const script: ApplyScript = {
      writeFailures: 0,
      rebuildFailures: 0,
      crashAfterIntent: false,
      onDiskAttempts: [],
      calls: 0,
      commits: 0,
    };
    const h = track(await createHarness({ applyScript: script }));
    h.setModelOutput([CREATE_PROPOSAL]);
    const { runId } = await h.start();
    script.ledgerFile = path.join(h.baseDir, runId, "proposals.jsonl");
    const ref = (await h.service.status(runId)).proposalRefs[0];
    // 并发提交 approve 与 cancel（J：同一 per-run 队列串行化——终态唯一可串行化）。
    const [, cancelOutcome] = await Promise.all([
      h.store.approve(ref!.proposalId!),
      h.service.cancel(runId),
    ]);
    // 两序皆合法：apply 先完成 → cancel 幂等返回 completed；cancel 先迁移 → apply
    // 二次校验 DISTILL_STALE（failed+expired + run cancelled）。断言终态唯一且相干。
    expect(["cancelled", "completed"]).toContain(cancelOutcome.state);
    const status = await h.service.status(runId);
    const lineStatus = status.proposalRefs[0]?.status;
    if (cancelOutcome.state === "cancelled") {
      expect(lineStatus).toBe("expired");
      expect(h.store.get(ref!.proposalId!)?.status).toBe("failed");
      expect(status.counters.expired).toBe(1);
    } else {
      expect(lineStatus).toBe("applied");
      expect(h.store.get(ref!.proposalId!)?.status).toBe("executed");
      expect(status.counters.applied).toBe(1);
    }
  });

  it("throws typed PROPOSAL_STALE on a late reject after approve (token cannot be overtaken)", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const script: ApplyScript = {
      writeFailures: 0,
      rebuildFailures: 0,
      crashAfterIntent: false, // 挂起后正常完成
      hangAfterIntent: gate,
      onDiskAttempts: [],
      calls: 0,
      commits: 0,
    };
    const h = track(await createHarness({ applyScript: script }));
    h.setModelOutput([CREATE_PROPOSAL]);
    const { runId } = await h.start();
    script.ledgerFile = path.join(h.baseDir, runId, "proposals.jsonl");
    const ref = (await h.service.status(runId)).proposalRefs[0];
    const approval = h.store.approve(ref!.proposalId!);
    await new Promise((resolve) => setTimeout(resolve, 20)); // 决定点已过（approved 瞬态）
    expect(h.store.get(ref!.proposalId!)?.status).toBe("approved");
    await expect(h.store.reject(ref!.proposalId!)).rejects.toMatchObject({
      code: "PROPOSAL_STALE",
    });
    // detail.currentView = 决定时刻快照（同一 CapabilityFailureDetailSchema 解析）。
    try {
      await h.store.reject(ref!.proposalId!);
      expect.unreachable("late reject must throw");
    } catch (error) {
      const detail = CapabilityFailureDetailSchema.parse((error as { detail?: unknown }).detail);
      expect(detail.code).toBe("PROPOSAL_STALE");
      expect(detail.code === "PROPOSAL_STALE" && detail.currentView.status).toBe("approved");
    }
    release?.();
    const settled = await approval;
    expect(settled.view.status).toBe("executed"); // token 不被迟到决定覆盖
    expect(readLedgerLine(h.baseDir, runId, 0).status).toBe("applied");
  });

  it("keeps the human rejection ledger migration fail-closed when its IO fails", async () => {
    if (process.platform === "win32") return; // chmod 权限语义不可移植
    const h = track(await createHarness());
    h.setModelOutput([CREATE_PROPOSAL]);
    const { runId } = await h.start();
    const ref = (await h.service.status(runId)).proposalRefs[0];
    const ledgerPath = path.join(h.baseDir, runId, "proposals.jsonl");
    const before = fs.readFileSync(ledgerPath, "utf8");
    fs.chmodSync(path.join(h.baseDir, runId), 0o500); // 目录只读 → 原子写失败
    try {
      await expect(h.store.reject(ref!.proposalId!)).rejects.toMatchObject({
        code: "DISTILL_IO",
      });
    } finally {
      fs.chmodSync(path.join(h.baseDir, runId), 0o700);
    }
    // proposal 决定不可逆（rejected）；ledger 行保持 pending（fail-closed pin）。
    expect(h.store.get(ref!.proposalId!)?.status).toBe("rejected");
    expect(h.store.get(ref!.proposalId!)?.rejectedCause).toBe("human");
    expect(fs.readFileSync(ledgerPath, "utf8")).toBe(before);
  });

  it("rejects forged distill_apply inputs with typed DISTILL_RUN_NOT_FOUND and zero writes", async () => {
    const h = track(await createHarness());
    h.setModelOutput([CREATE_PROPOSAL]);
    const { runId } = await h.start();
    const forgedRun = "wd_" + "f".repeat(24);
    const missing = await h.service.apply({ runId: forgedRun, ordinal: 0 });
    expect(missing.kind).toBe("failed");
    if (missing.kind === "failed") {
      expect(CapabilityFailureDetailSchema.parse(missing.detail).code).toBe(
        "DISTILL_RUN_NOT_FOUND",
      );
    }
    const wrongOrdinal = await h.service.apply({ runId, ordinal: 42 });
    expect(wrongOrdinal.kind).toBe("failed");
    if (wrongOrdinal.kind === "failed") {
      expect(CapabilityFailureDetailSchema.parse(wrongOrdinal.detail).code).toBe(
        "DISTILL_RUN_NOT_FOUND",
      );
    }
    const malformed = await h.service.apply({ runId: "nope", ordinal: -1 });
    expect(malformed.kind).toBe("failed");
    // 零写：ledger 未变、store 无新 proposal。
    expect(readLedgerLine(h.baseDir, runId, 0).status).toBe("pending");
    expect(h.store.list()).toHaveLength(1);
  });

  it("fails a kernel-running run with cancelled-by-shutdown on daemon dispose", async () => {
    const h = track(await createHarness());
    let releasePrompt: (() => void) | undefined;
    h.sessionPlan.hangUntil = new Promise<void>((resolve) => {
      releasePrompt = resolve;
    });
    const startPromise = h.start();
    // 等 run 目录出现（start 尚未返回 runId）。
    let runId = "";
    for (let spin = 0; spin < 100 && runId === ""; spin += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      const entries = fs.existsSync(h.baseDir)
        ? fs.readdirSync(h.baseDir).filter((name) => DistillRunIdSchema.safeParse(name).success)
        : [];
      if (entries.length > 0) runId = entries[0] as string;
    }
    expect(runId).not.toBe("");
    await h.service.dispose();
    releasePrompt?.();
    await startPromise;
    const status = await h.service.status(runId);
    expect(status.state).toBe("failed");
    expect(status.reason).toBe("cancelled-by-shutdown");
    expect(h.sessionPlan.disposed).toBeGreaterThanOrEqual(1); // kernel session 有界释放
  });

  it("pins damaged run directories fail-closed (typed DISTILL_IO, never evicted by LRU)", async () => {
    const h = track(await createHarness());
    h.setModelOutput([CREATE_PROPOSAL]);
    const { runId } = await h.start();
    await h.service.cancel(runId); // terminal（可淘汰形状——但即将损坏 → pin）
    fs.writeFileSync(path.join(h.baseDir, runId, "run.json"), "{ not json");
    // 重启：损坏 → typed DISTILL_IO + pin fail-closed。
    const workspaces = {
      lookup: (id: string) =>
        id === WORKSPACE_ID
          ? { id: WORKSPACE_ID, label: "ws", path: path.join(path.dirname(h.baseDir), WS_DIR_NAME) }
          : null,
    };
    const logs: string[] = [];
    let service2: DistillJobService;
    const reg = createCapabilityRegistry([
      {
        name: "wiki.distill_apply",
        description: "test apply entry",
        authority: "approved-mutation",
        input: DistillApplyInputSchema,
        handler: (input: unknown) => service2.apply(input),
      },
    ]);
    const store2 = createMcpProposalStore(reg, {
      onRejected: (view, cause) => service2.onProposalRejected(view, cause),
    });
    service2 = createWikiDistillService({
      workspaces,
      globalWikiDirectory: () => h.globalDir,
      baseDir: h.baseDir,
      proposals: () => store2,
      createSession: async () => fakeSession({ disposed: 0, text: "[]" }),
      buildCorpus: async () => ({
        clusters: [],
        candidates: [],
        retrieval: { query: "fixture", limit: 5 },
        evidenceThreshold: DISTILL_EVIDENCE_THRESHOLD,
        budgets: { patternsIncluded: 0, totalBodyChars: 0 },
        scoreVersion: DISTILL_SCORE_VERSION,
        corpusDigest: "b".repeat(64),
      }),
      log: (message) => logs.push(message),
    });
    await expect(service2.status(runId)).rejects.toMatchObject({ code: "DISTILL_IO" });
    expect(logs.some((entry) => entry.includes("pinned"))).toBe(true);
    // LRU：灌满 20 个健康终态 run 后再多一个 → 淘汰最旧健康 run，损坏 run 恒存。
    for (let index = 0; index < 21; index += 1) {
      await service2.start(WORKSPACE_ID); // 零提案 → 立即 failed(no-valid-proposals) 终态
    }
    expect(fs.existsSync(path.join(h.baseDir, runId))).toBe(true);
    const survivors = fs
      .readdirSync(h.baseDir)
      .filter((name) => DistillRunIdSchema.safeParse(name).success);
    expect(survivors.length).toBeLessThanOrEqual(20 + 1); // 20 健康 + 1 pinned
    expect(logs.some((entry) => entry.includes("LRU evicted"))).toBe(true);
  });
});
