// @vitest-environment jsdom
/**
 * StewardView 组件交互测试（openspec steward-product-workflow task 4.9）。
 *
 * 用户原始需求 [2026-09-07]（tasks 4.9）：「延迟/失败 RPC 的组件交互测试……切 route
 * 后迟到 response 不覆盖新 scope；选中终态 run 停止高频刷新；断线错误可见；
 * permission capability 必须由实际 handler/restriction 决定；不用 as never。」
 *
 * 正交意图：
 *   [1] 轮询生命周期：running 态 1s 增量轮询；终态停止；status 翻转即停。
 *   [2] scope guard：切 run 后迟到的旧响应不得写入新选中 run 的投影。
 *   [3] 断线可见：连续失败 ≥3 次上浮错误横幅；恢复后清除。
 *   [4] capability 消费：cancellation=false 的 run 禁用 Cancel；
 *       permissionRequests=false 的 backend 卡片展示真实 restriction。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stubIcon = vi.hoisted(() => () => ({
  default: function IconStub(): void {},
}));
const store = vi.hoisted(() => ({
  loadStewardBackends: vi.fn(),
  loadStewardRuns: vi.fn(),
  pollStewardEvents: vi.fn(),
  startStewardRun: vi.fn(),
  cancelStewardRun: vi.fn(),
  decideStewardPermission: vi.fn(),
  approveStewardProposal: vi.fn(),
  rejectStewardProposal: vi.fn(),
}));

// lucide 图标走真实包会经外置 "svelte" 入口（server 导出）触发 lifecycle 错误；
// 测试以 no-op 组件替身隔离图标层（视觉由 4.9 浏览器证据覆盖）。
vi.mock("@lucide/svelte/icons/bot", stubIcon);
vi.mock("@lucide/svelte/icons/check", stubIcon);
vi.mock("@lucide/svelte/icons/loader-circle", stubIcon);
vi.mock("@lucide/svelte/icons/shield-off", stubIcon);
vi.mock("@lucide/svelte/icons/x", stubIcon);
vi.mock("$lib/shell", () => ({
  useParams: () => () => ({ wsId: "ws_abababababababababababab", providerId: "openclaw" }),
  goById: vi.fn(),
}));
vi.mock("$lib/toast.svelte", () => ({ showToast: vi.fn() }));
vi.mock("../stores/steward.svelte", () => store);

import { flushSync, mount, unmount } from "./svelte-client.js";
import StewardView from "../apps/workspaces/StewardView.svelte";
import {
  BackendStatusSchema,
  RunEventSchema,
  StewardRunSchema,
  type RunEvent,
  type StewardRun,
} from "$shared/contracts/agent-steward.js";

/** fixture 走真实 Zod parse——不手写 branded 断言（4.9：不用 as never 接受输入）。 */
function makeRun(overrides: {
  runSeed: string;
  status: StewardRun["status"];
  capabilities?: Partial<StewardRun["capabilities"]>;
  proposals?: string[];
}): StewardRun {
  return StewardRunSchema.parse({
    runId: `sr_${overrides.runSeed.padEnd(24, "0").slice(0, 24)}`,
    backendId: "fixture",
    target: { workspaceId: "ws_abababababababababababab", providerId: "openclaw" },
    skillIds: ["sk_abababababababababababab"],
    observedRevisions: [
      { skillId: "sk_abababababababababababab", revision: `sha256:${"a".repeat(64)}` },
    ],
    capabilities: {
      backendId: "fixture",
      version: "fixture-1",
      streamingEvents: true,
      cancellation: true,
      permissionRequests: true,
      executionRoot: "isolated",
      ...overrides.capabilities,
    },
    executionRoot: "/tmp/steward-exec/run-x",
    objective: "test objective",
    startedAt: "2026-09-07T00:00:00.000Z",
    endedAt: overrides.status === "running" ? null : "2026-09-07T00:01:00.000Z",
    status: overrides.status,
    phase: overrides.status === "running" ? "analyzing" : null,
    error: null,
    recommendations: [],
    proposalIds: (overrides.proposals ?? []).map((id) => id),
    permissionRequests: [],
    permissionDecisions: [],
  });
}

function makeEvent(runId: string, seq: number, message: string): RunEvent {
  return RunEventSchema.parse({
    seq,
    at: "2026-09-07T00:00:01.000Z",
    runId,
    kind: "agent-message",
    message,
  });
}

