// @vitest-environment jsdom
/**
 * Agent composer 草稿分轨验收测试（R17-A）。
 *
 * 用户原始需求 [2026-09-13]（R17-A 走查）：「Agent Chat 的输入面板的数据
 * （输入的文字、附加的图片、文件），跟着 Session 走，而不是共享。」——草稿按
 * sessionId 分轨（Map<sessionId, Draft>），New Session 态共享 "__new__" 桶。
 *
 * 正交意图：
 *   [1] 轨隔离（组件面）：会话 A 输入 + 图片/文件附件 → 切会话 B（空白）→
 *       切回 A（草稿完整恢复）；换轨由 sessionId 变化向量驱动（selectAgentSession
 *       / beginNewAgentSession / 惰性 create），textarea 与附件条跟随 facade。
 *   [2] 清轨语义收窄：发送成功清发送轨（失败留在原轨可重试）；显式新建清
 *       "__new__" 桶且不动会话轨；惰性建会话把在途草稿迁到新会话轨（发送期间
 *       继续可见）。
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
// 无状态件共享 stub；composer 模式/model chip 菜单依赖 per-instance 开合。
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
// 真 store（runes .svelte.ts）：被测的正是分轨换轨的真实 effect/生命周期。
import {
  agentPanel,
  agentSession,
  agentSessionsList,
  beginNewAgentSession,
  selectAgentSession,
} from "../stores/agent.svelte";
import {
  NEW_SESSION_COMPOSER_TRACK,
  agentComposer,
  resetAllComposerTracks,
  switchComposerTrack,
} from "../stores/agent-composer.svelte";
import type { AgentSessionSummary } from "$shared/contracts/agent.js";
import type { DshStewardSettingsView } from "$shared/contracts/dsh-runtime.js";

// 最小真实 view：ComposerCard model chip 的 $derived 会读 settings.model 与
// modelRoutes（形状不完整会在响应式重算中抛错）。
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

function sessionSummary(sessionId: string): AgentSessionSummary {
  return {
    sessionId,
    title: "",
    status: "idle",
    cwd: "/tmp",
    createdAt: "2026-09-13T00:00:00.000Z",
    mode: "free",
  };
}

function agentRpc(): unknown {
  return {
    agent: {
      settings: { get: async () => VIEW },
      models: { catalog: async () => ({ providers: [] }) },
      sessions: {
        list: async () => ({ sessions: [] }),
        cleanup: async () => ({ kind: "summary", deleted: 0, kept: 0 }),
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
    cleanup: () => {
      unmount(instance);
      target.remove();
      document.querySelectorAll("[data-slot='dropdown-menu-content']").forEach((n) => n.remove());
    },
  };
}

function textarea(): HTMLTextAreaElement {
  const el = document.querySelector<HTMLTextAreaElement>("textarea[aria-label='Message']");
  if (!el) throw new Error("composer textarea not rendered");
  return el;
}

/** 附件条图片缩略（preview src 断言用）。 */
function pendingImages(): HTMLImageElement[] {
  return [
    ...document.querySelectorAll<HTMLImageElement>("div[aria-label='Pending attachments'] img"),
  ];
}

/** 附件条文件 chip 文本。 */
function pendingFileChips(): string[] {
  return [...document.querySelectorAll("div[aria-label='Pending attachments'] span")].map(
    (chip) => chip.textContent ?? "",
  );
}

