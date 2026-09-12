// @vitest-environment jsdom
/**
 * RouteTabContent 组件测试（R7 8.2/8.6/8.7 集成面）。
 * 用户原始需求 [2026-09-12]：「颜色与 Letter 分离——Identity 块用
 * route.iconLetter ?? 首字母 + route.iconColor」；「api 两路径同一 Select 字段
 * （预设路径预填目录 api 可改）」；「Models 区 = ModelListItem 列表 + dirty-gated
 * Save；Active 块 effort 数据源 = 当前模型的 efforts（删除硬编码）」。
 * 正交意图：
 *   [1] Identity 投影：字母/颜色/展示名经 IconPicker stub 的 data-* 断言
 *       （编号 slug 的 (N) 展示名 + iconLetter/iconColor 覆盖）。
 *   [2] Endpoint：api Select 恒在（目录路由亦然），改动后 Save 补丁带 api。
 *   [3] Models：ModelListItem 编辑改 dirty → Save 解禁 → 全量补丁；effort
 *       建议词 = 当前模型 efforts。
 */
import { describe, expect, it, vi } from "vitest";

const agentStore = vi.hoisted(() => ({
  updating: false,
  view: null as unknown,
  updateAgentSettings: vi.fn(),
  setAgentCredential: vi.fn(),
  clearAgentCredential: vi.fn(),
  testRouteConnection: vi.fn(),
}));

vi.mock("../stores/agent.svelte", () => ({
  agentRuntimeConfig: agentStore,
  updateAgentSettings: agentStore.updateAgentSettings,
  setAgentCredential: agentStore.setAgentCredential,
  clearAgentCredential: agentStore.clearAgentCredential,
  testRouteConnection: agentStore.testRouteConnection,
}));

vi.mock("../stores/provider-presets.svelte", () => ({
  saveProviderPreset: vi.fn(),
}));

vi.mock("../components/settings/IconPicker.svelte", async () => {
  const { default: stub } = await import("./stubs/icon-picker-stub.svelte");
  return { default: stub };
});

// ModelListItem 的三个 icon-button（R10-2）经 @lucide/svelte 引入 node_modules 的
// .svelte 图标——同签名 stub 替换。
vi.mock("@lucide/svelte/icons/pencil", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/plug-zap", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/trash-2", async () => await import("./stubs/lucide-icon-mocks.js"));

import RouteTabContent from "../components/settings/RouteTabContent.svelte";
import { flushSync, mount, unmount } from "./svelte-client";
import type { DshStewardSettingsView } from "$shared/contracts/dsh-runtime.js";

const CATALOG = {
  providers: [
    {
      provider: "zai",
      label: "Z.ai",
      api: "openai-completions",
      baseURL: "https://api.z.ai/api/paas/v4",
      icon: null,
      models: [{ id: "glm-4.7", name: "GLM 4.7", image: true, contextWindow: 200000 }],
    },
  ],
};

function baseView(
  routes: unknown[],
  active: { provider: string; model: string } = { provider: "openai", model: "gpt-4o" },
): DshStewardSettingsView {
  return {
    settings: {
      configVersion: 1,
      revision: 0,
      model: active,
      preset: "live",
      permissions: { approvalPolicy: "ask" },
      session: { streamRetention: 50, streamProjection: "enabled" },
      defaultMode: "free",
      modelRoutes: routes as DshStewardSettingsView["settings"]["modelRoutes"],
    },
    providers: [],
  };
}

