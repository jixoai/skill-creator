// @vitest-environment jsdom
/**
 * EvaluatingDetail 组件级 DOM 断言（evaluating-world-class task 1.4/1.5/1.6；
 * evaluating-dashboard 迁移钉沿承：三段路由身份、挂载竞态补救、Run 固定三元组
 * 显式确认、Cancel 幂等、Global 只读、技能不可解析降级面）。
 *
 * 用户原始需求 [2026-10-04]（design §4.2）：详情屏 = run 报告——run 选择器
 * （时间线胶囊）+ case 步骤树（失败默认选中、三态 icon、分式徽标）+ 断言详情
 * （期望 vs 观测 diff 双栏记忆点 + finding 触发语义标记 + revision stale 判读）
 * + 键盘 ↑↓/Enter/Esc + ?case= 深链 + 三尺寸（jsdom matchMedia=false → 单列
 * push；wide 用 stubGlobal 切换）。
 *
 * 正交意图：
 *   [1] run 报告投影钉：时间线胶囊（最新在前/选中态/错误 chip）、case 树
 *       （tone/score）、断言详情（diff 双栏 + 触发标记 + stale 判读）。
 *   [2] 交互钉：失败默认选中、键盘导航（树容器 keydown）、?case= 深链、
 *       run 切换重投影、「管理」折叠区（Imported-only）。
 *   [3] 沿承钉：Run 固定三元组确认、case 新建/编辑、Global 只读、
 *       unresolvable 技能降级。
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
const RUN_NEW = `run_${"9".repeat(24)}`;
const RUN_OLD = `run_${"1".repeat(24)}`;

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
    runId: RUN_NEW,
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
      { ref: 0, kind: "contains", expected: "MIT", observed: "…MIT…", outcome: "passed" },
      { ref: 1, kind: "finding-triggered", expected: "true", observed: "true", outcome: "passed" },
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
    start: vi.fn().mockResolvedValue({ runId: RUN_NEW, status: "queued" }),
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

interface MountOptions {
  wsId?: string;
  search?: Record<string, unknown>;
}

/** jsdom matchMedia 恒 false → 默认单列（stack）；wide 测试用 stubMatchMedia。 */
function stubMatchMedia(matches: (query: string) => boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => {
    const listeners = new Set<() => void>();
    const mediaQueryList = {
      matches: matches(query),
      media: query,
      onchange: null,
      addEventListener: (_: string, listener: () => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_: string, listener: () => void) => {
        listeners.delete(listener);
      },
      addListener: (listener: () => void) => {
        listeners.add(listener);
      },
      removeListener: (listener: () => void) => {
        listeners.delete(listener);
      },
      dispatchEvent: () => false,
    };
    return mediaQueryList as unknown as MediaQueryList;
  });
}

