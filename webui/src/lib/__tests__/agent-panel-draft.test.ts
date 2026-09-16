// @vitest-environment jsdom
/**
 * AgentPanel composer 草稿保护组件测试（codex R2 阻塞 5）。
 *
 * 用户原始需求 [2026-09-12]（codex R2 复审）：「同一个 $effect 每次运行先
 * resetComposer() 再读 agentRuntimeConfig.view/loading——model 热切/凭据更新/
 * settings reload 会重跑 effect 清空用户草稿」——修复后挂载重置与配置惰性加载
 * 分属两个 effect，配置更新不得触碰草稿。
 *
 * 正交意图：
 *   [1] 挂载语义（R17-A/R17-C 修订）：草稿按 sessionId 分轨，挂载/开合/收起
 *       均不重置（清轨点在 store 侧收窄为显式新建与发送成功）。
 *   [2] 草稿连续性：settings.model 热切（view 替换）与 loading 翻转后，草稿
 *       文本与附件原样保留；配置投影只加载一次（无重放）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const connection = vi.hoisted(() => ({
  generation: 0,
  rpc: null as unknown,
  // 可变连接状态（走查 P1 回归：面板早开竞态——effect 消费 status）。
  state: { status: "idle" as string, error: null as string | null },
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
  connectionState: connection.state,
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

// bits-ui 在 node_modules 含 .svelte（vitest 外置）——同 data-slot 契约的本地
// dropdown stub 替换（ComposerCard 的 mode/model 菜单）。
vi.mock("$lib/components/ui/dropdown-menu", async () => {
  const Root = (await import("./stubs/dropdown-menu-stub/Root.svelte")).default;
  const Trigger = (await import("./stubs/dropdown-menu-stub/Trigger.svelte")).default;
  const Content = (await import("./stubs/dropdown-menu-stub/Content.svelte")).default;
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
// 真 store（runes .svelte.ts）：被测的正是真实 effect 依赖图（agentRuntimeConfig
// 变化 → 不得触碰 composer 草稿）。
import {
  agentPanel,
  agentRuntimeConfig,
  agentSession,
  agentSessionsList,
} from "../stores/agent.svelte";
import { agentComposer, resetAllComposerTracks } from "../stores/agent-composer.svelte";
import type { DshStewardSettingsView } from "$shared/contracts/dsh-runtime.js";

const VIEW: DshStewardSettingsView = {
  settings: {
    configVersion: 1,
    revision: 0,
    model: { provider: "zai", model: "glm-4.7" },
    preset: "live",
    permissions: { approvalPolicy: "ask" },
    session: { streamRetention: 50, streamProjection: "enabled", sessionCleanupDays: 30 },
    defaultMode: "free",
    modelRoutes: [
      {
        provider: "zai",
        baseURL: "https://api.z.ai/api/paas/v4",
        api: "openai-completions",
        models: [{ id: "glm-4.7" }],
      },
    ],
  },
  providers: [],
};

function hotSwitchedView(): DshStewardSettingsView {
  return {
    ...VIEW,
    settings: {
      ...VIEW.settings,
      model: { provider: "zai", model: "glm-4.7-flash", reasoningEffort: "high" },
    },
  };
}

let settingsGet: ReturnType<typeof vi.fn>;

function mountPanel() {
  // R17-C：面板常驻挂载后配置惰性加载以 agentPanel.open 为闸——组件 mount 测试
  // 代表「面板打开」场景。
  agentPanel.open = true;
  const target = document.createElement("div");
  document.body.appendChild(target);
  const instance = mount(AgentPanel, { target });
  flushSync();
  return {
    cleanup: () => {
      unmount(instance);
      target.remove();
    },
  };
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

function agentRpc(settingsGetImpl: ReturnType<typeof vi.fn>): unknown {
  return {
    agent: {
      settings: { get: settingsGetImpl },
      // ComposerCard 的菜单组头 label 缓存拉取（结果为空目录即可）。
      models: { catalog: async () => ({ providers: [] }) },
    },
  };
}

beforeEach(() => {
  settingsGet = vi.fn().mockResolvedValue(VIEW);
  connection.rpc = agentRpc(settingsGet);
  connection.generation = 0;
  connection.state.status = "connected";
  connection.state.error = null;
  agentPanel.open = false;
  agentPanel.seedPrompt = null;
  agentSession.sessionId = null;
  agentSession.mode = null;
  agentSession.items = [];
  agentSession.todos = [];
  agentSession.turnStartedAt = null;
  agentSession.status = "idle";
  agentSession.sending = false;
  agentSession.error = null;
  agentSession.promptError = null;
  agentSessionsList.loaded = false;
  agentSessionsList.sessions = [];
  agentRuntimeConfig.view = null;
  agentRuntimeConfig.loading = false;
  agentRuntimeConfig.updating = false;
  agentRuntimeConfig.error = null;
  resetAllComposerTracks();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("AgentPanel composer draft protection (codex R2 blocker 5)", () => {
  it("does not fire the lazy settings load before the connection is established (walkthrough P1)", async () => {
    // 走查 P1（2026-09-16）：连接建立前打开面板曾让 requireRpc 同步抛错——
    // loading/error 同帧写回触发 effect_update_depth_exceeded 无限环，杀死
    // 整个 app 响应性。修复后 status 未连接不开闸；连接建立后正常补拉。
    //（mock 的 connectionState 是普通对象，无响应性——第二分支以重挂载驱动，
    // 与生产 status 变化重跑同一 effect 体等价。）
    connection.state.status = "connecting";
    connection.rpc = null;
    let ctx = mountPanel();
    try {
      flushSync();
      flushSync();
      expect(settingsGet).not.toHaveBeenCalled();
      expect(agentRuntimeConfig.loading).toBe(false);
      expect(agentRuntimeConfig.error).toBeNull();
      ctx.cleanup();
      // 连接建立：重挂载（= 同一 effect 体以 connected status 运行）→ 补拉一次。
      connection.rpc = agentRpc(settingsGet);
      connection.state.status = "connected";
      agentRuntimeConfig.view = null;
      ctx = mountPanel();
      flushSync();
      await vi.waitFor(() => {
        expect(agentRuntimeConfig.view).not.toBeNull();
      });
      expect(settingsGet).toHaveBeenCalledTimes(1);
    } finally {
      ctx.cleanup();
    }
  });

  it("keeps the draft across mount cycles (R17-A/R17-C: mount never resets)", async () => {
    agentComposer.text = "stale draft from a previous mount";
    const ctx = mountPanel();
    await vi.waitFor(() => expect(agentRuntimeConfig.view).not.toBeNull());

    // 挂载不重置：草稿按 sessionId 分轨，清轨点收窄为显式新建/发送成功。
    expect(agentComposer.text).toBe("stale draft from a previous mount");

    // 组件卸载/重挂载（等效面板收起再展开的 DOM 生命周期）同样不清草稿。
    agentComposer.text = "left between mounts";
    ctx.cleanup();
    const second = mountPanel();
    flushSync();
    expect(agentComposer.text).toBe("left between mounts");
    second.cleanup();
  });

  it("keeps the draft when settings.model hot-switches mid-edit (view replacement)", async () => {
    const ctx = mountPanel();
    await vi.waitFor(() => expect(agentRuntimeConfig.view).not.toBeNull());

    agentComposer.text = "my precious draft";
    agentComposer.files = [{ name: "notes.txt", data: "aGk=" }];
    flushSync();

    // 模拟 updateAgentSettings 成功路径（settings.model 热切写 view）：
    agentRuntimeConfig.view = hotSwitchedView();
    flushSync();
    expect(agentComposer.text).toBe("my precious draft");
    expect(agentComposer.files).toHaveLength(1);

    // 模拟凭据更新 / settings reload 的 loading 翻转：
    agentRuntimeConfig.loading = true;
    flushSync();
    agentRuntimeConfig.loading = false;
    flushSync();
    expect(agentComposer.text).toBe("my precious draft");
    expect(agentComposer.files).toHaveLength(1);

    // 配置投影只加载一次：view 就位后 view/loading 变化不重放拉取。
    expect(settingsGet).toHaveBeenCalledTimes(1);
    ctx.cleanup();
  });

  it("keeps the draft when the lazy settings load resolves after typing started", async () => {
    // 面板先开、配置后到（慢 RPC）：挂载时 view 为 null，用户已开始输入——
    // 惰性加载落定（view 写入 + loading 翻转）不得清空草稿。
    let resolveSettings: ((value: DshStewardSettingsView) => void) | undefined;
    settingsGet = vi
      .fn()
      .mockImplementation(
        () => new Promise<DshStewardSettingsView>((resolve) => (resolveSettings = resolve)),
      );
    connection.rpc = agentRpc(settingsGet);
    const ctx = mountPanel();
    flushSync();
    expect(agentRuntimeConfig.loading).toBe(true);

    agentComposer.text = "typed before settings arrived";
    flushSync();

    resolveSettings?.(VIEW);
    await vi.waitFor(() => expect(agentRuntimeConfig.view).not.toBeNull());
    flushSync();
    expect(agentComposer.text).toBe("typed before settings arrived");
    ctx.cleanup();
  });
});