const okBackends = BackendStatusSchema.parse({
  state: "available",
  capabilities: {
    backendId: "fixture",
    version: "fixture-1",
    streamingEvents: true,
    cancellation: true,
    permissionRequests: true,
    executionRoot: "isolated",
  },
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

interface Harness {
  target: HTMLElement;
  unmount: () => void;
}

function mountView(): Harness {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const app = mount(StewardView, { target });
  return {
    target,
    unmount: () => {
      unmount(app);
      target.remove();
    },
  };
}

/** 等待 effect/微任务 settle（$effect 与 await 链都走微任务）。 */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

/** 点击文本匹配的按钮/可选 run 行。 */
function clickByText(root: HTMLElement, text: string): HTMLElement {
  const elements = [...root.querySelectorAll<HTMLElement>("button, label")];
  const hit = elements.find((el) => el.textContent?.includes(text));
  if (!hit) throw new Error(`element with text "${text}" not found`);
  hit.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  flushSync();
  return hit;
}

function runRow(root: HTMLElement, runId: string): HTMLElement {
  const hit = [...root.querySelectorAll<HTMLElement>("button")].find((el) =>
    el.textContent?.includes(runId.slice(0, 11)),
  );
  if (!hit) throw new Error(`run row ${runId} not found`);
  return hit;
}

let view: Harness | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  store.loadStewardBackends.mockResolvedValue({ backends: [okBackends], error: null });
  store.loadStewardRuns.mockResolvedValue({ runs: [], error: null });
});

afterEach(() => {
  view?.unmount();
  view = null;
  vi.useRealTimers();
});

