// @vitest-environment jsdom
/**
 * i18n 基建测试（webui-i18n-bilingual task 1.3）。
 *
 * 用户原始需求 [2026-10-03]（Owner 裁决）：「WebUI 做中英双语（i18n）」。
 *
 * 正交意图：
 *   [1] 词典齐全性：en/zh key 集合相等（类型层之外的双保险）。
 *   [2] 插值：{param} 替换；未提供占位符保留原样。
 *   [3] locale 生命周期：默认 en、setLocale 持久化 DevicePrefs.language、
 *       document.documentElement.lang 同步、不兼容持久值回退默认。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { en } from "../catalogs/en.js";
import { zh } from "../catalogs/zh.js";
import { __resetLocaleForTests, currentLocale, setLocale, t } from "../locale.svelte.js";
import { DevicePrefsSchema, readDevicePrefs } from "$lib/shell/device-prefs.js";

beforeEach(() => {
  localStorage.clear();
  __resetLocaleForTests();
});

describe("i18n catalogs (webui-i18n-bilingual)", () => {
  it("keeps en and zh key sets identical", () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  });

  it("keeps every en value a non-empty string", () => {
    for (const [key, value] of Object.entries(en)) {
      expect(value.length, key).toBeGreaterThan(0);
    }
  });
});

describe("t() interpolation", () => {
  it("substitutes provided params", () => {
    expect(t("wikiScope.toastAdded", { title: "Pin exit codes" })).toBe(
      "Added “Pin exit codes” to the wiki.",
    );
  });

  it("keeps unsubstituted placeholders verbatim (visible defect, no swallowing)", () => {
    expect(t("wikiScope.noMatch")).toBe("No fragments match “{query}”.");
  });

  it("returns the en literal verbatim under the default locale", () => {
    expect(t("wikiScope.noMatch")).toBe("No fragments match “{query}”.");
  });
});

describe("locale lifecycle", () => {
  it("defaults to en and syncs document.lang", () => {
    expect(currentLocale()).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });

  it("switches to zh at runtime: t() flips, DevicePrefs persists, document.lang syncs", () => {
    setLocale("zh");
    expect(currentLocale()).toBe("zh");
    expect(t("wikiScope.noMatch")).toContain("没有匹配");
    expect(readDevicePrefs().language).toBe("zh");
    expect(document.documentElement.lang).toBe("zh");
  });

  it("restores the persisted language from DevicePrefs storage", () => {
    localStorage.setItem(
      "skill-creator:device-prefs",
      JSON.stringify({ version: 1, theme: "dark", sidebarCollapsed: false, language: "zh" }),
    );
    // schema 直接读：locale store 的恢复路径就是 readDevicePrefs().language
    expect(readDevicePrefs().language).toBe("zh");
    expect(DevicePrefsSchema.safeParse({ version: 1 }).success).toBe(true);
  });

  it("falls back to the en default for incompatible persisted language values", () => {
    localStorage.setItem(
      "skill-creator:device-prefs",
      JSON.stringify({ version: 1, theme: "dark", sidebarCollapsed: false, language: "fr" }),
    );
    expect(readDevicePrefs().language).toBe("en");
  });
});
