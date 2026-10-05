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

/**
 * 占位符 + ICU plural 子集插值（2026-10-05，Owner 实测 Load more 反馈显示
 * 原始模板 `Loaded {count, plural, …}`——旧实现只有 {name} 简单替换）。
 * 支持：{name} 简单占位；{var, plural, =N {…} one {…} other {…}} 单层复数
 * （分支内 # = 数值；分支内可含嵌套 {var} 简单占位——语料无嵌套复数）。
 * 类别选择 = Intl.PluralRules(locale)（en: 1→one；zh: 恒 other）；=N 精确
 * 匹配优先。解析失败或参数缺失 → 原样保留（与简单占位同款可检测缺陷行为）。
 */
const PLURAL_SELECTOR = /^(=\d+|zero|one|two|few|many|other)\s*/;

/** 在 template[start]（必须为 "{"）处尝试解析 plural 段；非 plural 返回 null。 */
function tryParsePlural(
  template: string,
  start: number,
  params: Readonly<Record<string, string | number>> | undefined,
  locale: Locale,
): { text: string; end: number } | null {
  const header = /^\{(\w+),\s*plural,\s*/.exec(template.slice(start));
  if (!header) return null;
  const name = header[1] as string;
  let pos = start + header[0].length;
  const branches: Array<{ selector: string; text: string }> = [];
  while (template[pos] !== "}") {
    const selMatch = PLURAL_SELECTOR.exec(template.slice(pos));
    if (!selMatch) return null;
    const selector = selMatch[1] as string;
    pos += selMatch[0].length;
    if (template[pos] !== "{") return null;
    let depth = 1;
    let j = pos + 1;
    while (j < template.length && depth > 0) {
      if (template[j] === "{") depth++;
      else if (template[j] === "}") depth--;
      j++;
    }
    if (depth !== 0) return null;
    branches.push({ selector, text: template.slice(pos + 1, j - 1) });
    pos = j;
    while (template[pos] === " ") pos++;
  }
  const end = pos + 1;
  const raw = template.slice(start, end);
  const value = params?.[name];
  if (value === undefined) return { text: raw, end };
  const num = Number(value);
  if (!Number.isFinite(num)) return { text: raw, end };
  const branch =
    branches.find((b) => b.selector === `=${num}`) ??
    branches.find((b) => b.selector === new Intl.PluralRules(locale).select(num)) ??
    branches.find((b) => b.selector === "other");
  if (!branch) return { text: raw, end };
  const text = branch.text.replace(/#/g, String(num));
  return { text: interpolate(text, params, locale), end };
}

function interpolate(
  template: string,
  params?: Readonly<Record<string, string | number>>,
  locale: Locale = "en",
): string {
  if (!params) return template;
  let out = "";
  let i = 0;
  while (i < template.length) {
    const start = template.indexOf("{", i);
    if (start === -1) {
      out += template.slice(i);
      break;
    }
    out += template.slice(i, start);
    const plural = tryParsePlural(template, start, params, locale);
    if (plural) {
      out += plural.text;
      i = plural.end;
      continue;
    }
    const simple = /^(\w+)\}/.exec(template.slice(start + 1));
    if (simple && Object.hasOwn(params, simple[1] as string)) {
      out += String(params[simple[1] as string]);
      i = start + 1 + simple[0].length;
    } else {
      out += template[start] as string;
      i = start + 1;
    }
  }
  return out;
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
  return interpolate(template, params, locale);
}
