// @vitest-environment jsdom
/**
 * Eval 子视图 revision 双显合并测试（design-critique R1 Gap 1，2026-10-02）。
 *
 * 用户原始需求（批评回执 docs/reviews/2026-10-02-design-critique/r1-raw.md）：
 * 「eval 每行 `bound 6418692badfaf8…` + `rev 6418692badfaf8…` 同一 hash 打
 * 两遍——机器语汇压过了人的层级」。
 *
 * 正交意图：
 *   [1] 合并钉：latest 的 observedEndRevision === boundRevision 时左侧 bound
 *       不再渲染（右侧 `rev` 即同一 hash，单列即全义）。
 *   [2] 对照钉：revision 漂移（语料绑定旧版、结果观察新版）时 bound/rev 双列
 *       保留，读作「跑的是旧版」。
 *   [3] 未跑钉：latest=null 时 bound 保留（唯一 revision 信息源，不能丢）。
 *   [4] 组内去重钉（R2）：连续行同 boundRevision 时仅组首行播报 bound。
 *   [5] 失败面钉（R2）：failed 行播报未通过断言计数；error/unavailable 行
 *       播报 failure.detail（有界截断）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// 与 creator-deeplink-recovery 同法：mount 走 client 入口，统一重定向 "svelte"。
// @ts-expect-error -- 无类型声明的运行时直连（与 svelte-client.ts 同法）
vi.mock("svelte", async () => await import("../../../node_modules/svelte/src/index-client.js"));

// connectionState（eval-view 的挂载竞态补救读它）：恒 connected + 无 rpc →
// 首载/补发均静默 no-op，rows 由测试直接写入（本测试钉的是展示层合并逻辑）。
vi.mock("../store.svelte", () => ({
  connectionState: { status: "connected", error: null },
}));
vi.mock("$app/navigation", () => ({ goto: vi.fn() }));
vi.mock("$app/state", () => ({
  page: {
    url: {
      pathname: "/creator/edit/ws_1/openclaw/sk_1",
      search: "?subview=eval",
      searchParams: new URLSearchParams("subview=eval"),
    },
    params: {},
  },
}));
// shadcn 原语 → bits-ui（node_modules .svelte，vitest 外置）：button 以 stub 替换。
vi.mock("$lib/components/ui/button", async () => {
  const { default: stub } = await import("./stubs/ui-button-stub.svelte");
  return { Button: stub };
});
// @lucide/svelte 图标 = node_modules 的 .svelte（root vitest 管线不编译）。
vi.mock(
  "@lucide/svelte/icons/clipboard-check",
  async () => await import("./stubs/lucide-icon-mocks.js"),
);
vi.mock(
  "@lucide/svelte/icons/loader-circle",
  async () => await import("./stubs/lucide-icon-mocks.js"),
);
vi.mock("@lucide/svelte/icons/save", async () => await import("./stubs/lucide-icon-mocks.js"));

import EvalViewHost from "./stubs/eval-view-host.svelte";
import { flushSync, mount, unmount } from "./svelte-client";
import {
  evaluationViewState,
  resetEvaluationView,
  type EvaluationRow,
} from "../stores/evaluation-view.svelte";
import type { EvaluationResultView } from "$shared/contracts/evaluation.js";
import type { SkillId, WorkspaceProviderTarget } from "../types";
const WS = "ws_0123456789abcdef01234567" as WorkspaceProviderTarget["workspaceId"];
const PROVIDER = "openclaw" as WorkspaceProviderTarget["providerId"];
const SK = "sk_0123456789abcdef01234567" as SkillId;

const REV_A = `sha256:${"a".repeat(64)}`;
const REV_B = `sha256:${"b".repeat(64)}`;

/** 最小合法 passed 结果（类型满足 EvaluationResultView；展示层不重解析）。 */
function passedResult(
  caseId: string,
  observedEndRevision: string,
  resultHex: string,
): EvaluationResultView {
  return {
    schemaVersion: 1,
    resultId: `evr_${resultHex.padEnd(24, "0").slice(0, 24)}`,
    runId: `run_${"1".repeat(24)}`,
    caseId,
    target: { workspaceId: WS, providerId: PROVIDER, skillId: SK },
    expectedRevision: observedEndRevision,
    observedStartRevision: observedEndRevision,
    observedEndRevision,
    runner: {
      kind: "analyzer",
      version: { promptVersion: "1", toolVersion: "1", dshVersion: "n/a" },
    },
    startedAt: "2026-10-02T00:00:00.000Z",
    endedAt: "2026-10-02T00:00:01.000Z",
    outcome: "passed",
    assertions: [{ ref: 0, outcome: "passed" }],
    stale: false,
  };
}

function row(caseId: string, latest: EvaluationResultView | null): EvaluationRow {
  return {
    caseId,
    prompt: `Prompt ${caseId}`,
    enabled: true,
    assertionCount: 2,
    boundRevision: REV_A,
    latest,
  };
}

