// @vitest-environment jsdom
/**
 * NewRouteTab 组件测试（Track B1 复现 + B7 contextWindow + R7 8.4/8.5/8.6/8.7）。
 * 用户原始需求 [2026-09-12]：「Custom route 表单里输入 `gpt-test` 按 Enter 不生成
 * chip，Add route 持续 disabled」；「catalog 卡片选取路径持久化 models 时带上
 * contextWindow」；「已添加的 provider 可继续添加：slug zai → zai-2，label (1)」；
 * 「api 是 Select（DSH_ROUTE_API_PROTOCOLS）」；「模型补全 = 全供应商并集」。
 * 正交意图：
 *   [1] B1 端到端：form 态填 name/baseURL 后，Add model + Model id 输入
 *       gpt-test → Add route 解禁并提交。
 *   [2] B7：seed 路径 models 携带目录 contextWindow；手输路径保持裸 {id}。
 *   [3] R7 8.4：目录卡 Added 后不 disabled；连续两次添加 slug 序列为
 *       zai → zai-2（apiKeyEnv 由 daemon 侧按 slug 派生，不在此断言）。
 *   [4] preset 应用（codex R7 B3 追加）：iconSuppressed: true 的 preset 同路
 *       进新建路由；字段缺省不写入该键。
 */
import { describe, expect, it, vi } from "vitest";

const agentStore = vi.hoisted(() => ({
  updating: false,
  view: null as unknown,
  updateAgentSettings: vi.fn(),
  testRouteConnection: vi.fn(),
}));

vi.mock("../stores/agent.svelte", () => ({
  agentRuntimeConfig: agentStore,
  updateAgentSettings: agentStore.updateAgentSettings,
  testRouteConnection: agentStore.testRouteConnection,
}));

const presetStore = vi.hoisted(() => ({ list: [] as Array<Record<string, unknown>> }));

vi.mock("../stores/provider-presets.svelte", () => ({
  providerPresets: presetStore,
  loadProviderPresets: () => Promise.resolve(),
  deleteProviderPreset: () => {},
}));

// IconPicker 经 @lucide/svelte 引入 node_modules 的 .svelte 图标（root vitest
// 管线不编译）——以同签名 stub 替换，不参与被测交互。
vi.mock("../components/settings/IconPicker.svelte", async () => {
  const { default: stub } = await import("./stubs/icon-picker-stub.svelte");
  return { default: stub };
});

import NewRouteTab from "../components/settings/NewRouteTab.svelte";
import { flushSync, mount, unmount } from "./svelte-client";
import { DSH_ROUTE_API_PROTOCOLS } from "$shared/contracts/dsh-runtime.js";
import type { DshStewardSettingsView } from "$shared/contracts/dsh-runtime.js";

function baseView(routes: unknown[] = []): DshStewardSettingsView {
  return {
    settings: {
      configVersion: 1,
      revision: 0,
      model: { provider: "openai", model: "gpt-4o" },
      preset: "live",
      permissions: { approvalPolicy: "ask" },
      session: { streamRetention: 50, streamProjection: "enabled" },
      defaultMode: "free",
      modelRoutes: routes as DshStewardSettingsView["settings"]["modelRoutes"],
    },
    providers: [],
  };
}

const CATALOG = [
  {
    provider: "zai",
    label: "Z.ai",
    api: "openai-completions",
    baseURL: "https://api.z.ai/api/paas/v4",
    icon: null,
    models: [
      { id: "glm-4.7", name: "GLM 4.7", image: true, contextWindow: 200000 },
      { id: "glm-4.7-flash", name: "GLM 4.7 Flash", image: false },
    ],
  },
  {
    provider: "deepseek",
    label: "DeepSeek",
    api: "openai-completions",
    baseURL: "https://api.deepseek.com/v1",
    icon: null,
    models: [{ id: "deepseek-chat", image: false }],
  },
];

