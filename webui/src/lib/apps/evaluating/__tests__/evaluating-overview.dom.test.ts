// @vitest-environment jsdom
/**
 * EvaluatingOverview 组件级 DOM 断言（evaluating-world-class task 1.3；
 * evaluating-dashboard 沿承钉：点卡三段路由、typed error 降级卡、Run… 显式
 * 确认（绝不自动运行）、Global 无 run 入口、nextCursor 续页）。
 *
 * 用户原始需求 [2026-10-04]（design §4.1）：总览屏 = 健康度仪表——近期 runs
 * 时间线（三态瞬时判读 + 运行中 cancel + tracked run live 进度）置顶 + 技能
 * 健康卡网格（通过率环 + 三态计数行 + stale 环带 + 失败摘要行）+ 空态单焦点
 * 引导（Creator 深链）。
 *
 * 正交意图：
 *   [1] 健康卡投影：通过率环（SVG，token 色）/三态计数（icon+数字，非零渲染）
 *       /stale 黄带环绕/失败摘要行/typed error 降级卡（整页不失败）。
 *   [2] run 面：时间线行（状态 icon + 技能名 + 相对时间；运行中 cancel +
 *       live 进度）；Run… 仅 Imported ws；弹层显式确认后 start。
 *   [3] 残留台账沿承：errorCount > 0 → 红 chip；= 0 不渲染（正反钉）。
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
// δ 线公共面：失败路径 toast 走 error 变体（组件已迁移 showErrorToast）。
const showErrorToast = vi.hoisted(() => vi.fn());
vi.mock("$lib/toast.svelte", () => ({ showToast, showErrorToast }));

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
  evaluationRunState,
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

describe("EvaluatingOverview health cards (evaluating-world-class 1.3)", () => {
  it("renders the pass-rate ring, three-state counts, stale band and failing line", async () => {
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
    // 通过率环 + 百分比（2/3 ≈ 67%）。ring 色 = failed 相 → destructive。
    expect(host.querySelectorAll('[data-testid="evaluating-pass-ring"]')).toHaveLength(1);
    expect(text()).toContain("67%");
    // 三态计数行（icon + 数字）+ 相对时间。
    const counts = host.querySelector('[data-testid="evaluating-card-counts"]');
    expect(counts?.textContent).toContain("2");
    expect(counts?.textContent).toContain("1");
    expect(text()).toContain("3m ago");
    // stale 黄带环绕 + 占比 chip。
    expect(text()).toContain("50% stale");
    const card = host.querySelector('[data-testid="evaluating-target-card"]');
    expect(card?.className).toContain("ring-amber");
    // 失败摘要行。
    expect(host.querySelector('[data-testid="evaluating-failing-line"]')?.textContent).toContain(
      "1 failing",
    );
  });

  it("renders a muted empty ring and the never-run line when the target has no run yet", async () => {
    const overview = vi.fn().mockResolvedValue(output([okTarget()]));
    mockOverviewRpc(overview);
    mountView();
    await flushAsync();
    expect(text()).toContain("never run");
    // 无 run：环容器在场但无进度弧、无百分比数字。
    const ring = host.querySelector('[data-testid="evaluating-pass-ring"]');
    expect(ring).not.toBeNull();
    expect(ring?.querySelectorAll("circle")).toHaveLength(1);
    expect(text()).not.toMatch(/\d+%/);
    expect(host.querySelector('[data-testid="evaluating-failing-line"]')).toBeNull();
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
    expect(chips[0]!.textContent).toContain("2");
    expect(chips[0]!.className).toContain("bg-destructive"); // 红 chip。
  });

  it("renders the empty state with the Creator deep link when no corpora exist", async () => {
    const overview = vi.fn().mockResolvedValue(output([]));
    mockOverviewRpc(overview);
    mountView();
    await flushAsync();
    expect(text()).toContain("No evaluation corpora yet");
    click(
      Array.from(host.querySelectorAll("button")).find((entry) =>
        entry.textContent?.includes("Open Creator"),
      ),
    );
    expect(goById).toHaveBeenCalledWith("creator.home", { wsId: WS });
  });
});

describe("EvaluatingOverview recent runs timeline (1.3)", () => {
  it("shows a cancel entry for running runs, live progress for the tracked one, and reloads after cancel", async () => {
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
    // 该 run 同时是本 UI 追踪的 run → live 进度注入。
    evaluationRunState.runId = `run_${"1".repeat(24)}`;
    evaluationRunState.target = { workspaceId: WS, providerId: PROVIDER, skillId: SK };
    evaluationRunState.status = "running";
    evaluationRunState.startedAt = new Date().toISOString();
    evaluationRunState.resultCount = 2;
    evaluationRunState.totalCases = 5;
    mountView();
    await flushAsync();

    expect(text()).toContain("Recent runs");
    const rows = host.querySelectorAll('[data-testid="evaluating-recent-run"]');
    expect(rows).toHaveLength(2);
    // tracked 运行中 run 的 live 进度（n/m）。
    expect(
      host.querySelector('[data-testid="evaluating-run-live-progress"]')?.textContent,
    ).toContain("2/5");
    const cancelButtons = Array.from(host.querySelectorAll("button")).filter((button) =>
      button.textContent?.includes("Cancel run"),
    );
    expect(cancelButtons).toHaveLength(1); // completed 行无取消入口。
    click(cancelButtons[0]);
    await flushAsync();
    expect(cancel).toHaveBeenCalledWith({ runId: `run_${"1".repeat(24)}` });
    expect(showToast).toHaveBeenCalledWith(
      "Run cancelled.",
      undefined,
      `eval-run-run_${"1".repeat(24)}`,
    );
    // 取消后（tracked）store 侧驱动刷新；组件侧至少重拉过总览。
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
      Array.from(host.querySelectorAll('[data-stub="dialog-root"] button')).find((entry) =>
        entry.textContent?.includes("Start run"),
      ),
    );
    await flushAsync();
    // 默认勾选 enabled case（disabled 不进首批）。
    expect(start).toHaveBeenCalledWith({
      target: { workspaceId: WS, providerId: PROVIDER, skillId: SK },
      caseIds: [`ev_${"a".repeat(24)}`],
      runner: "analyzer",
    });
    // P2-3：started toast 技能 label 化（人名主显，不再直出 sk_ opaque ID）；
    // R2-3：lifecycle key 入参（终态帧按同 key 取代本帧）。
    expect(showToast).toHaveBeenCalledWith(
      "Run queued for code-review.",
      undefined,
      `eval-run-run_${"3".repeat(24)}`,
    );
  });
});

describe("EvaluatingOverview 批评环 R1 处置批（健康绑定/P1-3/P2-1/2/5/10/11）", () => {
  const now = () => new Date().toISOString();

  function recentRun(
    runId: string,
    overrides: Partial<EvaluationOverviewOutput["recentRuns"][number]> = {},
  ): EvaluationOverviewOutput["recentRuns"][number] {
    return {
      runId,
      target: { workspaceId: WS, providerId: PROVIDER, skillId: SK },
      status: "completed",
      startedAt: now(),
      resultIds: [],
      ...overrides,
    } as EvaluationOverviewOutput["recentRuns"][number];
  }

  it("binds health to the last completed snapshot: a poisoned payload (running partial) falls back to the remembered snapshot", async () => {
    const overview = vi
      .fn()
      .mockResolvedValueOnce(
        output(
          [
            okTarget({
              lastRun: {
                endedAt: new Date(Date.now() - 60_000).toISOString(),
                status: "completed",
                passedCount: 2,
                failedCount: 0,
                errorCount: 0,
                unavailableCount: 0,
              },
            }),
          ],
          [
            recentRun(`run_${"1".repeat(24)}`, {
              resultIds: [`evr_${"1".repeat(24)}`, `evr_${"2".repeat(24)}`],
            }),
          ],
        ),
      )
      .mockResolvedValueOnce(
        output(
          [
            okTarget({
              // 刷新后 payload lastRun 指向 running run 的部分落盘计数（毒化）。
              lastRun: {
                endedAt: now(),
                status: "completed",
                passedCount: 1,
                failedCount: 0,
                errorCount: 0,
                unavailableCount: 0,
              },
            }),
          ],
          [
            recentRun(`run_${"2".repeat(24)}`, {
              status: "running",
              resultIds: [`evr_${"9".repeat(24)}`],
            }),
          ],
        ),
      );
    mockOverviewRpc(overview);
    mountView();
    await flushAsync();
    expect(text()).toContain("100%");
    expect(text()).toContain("2 ran");

    click(
      Array.from(host.querySelectorAll("button")).find((entry) =>
        entry.textContent?.includes("Refresh"),
      ),
    );
    await flushAsync();
    // running 的部分计数不覆盖健康度：回落会话内记忆的 completed 快照。
    expect(text()).toContain("100%");
    expect(text()).toContain("2 ran");
  });

  it("shows an empty ring with 'no completed run' when only a cancelled run exists (no trusted snapshot)", async () => {
    const overview = vi
      .fn()
      .mockResolvedValue(
        output([okTarget()], [recentRun(`run_${"1".repeat(24)}`, { status: "cancelled" })]),
      );
    mockOverviewRpc(overview);
    mountView();
    await flushAsync();
    expect(text()).toContain("no completed run");
    expect(text()).not.toContain("never run");
    expect(text()).not.toMatch(/\d+%/);
  });

  it("P2-1: colors the completed timeline icon by outcome when counts align with lastRun", async () => {
    const overview = vi.fn().mockResolvedValue(
      output(
        [
          okTarget({
            skillId: SK,
            lastRun: {
              endedAt: now(),
              status: "completed",
              passedCount: 1,
              failedCount: 2,
              errorCount: 0,
              unavailableCount: 0,
            },
          }),
          okTarget({
            skillId: SK2,
            skillName: "clean-skill",
            lastRun: {
              endedAt: now(),
              status: "completed",
              passedCount: 3,
              failedCount: 0,
              errorCount: 0,
              unavailableCount: 0,
            },
          }),
        ],
        [
          recentRun(`run_${"1".repeat(24)}`, {
            resultIds: [`evr_${"1".repeat(24)}`, `evr_${"2".repeat(24)}`, `evr_${"3".repeat(24)}`],
          }),
          recentRun(`run_${"2".repeat(24)}`, {
            target: { workspaceId: WS, providerId: PROVIDER, skillId: SK2 },
            resultIds: [`evr_${"4".repeat(24)}`, `evr_${"5".repeat(24)}`, `evr_${"6".repeat(24)}`],
          }),
        ],
      ),
    );
    mockOverviewRpc(overview);
    mountView();
    await flushAsync();

    const rows = host.querySelectorAll('[data-testid="evaluating-recent-run"]');
    expect(rows).toHaveLength(2);
    // 有失败 → 红✗；全过 → 绿✓（icon-stub 携带透传类——以类断言）。
    expect(rows[0]?.querySelector('span[data-testid="icon-stub"].text-destructive')).not.toBeNull();
    expect(rows[1]?.querySelector('span[data-testid="icon-stub"].text-emerald-600')).not.toBeNull();
    // P2-2：百分比旁带分母（实际执行数）。
    expect(text()).toContain("3 ran");
  });

  it("P2-5: marks completed-but-empty timeline rows with No cases ran", async () => {
    const overview = vi
      .fn()
      .mockResolvedValue(
        output([okTarget()], [recentRun(`run_${"1".repeat(24)}`, { resultIds: [] })]),
      );
    mockOverviewRpc(overview);
    mountView();
    await flushAsync();
    const row = host.querySelector('[data-testid="evaluating-recent-run"]');
    expect(row?.textContent).toContain("No cases ran");
  });

  it("P1-3/P2-8/P2-12: pins the responsive css contract hooks (auto-fill minmax grid, header degrade, focus ring)", async () => {
    const overview = vi.fn().mockResolvedValue(output([okTarget()]));
    mockOverviewRpc(overview);
    mountView();
    await flushAsync();

    // 卡网格：220px 下限 auto-fill（Agent 面板挤压下列数收缩而非截断卡）。
    const grid = host.querySelector('[data-testid="evaluating-target-grid"]');
    expect(grid?.className).toContain("minmax(min(220px,100%),1fr)");
    // 根容器查询上下文（<480px 按钮降级为图标）+ focus-visible 作用域。
    expect(host.querySelector(".evaluating-overview-shell")).not.toBeNull();
    expect(host.querySelector(".evaluating-kbd-scope")).not.toBeNull();
    // 「N skills」徽标 nowrap + 按钮文案挂 label 钩子（取叶子 span——外层容器
    // 文本也含 "1 skill"）。
    const badge = Array.from(host.querySelectorAll("header span")).find(
      (entry) => entry.childElementCount === 0 && entry.textContent?.trim() === "1 skill",
    );
    expect(badge?.className).toContain("whitespace-nowrap");
    const runButton = Array.from(host.querySelectorAll("button")).find((entry) =>
      entry.textContent?.includes("Run…"),
    );
    expect(runButton?.querySelector(".evaluating-btn-label")).not.toBeNull();
  });

  it("P2-10: toasts the completed summary once per run (idempotent dedupe)", async () => {
    const overview = vi.fn().mockResolvedValue(output([okTarget()]));
    mockOverviewRpc(overview);
    mountView();
    await flushAsync();

    evaluationRunState.settledSummary = {
      runId: `run_${"4".repeat(24)}`,
      status: "completed",
      passed: 3,
      executed: 4,
    };
    await flushAsync();
    expect(showToast).toHaveBeenCalledWith(
      "Run completed: 3/4 passed.",
      undefined,
      `eval-run-run_${"4".repeat(24)}`,
    );
    evaluationRunState.settledSummary = {
      runId: `run_${"4".repeat(24)}`,
      status: "completed",
      passed: 3,
      executed: 4,
    };
    await flushAsync();
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it("P2-11: shows the readonly model/route line after picking the Provider model runner", async () => {
    const settingsGet = vi.fn().mockResolvedValue({
      settings: {
        configVersion: 1,
        revision: 0,
        model: { provider: "zai", model: "glm-5.3", reasoningEffort: "high" },
        preset: "draft",
        permissions: {},
        session: {},
        defaultMode: "free",
        modelRoutes: [],
      },
      providers: [],
    });
    const overview = vi.fn().mockResolvedValue(output([okTarget()]));
    rpcClient = {
      evaluation: {
        overview,
        cases: { list: vi.fn().mockResolvedValue({ cases: [] }) },
        run: { start: vi.fn(), status: vi.fn(), cancel: vi.fn() },
      },
      agent: { settings: { get: settingsGet } },
    };
    mountView();
    await flushAsync();

    click(
      Array.from(host.querySelectorAll("button")).find((entry) =>
        entry.textContent?.includes("Run…"),
      ),
    );
    flushSync();
    // 先选 target（runner 区在 effectiveTarget 就绪后渲染）。
    click(host.querySelector('[data-stub="dialog-root"] button[aria-pressed]'));
    await flushAsync();
    // analyzer 默认：不拉 settings。
    expect(settingsGet).not.toHaveBeenCalled();
    click(
      Array.from(host.querySelectorAll('[data-stub="dialog-root"] button')).find((entry) =>
        entry.textContent?.includes("Provider model"),
      ),
    );
    await flushAsync();
    expect(settingsGet).toHaveBeenCalledWith({});
    const line = host.querySelector('[data-testid="run-provider-model-line"]');
    expect(line?.textContent).toContain("Model: zai · glm-5.3 · reasoning high");
  });
});
