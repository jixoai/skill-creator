// @vitest-environment jsdom
/**
 * EvaluatingDetail 组件级 DOM 断言（evaluating-dashboard task 1.3/1.5；
 * 迁移自 eval-view-revision-display.test.ts 的 R1-R3 revision 钉）。
 *
 * 用户原始需求 [2026-10-03]（design §3/§4）：详情屏 = eval-view 迁 apps/evaluating
 * 并升格——cases 表（五态 + bound/rev 对照 + 失败断言展开：期望 vs 观测 +
 * observedEndRevision 对比）+ Run（显式确认）/Cancel + case 新建编辑
 * （Imported only；Global 只读徽标）。
 *
 * 正交意图：
 *   [1] 迁移钉（design-critique R1/R2/R3）：bound/rev 双显合并、组内去重、
 *       未跑行 bound 保留、失败摘要行。
 *   [2] 升格钉：失败断言展开（ref 对齐期望 vs 观测）、Run 固定三元组确认、
 *       case 新建（boundRevision=现读 revision）/编辑（bound 保留）、
 *       Global 只读（入口缺席 + 徽标 + 说明）、active run 取消。
 *   [3] 残留台账（task 1.5）：非零 error 行 → 红 chip；= 0 不渲染（正反钉）。
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
vi.mock("$lib/components/ui/input", async () => {
  const { default: stub } = await import("$lib/__tests__/stubs/ui-input-stub.svelte");
  return { Input: stub };
});
vi.mock("$lib/components/ui/textarea", async () => {
  const { default: stub } = await import("$lib/__tests__/stubs/ui-textarea-stub.svelte");
  return { Textarea: stub };
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
  evaluationRunState,
  evaluationViewState,
  resetEvaluationRun,
  resetEvaluationView,
} from "$lib/stores/evaluation-view.svelte";
import type {
  EvaluationCase,
  EvaluationResultView,
  EvaluationTarget,
} from "$shared/contracts/evaluation.js";

const WS = "ws_0123456789abcdef01234567";
const PROVIDER = "openclaw";
const SK = "sk_0123456789abcdef01234567";
const REV_A = `sha256:${"a".repeat(64)}`;
const REV_B = `sha256:${"b".repeat(64)}`;
const target = { workspaceId: WS, providerId: PROVIDER, skillId: SK } as EvaluationTarget;

function makeCase(
  caseId: string,
  overrides: { prompt?: string; boundRevision?: string; enabled?: boolean } = {},
): EvaluationCase {
  return {
    schemaVersion: 1,
    caseId,
    enabled: overrides.enabled ?? true,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    source: "user",
    boundRevision: overrides.boundRevision ?? REV_A,
    input: {
      prompt: overrides.prompt ?? `Prompt ${caseId}`,
      assertions: [
        { kind: "contains", value: "MIT", description: "license line" },
        { kind: "finding-triggered", value: true },
      ],
    },
  } as EvaluationCase;
}

function makeResult(
  caseId: string,
  overrides: Partial<EvaluationResultView> = {},
): EvaluationResultView {
  return {
    schemaVersion: 1,
    resultId: `evr_${caseId.slice(3, 27).padEnd(24, "0")}`,
    runId: `run_${"1".repeat(24)}`,
    caseId,
    target,
    expectedRevision: REV_A,
    observedStartRevision: REV_A,
    observedEndRevision: REV_A,
    runner: {
      kind: "analyzer",
      version: { promptVersion: "1", toolVersion: "1", dshVersion: "n/a" },
    },
    startedAt: "2026-10-02T00:00:00.000Z",
    endedAt: "2026-10-02T00:00:01.000Z",
    outcome: "passed",
    assertions: [
      { ref: 0, outcome: "passed" },
      { ref: 1, outcome: "passed" },
    ],
    stale: false,
    ...overrides,
  } as EvaluationResultView;
}

interface RpcMock {
  casesList: ReturnType<typeof vi.fn>;
  resultsList: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
}

function mockRpc(
  cases: EvaluationCase[],
  results: EvaluationResultView[],
  options: { skillName?: string | null } = {},
): RpcMock {
  const mock: RpcMock = {
    casesList: vi.fn().mockResolvedValue({ cases }),
    resultsList: vi.fn().mockResolvedValue({ results }),
    info:
      options.skillName === null
        ? vi.fn().mockRejectedValue(new Error("skill not found"))
        : vi.fn().mockResolvedValue({
            skillId: SK,
            name: options.skillName ?? "code-review",
            provider: PROVIDER,
            revision: REV_A,
          }),
    create: vi.fn().mockResolvedValue({ case_: cases[0] }),
    update: vi.fn().mockResolvedValue({ case_: cases[0] }),
    remove: vi.fn().mockResolvedValue({ removed: true }),
    start: vi.fn().mockResolvedValue({ runId: `run_${"9".repeat(24)}`, status: "queued" }),
    cancel: vi.fn(),
    status: vi.fn(),
  };
  rpcClient = {
    skills: { info: mock.info },
    evaluation: {
      cases: {
        list: mock.casesList,
        create: mock.create,
        update: mock.update,
        remove: mock.remove,
      },
      results: { list: mock.resultsList },
      run: { start: mock.start, cancel: mock.cancel, status: mock.status },
    },
  };
  return mock;
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
  mounted.push(
    mount(RouterContextHarness, {
      target: host,
      props: { view: "detail", wsId, providerId: PROVIDER, skillId: SK },
    }),
  );
}

function text(): string {
  return host.textContent ?? "";
}

function button(label: string): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll("button")).find((entry) =>
    entry.textContent?.includes(label),
  );
}

function click(buttonEl: Element | null | undefined): void {
  expect(buttonEl, "click target must exist").toBeTruthy();
  buttonEl!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  flushSync();
}

function shortRev(value: string): string {
  return value.slice("sha256:".length, "sha256:".length + 14);
}

beforeEach(() => {
  rpcClient = null;
  showToast.mockReset();
  vi.mocked(goById).mockReset();
  resetEvaluationView();
  resetEvaluationRun();
});

afterEach(() => {
  while (mounted.length > 0) unmount(mounted.pop() as ReturnType<typeof mount>);
  host?.remove();
});

describe("EvaluatingDetail route binding and rows (1.3)", () => {
  it("binds the three-segment route params to the loaded scope and skill title", async () => {
    const mock = mockRpc([makeCase(`ev_${"a".repeat(24)}`)], []);
    mountView();
    await flushAsync();
    expect(mock.casesList).toHaveBeenCalledWith({ target });
    expect(mock.resultsList).toHaveBeenCalledWith({ target });
    expect(mock.info).toHaveBeenCalledWith({
      workspaceId: WS,
      providerId: PROVIDER,
      skillId: SK,
    });
    expect(host.querySelector('[data-testid="evaluating-detail-title"]')?.textContent).toContain(
      "code-review",
    );
  });

  it("renders five-state outcomes with failure summaries and the not-run chip", async () => {
    const failedCase = `ev_${"a".repeat(24)}`;
    const errorCase = `ev_${"b".repeat(24)}`;
    mockRpc(
      [makeCase(failedCase), makeCase(errorCase), makeCase(`ev_${"c".repeat(24)}`)],
      [
        makeResult(failedCase, {
          outcome: "failed",
          assertions: [
            { ref: 0, outcome: "passed" },
            { ref: 1, outcome: "failed" },
          ],
        }),
        makeResult(errorCase, {
          outcome: "error",
          assertions: [],
          failure: { code: "RUNNER_ERROR", detail: "boom".repeat(40) },
        }),
      ],
    );
    mountView();
    await flushAsync();

    expect(text()).toContain("failed");
    expect(text()).toContain("error");
    expect(text()).toContain("not run");
    const summaries = host.querySelectorAll('[data-testid="eval-failure-summary"]');
    expect(summaries[0]?.textContent).toContain("1/2 assertion failed");
    // error 行摘要 = failure.detail 有界截断（120 字符 + …）。
    expect(summaries[1]?.textContent).toContain("…");
    expect(summaries[1]?.textContent).toContain("boom");
  });
});

describe("EvaluatingDetail revision display pins (migrated R1/R2/R3)", () => {
  it("merges to a single rev column when the latest result matches the bound revision", async () => {
    mockRpc([makeCase(`ev_${"a".repeat(24)}`)], [makeResult(`ev_${"a".repeat(24)}`)]);
    mountView();
    await flushAsync();
    expect(text()).toContain(`rev ${shortRev(REV_A)}…`);
    expect(text()).not.toContain("bound");
  });

  it("keeps both columns when the observed revision drifted from the bound one", async () => {
    mockRpc(
      [makeCase(`ev_${"b".repeat(24)}`)],
      [makeResult(`ev_${"b".repeat(24)}`, { observedEndRevision: REV_B })],
    );
    mountView();
    await flushAsync();
    expect(text()).toContain(`bound ${shortRev(REV_A)}…`);
    expect(text()).toContain(`rev ${shortRev(REV_B)}…`);
  });

  it("keeps bound as the only revision source when the case was never run", async () => {
    mockRpc([makeCase(`ev_${"c".repeat(24)}`)], []);
    mountView();
    await flushAsync();
    expect(text()).toContain(`bound ${shortRev(REV_A)}…`);
    expect(text()).toContain("not run");
  });

  it("shows bound once per consecutive same-revision group (R2) and rev once (R3)", async () => {
    const ids = ["1", "2", "3"].map((digit) => `ev_${digit.repeat(24)}`);
    mockRpc(
      // 三行同 bound（REV_A），全部漂移到 REV_B：bound 与 rev 均组首一次（R2/R3）。
      ids.map((id) => makeCase(id)),
      ids.map((id) => makeResult(id, { observedEndRevision: REV_B })),
    );
    mountView();
    await flushAsync();
    expect(text().split(`bound ${shortRev(REV_A)}…`).length - 1).toBe(1);
    expect(text().split(`rev ${shortRev(REV_B)}…`).length - 1).toBe(1);
  });

  it("dedupes the rev column across a consecutive same-observed group in merged state", async () => {
    const ids = ["4", "5", "6"].map((digit) => `ev_${digit.repeat(24)}`);
    mockRpc(
      ids.map((id) => makeCase(id)),
      ids.map((id) => makeResult(id)),
    );
    mountView();
    await flushAsync();
    expect(text().split(`rev ${shortRev(REV_A)}…`).length - 1).toBe(1);
  });
});

describe("EvaluatingDetail failed assertion expansion (1.3)", () => {
  it("expands expected vs observed per assertion on failed rows", async () => {
    const caseId = `ev_${"a".repeat(24)}`;
    mockRpc(
      [makeCase(caseId)],
      [
        makeResult(caseId, {
          outcome: "failed",
          assertions: [
            { ref: 0, outcome: "passed" },
            { ref: 1, outcome: "failed" },
          ],
        }),
      ],
    );
    mountView();
    await flushAsync();

    expect(host.querySelector('[data-testid="eval-assertion-detail"]')).toBeNull();
    click(button("expected/observed"));
    const detail = host.querySelector('[data-testid="eval-assertion-detail"]');
    expect(detail).not.toBeNull();
    expect(detail?.textContent).toContain("contains");
    expect(detail?.textContent).toContain("expected: MIT");
    expect(detail?.textContent).toContain("observed: passed");
    expect(detail?.textContent).toContain("finding triggered");
    expect(detail?.textContent).toContain("observed: failed");
    // 再点收起。
    click(button("expected/observed"));
    expect(host.querySelector('[data-testid="eval-assertion-detail"]')).toBeNull();
  });
});

describe("EvaluatingDetail non-zero errors red chip (task 1.5)", () => {
  it("renders the red chip for error rows and hides it when all rows are clean", async () => {
    const errorCase = `ev_${"b".repeat(24)}`;
    const passCase = `ev_${"a".repeat(24)}`;
    mockRpc(
      [makeCase(passCase), makeCase(errorCase)],
      [
        makeResult(passCase),
        makeResult(errorCase, {
          outcome: "error",
          assertions: [],
          failure: { code: "RUNNER_ERROR", detail: "runner exploded" },
        }),
      ],
    );
    mountView();
    await flushAsync();

    const chip = host.querySelector('[data-testid="evaluating-errors-chip"]');
    expect(chip?.textContent).toContain("1 error");
    expect(chip?.className).toContain("bg-destructive");
    unmount(mounted.pop() as ReturnType<typeof mount>);
    host.remove();

    // 反态：全部 passed → 无红 chip。
    mockRpc([makeCase(passCase)], [makeResult(passCase)]);
    mountView();
    await flushAsync();
    expect(host.querySelector('[data-testid="evaluating-errors-chip"]')).toBeNull();
  });
});

describe("EvaluatingDetail actions (1.3)", () => {
  it("starts a run with the fixed route triple after explicit confirmation", async () => {
    const enabled = makeCase(`ev_${"a".repeat(24)}`, { enabled: true });
    const disabled = makeCase(`ev_${"b".repeat(24)}`, { enabled: false });
    const mock = mockRpc([enabled, disabled], []);
    mountView();
    await flushAsync();

    expect(mock.start).not.toHaveBeenCalled();
    click(button("Run…"));
    flushSync();
    const dialog = host.querySelector('[data-stub="dialog-root"]');
    expect(dialog).not.toBeNull();
    // 固定三元组标注（无 target 选择器）。
    const triple = host.querySelector('[data-testid="run-target-triple"]');
    expect(triple?.textContent).toContain(WS);
    expect(triple?.textContent).toContain(SK);
    expect(
      Array.from(dialog!.querySelectorAll("button[aria-pressed]")).some((entry) =>
        entry.textContent?.includes("Select a skill"),
      ),
    ).toBe(false);
    // 固定 target 的 cases 即刻拉取——等待默认勾选落定再确认。
    await flushAsync();
    expect(mock.casesList).toHaveBeenCalledWith({ target });

    click(
      Array.from(dialog!.querySelectorAll("button")).find((entry) =>
        entry.textContent?.includes("Start run"),
      ),
    );
    await flushAsync();
    expect(mock.start).toHaveBeenCalledWith({
      target,
      caseIds: [`ev_${"a".repeat(24)}`],
      runner: "analyzer",
    });
  });

  it("cancels an actively tracked run from the header", async () => {
    const mock = mockRpc([makeCase(`ev_${"a".repeat(24)}`)], []);
    evaluationRunState.runId = `run_${"5".repeat(24)}`;
    evaluationRunState.target = target;
    evaluationRunState.status = "running";
    mock.cancel.mockResolvedValue({ runId: `run_${"5".repeat(24)}`, status: "cancelled" });
    mountView();
    await flushAsync();

    click(button("Cancel run"));
    await flushAsync();
    expect(mock.cancel).toHaveBeenCalledWith({ runId: `run_${"5".repeat(24)}` });
    expect(showToast).toHaveBeenCalledWith("Run cancelled.");
  });

  it("creates a case bound to the freshly-read current revision", async () => {
    const mock = mockRpc([makeCase(`ev_${"a".repeat(24)}`)], []);
    mountView();
    await flushAsync();

    click(button("New case"));
    flushSync();
    const dialog = host.querySelector('[data-stub="dialog-root"]');
    expect(dialog).not.toBeNull();
    const prompt = dialog!.querySelector<HTMLTextAreaElement>("#evaluating-case-prompt");
    prompt!.value = "Check the license footer";
    prompt!.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    const valueInput = dialog!.querySelector<HTMLInputElement>('input[aria-label="Value"]');
    valueInput!.value = "Apache-2.0";
    valueInput!.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();

    click(
      Array.from(dialog!.querySelectorAll("button")).find((entry) =>
        entry.textContent?.includes("Save case"),
      ),
    );
    await flushAsync();
    expect(mock.create).toHaveBeenCalledWith({
      target,
      input: {
        prompt: "Check the license footer",
        assertions: [{ kind: "contains", value: "Apache-2.0" }],
      },
      boundRevision: REV_A,
      enabled: true,
    });
    // 保存后行重拉。
    expect(mock.casesList.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("edits a case preserving its original bound revision", async () => {
    const caseId = `ev_${"a".repeat(24)}`;
    const mock = mockRpc(
      [makeCase(caseId, { boundRevision: REV_B, prompt: "Original prompt" })],
      [],
    );
    mountView();
    await flushAsync();

    click(button("Edit case"));
    flushSync();
    const dialog = host.querySelector('[data-stub="dialog-root"]');
    const prompt = dialog!.querySelector<HTMLTextAreaElement>("#evaluating-case-prompt");
    expect(prompt?.value).toBe("Original prompt");
    prompt!.value = "Updated prompt";
    prompt!.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();

    click(
      Array.from(dialog!.querySelectorAll("button")).find((entry) =>
        entry.textContent?.includes("Save case"),
      ),
    );
    await flushAsync();
    expect(mock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        target,
        caseId,
        boundRevision: REV_B, // 编辑不改绑定（design：重绑 = 删除后新建）。
        input: expect.objectContaining({ prompt: "Updated prompt" }),
      }),
    );
  });

  it("blocks validation instead of sending an invalid case", async () => {
    const mock = mockRpc([makeCase(`ev_${"a".repeat(24)}`)], []);
    mountView();
    await flushAsync();
    click(button("New case"));
    flushSync();
    const dialog = host.querySelector('[data-stub="dialog-root"]')!;
    click(
      Array.from(dialog.querySelectorAll("button")).find((entry) =>
        entry.textContent?.includes("Save case"),
      ),
    );
    await flushAsync();
    // 空 prompt + 空断言值：前端校验拦下（不发 RPC）。
    expect(mock.create).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="case-validation"]')?.textContent).toContain(
      "Prompt is required.",
    );
  });
});

describe("EvaluatingDetail Global read-only gate (1.3 spec scenario)", () => {
  it("hides run and case-writing entries and shows the read-only badge and note", async () => {
    mockRpc([makeCase(`ev_${"a".repeat(24)}`)], []);
    mountView("~");
    await flushAsync();

    expect(text()).toContain("read-only");
    expect(text()).toContain("Global workspace corpora are read-only");
    expect(button("Run…")).toBeUndefined();
    expect(button("New case")).toBeUndefined();
    expect(button("Edit case")).toBeUndefined();
  });
});

describe("EvaluatingDetail unresolvable skill face (1.3)", () => {
  it("shows the read-only banner and hides write actions when skills.info fails", async () => {
    mockRpc([makeCase(`ev_${"a".repeat(24)}`)], [], { skillName: null });
    mountView();
    await flushAsync();

    expect(host.querySelector('[data-testid="evaluating-skill-unresolvable"]')).not.toBeNull();
    expect(button("Run…")).toBeUndefined();
    expect(button("New case")).toBeUndefined();
  });
});
