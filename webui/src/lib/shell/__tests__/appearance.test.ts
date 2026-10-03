// @vitest-environment jsdom
/**
 * 外观偏好 store 测试（shell-settings-ui Ch6 task 1）。
 *
 * 用户原始需求 [2026-07-27]：「前端 Storage 只能用来存储与设备有关的一些偏好，
 * 比如 Theme」——DevicePrefs 首次获得消费者。
 *
 * 正交意图：
 *   [1] theme 生效：setAppearanceTheme 立即切换 documentElement 的 .dark 类
 *       并持久化到 localStorage（DevicePrefs 单源）。
 *   [2] 侧栏折叠：toggleAppearanceSidebar 翻转响应式 getter + 持久化。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  appearanceSidebarCollapsed,
  appearanceTheme,
  setAppearanceTheme,
  toggleAppearanceSidebar,
} from "../appearance.svelte";
import { readDevicePrefs, updateDevicePrefs } from "../device-prefs";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  setAppearanceTheme("system");
});

describe("appearance store (shell-settings-ui)", () => {
  it("applies and persists the dark theme immediately", () => {
    setAppearanceTheme("dark");
    expect(appearanceTheme()).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(readDevicePrefs().theme).toBe("dark");
  });

  it("removes the dark class on light and persists the preference", () => {
    setAppearanceTheme("dark");
    setAppearanceTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(readDevicePrefs().theme).toBe("light");
  });

  it("toggles and persists the sidebar collapsed preference", () => {
    expect(appearanceSidebarCollapsed()).toBe(false);
    toggleAppearanceSidebar();
    expect(appearanceSidebarCollapsed()).toBe(true);
    expect(readDevicePrefs().sidebarCollapsed).toBe(true);
    toggleAppearanceSidebar();
    expect(readDevicePrefs().sidebarCollapsed).toBe(false);
  });

  it("persists the language preference and defaults legacy payloads to en (webui-i18n-bilingual)", () => {
    updateDevicePrefs({ language: "zh" });
    expect(readDevicePrefs().language).toBe("zh");
    // 旧 v1 存量（无 language 字段）：带默认值加法——safeParse 通过并回落 en。
    localStorage.setItem(
      "skill-creator:device-prefs",
      JSON.stringify({ version: 1, theme: "dark", sidebarCollapsed: true }),
    );
    expect(readDevicePrefs().language).toBe("en");
    updateDevicePrefs({ language: "en" });
  });
});
