// @vitest-environment jsdom
/**
 * WikiScopeView 蒸馏入口的组件级 DOM 断言（skill-wiki-maintainer task 1.6，
 * 2026-09-25）。
 * 用户原始需求 [2026-09-25]：「WikiScopeView workspace scope『Distill to global』：
 * start→进度→跳 proposal 面」。
 * 正交意图：
 *   [1] scope 条件渲染：workspace scope 有入口按钮；global（~）无（蒸馏方向
 *       workspace→global，global 无 source patterns）。
 *   [2] 点击→状态迁移的 DOM 面：starting 不定态 → awaiting-approval（徽标 +
 *       View proposals + Cancel run）→ 决定面列表（AgentProposalCard stub 行）。
 *   [3] 错误面：DISTILL_ACTIVE_RUN 拒绝呈现为人读文案（不崩栈）；completed
 *       终态呈现 + 入口按钮恢复可用。
 * 妥协声明：live dev 环境（pnpm dev + 浏览器）在本次子代理上下文不可用——
 *   工作区存在操作者的常驻 daemon（bun src/daemon/main.ts），dev 接管会先停
 *   它，违反「不干扰用户未授权进程」边界；故按任务简报的回退路径以组件级
 *   DOM 测试覆盖（视觉走查由编排者另行分发 vision）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, unmount, type Component } from "svelte";
import { ORPCError } from "@orpc/client";

let rpcClient: Record<string, unknown> | null = null;

vi.mock("$lib/stores/connection.svelte", () => ({
  connectionState: { status: "connected", error: null },
  connect: vi.fn(),
  disconnect: vi.fn(),
  getConnectionGeneration: () => 0,
  getRpc: () => rpcClient,
  requireRpc: () => {
    if (!rpcClient) throw new Error("The Skill Creator daemon is not connected.");
    return rpcClient;
  },
}));

vi.mock("$lib/stores/wiki.svelte", () => ({
  wikiState: { scope: "~", patterns: [], loading: false, error: null },
  loadWiki: vi.fn(async () => "loaded"),
  appendWikiFragment: vi.fn(),
  readWikiPattern: vi.fn(),
  resetWiki: vi.fn(),
}));

vi.mock("$lib/store.svelte", () => ({
  workspaceState: { workspaces: [] },
}));

vi.mock("$lib/components/agent/AgentProposalCard.svelte", async () => {
  return { default: (await import("$lib/__tests__/stubs/proposal-card-stub.svelte")).default };
});

import RouterContextHarness from "./router-context-harness.svelte";
import { resetWikiDistill, wikiDistillState } from "$lib/stores/wiki-distill.svelte";
import type { DistillStatusOutput } from "$shared/contracts/wiki-distill.js";

const WS_ID = "ws_" + "d".repeat(24);
const RUN_ID = "wd_" + "a".repeat(24);

function zeroCounters(): DistillStatusOutput["counters"] {
  return {
    applied: 0,
    idempotent: 0,
    stale: 0,
    "patch-failed": 0,
    "model-invalid": 0,
    rejected: 0,
    expired: 0,
    "not-proposed": 0,
    "io-failed": 0,
  };
}

function statusOf(state: DistillStatusOutput["state"]): DistillStatusOutput {
  return { runId: RUN_ID, state, reason: null, counters: zeroCounters(), proposalRefs: [] };
}

function mockDistill() {
  const start = vi.fn();
  const status = vi.fn();
  const cancel = vi.fn();
  const list = vi.fn();
  rpcClient = { wiki: { distill: { start, status, cancel } }, agent: { proposals: { list } } };
  return { start, status, cancel, list };
}

function mountView(wsId?: string): HTMLElement {
  const target = document.createElement("div");
  document.body.appendChild(target);
  mounted.push(mount(RouterContextHarness as Component, { target, props: { wsId } }));
  return target;
}

const mounted: ReturnType<typeof mount>[] = [];

/** 短等待：flush 微任务链（start→poll→DOM effect 更新）。 */
function settle(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buttons(root: HTMLElement): HTMLButtonElement[] {
  return [...root.querySelectorAll("button")];
}

function findButton(root: HTMLElement, text: string): HTMLButtonElement | undefined {
  return buttons(root).find((button) => (button.textContent ?? "").includes(text));
}

function click(button: HTMLButtonElement): void {
  button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

/** 空白归一化的可见文本（模板插值在文本节点间引入换行缩进）。 */
function textOf(root: HTMLElement): string {
  return (root.textContent ?? "").replace(/\s+/g, " ");
}

beforeEach(() => {
  rpcClient = null;
  resetWikiDistill();
});

afterEach(() => {
  while (mounted.length > 0) {
    unmount(mounted.pop() as ReturnType<typeof mount>);
  }
  document.body.innerHTML = "";
});

describe("Distill entry scope gating", () => {
  it("shows the Distill to global button only for a workspace scope", () => {
    mockDistill();
    const workspaceRoot = mountView(WS_ID);
    expect(findButton(workspaceRoot, "Distill to global")).toBeTruthy();

    const globalRoot = mountView();
    expect(findButton(globalRoot, "Distill to global")).toBeUndefined();
    expect(globalRoot.textContent ?? "").not.toContain("Distill to global");
  });
});

describe("Distill click → progress → decision face", () => {
  it("renders the indeterminate starting state while start is in flight", async () => {
    const { start } = mockDistill();
    let resolveStart: (value: { runId: string }) => void = () => {};
    start.mockReturnValue(
      new Promise((resolve) => {
        resolveStart = resolve;
      }),
    );

    const root = mountView(WS_ID);
    click(findButton(root, "Distill to global") as HTMLButtonElement);
    await settle();

    expect(start).toHaveBeenCalledWith({ source: WS_ID });
    expect(root.textContent ?? "").toContain("Distilling fragments to the global wiki");
    // starting 不定态：runId 未知，无 Cancel 向量（daemon cancel 以 runId 为键）。
    expect(findButton(root, "Cancel run")).toBeUndefined();
    // 入口按钮在 run 进行中禁用。
    expect(findButton(root, "Distill to global")?.disabled).toBe(true);

    resolveStart({ runId: RUN_ID });
    await settle();
  });

  it("shows awaiting-approval with badge, decision entry, and cancel after admission", async () => {
    const { start, status, list } = mockDistill();
    start.mockResolvedValue({ runId: RUN_ID });
    status.mockResolvedValue(
      (() => {
        const s = statusOf("awaiting-approval");
        s.proposalRefs = [
          { ordinal: 0, proposalId: "p0", status: "pending" },
          { ordinal: 1, proposalId: "p1", status: "pending" },
        ];
        return s;
      })(),
    );
    list.mockResolvedValue({
      proposals: [
        {
          proposalId: "p1",
          capability: "wiki.distill_apply",
          input: { runId: RUN_ID, ordinal: 1 },
          status: "pending",
          createdAt: "2026-09-25T00:00:00.000Z",
        },
        {
          proposalId: "p0",
          capability: "wiki.distill_apply",
          input: { runId: RUN_ID, ordinal: 0 },
          status: "pending",
          createdAt: "2026-09-25T00:00:00.000Z",
        },
      ],
    });

    const root = mountView(WS_ID);
    click(findButton(root, "Distill to global") as HTMLButtonElement);
    await settle(40);

    expect(wikiDistillState.state).toBe("awaiting-approval");
    expect(textOf(root)).toContain("awaiting approval");
    expect(textOf(root)).toContain("2 proposals ready for review");
    expect(findButton(root, "View proposals")).toBeTruthy();
    expect(findButton(root, "Cancel run")).toBeTruthy();

    // 决定面：View proposals 展开 ordinal 升序的 proposal 卡（stub 行）。
    click(findButton(root, "View proposals") as HTMLButtonElement);
    await settle();
    const cards = [...root.querySelectorAll("[data-testid='proposal-card']")];
    expect(cards.map((card) => card.getAttribute("data-proposal-id"))).toEqual(["p0", "p1"]);
    expect(list).toHaveBeenCalledWith({});
  });

  it("surfaces a DISTILL_ACTIVE_RUN rejection as a readable error face", async () => {
    const { start } = mockDistill();
    start.mockRejectedValue(
      new ORPCError("DISTILL_ACTIVE_RUN", {
        message: `an active distill run ${RUN_ID} exists for ${WS_ID}`,
      }),
    );

    const root = mountView(WS_ID);
    click(findButton(root, "Distill to global") as HTMLButtonElement);
    await settle();

    expect(root.textContent ?? "").toContain("Couldn't start the distillation");
    expect(root.textContent ?? "").toContain("already running");
    // 拒绝后入口按钮恢复可用（可稍后重试）。
    expect(findButton(root, "Distill to global")?.disabled).toBe(false);
    expect(findButton(root, "Dismiss")).toBeTruthy();
  });

  it("renders the completed terminal state and re-enables the entry button", async () => {
    const { start, status } = mockDistill();
    start.mockResolvedValue({ runId: RUN_ID });
    const completed = statusOf("completed");
    completed.counters = { ...zeroCounters(), applied: 2 };
    status.mockResolvedValue(completed);

    const root = mountView(WS_ID);
    click(findButton(root, "Distill to global") as HTMLButtonElement);
    await settle(40);

    expect(root.textContent ?? "").toContain("Distillation completed");
    expect(root.textContent ?? "").toContain("applied 2");
    expect(findButton(root, "Cancel run")).toBeUndefined();
    expect(findButton(root, "Dismiss")).toBeTruthy();
    expect(findButton(root, "Distill to global")?.disabled).toBe(false);

    click(findButton(root, "Dismiss") as HTMLButtonElement);
    await settle();
    expect(root.textContent ?? "").not.toContain("Distillation completed");
  });
});
