/**
 * 用户原始需求 [2026-10-03]（Owner 裁决）：「WebUI 做中英双语（i18n）」。
 * 正交意图：
 *   [1] locale 真相：$state 单例（默认 en）+ DevicePrefs.language 持久化 +
 *       document.documentElement.lang 同步（appearance store 同初始化模式）。
 *   [2] t() 消费面：key 类型 = keyof en（en 为事实源）；{param} 插值；模板/
 *       $derived 内读取 locale 即追踪（动态切换不刷新）。
 */
import { en, type MessageKey } from "./catalogs/en.js";
import { zh } from "./catalogs/zh.js";
import { readDevicePrefs, updateDevicePrefs } from "$lib/shell/device-prefs.js";

/** 支持的 UI 语言。 */
export type Locale = "en" | "zh";
export type { MessageKey } from "./catalogs/en.js";

const catalogs: Record<Locale, Record<MessageKey, string>> = { en, zh };

/** 占位符插值：{name} 替换为 params 值；未提供的占位符保留原样（可检测缺陷）。 */
function interpolate(template: string, params?: Readonly<Record<string, string | number>>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}

/** locale 单例：模块加载时从 DevicePrefs 恢复（appearance store 同模式）。 */
let locale = $state<Locale>(readDevicePrefs().language);

/** document.lang 同步（a11y：屏幕阅读器/翻译锚定正确语言）。 */
function applyDocumentLanguage(): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
}

applyDocumentLanguage();

/** 当前 locale（响应式读：模板/$derived 内调用即建立追踪）。 */
export function currentLocale(): Locale {
  return locale;
}

/** 切换 locale：立即生效（细粒度更新）+ DevicePrefs 持久化 + document.lang。 */
export function setLocale(next: Locale): void {
  locale = next;
  updateDevicePrefs({ language: next });
  applyDocumentLanguage();
}

/** 测试复位口：只还原运行时态，不写持久化。 */
export function __resetLocaleForTests(): void {
  locale = "en";
  applyDocumentLanguage();
}

/**
 * 取词典消息。en 值与现网英文逐字节一致是硬门（组件测试/冒烟锚点依赖）；
 * 类型层保证 key 存在，运行时防御性回退 en（未来动态词典加载的兜底位）。
 */
export function t(key: MessageKey, params?: Readonly<Record<string, string | number>>): string {
  const template = catalogs[locale][key] ?? en[key] ?? key;
  return interpolate(template, params);
}