/** 在 composer 输入草稿（真 store bind:value）并按 Enter 提交。 */
function submitDraft(text: string): void {
  agentComposer.text = text;
  flushSync();
  textarea().dispatchEvent(
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
  sessionCreate = vi.fn().mockResolvedValue({ session: sessionSummary("agent-s2") });
  sessionPrompt = vi.fn().mockResolvedValue({ accepted: true });
  connection.rpc = agentRpc();
  connection.generation = 0;
  agentPanel.open = true;
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
  agentSessionsList.loaded = true;
  agentSessionsList.loading = false;
  agentSessionsList.sessions = [sessionSummary("agent-s1"), sessionSummary("agent-s2")];
  agentSessionsList.error = null;
  resetAllComposerTracks();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("R17-A [1]: per-session draft isolation (component surface)", () => {
  it("session A draft (text + image + file) is blank on B and fully restored on switch-back", () => {
    const ctx = mountPanel();
    selectAgentSession("agent-s1");
    flushSync();

    agentComposer.text = "draft for A";
    agentComposer.images = [
      { mediaType: "image/png", data: "aGk=", preview: "data:image/png;base64,aGk=" },
    ];
    agentComposer.files = [{ name: "notes.txt", data: "aGk=" }];
    flushSync();
    expect(textarea().value).toBe("draft for A");
    expect(pendingImages()).toHaveLength(1);
    expect(pendingFileChips().some((chip) => chip.includes("notes.txt"))).toBe(true);

    // 切会话 B：composer 空白（B 自己的草稿），无串档。
    selectAgentSession("agent-s2");
    flushSync();
    expect(textarea().value).toBe("");
    expect(pendingImages()).toHaveLength(0);
    expect(pendingFileChips()).toHaveLength(0);

    // 切回 A：文本 + 图片 + 文件完整恢复。
    selectAgentSession("agent-s1");
    flushSync();
    expect(textarea().value).toBe("draft for A");
    expect(pendingImages()).toHaveLength(1);
    expect(pendingImages()[0]?.getAttribute("src")).toBe("data:image/png;base64,aGk=");
    expect(pendingFileChips().some((chip) => chip.includes("notes.txt"))).toBe(true);
    ctx.cleanup();
  });

  it("editing state belongs to its session track and does not leak across switches", () => {
    const ctx = mountPanel();
    selectAgentSession("agent-s1");
    flushSync();
    agentComposer.editing = "previous message";
    flushSync();

    selectAgentSession("agent-s2");
    flushSync();
    expect(agentComposer.editing).toBeNull();
    expect(document.querySelector("[role='status']")).toBeNull();

    selectAgentSession("agent-s1");
    flushSync();
    expect(agentComposer.editing).toBe("previous message");
    ctx.cleanup();
  });
});

describe("R17-A [2]: narrowed clear semantics", () => {
  it("a successful send clears the sending track (text, attachments and editing)", async () => {
    const ctx = mountPanel();
    selectAgentSession("agent-s1");
    flushSync();

    agentComposer.editing = "old message";
    agentComposer.text = "hello world";
    agentComposer.files = [{ name: "notes.txt", data: "aGk=" }];
    flushSync();
    submitDraft("hello world");

    await vi.waitFor(() => expect(sessionPrompt).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(agentSession.sending).toBe(false));
    flushSync();

    // 提交点与成功点都清当前轨：textarea 空白、附件与 editing 态退出。
    expect(textarea().value).toBe("");
    expect(agentComposer.files).toHaveLength(0);
    expect(agentComposer.editing).toBeNull();

    // 清的是轨（不只是 facade）：切走再切回不再回显已发送内容。
    selectAgentSession("agent-s2");
    flushSync();
    selectAgentSession("agent-s1");
    flushSync();
    expect(textarea().value).toBe("");
    ctx.cleanup();
  });

  it("a failed send keeps the draft on the session track for retry", async () => {
    const ctx = mountPanel();
    selectAgentSession("agent-s1");
    flushSync();
    sessionPrompt.mockRejectedValueOnce(new Error("kernel not mounted"));

    submitDraft("retry me");
    await vi.waitFor(() => expect(agentSession.sending).toBe(false));
    flushSync();

    expect(agentSession.promptError).toContain("kernel not mounted");
    expect(textarea().value).toBe("retry me");

    // 重试成功后清轨。
    submitDraft("retry me");
    await vi.waitFor(() => expect(sessionPrompt).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(agentSession.sending).toBe(false));
    flushSync();
    expect(textarea().value).toBe("");
    ctx.cleanup();
  });

  it("the New Session bucket survives session switches; explicit new clears only that bucket", () => {
    const ctx = mountPanel();

    agentComposer.text = "seed in new";
    flushSync();
    selectAgentSession("agent-s1");
    flushSync();
    expect(textarea().value).toBe("");

    // 桶本身跨切换保留（换轨原语往返；生产回 New Session 态经 beginNewAgentSession）。
    switchComposerTrack(NEW_SESSION_COMPOSER_TRACK);
    flushSync();
    expect(textarea().value).toBe("seed in new");

    // 会话轨草稿不受显式新建影响。
    selectAgentSession("agent-s2");
    flushSync();
    agentComposer.text = "draft for B";
    flushSync();
    beginNewAgentSession();
    flushSync();
    expect(textarea().value).toBe("");

    selectAgentSession("agent-s2");
    flushSync();
    expect(textarea().value).toBe("draft for B");
    ctx.cleanup();
  });

  it("a lazily created session migrates the in-flight New Session draft (visible during send, cleared on success)", async () => {
    let resolvePrompt: ((value: { accepted: boolean }) => void) | undefined;
    sessionPrompt = vi
      .fn()
      .mockImplementation(
        () => new Promise<{ accepted: boolean }>((resolve) => (resolvePrompt = resolve)),
      );
    connection.rpc = agentRpc();
    const ctx = mountPanel();
    expect(agentSession.sessionId).toBeNull();

    submitDraft("first message");
    await vi.waitFor(() => expect(agentSession.sessionId).toBe("agent-s2"));

    // 惰性建会话换轨后草稿迁到新会话轨：发送期间继续可见（不是被清空）。
    flushSync();
    expect(textarea().value).toBe("first message");

    resolvePrompt?.({ accepted: true });
    await vi.waitFor(() => expect(sessionPrompt).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(agentSession.sending).toBe(false));
    flushSync();
    // 成功清发送轨；"__new__" 桶不回显已发送内容。
    expect(textarea().value).toBe("");
    switchComposerTrack(NEW_SESSION_COMPOSER_TRACK);
    flushSync();
    expect(textarea().value).toBe("");
    ctx.cleanup();
  });
});