describe("StewardView 交互（4.9）", () => {
  it("shows the real restriction when the backend cannot surface permission requests", async () => {
    const restricted = BackendStatusSchema.parse({
      state: "available",
      capabilities: {
        backendId: "codex",
        version: "codex-test/9.9",
        streamingEvents: true,
        cancellation: false,
        permissionRequests: false,
        executionRoot: "isolated",
      },
    });
    store.loadStewardBackends.mockResolvedValue({ backends: [restricted], error: null });
    view = mountView();
    await settle();
    expect(view.target.textContent).toContain("no runtime approvals");
    expect(view.target.textContent).toContain("no cancellation");
  });

  it("stops the 1s polling once the selected run reaches a terminal status", async () => {
    const completed = makeRun({ runSeed: "d04e", status: "completed" });
    store.loadStewardRuns.mockResolvedValue({ runs: [completed], error: null });
    store.pollStewardEvents.mockResolvedValue({
      events: [],
      status: "completed",
      phase: null,
      error: null,
    });
    view = mountView();
    await settle();
    runRow(view.target, completed.runId).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    flushSync();
    await settle();
    // 选中终态 run：仅显式单次拉取，无高频轮询。
    const afterSelection = store.pollStewardEvents.mock.calls.length;
    expect(afterSelection).toBe(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(store.pollStewardEvents.mock.calls.length).toBe(1);
  });

  it("polls every second while running and stops after the status flips terminal", async () => {
    const running = makeRun({ runSeed: "11de", status: "running" });
    store.loadStewardRuns.mockResolvedValue({ runs: [running], error: null });
    store.pollStewardEvents.mockResolvedValue({
      events: [],
      status: "running",
      phase: "analyzing",
      error: null,
    });
    view = mountView();
    await settle();
    runRow(view.target, running.runId).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    flushSync();
    await settle();
    await vi.advanceTimersByTimeAsync(3000);
    expect(store.pollStewardEvents.mock.calls.length).toBeGreaterThanOrEqual(3);
    // 翻转为终态：后续 run 列表刷新返回 completed → effect 清理 interval。
    store.pollStewardEvents.mockResolvedValue({
      events: [],
      status: "completed",
      phase: null,
      error: null,
    });
    store.loadStewardRuns.mockResolvedValue({
      runs: [makeRun({ runSeed: "11de", status: "completed" })],
      error: null,
    });
    await vi.advanceTimersByTimeAsync(1500);
    const stopped = store.pollStewardEvents.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(store.pollStewardEvents.mock.calls.length).toBe(stopped);
  });

  it("keeps polling failures silent until 3 consecutive failures, then surfaces the error", async () => {
    const running = makeRun({ runSeed: "e441", status: "running" });
    store.loadStewardRuns.mockResolvedValue({ runs: [running], error: null });
    store.pollStewardEvents.mockResolvedValue({
      events: [],
      status: null,
      phase: null,
      error: "websocket closed",
    });
    view = mountView();
    await settle();
    runRow(view.target, running.runId).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    flushSync();
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    expect(view.target.textContent).not.toContain("Event polling failed");
    await vi.advanceTimersByTimeAsync(2000);
    expect(view.target.textContent).toContain("Event polling failed");
    expect(view.target.textContent).toContain("websocket closed");
    // 恢复后横幅清除。
    store.pollStewardEvents.mockResolvedValue({
      events: [],
      status: "running",
      phase: "analyzing",
      error: null,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(view.target.textContent).not.toContain("Event polling failed");
  });

  it("drops a late response that resolves after the user switched to another run", async () => {
    const runA = makeRun({ runSeed: "0a0a", status: "running" });
    const runB = makeRun({ runSeed: "0b0b", status: "running" });
    store.loadStewardRuns.mockResolvedValue({ runs: [runA, runB], error: null });
    const pending = deferred<{
      events: RunEvent[];
      status: StewardRun["status"] | null;
      phase: StewardRun["phase"] | null;
      error: string | null;
    }>();
    store.pollStewardEvents.mockImplementationOnce(() => pending.promise);
    store.pollStewardEvents.mockResolvedValue({
      events: [makeEvent(runB.runId, 1, "event-for-B")],
      status: "running",
      phase: "analyzing",
      error: null,
    });
    view = mountView();
    await settle();
    // 选中 A（发起挂起轮询），随后切换到 B（B 的轮询立即完成）。
    runRow(view.target, runA.runId).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    flushSync();
    await settle();
    runRow(view.target, runB.runId).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    flushSync();
    await settle();
    expect(view.target.textContent).toContain("event-for-B");
    // A 的迟到响应到达：不得写入 B 的 scope。
    pending.resolve({
      events: [makeEvent(runA.runId, 1, "late-event-for-A")],
      status: "running",
      phase: "analyzing",
      error: null,
    });
    await settle();
    expect(view.target.textContent).not.toContain("late-event-for-A");
  });

  it("disables Cancel for a running run whose backend declares no cancellation", async () => {
    const noCancel = makeRun({
      runSeed: "0ce1",
      status: "running",
      capabilities: { backendId: "codex", cancellation: false },
    });
    store.loadStewardRuns.mockResolvedValue({ runs: [noCancel], error: null });
    view = mountView();
    await settle();
    runRow(view.target, noCancel.runId).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    flushSync();
    await settle();
    const cancel = [...view.target.querySelectorAll("button")].find((el) =>
      el.textContent?.includes("Cancel run"),
    );
    expect(cancel).toBeTruthy();
    expect((cancel as HTMLButtonElement).disabled).toBe(true);
    expect(store.cancelStewardRun).not.toHaveBeenCalled();
  });

  it("approves a proposal with the typed proposal id (no unsafe casts)", async () => {
    const proposalId = "pr_aaaaaaaaaaaaaaaaaaaaaaaa";
    const awaiting = makeRun({
      runSeed: "a994",
      status: "running",
      proposals: [proposalId],
    });
    // 让审批门可见：phase = awaiting-approval + recommendations 非空。
    const withGate = StewardRunSchema.parse({
      ...awaiting,
      phase: "awaiting-approval",
      recommendations: [
        {
          id: "rcmd_abababababababab",
          kind: "disable",
          rationale: "test rationale",
          skillIds: ["sk_abababababababababababab"],
          findingIds: [],
          payload: {
            kind: "disable",
            selections: [
              {
                workspaceId: "ws_abababababababababababab",
                providerId: "openclaw",
                skillId: "sk_abababababababababababab",
              },
            ],
            reason: "test disable",
          },
        },
      ],
    });
    store.loadStewardRuns.mockResolvedValue({ runs: [withGate], error: null });
    store.pollStewardEvents.mockResolvedValue({
      events: [],
      status: "running",
      phase: "awaiting-approval",
      error: null,
    });
    store.approveStewardProposal.mockResolvedValue({
      result: { applied: 1, conflicts: 0, failed: 0 },
      error: null,
    });
    view = mountView();
    await settle();
    runRow(view.target, withGate.runId).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    flushSync();
    await settle();
    clickByText(view.target, `Approve ${proposalId.slice(0, 8)}`);
    await settle();
    expect(store.approveStewardProposal).toHaveBeenCalledWith({
      runId: withGate.runId,
      proposalId,
    });
  });
});
