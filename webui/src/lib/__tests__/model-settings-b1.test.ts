// @vitest-environment jsdom
/**
 * NewRouteTab × 真 provider-presets store 回归（Track B1 根因）。
 * 用户原始需求 [2026-09-12]：「Custom route 表单里输入 gpt-test 按 Enter 不生成
 * chip，Add route 持续 disabled」——根因是 $effect 内调用 loadProviderPresets()
 * （同步写 + 读 providerPresets.list）触发 effect_update_depth_exceeded，组件
 * 僵死（点击/键盘无响应）。
 * 正交意图：
 *   [1] 挂载后外部写 presets（saveProviderPreset）不再引发 effect 循环僵尸：
 *       组件仍能响应交互（pick → form 切换可见）。
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

// IconPicker 经 @lucide/svelte 引入 node_modules 的 .svelte 图标（root vitest
// 管线不编译）——以同签名 stub 替换，不参与被测交互。
vi.mock("../components/settings/IconPicker.svelte", async () => {
  const { default: stub } = await import("./stubs/icon-picker-stub.svelte");
  return { default: stub };
});

// ModelListItem 的三个 icon-button（R10-2）同样经 @lucide/svelte 引入。
vi.mock("@lucide/svelte/icons/pencil", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/plug-zap", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/trash-2", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/eye", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/eye-off", async () => await import("./stubs/lucide-icon-mocks.js"));

import NewRouteTab from "../components/settings/NewRouteTab.svelte";
import {
  loadProviderPresets,
  PROVIDER_PRESETS_STORAGE_KEY,
  saveProviderPreset,
} from "../stores/provider-presets.svelte";
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
      session: { streamRetention: 50, streamProjection: "enabled", sessionCleanupDays: 30 },
      defaultMode: "free",
      modelRoutes: [],
    },
    providers: [],
  };
}

describe("NewRouteTab presets effect (B1 root cause)", () => {
  it("stays interactive after an external presets write (no effect loop)", async () => {
    localStorage.clear();
    agentStore.view = baseView();
    agentStore.updating = false;

    // 预置一条本地 preset（localStorage 有真实内容，readStoredPresets 非空）。
    loadProviderPresets();
    saveProviderPreset({
      provider: "relay-a",
      label: "Relay A",
      baseURL: "https://a.example.com/v1",
      models: ["m1"],
    });

    const target = document.createElement("div");
    document.body.appendChild(target);
    const instance = mount(NewRouteTab, {
      target,
      props: {
        catalog: null,
        catalogError: null,
        catalogLoading: false,
        initialMode: "pick",
        seed: null,
        onadded: vi.fn(),
      },
    });
    flushSync();

    // 外部写（等价另一处 Save as preset / delete）：旧实现里这是 effect 第二次
    // 运行的触发器——write-while-dep 持有 → effect_update_depth_exceeded。
    saveProviderPreset({
      provider: "relay-b",
      label: "Relay B",
      baseURL: "https://b.example.com/v1",
      models: ["m2"],
    });
    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();

    // 僵尸检验：Start from scratch 仍能进入 form 态（Route name 输入框可见）。
    const scratch = [...target.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Start from scratch"),
    );
    expect(scratch).toBeTruthy();
    scratch!.click();
    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();
    const nameInput = target.querySelector<HTMLInputElement>('input[aria-label="Route name"]');
    expect(nameInput).not.toBeNull();

    unmount(instance);
    target.remove();
    localStorage.removeItem(PROVIDER_PRESETS_STORAGE_KEY);
  });
});
