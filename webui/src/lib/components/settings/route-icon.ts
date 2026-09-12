/**
 * 路由图标/头像解析（redesign-model-tabs-and-agent-panel S1；R7 8.2 颜色与
 * Letter 分离重写）。
 *
 * 用户原始需求 [2026-09-12]：「图标三级回退：route.icon（覆盖）→ 目录图标
 * （catalog entry.icon）→ 字母头像」；「重构为三个独立控制：图标（含无图标）、
 * 图标/头像颜色（预设色板 + hex 输入，写 route.iconColor）、Letter 文字
 * （route.iconLetter，默认名称首字母，可直接编辑 1-2 字符）。」
 *
 * 正交意图：
 *   [1] 三级回退解析：resolveRouteIcon 单点收口（tab 条 / Identity / NewTab 共用）。
 *   [2] 字母头像投影：routeLetter/routeAvatarColor 把 iconLetter/iconColor 与
 *       缺省（首字母 / 确定性色相）统一成展示事实；旧版「色相选择生成 SVG
 *       dataURL 持久化进 route.icon」的机制已随三控制分离废弃（R7 8.2），
 *       isLetterAvatar 仅保留对历史持久化字母头像的 dark:invert 豁免识别。
 */
import type { DshModelRoute, ModelProviderCatalogEntry } from "$shared/contracts/dsh-runtime.js";

/** provider id → 确定性色相。 */
export function avatarHue(provider: string): number {
  let hash = 0;
  for (const ch of provider) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return hash;
}

/** 确定性色相的完整 CSS 背景（iconColor 缺省回退）。 */
export function hueAvatarColor(provider: string): string {
  return `hsl(${avatarHue(provider)} 55% 45%)`;
}

/** 生成字母头像的内部标记（data-* 属性，encodeURIComponent 后仍可子串识别）。 */
const LETTER_AVATAR_MARK = "sc-letter-avatar";

/** 是否为旧机制生成的字母头像（自有色底，不参与 dark:invert）。 */
export function isLetterAvatar(icon: string): boolean {
  return icon.includes(LETTER_AVATAR_MARK);
}

/**
 * 图标解析（codex R7 B3 语义修正）：iconSuppressed = true 时显式无图标（走
 * Letter 头像，抑制目录回退）；否则 route.icon 覆盖 → 目录图标 → null = UI 字母
 * 头像回退。三级回退与「无图标」成为可表达的四个状态。
 */
export function resolveRouteIcon(
  route: Pick<DshModelRoute, "icon" | "provider" | "iconSuppressed">,
  catalogEntry: ModelProviderCatalogEntry | undefined,
): string | null {
  if (route.iconSuppressed === true) return null;
  return route.icon ?? catalogEntry?.icon ?? null;
}

/**
 * 字母头像文字：route.iconLetter（用户可编辑 1-2 字符）→ 缺省展示名首字母。
 * iconLetter 为用户显式输入，原样返回（保留小写/双字符语义）；缺省路径取
 * fallbackLabel 首字符大写。
 */
export function routeLetter(
  route: Pick<DshModelRoute, "iconLetter" | "provider">,
  fallbackLabel: string,
): string {
  if (route.iconLetter !== undefined && route.iconLetter.length > 0) return route.iconLetter;
  return (fallbackLabel || route.provider).slice(0, 1).toUpperCase();
}

/** 字母头像底色：route.iconColor（CSS color）→ 缺省确定性色相。 */
export function routeAvatarColor(route: Pick<DshModelRoute, "iconColor" | "provider">): string {
  return route.iconColor ?? hueAvatarColor(route.provider);
}

/**
 * 按扩展名推断图标 MIME（R7 8.3 上传修复）：Figma/浏览器下载的 .svg 常见
 * File.type === ""，readAsDataURL 会产出非 image MIME 的 dataURL（<img> 拒绝
 * 渲染）；上传守卫按本表重写 dataURL 前缀。unknown 扩展返回 null。
 */
export const ICON_EXTENSION_MIME: Readonly<Record<string, string>> = {
  svg: "image/svg+xml",
  png: "image/png",
  webp: "image/webp",
};

/**
 * 重写 dataURL 的 MIME 段（payload 字节不变）：readAsDataURL 恒为 base64 形态，
 * 以首个逗号切分重建 `data:<mime>;base64,<payload>`。非 data: 前缀返回 null。
 */
export function withDataUrlMime(raw: string, mime: string): string | null {
  const comma = raw.indexOf(",");
  if (!raw.startsWith("data:") || comma < 0) return null;
  return `data:${mime};base64,${raw.slice(comma + 1)}`;
}