function mountTab(route: Record<string, unknown>, view = baseView([route])) {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const instance = mount(RouteTabContent, {
    target,
    props: {
      route: route as never,
      catalog: CATALOG as never,
      onremove: vi.fn(),
    },
  });
  flushSync();
  // mock store 非响应式：view 变更后手动重挂载（测试内按需）。
  return {
    target,
    remount: (nextRoute: Record<string, unknown>, nextView = view) => {
      unmount(instance);
      return mountTab(nextRoute, nextView);
    },
    iconStub: () => target.querySelector<HTMLButtonElement>('[aria-label^="Icon picker stub"]')!,
    selectByLabel: (label: string) =>
      target.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!,
    inputByLabel: (label: string) =>
      target.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!,
    buttonByText: (text: string) =>
      [...target.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!,
    /** 展开第一个 ModelListItem（R10-2 默认折叠；edit icon-button 切换）。 */
    expandFirstModel: (): void => {
      target.querySelector<HTMLButtonElement>('button[aria-label^="Edit model"]')!.click();
      flushSync();
    },
    /** Models 块的 Save（与 Endpoint 的 Save 同名——按 section 作用域区分）。 */
    modelsSaveButton: (): HTMLButtonElement => {
      const buttons = [
        ...target
          .querySelector('section[aria-label="Models"]')!
          .querySelectorAll<HTMLButtonElement>("button"),
      ];
      return buttons.find((b) => b.textContent?.trim() === "Save")!;
    },
    saveButtons: () =>
      [...target.querySelectorAll("button")].filter((b) => b.textContent?.trim() === "Save"),
    cleanup: () => {
      unmount(instance);
      target.remove();
    },
  };
}

function typeValue(el: HTMLInputElement | HTMLSelectElement, value: string): void {
  el.value = value;
  el.dispatchEvent(
    new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
  );
  flushSync();
}

function blurEl(el: HTMLInputElement): void {
  el.dispatchEvent(new Event("blur"));
  flushSync();
}

describe("RouteTabContent (R7 8.2/8.6/8.7)", () => {
  it("projects identity via route iconLetter/iconColor and numbers display labels (8.2/8.4)", () => {
    agentStore.view = baseView([
      { provider: "zai-2", baseURL: "https://api.z.ai/api/paas/v4", models: [{ id: "glm-4.7" }] },
    ]);
    const ctx = mountTab({
      provider: "zai-2",
      baseURL: "https://api.z.ai/api/paas/v4",
      iconLetter: "Z2",
      iconColor: "#3b82f6",
      models: [{ id: "glm-4.7" }],
    });
    const stub = ctx.iconStub();
    expect(stub.dataset.stubLetter).toBe("Z2");
    expect(stub.dataset.stubColor).toBe("#3b82f6");
    expect(stub.dataset.stubLabel).toBe("Z.ai (1)");
    ctx.cleanup();
  });

  it("falls back to first letter + deterministic hue without overrides (8.2)", () => {
    agentStore.view = baseView([
      { provider: "my-relay", baseURL: "https://r.example/v1", models: [{ id: "m1" }] },
    ]);
    const ctx = mountTab({
      provider: "my-relay",
      baseURL: "https://r.example/v1",
      models: [{ id: "m1" }],
    });
    const stub = ctx.iconStub();
    expect(stub.dataset.stubLetter).toBe("M");
    expect(stub.dataset.stubColor).toMatch(/^hsl\(\d+ 55% 45%\)$/);
    expect(stub.dataset.stubLabel).toBe("my-relay");
    ctx.cleanup();
  });

  it("shows the api Select for catalog routes too, prefilled from the catalog (8.6)", async () => {
    agentStore.view = baseView([
      {
        provider: "zai",
        baseURL: "https://api.z.ai/api/paas/v4",
        models: [{ id: "glm-4.7" }],
      },
    ]);
    const ctx = mountTab({
      provider: "zai",
      baseURL: "https://api.z.ai/api/paas/v4",
      models: [{ id: "glm-4.7" }],
    });
    const apiSelect = ctx.selectByLabel("API protocol");
    expect(apiSelect).not.toBeNull();
    expect(apiSelect.value).toBe("openai-completions");
    // 改 api → endpoint Save 解禁 → 补丁带新 api。
    agentStore.updateAgentSettings.mockReset();
    agentStore.updateAgentSettings.mockResolvedValue({ outcome: "updated", changed: true });
    typeValue(apiSelect, "openai-responses");
    ctx.buttonByText("Save").click();
    flushSync();
    await vi.waitFor(() => expect(agentStore.updateAgentSettings).toHaveBeenCalled());
    const patch = agentStore.updateAgentSettings.mock.calls[0]![0] as {
      modelRoutes: Array<{ provider: string; api: string }>;
    };
    expect(patch.modelRoutes[0]).toEqual(
      expect.objectContaining({ provider: "zai", api: "openai-responses" }),
    );
    ctx.cleanup();
  });

  it("edits models through ModelListItem with dirty-gated Save (8.7)", async () => {
    agentStore.view = baseView([
      {
        provider: "my-relay",
        baseURL: "https://r.example/v1",
        models: [{ id: "glm-4.7", contextWindow: 200000 }],
      },
    ]);
    const ctx = mountTab({
      provider: "my-relay",
      baseURL: "https://r.example/v1",
      models: [{ id: "glm-4.7", contextWindow: 200000 }],
    });
    // Models 块的 Save：初始 not dirty → disabled；折叠行无 dirty 点。
    const modelsSave = ctx.modelsSaveButton();
    expect(modelsSave.disabled).toBe(true);
    expect(ctx.target.querySelector('[aria-label="Unsaved changes"]')).toBeNull();

    // R10-2：条目默认折叠；edit 展开 → 改上下文窗口（253k → 259072）→ dirty →
    // Save 补丁 + 折叠行小圆点出现。
    ctx.expandFirstModel();
    agentStore.updateAgentSettings.mockReset();
    agentStore.updateAgentSettings.mockResolvedValue({ outcome: "updated", changed: true });
    typeValue(ctx.inputByLabel("Context window (tokens)"), "253k");
    blurEl(ctx.inputByLabel("Context window (tokens)"));
    expect(modelsSave.disabled).toBe(false);
    expect(ctx.target.querySelector('[aria-label="Unsaved changes"]')).not.toBeNull();
    modelsSave.click();
    flushSync();
    await vi.waitFor(() => expect(agentStore.updateAgentSettings).toHaveBeenCalled());
    const patch = agentStore.updateAgentSettings.mock.calls[0]![0] as {
      modelRoutes: Array<{ models: Array<{ id: string; contextWindow: number }> }>;
    };
    expect(patch.modelRoutes[0]!.models).toEqual([{ id: "glm-4.7", contextWindow: 259072 }]);
    ctx.cleanup();
  });

  it("blocks Save while a token field is invalid, then unblocks after fix (8.7)", async () => {
    agentStore.view = baseView([
      { provider: "my-relay", baseURL: "https://r.example/v1", models: [{ id: "glm-4.7" }] },
    ]);
    const ctx = mountTab({
      provider: "my-relay",
      baseURL: "https://r.example/v1",
      models: [{ id: "glm-4.7" }],
    });
    ctx.expandFirstModel();
    const modelsSave = ctx.modelsSaveButton();
    const field = ctx.inputByLabel("Context window (tokens)");
    typeValue(field, "huge");
    blurEl(field);
    expect(modelsSave.disabled).toBe(true);
    typeValue(field, "128k");
    blurEl(field);
    expect(modelsSave.disabled).toBe(false);
    ctx.cleanup();
  });

  it("pins the route provider's catalog models in the completion pool (R10-1)", () => {
    agentStore.view = baseView([
      {
        provider: "zai",
        baseURL: "https://api.z.ai/api/paas/v4",
        models: [{ id: "glm-4.7" }],
      },
    ]);
    const catalog = {
      providers: [
        ...CATALOG.providers,
        {
          provider: "deepseek",
          label: "DeepSeek",
          api: "openai-completions",
          baseURL: "https://api.deepseek.com/v1",
          icon: null,
          models: [{ id: "deepseek-chat", image: false }],
        },
      ],
    };
    const target = document.createElement("div");
    document.body.appendChild(target);
    const instance = mount(RouteTabContent, {
      target,
      props: {
        route: {
          provider: "zai",
          baseURL: "https://api.z.ai/api/paas/v4",
          models: [{ id: "glm-4.7" }],
        } as never,
        catalog: catalog as never,
        onremove: vi.fn(),
      },
    });
    flushSync();
    target.querySelector<HTMLButtonElement>('button[aria-label^="Edit model"]')!.click();
    flushSync();
    const ids = [...target.querySelectorAll<HTMLOptionElement>("datalist option")].map(
      (option) => option.value,
    );
    // 当前路由 provider（zai）的目录模型置顶，其余供应商随后。
    expect(ids).toEqual(["glm-4.7", "deepseek-chat"]);
    unmount(instance);
    target.remove();
  });

  it("derives Active effort suggestions from the selected model's efforts (8.7)", () => {
    const routes = [
      {
        provider: "my-relay",
        baseURL: "https://r.example/v1",
        models: [{ id: "m1", efforts: ["low", "xhigh"] }, { id: "m2" }],
      },
    ] as unknown[];
    agentStore.view = baseView(routes, { provider: "my-relay", model: "m1" });
    const ctx = mountTab(
      routes[0] as Record<string, unknown>,
      agentStore.view as DshStewardSettingsView,
    );
    const effortInput = ctx.inputByLabel("Reasoning effort");
    // 活动模型 m1：建议词 = 其 efforts（占位与 datalist 同源）。
    expect(effortInput.placeholder).toBe("low / xhigh");
    const options = [
      ...ctx.target.querySelectorAll<HTMLOptionElement>("#active-effort-suggestions option"),
    ].map((option) => option.value);
    expect(options).toEqual(["low", "xhigh"]);

    // 切到 m2（无 efforts）：自由输入，无建议词、无硬编码数组。
    typeValue(ctx.selectByLabel("Model"), "m2");
    expect(effortInput.placeholder).toBe("effort");
    expect(
      [...ctx.target.querySelectorAll<HTMLOptionElement>("#active-effort-suggestions option")]
        .length,
    ).toBe(0);
    ctx.cleanup();
  });
});
