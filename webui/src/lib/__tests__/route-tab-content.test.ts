// @vitest-environment jsdom
/**
 * RouteTabContent 组件测试（R7 8.2/8.6/8.7 集成面 + R12-A 五项交互收敛）。
 * 用户原始需求 [2026-09-12]：「颜色与 Letter 分离——Identity 块用
 * route.iconLetter ?? 首字母 + route.iconColor」；「api 两路径同一 Select 字段
 * （预设路径预填目录 api 可改）」；「Models 区 = ModelListItem 列表 + dirty-gated
 * Save」。
 * 用户原始需求 [2026-09-12 R12-A]：「一共只提供一个 save 按钮就好，现在给了
 * 3 个，save 和 remove 都放到右上角」；「AddModel，新增的 Model，要
 * scrollInToView」；「Active model 这个配置没有意义，删掉」；「key 直接通过
 * 一个 input-password 直接显示出来，提供 eye-toggle 即可」。
 * 用户原始需求 [2026-09-12 R14-A]：「删除和保存应该和 title/subtitle 处于
 * 同一栏」——Remove/Save 并入 Identity 标题行（data-route-titlebar），与
 * displayName/meta 同一容器行；独立动作行不复存在；功能断言沿用。
 * 正交意图：
 *   [1] Identity 投影：字母/颜色/展示名经 IconPicker stub 的 data-* 断言
 *       （编号 slug 的 (N) 展示名 + iconLetter/iconColor 覆盖）。
 *   [2] 全局 Save（R12-A2）：endpoint + models 任一 dirty 解禁；多块 dirty 单击
 *       一次补丁携带全部；无 dirty / 条目非法禁用；Remove icon-button 走 onremove。
 *   [3] Add model（R12-A3）：新增条目 scrollIntoView({nearest, smooth})。
 *   [4] Active model 块删除（R12-A4）：相关 select/按钮不再渲染。
 *   [5] 常驻凭据输入（R12-A5）：password 输入 + eye 切 type；失焦/Enter 保存；
 *       已配置客观回显 key 值（R16 用户裁决）；Clear 旁路保留。
 *   [6] 标题行布局（R14-A2）：Remove/Save 与 displayName/meta 同一容器行
 *       （data-route-titlebar），标题行位于首块、无独立动作行。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

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

// ModelListItem 的 icon-button 与 RouteTabContent 的 eye/trash（R12-A）经
// @lucide/svelte 引入 node_modules 的 .svelte 图标——同签名 stub 替换。
vi.mock("@lucide/svelte/icons/pencil", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/plug-zap", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/trash-2", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/eye", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/eye-off", async () => await import("./stubs/lucide-icon-mocks.js"));

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
  providers: Array<{ provider: string; configured: boolean; apiKey: string | null }> = [],
): DshStewardSettingsView {
  return {
    settings: {
      configVersion: 1,
      revision: 0,
      model: active,
      preset: "live",
      permissions: { approvalPolicy: "ask" },
      session: { streamRetention: 50, streamProjection: "enabled", sessionCleanupDays: 30 },
      defaultMode: "free",
      modelRoutes: routes as DshStewardSettingsView["settings"]["modelRoutes"],
    },
    providers,
  };
}

function mountTab(route: Record<string, unknown>, view = baseView([route])) {
  const onremove = vi.fn();
  const target = document.createElement("div");
  document.body.appendChild(target);
  const instance = mount(RouteTabContent, {
    target,
    props: {
      route: route as never,
      catalog: CATALOG as never,
      onremove,
    },
  });
  flushSync();
  // mock store 非响应式：view 变更后手动重挂载（测试内按需）。
  return {
    target,
    onremove,
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
    /** 右上角全局 Save（R12-A2 唯一保存按钮）。 */
    saveButton: (): HTMLButtonElement =>
      target.querySelector<HTMLButtonElement>("[data-route-save]")!,
    removeRouteButton: (): HTMLButtonElement =>
      target.querySelector<HTMLButtonElement>('button[aria-label="Remove route"]')!,
    eyeButton: (): HTMLButtonElement =>
      target.querySelector<HTMLButtonElement>(
        'button[aria-label^="Show API key"], button[aria-label^="Hide API key"]',
      )!,
    keyInput: (): HTMLInputElement =>
      target.querySelector<HTMLInputElement>('input[aria-label="API key"]')!,
    /** 展开第一个 ModelListItem（R10-2 默认折叠；edit icon-button 切换）。 */
    expandFirstModel: (): void => {
      target.querySelector<HTMLButtonElement>('button[aria-label^="Edit model"]')!.click();
      flushSync();
    },
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
    // 改 api → 全局 Save 解禁 → 补丁带新 api。
    agentStore.updateAgentSettings.mockReset();
    agentStore.updateAgentSettings.mockResolvedValue({ outcome: "updated", changed: true });
    typeValue(apiSelect, "openai-responses");
    ctx.saveButton().click();
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

  it("edits models through ModelListItem with the dirty-gated global Save (8.7)", async () => {
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
    // 全局 Save：初始 not dirty → disabled；折叠行无 dirty 点。
    expect(ctx.saveButton().disabled).toBe(true);
    expect(ctx.target.querySelector('[aria-label="Unsaved changes"]')).toBeNull();

    // R10-2：条目默认折叠；edit 展开 → 改上下文窗口（253k → 259072）→ dirty →
    // Save 补丁 + 折叠行小圆点出现。
    ctx.expandFirstModel();
    agentStore.updateAgentSettings.mockReset();
    agentStore.updateAgentSettings.mockResolvedValue({ outcome: "updated", changed: true });
    typeValue(ctx.inputByLabel("Context window (tokens)"), "253k");
    blurEl(ctx.inputByLabel("Context window (tokens)"));
    expect(ctx.saveButton().disabled).toBe(false);
    expect(ctx.target.querySelector('[aria-label="Unsaved changes"]')).not.toBeNull();
    ctx.saveButton().click();
    flushSync();
    await vi.waitFor(() => expect(agentStore.updateAgentSettings).toHaveBeenCalled());
    const patch = agentStore.updateAgentSettings.mock.calls[0]![0] as {
      modelRoutes: Array<{ models: Array<{ id: string; contextWindow: number }> }>;
    };
    expect(patch.modelRoutes[0]!.models).toEqual([{ id: "glm-4.7", contextWindow: 259072 }]);
    ctx.cleanup();
  });

  it("blocks Save while a token field is invalid, then unblocks after fix (8.7)", () => {
    agentStore.view = baseView([
      { provider: "my-relay", baseURL: "https://r.example/v1", models: [{ id: "glm-4.7" }] },
    ]);
    const ctx = mountTab({
      provider: "my-relay",
      baseURL: "https://r.example/v1",
      models: [{ id: "glm-4.7" }],
    });
    ctx.expandFirstModel();
    const field = ctx.inputByLabel("Context window (tokens)");
    typeValue(field, "huge");
    blurEl(field);
    expect(ctx.saveButton().disabled).toBe(true);
    typeValue(field, "128k");
    blurEl(field);
    expect(ctx.saveButton().disabled).toBe(false);
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
});

