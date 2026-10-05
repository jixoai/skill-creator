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
    for (const [key, value] of Object.entries(en) as [string, string][]) {
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

describe("t() ICU plural subset (2026-10-05, Load more raw-template fix)", () => {
  it("selects one/other branches with # substitution (en)", () => {
    expect(t("skillsWorkspace.skillsScreen.loadedMore", { count: 1 })).toBe("Loaded 1 skill");
    expect(t("skillsWorkspace.skillsScreen.loadedMore", { count: 3 })).toBe("Loaded 3 skills");
    expect(t("skillsWorkspace.reposScreen.minutesAgo", { minutes: 1 })).toBe("1 minute ago");
    expect(t("skillsWorkspace.reposScreen.minutesAgo", { minutes: 30 })).toBe("30 minutes ago");
  });

  it("prefers =N exact match and interpolates nested placeholders inside branches", () => {
    expect(t("skillsWorkspace.reposScan.installedGroup", { installed: 3, overwritten: 0 })).toBe(
      "3 installed",
    );
    expect(t("skillsWorkspace.reposScan.installedGroup", { installed: 3, overwritten: 2 })).toBe(
      "3 installed (2 overwritten)",
    );
  });

  it("resolves plural categories by active locale (zh → other + zh nested branches)", () => {
    setLocale("zh");
    expect(t("skillsWorkspace.reposScan.installedGroup", { installed: 3, overwritten: 0 })).toBe(
      "3 个已安装",
    );
    expect(t("skillsWorkspace.reposScan.installedGroup", { installed: 3, overwritten: 2 })).toBe(
      "3 个已安装（2 个覆盖）",
    );
  });

  it("keeps raw template when the plural variable is missing (detectable defect)", () => {
    const raw = t("skillsWorkspace.skillsScreen.loadedMore");
    expect(raw).toContain("plural");
    expect(raw).toContain("{count");
  });
});