function mountTab(options: {
  catalog?: unknown[];
  initialMode?: "pick" | "form";
  seed?: { provider: string; models?: string[] } | null;
}) {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const instance = mount(NewRouteTab, {
    target,
    props: {
      catalog: options.catalog ? { providers: options.catalog } : null,
      catalogError: null,
      catalogLoading: false,
      initialMode: options.initialMode ?? "form",
      seed: options.seed ?? null,
      onadded: vi.fn(),
    },
  });
  flushSync();
  return {
    target,
    inputByLabel: (label: string) =>
      target.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!,
    selectByLabel: (label: string) =>
      target.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!,
    buttonByText: (text: string) =>
      [...target.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!,
    cardByLabel: (label: string) =>
      [...target.querySelectorAll("button")]
        .filter((b) => b.querySelector("span.text-xs.font-medium")?.textContent === label)
        .find((b) => b.closest(".grid"))!,
    cleanup: () => {
      unmount(instance);
      target.remove();
    },
  };
}

function typeValue(input: HTMLInputElement | HTMLSelectElement, value: string): void {
  input.value = value;
  input.dispatchEvent(
    new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
  );
  flushSync();
}

function pressKey(el: HTMLElement, key: string): void {
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  flushSync();
}

describe("NewRouteTab (B1 e2e + B7 + R7)", () => {
  it("hand-typed model via ModelListItem enables Add route (B1)", async () => {
    agentStore.view = baseView();
    agentStore.updating = false;
    agentStore.updateAgentSettings.mockReset();
    const ctx = mountTab({});

    typeValue(ctx.inputByLabel("Route name"), "my-relay");
    typeValue(ctx.inputByLabel("Base URL"), "https://api.example.com/v1");
    ctx.inputByLabel("Base URL").dispatchEvent(new Event("blur", { bubbles: true }));
    flushSync();
    expect(ctx.buttonByText("Add route").disabled).toBe(true);

    ctx.buttonByText("+ Add model").click();
    flushSync();
    typeValue(ctx.inputByLabel("Model id"), "gpt-test");
    expect(ctx.buttonByText("Add route").disabled).toBe(false);

    ctx.buttonByText("Add route").click();
    flushSync();
    await vi.waitFor(() => expect(agentStore.updateAgentSettings).toHaveBeenCalledTimes(1));
    const patch = agentStore.updateAgentSettings.mock.calls[0]![0] as {
      modelRoutes: Array<{ provider: string; models: Array<{ id: string }> }>;
    };
    expect(patch.modelRoutes[0]!.provider).toBe("my-relay");
    expect(patch.modelRoutes[0]!.models).toEqual([{ id: "gpt-test" }]);
    ctx.cleanup();
  });

  it("seeded models persist catalog contextWindow (B7)", async () => {
    agentStore.view = baseView();
    agentStore.updating = false;
    agentStore.updateAgentSettings.mockReset();
    const ctx = mountTab({ catalog: CATALOG, seed: { provider: "zai", models: ["glm-4.7"] } });

    typeValue(ctx.inputByLabel("Base URL"), "https://api.z.ai/api/paas/v4");
    // 第二个模型走 + Add model（seed 条目已有一个）。
    ctx.buttonByText("+ Add model").click();
    flushSync();
    const idInputs = [
      ...ctx.target.querySelectorAll<HTMLInputElement>('input[aria-label="Model id"]'),
    ];
    expect(idInputs.length).toBe(2);
    typeValue(idInputs[1]!, "glm-4.7-flash");
    ctx.buttonByText("Add route").click();
    flushSync();
    await vi.waitFor(() => expect(agentStore.updateAgentSettings).toHaveBeenCalledTimes(1));
    const patch = agentStore.updateAgentSettings.mock.calls[0]![0] as {
      modelRoutes: Array<{ models: Array<{ id: string; contextWindow?: number }> }>;
    };
    // 第二条：手输已知目录 id → 预填 name/inputTypes（R7 8.7 选中即预填语义）。
    expect(patch.modelRoutes[0]!.models).toEqual([
      { id: "glm-4.7", contextWindow: 200000 },
      { id: "glm-4.7-flash", name: "GLM 4.7 Flash", inputTypes: ["text"] },
    ]);
    ctx.cleanup();
  });

  it("api protocol is a Select over DSH_ROUTE_API_PROTOCOLS (R7 8.6)", () => {
    agentStore.view = baseView();
    agentStore.updating = false;
    const ctx = mountTab({});
    const select = ctx.selectByLabel("API protocol");
    expect([...select.options].map((option) => option.value)).toEqual([...DSH_ROUTE_API_PROTOCOLS]);
    expect(select.value).toBe("anthropic-messages");
    ctx.cleanup();
  });

  it("model id completion pool = union of all providers (R7 8.5)", () => {
    agentStore.view = baseView();
    agentStore.updating = false;
    const ctx = mountTab({ catalog: CATALOG });
    ctx.buttonByText("+ Add model").click();
    flushSync();
    const datalist = ctx.target.querySelector("datalist");
    expect(datalist).not.toBeNull();
    const ids = [...datalist!.querySelectorAll("option")].map((option) => option.value);
    expect(ids).toEqual(["deepseek-chat", "glm-4.7", "glm-4.7-flash"]);
    ctx.cleanup();
  });

  it("re-adding an added provider numbers the slug: zai → zai-2 (R7 8.4)", async () => {
    agentStore.view = baseView();
    agentStore.updating = false;
    agentStore.updateAgentSettings.mockReset();
    const ctx = mountTab({ catalog: CATALOG, initialMode: "pick" });

    const card = ctx.cardByLabel("Z.ai");
    expect(card.disabled).toBe(false);
    card.click();
    flushSync();

    // 第一次：slug 原名，预填目录 api/baseURL/top-4 模型（含 contextWindow）。
    expect(ctx.inputByLabel("Route name").value).toBe("zai");
    expect(ctx.selectByLabel("API protocol").value).toBe("openai-completions");
    ctx.buttonByText("Add route").click();
    flushSync();
    await vi.waitFor(() => expect(agentStore.updateAgentSettings).toHaveBeenCalledTimes(1));
    const first = agentStore.updateAgentSettings.mock.calls[0]![0] as {
      modelRoutes: Array<{
        provider: string;
        models: Array<{ id: string; contextWindow?: number }>;
      }>;
    };
    expect(first.modelRoutes[0]!.provider).toBe("zai");
    expect(first.modelRoutes[0]!.models).toEqual([
      { id: "glm-4.7", contextWindow: 200000 },
      { id: "glm-4.7-flash" },
    ]);

    // 模拟 daemon 落库（mock store 非响应式——重挂载拾取新 view）。
    const firstRoutes = first.modelRoutes;
    ctx.cleanup();
    agentStore.view = baseView(firstRoutes);
    const ctx2 = mountTab({ catalog: CATALOG, initialMode: "pick" });
    const cardAgain = ctx2.cardByLabel("Z.ai");
    expect(cardAgain.disabled).toBe(false);
    expect(cardAgain.textContent).toContain("Added ✓");
    cardAgain.click();
    flushSync();
    expect(ctx2.inputByLabel("Route name").value).toBe("zai-2");
    ctx2.buttonByText("Add route").click();
    flushSync();
    await vi.waitFor(() => expect(agentStore.updateAgentSettings).toHaveBeenCalledTimes(2));
    const second = agentStore.updateAgentSettings.mock.calls[1]![0] as {
      modelRoutes: Array<{ provider: string }>;
    };
    expect(second.modelRoutes.map((route) => route.provider)).toEqual(["zai", "zai-2"]);
    ctx2.cleanup();
  });

  it("applies a preset's iconSuppressed through the new route (and omits it when absent)", async () => {
    presetStore.list = [
      {
        provider: "my-relay",
        label: "My Relay",
        baseURL: "https://relay.example/v1",
        models: ["m1"],
        iconSuppressed: true,
      },
    ];
    agentStore.view = baseView();
    agentStore.updating = false;
    agentStore.updateAgentSettings.mockReset();
    // catalog 非 null 才会渲染 pick 态画廊（Your presets 分组在内）。
    const ctx = mountTab({ catalog: [], initialMode: "pick" });
    ctx.cardByLabel("My Relay").click();
    flushSync();
    expect(ctx.inputByLabel("Route name").value).toBe("my-relay");
    ctx.buttonByText("Add route").click();
    flushSync();
    await vi.waitFor(() => expect(agentStore.updateAgentSettings).toHaveBeenCalledTimes(1));
    const suppressed = agentStore.updateAgentSettings.mock.calls[0]![0] as {
      modelRoutes: Array<Record<string, unknown>>;
    };
    expect(suppressed.modelRoutes[0]!.iconSuppressed).toBe(true);
    ctx.cleanup();

    // 无该字段的 preset 维持现状：不写入 iconSuppressed 键。
    presetStore.list = [
      {
        provider: "plain-preset",
        label: "Plain Preset",
        baseURL: "https://plain.example/v1",
        models: ["m1"],
      },
    ];
    agentStore.updateAgentSettings.mockReset();
    const ctx2 = mountTab({ catalog: [], initialMode: "pick" });
    ctx2.cardByLabel("Plain Preset").click();
    flushSync();
    ctx2.buttonByText("Add route").click();
    flushSync();
    await vi.waitFor(() => expect(agentStore.updateAgentSettings).toHaveBeenCalledTimes(1));
    const plain = agentStore.updateAgentSettings.mock.calls[0]![0] as {
      modelRoutes: Array<Record<string, unknown>>;
    };
    expect("iconSuppressed" in plain.modelRoutes[0]!).toBe(false);
    ctx2.cleanup();
    presetStore.list = [];
  });
});