/** 最小合法 failed 结果（R2 失败面钉：1/2 断言未通过）。 */
function failedResult(caseId: string, observedEndRevision: string): EvaluationResultView {
  return {
    schemaVersion: 1,
    resultId: `evr_${"f".repeat(24)}`,
    runId: `run_${"1".repeat(24)}`,
    caseId,
    target: { workspaceId: WS, providerId: PROVIDER, skillId: SK },
    expectedRevision: observedEndRevision,
    observedStartRevision: observedEndRevision,
    observedEndRevision,
    runner: {
      kind: "analyzer",
      version: { promptVersion: "1", toolVersion: "1", dshVersion: "n/a" },
    },
    startedAt: "2026-10-02T00:00:00.000Z",
    endedAt: "2026-10-02T00:00:01.000Z",
    outcome: "failed",
    assertions: [
      { ref: 0, outcome: "passed" },
      { ref: 1, outcome: "failed" },
    ],
    stale: false,
  };
}

let target: HTMLElement;

function mountHost(): { cleanup: () => void } {
  target = document.body.appendChild(document.createElement("div"));
  const instance = mount(EvalViewHost, { target });
  flushSync();
  return {
    cleanup: () => {
      unmount(instance);
      target.remove();
    },
  };
}

function shortRev(value: string): string {
  return value.slice("sha256:".length, "sha256:".length + 14);
}

beforeEach(() => {
  resetEvaluationView();
});

describe("eval view bound/rev display merge (design-critique R1 Gap 1)", () => {
  it("renders a single rev column when the latest result matches the bound revision", () => {
    evaluationViewState.rows = [
      row(`ev_${"a".repeat(24)}`, passedResult(`ev_${"a".repeat(24)}`, REV_A, "1")),
    ];
    flushSync();
    const ctx = mountHost();

    expect(target.textContent).toContain(`rev ${shortRev(REV_A)}…`);
    expect(target.textContent).not.toContain("bound");
    ctx.cleanup();
  });

  it("keeps both columns when the observed revision drifted from the bound one", () => {
    evaluationViewState.rows = [
      row(`ev_${"b".repeat(24)}`, passedResult(`ev_${"b".repeat(24)}`, REV_B, "2")),
    ];
    flushSync();
    const ctx = mountHost();

    expect(target.textContent).toContain(`bound ${shortRev(REV_A)}…`);
    expect(target.textContent).toContain(`rev ${shortRev(REV_B)}…`);
    ctx.cleanup();
  });

  it("keeps bound as the only revision source when the case was never run", () => {
    evaluationViewState.rows = [row(`ev_${"c".repeat(24)}`, null)];
    flushSync();
    const ctx = mountHost();

    expect(target.textContent).toContain(`bound ${shortRev(REV_A)}…`);
    expect(target.textContent).toContain("not run");
    ctx.cleanup();
  });

  it("shows bound once per consecutive same-revision group (R2 merge)", () => {
    // 三行同 boundRevision（均漂移对照态）：仅首行播报 bound，后续行留空。
    evaluationViewState.rows = [
      row(`ev_${"d".repeat(24)}`, passedResult(`ev_${"d".repeat(24)}`, REV_B, "3")),
      row(`ev_${"e".repeat(24)}`, passedResult(`ev_${"e".repeat(24)}`, REV_B, "4")),
      row(`ev_${"f".repeat(24)}`, null),
    ];
    flushSync();
    const ctx = mountHost();

    const boundCount = target.textContent!.split(`bound ${shortRev(REV_A)}…`).length - 1;
    expect(boundCount).toBe(1);
    ctx.cleanup();
  });

  it("renders a failure summary line for failed rows (R2 failure face)", () => {
    evaluationViewState.rows = [
      row(`ev_${"a".repeat(24)}`, failedResult(`ev_${"a".repeat(24)}`, REV_B)),
    ];
    flushSync();
    const ctx = mountHost();

    const summary = target.querySelector('[data-testid="eval-failure-summary"]');
    expect(summary?.textContent).toContain("1/2 assertion failed");
    ctx.cleanup();
  });

  it("shows the result rev once per consecutive same-revision group (R3 column fix)", () => {
    // bound===observed 的合并态下逐行重复的是 rev 列（R2 只去重了 bound 列）：
    // 三行同 revision 仅组首播报 rev，后续行留空。
    evaluationViewState.rows = [
      row(`ev_${"1".repeat(24)}`, passedResult(`ev_${"1".repeat(24)}`, REV_A, "1")),
      row(`ev_${"2".repeat(24)}`, passedResult(`ev_${"2".repeat(24)}`, REV_A, "2")),
      row(`ev_${"3".repeat(24)}`, passedResult(`ev_${"3".repeat(24)}`, REV_A, "3")),
    ];
    flushSync();
    const ctx = mountHost();

    const revCount = target.textContent!.split(`rev ${shortRev(REV_A)}…`).length - 1;
    expect(revCount).toBe(1);
    ctx.cleanup();
  });
});