describe("RouteTabContent single top-right Save/Remove (R12-A2)", () => {
  it("merges endpoint + models dirty edits into one patch on a single Save click", async () => {
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
    // 唯一 Save：Endpoint/Models 区不再有自己的 Save 按钮。
    const exactSaveButtons = [...ctx.target.querySelectorAll("button")].filter(
      (b) => b.textContent?.trim() === "Save",
    );
    expect(exactSaveButtons.length).toBe(1);
    expect(exactSaveButtons[0]).toBe(ctx.saveButton());

    // 两块同时 dirty：改 baseURL + 改条目上下文窗口。
    typeValue(ctx.inputByLabel("Base URL"), "https://relay.example/v2");
    ctx.expandFirstModel();
    typeValue(ctx.inputByLabel("Context window (tokens)"), "253k");
    blurEl(ctx.inputByLabel("Context window (tokens)"));
    expect(ctx.saveButton().disabled).toBe(false);

    agentStore.updateAgentSettings.mockReset();
    agentStore.updateAgentSettings.mockResolvedValue({ outcome: "updated", changed: true });
    ctx.saveButton().click();
    flushSync();
    await vi.waitFor(() => expect(agentStore.updateAgentSettings).toHaveBeenCalled());
    // 单击一次 → 恰好一次补丁调用，携带 endpoint + models 全部脏改动。
    expect(agentStore.updateAgentSettings).toHaveBeenCalledTimes(1);
    const patch = agentStore.updateAgentSettings.mock.calls[0]![0] as {
      modelRoutes: Array<{
        baseURL: string;
        models: Array<{ id: string; contextWindow: number }>;
      }>;
    };
    expect(patch.modelRoutes[0]).toEqual(
      expect.objectContaining({
        baseURL: "https://relay.example/v2",
        models: [{ id: "glm-4.7", contextWindow: 259072 }],
      }),
    );
    ctx.cleanup();
  });

  it("keeps the single Save disabled without any dirty change", () => {
    agentStore.view = baseView([
      { provider: "my-relay", baseURL: "https://r.example/v1", models: [{ id: "m1" }] },
    ]);
    const ctx = mountTab({
      provider: "my-relay",
      baseURL: "https://r.example/v1",
      models: [{ id: "m1" }],
    });
    expect(ctx.saveButton().disabled).toBe(true);
    // Endpoint-only dirty 也解禁。
    typeValue(ctx.inputByLabel("Base URL"), "https://relay.example/v2");
    expect(ctx.saveButton().disabled).toBe(false);
    ctx.cleanup();
  });

  it("routes the top-right Remove icon button through onremove (ConfirmDialog 流程不变)", () => {
    agentStore.view = baseView([
      { provider: "my-relay", baseURL: "https://r.example/v1", models: [{ id: "m1" }] },
    ]);
    const ctx = mountTab({
      provider: "my-relay",
      baseURL: "https://r.example/v1",
      models: [{ id: "m1" }],
    });
    ctx.removeRouteButton().click();
    flushSync();
    expect(ctx.onremove).toHaveBeenCalledTimes(1);
    ctx.cleanup();
  });

  it("no longer renders Save as preset (R13 user decree: top-right keeps only Remove + Save)", async () => {
    agentStore.view = baseView([
      { provider: "my-relay", baseURL: "https://r.example/v1", models: [{ id: "m1" }] },
    ]);
    const ctx = mountTab({
      provider: "my-relay",
      baseURL: "https://r.example/v1",
      models: [{ id: "m1" }],
    });
    expect(ctx.buttonByText("Save as preset")).toBeUndefined();
    expect(ctx.target.textContent).not.toContain("Save as preset");
    ctx.cleanup();
  });
});

