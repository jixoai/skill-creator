/**
 * 用户原始需求 [2026-09-25]（settings-panel-zcode-source Owner 裁决）：「目前的
 * settings 是一个 Dialog，放弃 Dialog，改成标准的页面面板。」
 * 正交意图：[1] 声明 Settings App 的 manifest（home = /settings 默认 General；
 * :section 子路由深链恢复——URL 即分区状态，与 Wiki 的 home/:wsId 双 activity 同形）。
 * 迁移注记：SettingsDialog（shell 级 Dialog）已删除，无双入口残留。
 */
import IconSettings from "@lucide/svelte/icons/settings";
import { defineApp, defineActivity, defineRoute, leafRoute } from "$lib/shell";
import { SETTINGS_SECTION_IDS } from "$lib/stores/settings-ui.svelte";
import { z } from "zod";

/** Settings App：全局设置页面面板（General / Model / Agent / Sessions 分区）。 */
export const settingsApp = defineApp({
  id: "settings",
  name: "Settings",
  icon: IconSettings,
  activities: [
    // home tab：/settings（无分区段 → General）
    defineActivity({
      pattern: "/settings",
      entry: true,
      root: leafRoute({
        id: "settings.home",
        component: () => import("./SettingsPage.svelte"),
      }),
    }),
    // 分区 tab：/settings/:section（zod enum 收窄；非法段渲染前重定向回入口）
    defineActivity({
      pattern: "/settings",
      root: defineRoute({
        id: "settings.section",
        pattern: ":section",
        params: z.object({ section: z.enum(SETTINGS_SECTION_IDS) }),
        component: () => import("./SettingsPage.svelte"),
      }),
    }),
  ],
});
