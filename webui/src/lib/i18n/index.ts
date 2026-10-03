/**
 * 用户原始需求 [2026-10-03]（Owner 裁决）：「WebUI 做中英双语（i18n）」。
 * 正交意图：
 *   [1] i18n 公共 API 汇总导出（组件统一从 `$lib/i18n` 消费；B/C 类后续接入同入口）。
 */

export { t, currentLocale, setLocale, __resetLocaleForTests } from "./locale.svelte.js";
export type { Locale, MessageKey } from "./locale.svelte.js";