describe("RouteTabContent title-row actions (R14-A2)", () => {
  it("renders Remove and Save inside the identity title row, on the same line as name/meta", () => {
    agentStore.view = baseView([
      { provider: "my-relay", baseURL: "https://r.example/v1", models: [{ id: "m1" }] },
    ]);
    const ctx = mountTab({
      provider: "my-relay",
      baseURL: "https://r.example/v1",
      models: [{ id: "m1" }],
    });
    const titlebar = ctx.target.querySelector<HTMLElement>("[data-route-titlebar]")!;
    expect(titlebar).not.toBeNull();
    // 动作按钮与 displayName/meta 同一容器行（R14-A2 核心断言）。
    expect(ctx.saveButton().closest("[data-route-titlebar]")).toBe(titlebar);
    expect(ctx.removeRouteButton().closest("[data-route-titlebar]")).toBe(titlebar);
    const nameP = [...titlebar.querySelectorAll("p")].find(
      (p) => p.textContent?.trim() === "my-relay",
    )!;
    expect(nameP).toBeTruthy();
    expect(nameP.closest("[data-route-titlebar]")).toBe(titlebar);
    // 独立动作行不复存在：标题行位于首块（与 IconPicker 同块），其上没有仅含
    // 动作按钮的行。
    const root = ctx.target.firstElementChild!;
    const firstBlock = root.firstElementChild!;
    expect(firstBlock.contains(titlebar)).toBe(true);
    expect(firstBlock.querySelector('button[aria-label^="Icon picker stub"]')).not.toBeNull();
    // 命中区几何沿用 R12：Remove 的 after:-inset-2 与 Save 的纵向外扩 +
    // gap-2.5 互不相交（这里以类名存在性钉住，防止回归时被顺手删掉）。
    expect(ctx.removeRouteButton().className).toContain("after:-inset-2");
    expect(ctx.saveButton().className).toContain("after:-top-1");
    expect(ctx.saveButton().closest(".gap-2\\.5")).not.toBeNull();
    ctx.cleanup();
  });
});

