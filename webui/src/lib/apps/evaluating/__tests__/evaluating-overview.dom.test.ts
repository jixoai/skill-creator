// @vitest-environment jsdom
/**
 * EvaluatingOverview 组件级 DOM 断言（evaluating-dashboard task 1.2/1.5）。
 *
 * 用户原始需求 [2026-10-03]（design §3）：「顶行：ws 名 + Run… 入口（显式选
 * target 确认）+ 刷新；主体：技能卡网格（五态徽标行 + stale 黄标 + 最近 run
 * 相对时间）；点卡跳三段路由详情」+ 有界近期 runs 行（运行中进度态/取消入口）。
 *
 * 正交意图：
 *   [1] 技能卡投影：五态徽标行 + stale 黄标 + 最近 run 相对时间 + typed error
 *       降级卡（整页不失败）；点卡 → 三段路由详情（goById 断言）。
 *   [2] run 面：Run… 仅 Imported ws（Global 缺席）；弹层显式确认（选 target +
 *       勾 case 后才发 run.start——禁自动运行）；近期 runs 行的运行中取消。
 *   [3] 残留台账（task 1.5）：errorCount > 0 → 红 chip；= 0 不渲染（正反钉）。
 * 妥协声明：live 桌面走查归编排者（1.7 验证门）；本文件覆盖组件行为面。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";

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

vi.mock("$lib/store.svelte", () => ({
  connectionState: { status: "connected", error: null },
}));

// goById 断言面：$lib/shell index 从 navigate.js re-export——mock 该模块即可。
vi.mock("$lib/shell/navigate", () => ({
  goById: vi.fn(),
  goTarget: vi.fn(),
  buildHrefById: vi.fn(() => "/"),
  targetById: vi.fn(),
  setNavControllerAdapter: vi.fn(),
}));

const showToast = vi.hoisted(() => vi.fn());
vi.mock("$lib/toast.svelte", () => ({ showToast }));

vi.mock("$lib/components/ui/button", async () => {
  const { default: stub } = await import("$lib/__tests__/stubs/ui-button-stub.svelte");
  return { Button: stub };
});
vi.mock("$lib/components/ui/checkbox", async () => {
  const { default: stub } = await import("$lib/__tests__/stubs/ui-checkbox-stub.svelte");
  return { Checkbox: stub };
});
vi.mock("$lib/components/ui/dialog", async () => ({
  Root: (await import("$lib/__tests__/stubs/dialog-stub/Root.svelte")).default,
  Content: (await import("$lib/__tests__/stubs/dialog-stub/Content.svelte")).default,
  Header: (await import("$lib/__tests__/stubs/dialog-stub/Header.svelte")).default,
  Title: (await import("$lib/__tests__/stubs/dialog-stub/Title.svelte")).default,
  Description: (await import("$lib/__tests__/stubs/dialog-stub/Description.svelte")).default,
  Footer: (await import("$lib/__tests__/stubs/dialog-stub/Footer.svelte")).default,
}));

import RouterContextHarness from "./router-context-harness.svelte";
import { goById } from "$lib/shell/navigate";
import {
  evaluationOverviewState,
  resetEvaluationOverview,
  resetEvaluationRun,
} from "$lib/stores/evaluation-view.svelte";
import type {
  EvaluationCase,
  EvaluationOverviewOutput,
  EvaluationOverviewTarget,
} from "$shared/contracts/evaluation.js";
import type { ProviderId, WorkspaceId } from "$shared/contracts/workspaces.js";
import type { SkillId } from "$shared/contracts/skills.js";

const WS = "ws_0123456789abcdef01234567" as WorkspaceId;
const PROVIDER = "openclaw" as ProviderId;
const SK = "sk_0123456789abcdef01234567" as SkillId;
const SK2 = "sk_ffffffffffffffffffffffff" as SkillId;

function okTarget(
  overrides: {
    skillId?: SkillId;
    skillName?: string;
    caseCount?: number;
    lastRun?: NonNullable<Extract<EvaluationOverviewTarget, { skillName: string }>["lastRun"]>;
    staleRatio?: number;
  } = {},
): Extract<EvaluationOverviewTarget, { skillName: string }> {
  return {
    target: { workspaceId: WS, providerId: PROVIDER, skillId: overrides.skillId ?? SK },
    skillName: overrides.skillName ?? "code-review",
    caseCount: overrides.caseCount ?? 3,
    ...(overrides.lastRun === undefined ? {} : { lastRun: overrides.lastRun }),
    ...(overrides.staleRatio === undefined ? {} : { staleRatio: overrides.staleRatio }),
  };
}

function output(
  targets: EvaluationOverviewTarget[],
  recentRuns: EvaluationOverviewOutput["recentRuns"] = [],
  nextCursor?: string,
): EvaluationOverviewOutput {
  return { targets, recentRuns, ...(nextCursor ? { nextCursor } : {}) } as EvaluationOverviewOutput;
}

function makeCase(caseId: string, enabled: boolean): EvaluationCase {
  return {
    schemaVersion: 1,
    caseId,
    enabled,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    source: "user",
    boundRevision: `sha256:${"b".repeat(64)}`,
    input: { prompt: `Prompt ${caseId}`, assertions: [{ kind: "contains", value: "MIT" }] },
  } as EvaluationCase;
}

function mockOverviewRpc(overview: ReturnType<typeof vi.fn>, casesList?: ReturnType<typeof vi.fn>) {
  const start = vi.fn();
  const status = vi.fn();
  const cancel = vi.fn();
  rpcClient = {
    evaluation: {
      overview,
      cases: { list: casesList ?? vi.fn().mockResolvedValue({ cases: [] }) },
      run: { start, status, cancel },
    },
  };
  return { start, status, cancel };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
}

let host: HTMLElement;
const mounted: ReturnType<typeof mount>[] = [];

function mountView(wsId = WS): void {
  host = document.body.appendChild(document.createElement("div"));
  const instance = mount(RouterContextHarness, { target: host, props: { view: "overview", wsId } });
  mounted.push(instance);
}

function text(): string {
  return host.textContent ?? "";
}

function click(button: Element | null | undefined): void {
  expect(button, "click target must exist").toBeTruthy();
  button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  flushSync();
}

beforeEach(() => {
  rpcClient = null;
  showToast.mockReset();
  vi.mocked(goById).mockReset();
  resetEvaluationOverview();
  resetEvaluationRun();
});

afterEach(() => {
  for (const instance of mounted.splice(0)) unmount(instance);
  host?.remove();
});

describe("EvaluatingOverview (evaluating-dashboard 1.2)", () => {
  it("renders the card grid with five-state badges, stale marker and relative time", async () => {
    const overview = vi.fn().mockResolvedValue(
      output([
        okTarget({
          lastRun: {
            endedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
            status: "completed",
            passedCount: 2,
            failedCount: 1,
            errorCount: 0,
            unavailableCount: 0,
          },
          staleRatio: 0.5,
        }),
      ]),
    );
    mockOverviewRpc(overview);
    mountView();
    await flushAsync();

    expect(overview).toHaveBeenCalledWith({ wsId: WS });
    expect(text()).toContain("code-review");
    expect(text()).toContain("2 passed");
    expect(text()).toContain("1 failed");
    expect(text()).toContain("50% stale");
    expect(text()).toContain("3m ago");
    // 五态徽标行存在（data-testid 锚点）。
    expect(host.querySelectorAll('[data-testid="evaluating-card-badges"]')).toHaveLength(1);
  });

  it("navigates to the three-segment detail route on card click", async () => {
    const overview = vi.fn().mockResolvedValue(output([okTarget()]));
    mockOverviewRpc(overview);
    mountView();
    await flushAsync();
    click(host.querySelector('[data-testid="evaluating-target-card"]'));
    expect(goById).toHaveBeenCalledWith("evaluating.detail", {
      wsId: WS,
      providerId: PROVIDER,
      skillId: SK,
    });
  });

  it("degrades a typed-error target to an error card without failing the page", async () => {
    const errorTarget: EvaluationOverviewTarget = {
      target: { workspaceId: WS, providerId: PROVIDER, skillId: SK2 },
      error: { code: "io-error", message: "cases.json unreadable" },
    };
    const overview = vi.fn().mockResolvedValue(output([okTarget(), errorTarget]));
    mockOverviewRpc(overview);
    mountView();
    await flushAsync();

    expect(text()).toContain("unreadable corpus");
    expect(text()).toContain("io-error: cases.json unreadable");
    // 正常卡不受牵连。
    expect(text()).toContain("code-review");
  });

  it("renders a red errors chip only for non-zero errorCount (task 1.5 both sides)", async () => {
    const overview = vi.fn().mockResolvedValue(
      output([
        okTarget({
          skillId: SK,
          lastRun: {
            endedAt: new Date().toISOString(),
            status: "completed",
            passedCount: 1,
            failedCount: 0,
            errorCount: 2,
            unavailableCount: 0,
          },
        }),
        okTarget({
          skillId: SK2,
          skillName: "clean-skill",
          lastRun: {
            endedAt: new Date().toISOString(),
            status: "completed",
            passedCount: 3,
            failedCount: 0,
            errorCount: 0,
            unavailableCount: 0,
          },
        }),
      ]),
    );
    mockOverviewRpc(overview);
    mountView();
    await flushAsync();

    const chips = host.querySelectorAll('[data-testid="evaluating-errors-chip"]');
    expect(chips).toHaveLength(1); // 反态：errorCount=0 的卡不渲染。
    expect(chips[0]!.textContent).toContain("2 errors");
    expect(chips[0]!.className).toContain("bg-destructive"); // 红 chip。
  });

  it("shows a cancel entry for running recent runs and reloads overview after cancel", async () => {
    const overview = vi.fn().mockResolvedValue(
      output(
        [okTarget()],
        [
          {
            runId: `run_${"1".repeat(24)}`,
            target: { workspaceId: WS, providerId: PROVIDER, skillId: SK },
            status: "running",
            startedAt: new Date().toISOString(),
            resultIds: [],
          },
          {
            runId: `run_${"2".repeat(24)}`,
            target: { workspaceId: WS, providerId: PROVIDER, skillId: SK },
            status: "completed",
            startedAt: new Date().toISOString(),
            endedAt: new Date().toISOString(),
            resultIds: [],
          },
        ],
      ),
    );
    const { cancel } = mockOverviewRpc(overview);
    cancel.mockResolvedValue({ runId: `run_${"1".repeat(24)}`, status: "cancelled" });
    mountView();
    await flushAsync();

    expect(text()).toContain("Recent runs");
    const cancelButtons = Array.from(host.querySelectorAll("button")).filter((button) =>
      button.textContent?.includes("Cancel run"),
    );
    expect(cancelButtons).toHaveLength(1); // completed 行无取消入口。
    click(cancelButtons[0]);
    await flushAsync();
    expect(cancel).toHaveBeenCalledWith({ runId: `run_${"1".repeat(24)}` });
    expect(showToast).toHaveBeenCalledWith("Run cancelled.");
    // 非追踪 run 的取消 → 组件就地重拉总览。
    expect(overview.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("hides the Run entry for the Global workspace (run is Imported-only)", async () => {
    const overview = vi.fn().mockResolvedValue(output([okTarget()]));
    mockOverviewRpc(overview);
    mountView("~");
    await flushAsync();
    expect(text()).not.toContain("Run…");
  });

  it("loads the next cursor page on Load more", async () => {
    const overview = vi
      .fn()
      .mockResolvedValueOnce(output([okTarget()], [], "cursor-1"))
      .mockResolvedValueOnce(output([okTarget({ skillId: SK2, skillName: "second" })]));
    mockOverviewRpc(overview);
    mountView();
    await flushAsync();

    click(
      Array.from(host.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("Load more"),
      ),
    );
    await flushAsync();
    expect(overview).toHaveBeenLastCalledWith({ wsId: WS, cursor: "cursor-1" });
    expect(text()).toContain("second");
    expect(evaluationOverviewState.targets).toHaveLength(2);
  });

  it("starts a run only after explicit target + case confirmation (never automatically)", async () => {
    const caseA = makeCase(`ev_${"a".repeat(24)}`, true);
    const caseB = makeCase(`ev_${"b".repeat(24)}`, false);
    const casesList = vi.fn().mockResolvedValue({ cases: [caseA, caseB] });
    const overview = vi.fn().mockResolvedValue(output([okTarget()]));
    const { start } = mockOverviewRpc(overview, casesList);
    start.mockResolvedValue({ runId: `run_${"3".repeat(24)}`, status: "queued" });
    mountView();
    await flushAsync();

    // 弹层未开：run.start 零调用（禁自动运行）。
    expect(start).not.toHaveBeenCalled();

    click(
      Array.from(host.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("Run…"),
      ),
    );
    flushSync();
    // 未选 target：弹层打开但无三元组、无 cases 拉取。
    expect(casesList).not.toHaveBeenCalled();
    click(host.querySelector('[data-stub="dialog-root"] button[aria-pressed]'));
    await flushAsync();
    expect(casesList).toHaveBeenCalledWith({
      target: { workspaceId: WS, providerId: PROVIDER, skillId: SK },
    });
    // 三段标注（workspace/provider/skill）。
    const triple = host.querySelector('[data-testid="run-target-triple"]');
    expect(triple?.textContent).toContain(WS);
    expect(triple?.textContent).toContain(PROVIDER);
    expect(triple?.textContent).toContain(SK);

    click(
      Array.from(host.querySelectorAll('[data-stub="dialog-root"] button')).find((button) =>
        button.textContent?.includes("Start run"),
      ),
    );
    await flushAsync();
    // 默认勾选 enabled case（disabled 不进首批）。
    expect(start).toHaveBeenCalledWith({
      target: { workspaceId: WS, providerId: PROVIDER, skillId: SK },
      caseIds: [`ev_${"a".repeat(24)}`],
      runner: "analyzer",
    });
    expect(showToast).toHaveBeenCalledWith("Run queued for sk_0123456789abcdef01234567.");
  });

  it("renders the empty state when no corpora exist", async () => {
    const overview = vi.fn().mockResolvedValue(output([]));
    mockOverviewRpc(overview);
    mountView();
    await flushAsync();
    expect(text()).toContain("No evaluation corpora yet");
  });
});
