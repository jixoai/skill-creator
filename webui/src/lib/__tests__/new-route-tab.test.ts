// @vitest-environment jsdom
/**
 * NewRouteTab 组件测试（Track B1 复现 + B7 contextWindow 持久化回归）。
 * 用户原始需求 [2026-09-12]：「Custom route 表单里输入 `gpt-test` 按 Enter 不生成
 * chip，Add route 持续 disabled」；「catalog 卡片选取路径持久化 models 时带上
 * contextWindow」。
 * 正交意图：
 *   [1] B1 端到端复现：form 态填 name/baseURL 后，Models tags 输入 gpt-test +
 *       Enter → chip 渲染 + Add route 解禁。
 *   [2] B7：catalog 预填路径 addRoute 的 models 携带目录 contextWindow（若目录
 *       条目带该字段）；手输路径 contextWindow 保持 undefined。
 */
import { describe, expect, it, vi } from "vitest";

const agentStore = vi.hoisted(() => ({
  updating: false,
  view: null as unknown,
  updateAgentSettings: vi.fn(),
}));

vi.mock("../stores/agent.svelte", () => ({
  agentRuntimeConfig: agentStore,
  updateAgentSettings: agentStore.updateAgentSettings,
}));

vi.mock("../stores/provider-presets.svelte", () => ({
  providerPresets: { list: [] },
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
import type { DshStewardSettingsView } from "$shared/contracts/dsh-runtime.js";

function baseView(): DshStewardSettingsView {
  return {
    settings: {
      configVersion: 1,
      revision: 0,
      model: { provider: "openai", model: "gpt-4o" },
      preset: "live",
      permissions: { approvalPolicy: "ask" },
      session: { streamRetention: 50, streamProjection: "enabled" },
      defaultMode: "free",
      modelRoutes: [],
    },
    providers: [],
  };
}

function mountTab(
  catalogProviders: unknown[] = [],
  seed: { provider: string; models?: string[] } | null = null,
) {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const instance = mount(NewRouteTab, {
    target,
    props: {
      catalog: catalogProviders.length > 0 ? { providers: catalogProviders } : null,
      catalogError: null,
      catalogLoading: false,
      initialMode: "form",
      seed,
      onadded: vi.fn(),
    },
  });
  flushSync();
  return {
    target,
    inputByLabel: (label: string) =>
      target.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!,
    modelInput: () => target.querySelector<HTMLInputElement>('input[placeholder="Add model id…"]')!,
    chipTexts: () =>
      [...target.querySelectorAll("span.flex.items-center.gap-1")].map((n) =>
        (n.textContent ?? "").replace(/\s*×\s*$/, "").trim(),
      ),
    addRouteButton: () =>
      [...target.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Add route")!,
    cleanup: () => {
      unmount(instance);
      target.remove();
    },
  };
}

function typeValue(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
}

function pressKey(el: HTMLElement, key: string): void {
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  flushSync();
}

describe("NewRouteTab (B1 e2e + B7 contextWindow)", () => {
  it("hand-typed model + Enter renders the chip and enables Add route", async () => {
    agentStore.view = baseView();
    agentStore.updating = false;
    agentStore.updateAgentSettings.mockReset();
    const ctx = mountTab();

    typeValue(ctx.inputByLabel("Route name"), "my-relay");
    typeValue(ctx.inputByLabel("Base URL"), "https://api.example.com/v1");
    ctx.inputByLabel("Base URL").dispatchEvent(new Event("blur", { bubbles: true }));
    flushSync();
    expect(ctx.addRouteButton().disabled).toBe(true);

    const modelInput = ctx.modelInput();
    modelInput.focus();
    typeValue(modelInput, "gpt-test");
    pressKey(modelInput, "Enter");

    expect(ctx.chipTexts()).toContain("gpt-test");
    expect(modelInput.value).toBe("");
    expect(ctx.addRouteButton().disabled).toBe(false);

    ctx.addRouteButton().click();
    flushSync();
    await vi.waitFor(() => expect(agentStore.updateAgentSettings).toHaveBeenCalledTimes(1));
    const patch = agentStore.updateAgentSettings.mock.calls[0]![0] as {
      modelRoutes: Array<{
        provider: string;
        models: Array<{ id: string; contextWindow?: number }>;
      }>;
    };
    expect(patch.modelRoutes[0]!.models).toEqual([{ id: "gpt-test" }]);
    ctx.cleanup();
  });

  it("catalog-seeded models persist contextWindow when the catalog entry carries it (B7)", async () => {
    agentStore.view = baseView();
    agentStore.updating = false;
    agentStore.updateAgentSettings.mockReset();
    const ctx = mountTab(
      [
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
      ],
      { provider: "zai", models: ["glm-4.7"] },
    );

    typeValue(ctx.inputByLabel("Base URL"), "https://api.z.ai/api/paas/v4");
    const modelInput = ctx.modelInput();
    typeValue(modelInput, "glm-4.7-flash");
    pressKey(modelInput, "Enter");

    ctx.addRouteButton().click();
    flushSync();
    await vi.waitFor(() => expect(agentStore.updateAgentSettings).toHaveBeenCalledTimes(1));
    const patch = agentStore.updateAgentSettings.mock.calls[0]![0] as {
      modelRoutes: Array<{
        provider: string;
        models: Array<{ id: string; contextWindow?: number }>;
      }>;
    };
    expect(patch.modelRoutes[0]!.provider).toBe("zai");
    expect(patch.modelRoutes[0]!.models).toEqual([
      { id: "glm-4.7", contextWindow: 200000 },
      { id: "glm-4.7-flash" },
    ]);
    ctx.cleanup();
  });
});