function mountView(options: MountOptions = {}): void {
  host = document.body.appendChild(document.createElement("div"));
  mounted.push(
    mount(RouterContextHarness, {
      target: host,
      props: {
        view: "detail",
        wsId: options.wsId ?? WS,
        providerId: PROVIDER,
        skillId: SK,
        ...(options.search === undefined ? {} : { search: options.search }),
      },
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

function keydown(key: string): void {
  const tree = host.querySelector('[data-testid="evaluating-case-tree"]');
  expect(tree, "case tree must exist").toBeTruthy();
  tree!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
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
  vi.unstubAllGlobals();
});

describe("EvaluatingDetail route binding (1.4)", () => {
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
});

describe("EvaluatingDetail run report projection (1.4)", () => {
  const PASS = `ev_${"a".repeat(24)}`;
  const FAIL = `ev_${"b".repeat(24)}`;
  const ERROR = `ev_${"c".repeat(24)}`;
  const UNTOUCHED = `ev_${"d".repeat(24)}`;

  function seedReport(): void {
    mockRpc(
      [makeCase(PASS), makeCase(FAIL), makeCase(ERROR), makeCase(UNTOUCHED)],
      [
        makeResult(PASS, {
          runId: RUN_NEW,
          startedAt: "2026-10-02T00:10:00.000Z",
          endedAt: "2026-10-02T00:10:01.000Z",
        }),
        makeResult(FAIL, {
          runId: RUN_NEW,
          outcome: "failed",
          assertions: [
            {
              ref: 0,
              kind: "contains",
              expected: "MIT",
              observed: "Apache-2.0 instead",
              outcome: "failed",
            },
            {
              ref: 1,
              kind: "finding-triggered",
              expected: "true",
              observed: "false",
              outcome: "failed",
            },
          ],
          startedAt: "2026-10-02T00:10:02.000Z",
          endedAt: "2026-10-02T00:10:03.000Z",
        }),
        makeResult(ERROR, {
          runId: RUN_OLD,
          outcome: "error",
          assertions: [],
          failure: { code: "RUNNER_ERROR", detail: "boom".repeat(40) },
          startedAt: "2026-10-01T00:00:00.000Z",
          endedAt: "2026-10-01T00:00:01.000Z",
        }),
      ],
    );
  }

  it("renders the run timeline capsules newest-first with an errors chip for error runs", async () => {
    seedReport();
    mountView();
    await flushAsync();

    const capsules = host.querySelectorAll('[data-testid="evaluating-run-capsule"]');
    expect(capsules).toHaveLength(2);
    expect(capsules[0]?.getAttribute("data-run-id")).toBe(RUN_NEW); // 最新在前。
    expect(capsules[0]?.getAttribute("aria-pressed")).toBe("true"); // 默认选中最新。
    expect(capsules[1]?.getAttribute("aria-pressed")).toBe("false");
    // 旧 run 含 error 结果 → 红 chip（正钉）。
    const chips = host.querySelectorAll('[data-testid="evaluating-errors-chip"]');
    expect(chips).toHaveLength(1);
    expect(chips[0]?.textContent).toContain("1");
  });

  it("projects case tree tones and score badges for the selected run", async () => {
    seedReport();
    mountView();
    await flushAsync();

    const nodes = host.querySelectorAll('[data-testid="evaluating-case-node"]');
    // 单列模式：失败 case 默认选中 → 树隐藏，先断言选中面再返回树。
    const tones = new Map(
      Array.from(nodes).map((node) => [
        node.getAttribute("data-case-id"),
        node.getAttribute("data-tone"),
      ]),
    );
    expect(tones.get(PASS)).toBe("passed");
    expect(tones.get(FAIL)).toBe("failed");
    expect(tones.get(ERROR)).toBe("pending"); // 旧 run 的 error 不在最新 run 内。
    expect(tones.get(UNTOUCHED)).toBe("pending");
    // 失败 case 的分式徽标 0/2。
    const failNode = Array.from(nodes).find((node) => node.getAttribute("data-case-id") === FAIL);
    expect(failNode?.querySelector('[data-testid="evaluating-case-score"]')?.textContent).toContain(
      "0/2",
    );
  });

  it("auto-selects the first failed case and renders the expected-vs-observed diff columns", async () => {
    seedReport();
    mountView();
    await flushAsync();

    // 失败默认选中（单列 → 断言详情面在场）。
    const pane = host.querySelector('[data-testid="evaluating-assertion-pane"]');
    expect(pane).not.toBeNull();
    const outcomeBadge = host.querySelector('[data-testid="evaluating-outcome-badge"]');
    expect(outcomeBadge?.textContent).toContain("failed");
    // revision 短显（stale 判读面）。
    expect(text()).toContain(shortRev(REV_A));

    // diff 双栏（记忆点）：contains 断言 期望 MIT | 观测 Apache。
    const rows = host.querySelectorAll('[data-testid="evaluating-assertion-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.getAttribute("data-outcome")).toBe("failed");
    const diff = rows[0]?.querySelector('[data-testid="evaluating-assertion-diff"]');
    expect(diff?.textContent).toContain("expected");
    expect(diff?.textContent).toContain("observed");
    expect(diff?.textContent).toContain("MIT");
    expect(diff?.textContent).toContain("Apache-2.0 instead");

    // finding-triggered 触发语义标记（期望触发 → 未触发）。
    const trigger = rows[1]?.querySelector('[data-testid="evaluating-trigger-mark"]');
    expect(trigger?.textContent).toContain("expect triggered");
    expect(trigger?.textContent).toContain("not triggered");
  });

  it("shows the stale judgment tag when the latest result drifted from the current revision", async () => {
    const caseId = `ev_${"a".repeat(24)}`;
    mockRpc([makeCase(caseId)], [makeResult(caseId, { observedEndRevision: REV_B, stale: true })]);
    mountView();
    await flushAsync();
    // 全 passed → 无默认选中（成功折叠）；点树行选中。
    click(host.querySelector(`[data-case-id="${caseId}"] button`));
    expect(host.querySelector('[data-testid="evaluating-stale-tag"]')?.textContent).toContain(
      "stale",
    );
    expect(text()).toContain(shortRev(REV_B));
  });

  it("re-projects the tree when an older run capsule is selected", async () => {
    seedReport();
    mountView();
    await flushAsync();
    const capsules = host.querySelectorAll('[data-testid="evaluating-run-capsule"]');
    click(capsules[1]); // 旧 run（error 结果）。
    flushSync();
    const tones = new Map(
      Array.from(host.querySelectorAll('[data-testid="evaluating-case-node"]')).map((node) => [
        node.getAttribute("data-case-id"),
        node.getAttribute("data-tone"),
      ]),
    );
    // 旧 run：PASS/FAIL 未进该 run → pending；ERROR → error。
    expect(tones.get(PASS)).toBe("pending");
    expect(tones.get(ERROR)).toBe("error");
  });
});

describe("EvaluatingDetail keyboard navigation and deep link (1.4/1.6)", () => {
  const ids = ["a", "b", "c"].map((digit) => `ev_${digit.repeat(24)}`);

  function seedNoFailures(): void {
    mockRpc(
      ids.map((id) => makeCase(id)),
      ids.map((id, index) =>
        makeResult(id, {
          startedAt: `2026-10-02T00:0${index}:00.000Z`,
          endedAt: `2026-10-02T00:0${index}:01.000Z`,
        }),
      ),
    );
  }

  it("keeps the tree collapsed (no selection) when every case passes", async () => {
    seedNoFailures();
    mountView();
    await flushAsync();
    expect(host.querySelector('[data-testid="evaluating-assertion-pane"]')).toBeNull();
    expect(host.querySelector('[data-testid="evaluating-case-tree"]')).not.toBeNull();
  });

  it("moves selection with ArrowDown/ArrowUp, expands with Enter, collapses with Escape", async () => {
    seedNoFailures();
    mountView();
    await flushAsync();

    keydown("ArrowDown"); // 无初始选择 → 首行。
    expect(host.querySelector('[data-testid="evaluating-assertion-pane"]')).not.toBeNull();
    expect(host.querySelector("li[aria-selected=true]")?.getAttribute("data-case-id")).toBe(ids[0]);
    keydown("ArrowDown");
    expect(host.querySelector("li[aria-selected=true]")?.getAttribute("data-case-id")).toBe(ids[1]);
    keydown("ArrowUp");
    keydown("ArrowUp"); // 端点钳制回首行。
    expect(host.querySelector("li[aria-selected=true]")?.getAttribute("data-case-id")).toBe(ids[0]);
    // Enter/→ 展开语义 = 保持选中；Esc 收起 = 清空（单列回到树）。
    keydown("Enter");
    expect(host.querySelector('[data-testid="evaluating-assertion-pane"]')).not.toBeNull();
    keydown("ArrowRight");
    expect(host.querySelector('[data-testid="evaluating-assertion-pane"]')).not.toBeNull();
    keydown("Escape");
    expect(host.querySelector('[data-testid="evaluating-assertion-pane"]')).toBeNull();
    expect(host.querySelector('[data-testid="evaluating-case-tree"]')).not.toBeNull();
  });

  it("selects the ?case= deep-linked case on mount", async () => {
    seedNoFailures();
    mountView({ search: { case: ids[2] } });
    await flushAsync();
    expect(host.querySelector("li[aria-selected=true]")?.getAttribute("data-case-id")).toBe(ids[2]);
    expect(host.querySelector('[data-testid="evaluating-assertion-pane"]')).not.toBeNull();
  });

  it("renders the wide two-pane layout when the viewport is at least 1024px", async () => {
    stubMatchMedia((query) => query === "(min-width: 1024px)");
    seedNoFailures();
    mountView();
    await flushAsync();
    // wide：树与详情双栏同屏（无选中时详情面为占位提示）。
    expect(host.querySelector('[data-testid="evaluating-case-tree-pane"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="evaluating-assertion-pane"]')).not.toBeNull();
    expect(text()).toContain("Select a case");
  });
});

describe("EvaluatingDetail manage cases drawer (1.5)", () => {
  it("collapses case authoring behind the manage toggle and opens the editor", async () => {
    const caseId = `ev_${"a".repeat(24)}`;
    const mock = mockRpc([makeCase(caseId, { prompt: "Original prompt" })], []);
    mountView();
    await flushAsync();

    // 诊断流优先：默认无「新建用例/编辑用例」直通入口。
    expect(button("New case")).toBeUndefined();
    expect(button("Edit case")).toBeUndefined();
    const manage = host.querySelector('[data-testid="evaluating-manage"]');
    expect(manage?.querySelector("button")?.getAttribute("aria-expanded")).toBe("false");

    click(manage?.querySelector("button"));
    expect(manage?.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
    click(button("Edit case"));
    flushSync();
    const dialog = host.querySelector('[data-stub="dialog-root"]');
    expect(dialog).not.toBeNull();
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
        boundRevision: REV_A, // 编辑不改绑定。
        input: expect.objectContaining({ prompt: "Updated prompt" }),
      }),
    );
  });

  it("creates a case bound to the freshly-read current revision from the manage drawer", async () => {
    const mock = mockRpc([makeCase(`ev_${"a".repeat(24)}`)], []);
    mountView();
    await flushAsync();
    click(host.querySelector('[data-testid="evaluating-manage"] button'));
    click(button("New case"));
    flushSync();
    const dialog = host.querySelector('[data-stub="dialog-root"]');
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
  });

  it("blocks validation instead of sending an invalid case", async () => {
    const mock = mockRpc([makeCase(`ev_${"a".repeat(24)}`)], []);
    mountView();
    await flushAsync();
    click(host.querySelector('[data-testid="evaluating-manage"] button'));
    click(button("New case"));
    flushSync();
    const dialog = host.querySelector('[data-stub="dialog-root"]')!;
    click(
      Array.from(dialog.querySelectorAll("button")).find((entry) =>
        entry.textContent?.includes("Save case"),
      ),
    );
    await flushAsync();
    expect(mock.create).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="case-validation"]')?.textContent).toContain(
      "Prompt is required.",
    );
  });
});

