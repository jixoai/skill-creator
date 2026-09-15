// @vitest-environment jsdom
/**
 * Agent 面板 New Session 态验收测试（R12-B 6/7/8）。
 *
 * 用户原始需求 [2026-09-12]（R12-B 走查）：
 * 「Pick a way to work with your skill library: 默认选中 General，底下 Mode 也
 * 默认选中 General，二者要同步」；「在 New Session 的模式下，顶部不该显示 +
 * 按钮」；「点击 + 不是立刻创建 Session，而是跳转到 New Session 的状态页。
 * 所以要区分清楚」。
 *
 * 正交意图：
 *   [1] 模式同步（6）：New Session 态模式卡与 composer 模式 chip 默认 General
 *       （pendingMode=free），卡片/chip 双向同步（同一数据源）。
 *   [2] 两态渲染（7/8）：newSession 态（无 sessionId：模式卡 + composer 可输入，
 *       无 + 按钮，select 显示 New session…）vs session 态（+ 显示，转录流）；
 *       + 点击 = 回空态不建会话；会话创建只发生在首条消息（lazy，恰好一次）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const connection = vi.hoisted(() => ({
  generation: 0,
  rpc: null as unknown,
}));
const settingsUi = vi.hoisted(() => ({
  openSettings: vi.fn(),
}));
const toast = vi.hoisted(() => ({
  showToast: vi.fn(),
}));
const sessionsCleanup = vi.hoisted(() => vi.fn());

vi.mock("../stores/connection.svelte", () => ({
  getConnectionGeneration: () => connection.generation,
  getRpc: () => connection.rpc ?? null,
  requireRpc: () => {
    if (!connection.rpc) throw new Error("not connected");
    return connection.rpc;
  },
  connectionState: { status: "connected", error: null },
}));
vi.mock("../toast.svelte", () => ({
  showToast: toast.showToast,
}));
vi.mock("../stores/settings-ui.svelte", () => ({
  openSettings: settingsUi.openSettings,
}));

// markstream-svelte 渲染链路（node_modules 体积/依赖面大）以纯文本 stub 隔离。
vi.mock("markstream-svelte", async () => {
  const { default: stub } = await import("./stubs/markdown-render-stub.svelte");
  return { default: stub };
});
vi.mock("markstream-svelte/index.css", () => ({}));
vi.mock("../components/agent/ContextMeter.svelte", async () => {
  const { default: stub } = await import("./stubs/context-meter-stub.svelte");
  return { default: stub };
});
// AgentApprovalCard → ui/button|input → bits-ui（node_modules .svelte，不编译）。
vi.mock("../components/agent/AgentApprovalCard.svelte", async () => {
  const { default: stub } = await import("./stubs/markdown-render-stub.svelte");
  return { default: stub };
});
// AgentToolRow → AgentCard → $app/navigation（SvelteKit 虚拟模块，root vitest
// 无法解析）；工具行在本测试不渲染，以渲染 stub 隔离导入链。
vi.mock("../components/agent/AgentCard.svelte", async () => {
  const { default: stub } = await import("./stubs/markdown-render-stub.svelte");
  return { default: stub };
});

// @lucide/svelte 图标 = node_modules 的 .svelte（root vitest 管线不编译）——空壳替换
// （AgentHeader / TranscriptView / AgentToolRow / TodoDock / DisclosureRow / ComposerCard）。
vi.mock("@lucide/svelte/icons/x", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/plus", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/plus", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/copy", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/check", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/pen-line", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock(
  "@lucide/svelte/icons/refresh-cw",
  async () => await import("./stubs/lucide-icon-mocks.js"),
);
vi.mock("@lucide/svelte/icons/sparkles", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/file", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/file-up", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/image", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock(
  "@lucide/svelte/icons/arrow-down",
  async () => await import("./stubs/lucide-icon-mocks.js"),
);
vi.mock("@lucide/svelte/icons/terminal", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/file-text", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/wrench", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock(
  "@lucide/svelte/icons/circle-check",
  async () => await import("./stubs/lucide-icon-mocks.js"),
);
vi.mock(
  "@lucide/svelte/icons/chevron-right",
  async () => await import("./stubs/lucide-icon-mocks.js"),
);
vi.mock("@lucide/svelte/icons/arrow-up", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/square", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock(
  "@lucide/svelte/icons/chevron-down",
  async () => await import("./stubs/lucide-icon-mocks.js"),
);

// bits-ui 在 node_modules 含 .svelte（vitest 外置）——per-instance 三件套
// （Root/Trigger/Content：context 级开合态，经 $bindable 同步 bind:open）+
// 无状态件共享 stub；composer 模式 chip 菜单依赖 per-instance 开合。
vi.mock("$lib/components/ui/dropdown-menu", async () => {
  const Root = (await import("./stubs/dropdown-menu-pi-stub/Root.svelte")).default;
  const Trigger = (await import("./stubs/dropdown-menu-pi-stub/Trigger.svelte")).default;
  const Content = (await import("./stubs/dropdown-menu-pi-stub/Content.svelte")).default;
  const Group = (await import("./stubs/dropdown-menu-stub/Group.svelte")).default;
  const GroupHeading = (await import("./stubs/dropdown-menu-stub/GroupHeading.svelte")).default;
  const Item = (await import("./stubs/dropdown-menu-stub/Item.svelte")).default;
  const Label = (await import("./stubs/dropdown-menu-stub/Label.svelte")).default;
  const Separator = (await import("./stubs/dropdown-menu-stub/Separator.svelte")).default;
  return {
    DropdownMenu: Root,
    Trigger,
    Content,
    Group,
    GroupHeading,
    Item,
    Label,
    Separator,
  };
});

import AgentPanel from "../components/agent/AgentPanel.svelte";
import { flushSync, mount, unmount } from "./svelte-client";
// 真 store（runes .svelte.ts）：被测的正是 pendingMode/lazy create 的真实投影。
import {
  agentPanel,
  agentRuntimeConfig,
  agentSession,
  agentSessionsList,
} from "../stores/agent.svelte";
import { agentComposer, resetAllComposerTracks } from "../stores/agent-composer.svelte";
import type { DshStewardSettingsView } from "$shared/contracts/dsh-runtime.js";
import type { AgentSessionSummary } from "$shared/contracts/agent.js";

// 最小真实 view：AgentPanel 惰性配置加载落定后必须停止重放（view 不得保持 null）。
const VIEW: DshStewardSettingsView = {
  settings: {
    configVersion: 1,
    revision: 0,
    model: { provider: "zai", model: "glm-4.7" },
    preset: "live",
    permissions: { approvalPolicy: "ask" },
    session: { streamRetention: 50, streamProjection: "enabled", sessionCleanupDays: 30 },
    defaultMode: "free",
    modelRoutes: [],
  },
  providers: [],
};

let sessionCreate: ReturnType<typeof vi.fn>;
let sessionPrompt: ReturnType<typeof vi.fn>;

function sessionSummary(sessionId: string, mode: AgentSessionSummary["mode"]): AgentSessionSummary {
  return {
    sessionId,
    title: "",
    status: "idle",
    cwd: "/tmp",
    createdAt: "2026-09-12T00:00:00.000Z",
    mode,
  };
}

function agentRpc(): unknown {
  return {
    agent: {
      settings: { get: async () => VIEW },
      models: { catalog: async () => ({ providers: [] }) },
      sessions: {
        list: async () => ({ sessions: [] }),
        cleanup: async (input: unknown) => sessionsCleanup(input),
      },
      session: {
        create: sessionCreate,
        prompt: sessionPrompt,
        stream: async () => ({ frames: [], status: "idle" }),
      },
    },
  };
}

function mountPanel() {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const instance = mount(AgentPanel, { target });
  flushSync();
  return {
    target,
    cleanup: () => {
      unmount(instance);
      target.remove();
      document.querySelectorAll("[data-slot='dropdown-menu-content']").forEach((n) => n.remove());
    },
  };
}

/** New Session 态模式卡（aria-pressed 是卡片的稳定语义钩子；DSH_AGENT_MODES 序）。 */
function modeCards(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")];
}

