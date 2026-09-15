// @vitest-environment jsdom
/**
 * ComposerCard model chip 下拉测试（Track B2，design §3.4 / PRODUCT_MODEL §5）。
 * 用户原始需求 [2026-09-12]：「composer 的 model chip 同步显示全局 active……
 * 会话运行时可在 composer model chip 下拉热切（只写 settings.model，绝不触碰
 * 路由字段）」。
 * 正交意图：
 *   [1] 分组渲染：routes → 菜单组（组头 = catalog label ?? provider id）；当前
 *       活动模型项带 check 标记；悬空（dangling）活动模型组外 amber 警示。
 *   [2] 交互与态：选中 → updateAgentSettings 只写 model 字段并保留
 *       reasoningEffort；running 触发器禁用；Open settings → 打开 Model 分区。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const connection = vi.hoisted(() => ({
  rpc: null as unknown,
}));
const settingsUi = vi.hoisted(() => ({
  openSettings: vi.fn(),
}));
const toast = vi.hoisted(() => ({
  showToast: vi.fn(),
}));
const composer = vi.hoisted(() => ({
  agentComposer: { text: "", images: [], files: [], references: [], editing: null },
}));

vi.mock("../stores/connection.svelte", () => ({
  getRpc: () => connection.rpc ?? null,
  getConnectionGeneration: () => 0,
  requireRpc: () => {
    throw new Error("not connected");
  },
  connectionState: { status: "connected", error: null },
}));
vi.mock("../stores/agent.svelte", async () => await import("./stubs/agent-store-stub.svelte"));
vi.mock("../stores/agent-composer.svelte", () => ({
  agentComposer: composer.agentComposer,
  addComposerImages: vi.fn(),
  addComposerDocs: vi.fn(),
  clearComposerEdit: vi.fn(),
}));
vi.mock("../stores/settings-ui.svelte", () => ({
  openSettings: settingsUi.openSettings,
}));
vi.mock("../toast.svelte", () => ({
  showToast: toast.showToast,
}));
vi.mock("../components/agent/ContextMeter.svelte", async () => {
  const { default: stub } = await import("./stubs/context-meter-stub.svelte");
  return { default: stub };
});

// @lucide/svelte 图标 = node_modules 的 .svelte（root vitest 管线不编译）——空壳替换。
vi.mock("@lucide/svelte/icons/image", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/file-up", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/arrow-up", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/square", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock(
  "@lucide/svelte/icons/chevron-down",
  async () => await import("./stubs/lucide-icon-mocks.js"),
);
vi.mock("@lucide/svelte/icons/check", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/x", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/plus", async () => await import("./stubs/lucide-icon-mocks.js"));

// bits-ui 在 node_modules 含 .svelte（vitest 外置）——以同 data-slot 契约的
// 本地 dropdown stub 替换；分组/勾选/禁用/选择 payload 等组件逻辑不受影响。
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

import ComposerCard from "../components/agent/ComposerCard.svelte";
import { flushSync, mount, unmount } from "./svelte-client";
import {
  agentSession,
  resetAgentStoreStub,
  updateAgentSettings,
} from "./stubs/agent-store-stub.svelte";
import type { DshStewardSettingsView } from "$shared/contracts/dsh-runtime.js";

function view(
  routes: DshStewardSettingsView["settings"]["modelRoutes"],
  active: {
    provider: string;
    model: string;
    reasoningEffort?: string;
  },
): DshStewardSettingsView {
  return {
    settings: {
      configVersion: 1,
      revision: 0,
      model: {
        provider: active.provider,
        model: active.model,
        ...(active.reasoningEffort ? { reasoningEffort: active.reasoningEffort } : {}),
      },
      preset: "live",
      permissions: { approvalPolicy: "ask" },
      session: { streamRetention: 50, streamProjection: "enabled", sessionCleanupDays: 30 },
      defaultMode: "free",
      modelRoutes: routes,
    },
    providers: [],
  };
}

const ROUTES: DshStewardSettingsView["settings"]["modelRoutes"] = [
  {
    provider: "zai",
    baseURL: "https://api.z.ai/api/paas/v4",
    api: "openai-completions",
    models: [{ id: "glm-4.7" }, { id: "glm-4.7-flash" }],
  },
  {
    provider: "xai",
    baseURL: "https://api.x.ai/v1",
    api: "openai-completions",
    models: [{ id: "grok-4" }],
  },
];

function mountComposer() {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const instance = mount(ComposerCard, { target });
  flushSync();
  return {
    target,
    trigger: () =>
      document.querySelector<HTMLButtonElement>('button[aria-label="Switch active model"]'),
    openMenu: async () => {
      const trigger = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Switch active model"]',
      );
      if (!trigger) throw new Error("model chip trigger not rendered");
      trigger.click();
      await vi.waitFor(() => {
        if (document.querySelector('[data-slot="dropdown-menu-content"]') === null) {
          throw new Error("menu content not rendered");
        }
      });
    },
    content: () => document.querySelector('[data-slot="dropdown-menu-content"]'),
    headings: () =>
      [...document.querySelectorAll('[data-slot="dropdown-menu-group-heading"]')].map(
        (n) => n.textContent,
      ),
    items: () =>
      [...document.querySelectorAll('[data-slot="dropdown-menu-item"]')].map((n) => ({
        text: n.textContent?.trim(),
        active: n.getAttribute("data-model-active"),
      })),
    cleanup: () => {
      unmount(instance);
      target.remove();
      document.querySelectorAll("[data-slot='dropdown-menu-content']").forEach((n) => n.remove());
    },
  };
}

describe("ComposerCard model chip dropdown (B2)", () => {
  beforeEach(() => {
    // 菜单组头 label 源（ComposerCard 模块级缓存：首个挂载消费此 rpc）。
    connection.rpc = {
      agent: {
        models: {
          catalog: async () => ({
            providers: [
              {
                provider: "zai",
                label: "Z.ai",
                api: "openai-completions",
                baseURL: "https://api.z.ai/api/paas/v4",
                icon: null,
                models: [{ id: "glm-4.7", image: false }],
              },
              {
                provider: "xai",
                label: "xAI",
                api: "openai-completions",
                baseURL: "https://api.x.ai/v1",
                icon: null,
                models: [{ id: "grok-4", image: false }],
              },
            ],
          }),
        },
      },
    };
  });

  it("groups models by route with catalog labels and marks the active model", async () => {
    resetAgentStoreStub(view(ROUTES, { provider: "zai", model: "glm-4.7" }));
    const ctx = mountComposer();
    await ctx.openMenu();

    // R7 8.2：组头 = 字母 chip（iconLetter ?? 首字母）+ 目录 label。
    expect(ctx.headings()).toEqual(["Z Z.ai", "X xAI"]);
    const chips = [
      ...document.querySelectorAll(
        '[data-slot="dropdown-menu-group-heading"] span[style^="background"]',
      ),
    ];
    expect(chips.length).toBe(2);
    // jsdom 会把 hsl() 归一成 rgb()——断言确有确定性底色即可。
    expect(chips[0]!.getAttribute("style")).toMatch(/^background: (hsl|rgb)/);
    const texts = ctx.items().map((item) => item.text);
    expect(texts).toContain("glm-4.7");
    expect(texts).toContain("glm-4.7-flash");
    expect(texts).toContain("grok-4");
    expect(texts).toContain("Open settings →");

    const active = ctx.items().find((item) => item.active === "true");
    expect(active?.text).toBe("glm-4.7");
    ctx.cleanup();
  });

  it("selecting a model writes only the model field, preserving reasoningEffort", async () => {
    resetAgentStoreStub(
      view(ROUTES, { provider: "zai", model: "glm-4.7", reasoningEffort: "high" }),
    );
    const ctx = mountComposer();
    await ctx.openMenu();

    const grok = [...document.querySelectorAll('[data-slot="dropdown-menu-item"]')].find((n) =>
      n.textContent?.includes("grok-4"),
    ) as HTMLElement | undefined;
    grok!.click();
    await vi.waitFor(() => expect(updateAgentSettings).toHaveBeenCalledTimes(1));
    expect(updateAgentSettings).toHaveBeenCalledWith({
      model: { provider: "xai", model: "grok-4", reasoningEffort: "high" },
    });
    ctx.cleanup();
  });

  it("disables the whole menu while the session is running", async () => {
    resetAgentStoreStub(view(ROUTES, { provider: "zai", model: "glm-4.7" }));
    const ctx = mountComposer();
    expect(ctx.trigger()?.disabled).toBe(false);

    agentSession.status = "running";
    flushSync();
    const trigger = ctx.trigger();
    expect(trigger?.disabled).toBe(true);
    expect(trigger?.title).toBe("Switch after the current turn ends");
    ctx.cleanup();
  });

  it("shows an amber dangling entry when the active model rides outside Routes", async () => {
    resetAgentStoreStub(view(ROUTES, { provider: "env-provider", model: "m-zero" }));
    const ctx = mountComposer();

    const trigger = ctx.trigger();
    expect(trigger?.className).toContain("border-amber-500/60");
    await ctx.openMenu();

    const dangling = ctx.content()?.querySelector("[data-dangling='true']");
    expect(dangling?.textContent).toContain("env-provider · m-zero");
    expect(dangling?.textContent).toContain("outside Routes");
    ctx.cleanup();
  });

  it("keeps Settings → Model as the route-configuration entry point", async () => {
    settingsUi.openSettings.mockReset();
    resetAgentStoreStub(view(ROUTES, { provider: "zai", model: "glm-4.7" }));
    const ctx = mountComposer();
    await ctx.openMenu();

    const openItem = [...document.querySelectorAll('[data-slot="dropdown-menu-item"]')].find((n) =>
      n.textContent?.includes("Open settings"),
    ) as HTMLElement | undefined;
    openItem!.click();
    expect(settingsUi.openSettings).toHaveBeenCalledWith("model");
    ctx.cleanup();
  });
});