describe("EvaluatingDetail actions (沿承钉)", () => {
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
    const triple = host.querySelector('[data-testid="run-target-triple"]');
    expect(triple?.textContent).toContain(WS);
    expect(triple?.textContent).toContain(SK);
    expect(
      Array.from(dialog!.querySelectorAll("button[aria-pressed]")).some((entry) =>
        entry.textContent?.includes("Select a skill"),
      ),
    ).toBe(false);
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

  it("surfaces live progress for a tracked running run (capsule + tree line)", async () => {
    const caseId = `ev_${"a".repeat(24)}`;
    mockRpc([makeCase(caseId)], []);
    evaluationRunState.runId = RUN_NEW;
    evaluationRunState.target = target;
    evaluationRunState.status = "running";
    evaluationRunState.startedAt = new Date().toISOString();
    evaluationRunState.resultCount = 1;
    evaluationRunState.totalCases = 3;
    mountView();
    await flushAsync();

    // tracked run 注入时间线（未落盘也合成行）+ live 进度。
    expect(text()).toContain("1/3");
    expect(host.querySelector('[data-testid="evaluating-live-line"]')).not.toBeNull();
    expect(
      host.querySelector('[data-testid="evaluating-run-live-progress"]')?.textContent,
    ).toContain("1/3");
  });
});

describe("EvaluatingDetail gates (沿承钉)", () => {
  it("hides run and case-writing entries and shows the read-only badge and note for Global", async () => {
    mockRpc([makeCase(`ev_${"a".repeat(24)}`)], []);
    mountView({ wsId: "~" });
    await flushAsync();

    expect(text()).toContain("read-only");
    expect(text()).toContain("Global workspace corpora are read-only");
    expect(button("Run…")).toBeUndefined();
    expect(host.querySelector('[data-testid="evaluating-manage"]')).toBeNull();
  });

  it("shows the read-only banner and hides write actions when skills.info fails", async () => {
    mockRpc([makeCase(`ev_${"a".repeat(24)}`)], [], { skillName: null });
    mountView();
    await flushAsync();

    expect(host.querySelector('[data-testid="evaluating-skill-unresolvable"]')).not.toBeNull();
    expect(button("Run…")).toBeUndefined();
    expect(host.querySelector('[data-testid="evaluating-manage"]')).toBeNull();
  });

  it("renders the empty-corpus state with a direct new-case entry (Imported)", async () => {
    mockRpc([], []);
    mountView();
    await flushAsync();
    expect(text()).toContain("No cases for this skill yet");
    expect(button("New case")).not.toBeUndefined();
  });
});