describe("RouteTabContent Add model scrollIntoView (R12-A3)", () => {
  it("scrolls the newly added entry into view with nearest + smooth", async () => {
    // jsdom 未实现 scrollIntoView：以原型 spy 钉住调用参数（类型层存在、运行时
    // undefined，捕获原值以便还原）。
    const original = HTMLElement.prototype.scrollIntoView;
    const spy = vi.fn((_options?: ScrollIntoViewOptions) => undefined);
    HTMLElement.prototype.scrollIntoView = spy;
    try {
      agentStore.view = baseView([
        {
          provider: "my-relay",
          baseURL: "https://r.example/v1",
          models: Array.from({ length: 12 }, (_, i) => ({ id: `m${i}` })),
        },
      ]);
      const ctx = mountTab({
        provider: "my-relay",
        baseURL: "https://r.example/v1",
        models: Array.from({ length: 12 }, (_, i) => ({ id: `m${i}` })),
      });
      ctx.buttonByText("+ Add model").click();
      await vi.waitFor(() => expect(spy).toHaveBeenCalled());
      expect(spy).toHaveBeenCalledWith({ block: "nearest", behavior: "smooth" });
      // 新条目挂载即展开（空 id 的 Model id 输入存在）。
      expect(ctx.target.querySelector('input[aria-label="Model id"]')).not.toBeNull();
      ctx.cleanup();
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });
});

describe("RouteTabContent Active model block removed (R12-A4)", () => {
  afterEach(() => {
    agentStore.view = null;
  });

  it("renders no Active model controls for the active route", () => {
    const routes = [
      { provider: "my-relay", baseURL: "https://r.example/v1", models: [{ id: "m1" }] },
    ];
    agentStore.view = baseView(routes, { provider: "my-relay", model: "m1" });
    const ctx = mountTab(routes[0] as Record<string, unknown>, agentStore.view as never);
    expect(ctx.target.querySelector('section[aria-label="Active model"]')).toBeNull();
    expect(ctx.selectByLabel("Model") ?? null).toBeNull();
    expect(ctx.target.querySelector('input[aria-label="Reasoning effort"]')).toBeNull();
    ctx.cleanup();
  });

  it("renders no Set active / Use controls for a non-active route", () => {
    const routes = [
      { provider: "my-relay", baseURL: "https://r.example/v1", models: [{ id: "m1" }] },
    ];
    agentStore.view = baseView(routes, { provider: "openai", model: "gpt-4o" });
    const ctx = mountTab(routes[0] as Record<string, unknown>, agentStore.view as never);
    expect(ctx.target.querySelector('section[aria-label="Active model"]')).toBeNull();
    expect(
      [...ctx.target.querySelectorAll("button")].map((b) => b.textContent?.trim()),
    ).not.toContain("Set active");
    expect(
      [...ctx.target.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Use"),
    ).toBe(false);
    ctx.cleanup();
  });
});

describe("RouteTabContent persistent credential input (R12-A5)", () => {
  afterEach(() => {
    agentStore.view = null;
  });

  it("renders a permanent password input with eye toggle; blur saves the key", async () => {
    agentStore.view = baseView([
      { provider: "my-relay", baseURL: "https://r.example/v1", models: [{ id: "m1" }] },
    ]);
    const ctx = mountTab({
      provider: "my-relay",
      baseURL: "https://r.example/v1",
      models: [{ id: "m1" }],
    });
    // 常驻 password 输入（无展开 pill 流程）；未配置占位 "API key"。
    const input = ctx.keyInput();
    expect(input.type).toBe("password");
    expect(input.placeholder).toBe("API key");
    // R16：状态 chip 已删（key 客观回显）；Credential 区位于 Endpoint 之后。
    const sections = [...ctx.target.querySelectorAll("section[aria-label]")].map((el) =>
      el.getAttribute("aria-label"),
    );
    expect(sections.indexOf("Endpoint")).toBeGreaterThan(-1);
    expect(sections.indexOf("Credential")).toBeGreaterThan(sections.indexOf("Endpoint"));

    // eye 切 type（只控制新输入的可见性）。
    const eye = ctx.eyeButton();
    expect(eye.getAttribute("aria-pressed")).toBe("false");
    eye.click();
    flushSync();
    expect(input.type).toBe("text");
    expect(ctx.eyeButton().getAttribute("aria-pressed")).toBe("true");
    ctx.eyeButton().click();
    flushSync();
    expect(input.type).toBe("password");

    // 输入 + 失焦 → setAgentCredential（provider + 新值）；R13：保存后值保留（掩码）。
    agentStore.setAgentCredential.mockReset();
    agentStore.setAgentCredential.mockResolvedValue({ outcome: "stored" });
    typeValue(input, "sk-test-1");
    blurEl(input);
    await vi.waitFor(() => expect(agentStore.setAgentCredential).toHaveBeenCalled());
    expect(agentStore.setAgentCredential).toHaveBeenCalledWith("my-relay", "sk-test-1");
    expect(input.value).toBe("sk-test-1");
    ctx.cleanup();
  });

  it("saves on Enter and ignores empty blur", async () => {
    agentStore.view = baseView([
      { provider: "my-relay", baseURL: "https://r.example/v1", models: [{ id: "m1" }] },
    ]);
    const ctx = mountTab({
      provider: "my-relay",
      baseURL: "https://r.example/v1",
      models: [{ id: "m1" }],
    });
    agentStore.setAgentCredential.mockReset();
    agentStore.setAgentCredential.mockResolvedValue({ outcome: "stored" });
    const input = ctx.keyInput();
    // 空 blur：no-op。
    blurEl(input);
    expect(agentStore.setAgentCredential).not.toHaveBeenCalled();
    // Enter：保存。
    typeValue(input, "sk-enter-1");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    flushSync();
    await vi.waitFor(() =>
      expect(agentStore.setAgentCredential).toHaveBeenCalledWith("my-relay", "sk-enter-1"),
    );
    ctx.cleanup();
  });

  it("focuses the key input on mount for the new-route guidance (bind:ref 回流)", () => {
    agentStore.view = baseView([
      { provider: "my-relay", baseURL: "https://r.example/v1", models: [{ id: "m1" }] },
    ]);
    const onCredentialFocused = vi.fn();
    const target = document.createElement("div");
    document.body.appendChild(target);
    const instance = mount(RouteTabContent, {
      target,
      props: {
        route: {
          provider: "my-relay",
          baseURL: "https://r.example/v1",
          models: [{ id: "m1" }],
        } as never,
        catalog: CATALOG as never,
        autoFocusCredential: true,
        onCredentialFocused,
      },
    });
    flushSync();
    const input = target.querySelector<HTMLInputElement>('input[aria-label="API key"]')!;
    // bind:ref 生效：挂载后输入框即获得焦点（单向 ref 传递会让 credInput 恒 null）。
    expect(input).toBe(document.activeElement);
    expect(onCredentialFocused).toHaveBeenCalled();
    // 新建引导 hint 可见。
    expect(target.textContent).toContain("paste its API key");
    unmount(instance);
    target.remove();
  });

  it("shows the stored placeholder without echoing the value; replace + Clear semantics", async () => {
    const routes = [
      { provider: "my-relay", baseURL: "https://r.example/v1", models: [{ id: "m1" }] },
    ];
    agentStore.view = baseView(routes, { provider: "openai", model: "gpt-4o" }, [
      { provider: "my-relay", configured: true, apiKey: "sk-stored-9" },
    ]);
    const ctx = mountTab(routes[0] as Record<string, unknown>, agentStore.view as never);
    const input = ctx.keyInput();
    // R16 用户裁决：已存 key 客观回显（password 掩码）。
    expect(input.type).toBe("password");
    expect(input.value).toBe("sk-stored-9");

    // 输入新 key + Enter → 替换（同一 setAgentCredential 旁路）。
    agentStore.setAgentCredential.mockReset();
    agentStore.setAgentCredential.mockResolvedValue({ outcome: "stored" });
    typeValue(input, "sk-replace-1");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    flushSync();
    await vi.waitFor(() =>
      expect(agentStore.setAgentCredential).toHaveBeenCalledWith("my-relay", "sk-replace-1"),
    );
    // R13：blur/Enter 保存后输入值保留（掩码展示；用户裁决不清空）。
    expect(input.value).toBe("sk-replace-1");

    // Clear 旁路保留：同时清空草稿文本。
    agentStore.clearAgentCredential.mockReset();
    agentStore.clearAgentCredential.mockResolvedValue(undefined);
    ctx.buttonByText("Clear").click();
    flushSync();
    await vi.waitFor(() =>
      expect(agentStore.clearAgentCredential).toHaveBeenCalledWith("my-relay"),
    );
    await vi.waitFor(() => expect(input.value).toBe(""));
    ctx.cleanup();
  });
});

describe("credential save vs Clear ordering (codex R13 probe)", () => {
  it("a pending blur-save followed by Clear ends with the credential cleared and the draft empty", async () => {
    const routes = [
      { provider: "my-relay", baseURL: "https://r.example/v1", models: [{ id: "m1" }] },
    ];
    agentStore.view = baseView(routes, undefined, [
      { provider: "my-relay", configured: true, apiKey: null },
    ]);
    // 慢保存：blur 发起的 setAgentCredential 挂起期间点 Clear。
    let releaseSave: (() => void) | null = null;
    agentStore.setAgentCredential.mockReset();
    agentStore.setAgentCredential.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseSave = () => resolve({ outcome: "stored" });
        }),
    );
    agentStore.clearAgentCredential.mockReset();
    agentStore.clearAgentCredential.mockResolvedValue(undefined);
    const ctx = mountTab(routes[0] as Record<string, unknown>, agentStore.view as never);
    const input = ctx.keyInput();
    typeValue(input, "sk-race-1");
    input.dispatchEvent(new Event("blur"));
    // blur 保存挂起中点 Clear：草稿立即清空，clear 旁路发出。
    ctx.buttonByText("Clear").click();
    flushSync();
    expect(agentStore.clearAgentCredential).toHaveBeenCalledWith("my-relay");
    // Clear 的草稿清空在 await clear 之后——有界等待。
    await vi.waitFor(() => expect(input.value).toBe(""));
    // 释放迟到的保存：值已被清、不再回填（save 成功只影响存储态，不回写草稿）。
    (releaseSave as (() => void) | null)?.();
    await vi.waitFor(() => expect(agentStore.setAgentCredential).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();
    expect(input.value).toBe("");
    ctx.cleanup();
  });
});
