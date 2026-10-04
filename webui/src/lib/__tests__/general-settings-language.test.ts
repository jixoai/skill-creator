// @vitest-environment jsdom
/**
 * GeneralSettingsSection 语言切换控件测试（webui-i18n-bilingual task 4.2）。
 * 用户原始需求 [2026-10-03]（Owner 裁决）：「WebUI 做中英双语（i18n）」。
 * 正交意图：
 *   [1] segmented 渲染：General → Appearance 内 Language 行（English/中文 二段，
 *     role=group + aria-pressed），默认 locale=en 时 English 段 pressed。
 *   [2] 切换持久化：点「中文」→ setLocale 生效（t() 翻转、组件文案即时重渲染
 *     为 zh）+ DevicePrefs.language 持久化为 zh + document.lang 同步。
 *   [3] 回切：zh → en 恢复英文文案与持久化值。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Switch 走 bits-ui（node_modules .svelte 被 root vitest 外置）——同契约 stub。
vi.mock("$lib/components/ui/switch", async () => {
  const { default: stub } = await import("./stubs/switch-stub.svelte");
  return { Switch: stub };
});

vi.mock("@lucide/svelte/icons/plug-zap", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/plug", async () => await import("./stubs/lucide-icon-mocks.js"));

// 连接栈与本测试无关（只断言 Appearance 区）；mock 掉避免拉入 RPC client 全家桶。
vi.mock("../store.svelte", () => ({
  connectionState: { status: "idle", error: null },
}));

import GeneralSettingsSection from "$lib/components/settings/GeneralSettingsSection.svelte";
import { flushSync, mount, unmount } from "./svelte-client";
import { __resetLocaleForTests, currentLocale, t } from "$lib/i18n";
import { readDevicePrefs } from "$lib/shell/device-prefs.js";

function mountSection() {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const instance = mount(GeneralSettingsSection, { target });
  flushSync();
  return {
    target,
    cleanup: () => {
      unmount(instance);
      target.remove();
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  __resetLocaleForTests();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("language segmented control (task 4.2)", () => {
  it("renders the Language row inside Appearance with English pressed by default", () => {
    const ctx = mountSection();
    const group = ctx.target.querySelector<HTMLElement>('[aria-label="Language preference"]');
    expect(group).not.toBeNull();
    const buttons = [...group!.querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(["English", "中文"]);
    const pressed = buttons.find((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed?.textContent?.trim()).toBe("English");
    // en 文案可见（Language 标签 + hint）。
    expect(ctx.target.textContent).toContain("Language");
    expect(ctx.target.textContent).toContain("Interface language; applies immediately.");
    ctx.cleanup();
  });

  it("switches to zh on click: t() flips, the section re-renders, and DevicePrefs persists", () => {
    const ctx = mountSection();
    const group = ctx.target.querySelector<HTMLElement>('[aria-label="Language preference"]')!;
    const zhButton = [...group.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent?.trim() === "中文",
    )!;
    zhButton.click();
    flushSync();

    expect(currentLocale()).toBe("zh");
    expect(readDevicePrefs().language).toBe("zh");
    expect(document.documentElement.lang).toBe("zh");
    // 细粒度更新：组件文案即时翻转为 zh（不再出现 en 标签）。
    expect(ctx.target.textContent).toContain("语言");
    expect(ctx.target.textContent).toContain("界面语言；立即生效。");
    expect(ctx.target.textContent).not.toContain("Interface language");
    // 分段状态翻转：中文 段 pressed。
    const pressed = [...group.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.getAttribute("aria-pressed") === "true",
    );
    expect(pressed?.textContent?.trim()).toBe("中文");
    ctx.cleanup();
  });

  it("switches back to en and restores the persisted preference", () => {
    const ctx = mountSection();
    const group = ctx.target.querySelector<HTMLElement>('[aria-label="Language preference"]')!;
    const byLabel = (label: string) =>
      [...group.querySelectorAll<HTMLButtonElement>("button")].find(
        (b) => b.textContent?.trim() === label,
      )!;
    byLabel("中文").click();
    flushSync();
    byLabel("English").click();
    flushSync();

    expect(currentLocale()).toBe("en");
    expect(readDevicePrefs().language).toBe("en");
    expect(t("settings.general.language")).toBe("Language");
    expect(ctx.target.textContent).toContain("Interface language; applies immediately.");
    ctx.cleanup();
  });
});