function modeCard(label: string): HTMLButtonElement {
  const card = modeCards().find((card) => card.textContent?.includes(label));
  if (!card) throw new Error(`mode card ${label} not rendered`);
  return card;
}

function modeChip(): HTMLButtonElement {
  const chip = document.querySelector<HTMLButtonElement>('button[aria-label="Session mode"]');
  if (!chip) throw new Error("mode chip not rendered");
  return chip;
}

function plusButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('button[aria-label="New session"]');
}

function composer(): HTMLTextAreaElement {
  const textarea = document.querySelector<HTMLTextAreaElement>("textarea[aria-label='Message']");
  if (!textarea) throw new Error("composer textarea not rendered");
  return textarea;
}

async function openModeMenu(): Promise<void> {
  modeChip().click();
  await vi.waitFor(() => {
    if (document.querySelector('[data-slot="dropdown-menu-content"]') === null) {
      throw new Error("mode menu content not rendered");
    }
  });
}

function modeMenuItems(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]')];
}

/** 在 composer 输入草稿（真 store bind:value）并按 Enter 提交。 */
function submitDraft(text: string): void {
  agentComposer.text = text;
  flushSync();
  composer().dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
  );
  flushSync();
}

beforeAll(() => {
  // TranscriptView 的滚动跟随用 ResizeObserver；jsdom 无实现，静默 stub。
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

beforeEach(() => {
  sessionCreate = vi.fn().mockResolvedValue({ session: sessionSummary("agent-s2", "create") });
  sessionPrompt = vi.fn().mockResolvedValue({ accepted: true });
  connection.rpc = agentRpc();
  connection.generation = 0;
  agentPanel.open = false;
  agentPanel.seedPrompt = null;
  agentSession.sessionId = null;
  agentSession.mode = null;
  agentSession.pendingMode = "free";
  agentSession.items = [];
  agentSession.todos = [];
  agentSession.turnStartedAt = null;
  agentSession.cursor = 0;
  agentSession.status = "idle";
  agentSession.sending = false;
  agentSession.error = null;
  agentSession.promptError = null;
  agentSession.lastUsage = null;
  agentSessionsList.loaded = false;
  agentSessionsList.loading = false;
  agentSessionsList.sessions = [];
  agentSessionsList.error = null;
  agentRuntimeConfig.view = null;
  agentRuntimeConfig.loading = false;
  agentRuntimeConfig.updating = false;
  agentRuntimeConfig.error = null;
  resetAllComposerTracks();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("R12-B 6: New Session mode sync (cards <-> composer chip)", () => {
  it("defaults both the mode cards and the composer chip to General in the new-session state", () => {
    const ctx = mountPanel();

    expect(agentSession.sessionId).toBeNull();
    expect(modeChip().textContent).toContain("General");
    expect(modeCard("General").getAttribute("aria-pressed")).toBe("true");
    for (const label of ["Create", "Manage", "Explore"]) {
      expect(modeCard(label).getAttribute("aria-pressed")).toBe("false");
    }
    ctx.cleanup();
  });

  it("selecting a mode card updates the composer chip (same data source)", () => {
    const ctx = mountPanel();

    modeCard("Create").click();
    flushSync();
    expect(modeChip().textContent).toContain("Create");
    expect(modeChip().textContent).not.toContain("General");
    expect(modeCard("Create").getAttribute("aria-pressed")).toBe("true");
    expect(modeCard("General").getAttribute("aria-pressed")).toBe("false");
    expect(sessionCreate).not.toHaveBeenCalled();
    ctx.cleanup();
  });

  it("selecting from the composer chip updates the mode cards in the empty state", async () => {
    const ctx = mountPanel();

    await openModeMenu();
    const explore = modeMenuItems().find((item) => item.textContent?.includes("Explore"));
    explore!.click();
    flushSync();
    expect(modeChip().textContent).toContain("Explore");
    expect(modeCard("Explore").getAttribute("aria-pressed")).toBe("true");
    expect(modeCard("General").getAttribute("aria-pressed")).toBe("false");
    expect(sessionCreate).not.toHaveBeenCalled();
    ctx.cleanup();
  });

  it("the first message creates the session with the selected mode (lazy, exactly once)", async () => {
    const ctx = mountPanel();

    modeCard("Create").click();
    flushSync();
    submitDraft("hello");

    await vi.waitFor(() => expect(sessionCreate).toHaveBeenCalledTimes(1));
    expect(sessionCreate).toHaveBeenCalledWith({ mode: "create" });
    await vi.waitFor(() =>
      expect(sessionPrompt).toHaveBeenCalledWith({
        sessionId: "agent-s2",
        text: "hello",
        images: [],
        files: [],
        mode: "queue",
      }),
    );
    expect(agentSession.sessionId).toBe("agent-s2");

    // 会话建立后，第二条消息不再触发 create。
    await vi.waitFor(() => expect(agentSession.sending).toBe(false));
    submitDraft("second");
    await vi.waitFor(() => expect(sessionPrompt).toHaveBeenCalledTimes(2));
    expect(sessionCreate).toHaveBeenCalledTimes(1);
    ctx.cleanup();
  });
});

describe("R12-B 7/8: two-state rendering and the + entry", () => {
  it("new-session state has no + button; the session select shows New session…", () => {
    agentSessionsList.sessions = [sessionSummary("agent-s1", "free")];
    agentSessionsList.loaded = true;
    const ctx = mountPanel();

    expect(plusButton()).toBeNull();
    const select = document.querySelector<HTMLSelectElement>('select[aria-label="Session"]');
    expect(select).not.toBeNull();
    expect(select!.value).toBe("");
    expect(select!.options[0]?.textContent).toContain("New session");
    ctx.cleanup();
  });

  it("session state shows the + button and the transcript (no mode cards)", () => {
    agentSession.sessionId = "agent-s1";
    agentSession.mode = "free";
    agentSession.items.push({ kind: "turn", seq: 1, label: "Turn" });
    const ctx = mountPanel();

    expect(plusButton()).not.toBeNull();
    expect(modeCards()).toHaveLength(0);
    expect(modeChip().textContent).toContain("General");
    ctx.cleanup();
  });

  it("clicking + returns to the new-session empty state without creating a session", () => {
    agentSession.sessionId = "agent-s1";
    agentSession.mode = "explore";
    agentSession.items.push({ kind: "turn", seq: 1, label: "Turn" });
    agentSession.pendingMode = "explore";
    const ctx = mountPanel();

    plusButton()!.click();
    flushSync();
    expect(sessionCreate).not.toHaveBeenCalled();
    expect(agentSession.sessionId).toBeNull();
    expect(agentSession.mode).toBeNull();
    // 空态复位：模式卡可见且默认回到 General。
    expect(modeCard("General").getAttribute("aria-pressed")).toBe("true");
    expect(agentSession.pendingMode).toBe("free");
    expect(modeChip().textContent).toContain("General");
    // 回空态后 + 消失（7）。
    expect(plusButton()).toBeNull();
    ctx.cleanup();
  });

  it("after a lazily created session, + goes back to the empty state (create still once)", async () => {
    const ctx = mountPanel();

    submitDraft("hello");
    await vi.waitFor(() => expect(sessionCreate).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(agentSession.sessionId).toBe("agent-s2"));

    plusButton()!.click();
    flushSync();
    expect(agentSession.sessionId).toBeNull();
    expect(sessionCreate).toHaveBeenCalledTimes(1);
    expect(modeCard("General").getAttribute("aria-pressed")).toBe("true");
    ctx.cleanup();
  });
});

describe("cleanup invalidates the current session (R15 codex P1-4)", () => {
  it("returns to the New Session state when the deletedIds include the active session", async () => {
    const { agentSession, cleanupAgentSessions } = await import("../stores/agent.svelte");
    sessionCreate.mockResolvedValue({ session: sessionSummary("agent-s9", "free") });
    sessionPrompt.mockResolvedValue({ accepted: true });
    const ctx = mountPanel();
    submitDraft("hello");
    await vi.waitFor(() => expect(agentSession.sessionId).toBe("agent-s9"));
    // 清理结果包含当前会话 → 必须回空态（不向已删 ID 发 prompt）。
    sessionsCleanup.mockResolvedValue({
      kind: "summary",
      deleted: 1,
      kept: 0,
      deletedIds: ["agent-s9"],
    });
    await cleanupAgentSessions({ sessionIds: ["agent-s9"] });
    await flushSync();
    expect(agentSession.sessionId).toBeNull();
    expect(ctx.target.textContent).toContain("Pick a way to work");
    ctx.cleanup();
  });

  it("keeps the current session when deletedIds does not include it", async () => {
    const { agentSession, cleanupAgentSessions } = await import("../stores/agent.svelte");
    sessionCreate.mockResolvedValue({ session: sessionSummary("agent-s10", "free") });
    sessionPrompt.mockResolvedValue({ accepted: true });
    const ctx = mountPanel();
    submitDraft("hello");
    await vi.waitFor(() => expect(agentSession.sessionId).toBe("agent-s10"));
    sessionsCleanup.mockResolvedValue({ kind: "summary", deleted: 1, kept: 3 });
    await cleanupAgentSessions({ beforeDays: 30 });
    await flushSync();
    expect(agentSession.sessionId).toBe("agent-s10");
    ctx.cleanup();
  });
});

describe("truncated cleanup with kernel-only re-projection (R15 追加 P1-5)", () => {
  it("returns to the empty state when the refreshed list only has a kernel-only row for the current id", async () => {
    const { agentSession, cleanupAgentSessions } = await import("../stores/agent.svelte");
    sessionCreate.mockResolvedValue({ session: sessionSummary("agent-k9", "free") });
    sessionPrompt.mockResolvedValue({ accepted: true });
    const ctx = mountPanel();
    submitDraft("hello");
    await vi.waitFor(() => expect(agentSession.sessionId).toBe("agent-k9"));
    sessionsCleanup.mockResolvedValue({
      kind: "summary",
      deleted: 1200,
      kept: 0,
      deletedIds: Array.from({ length: 1000 }, (_, i) => `agent-bulk-${i}`),
      deletedIdsTruncated: true,
    });
    // 刷新后的列表：同 id 仅剩 hasTranscript:false 的 kernel-only 行（转录已删）。
    agentSessionsList.loaded = true;
    agentSessionsList.sessions = [{ ...sessionSummary("agent-k9", "free"), hasTranscript: false }];
    await cleanupAgentSessions({ beforeDays: 30 });
    await vi.waitFor(() => expect(agentSession.sessionId).toBeNull());
    ctx.cleanup();
  });
});
