/**
 * 路由图标解析与字母头像（redesign-model-tabs-and-agent-panel S1）。
 *
 * 用户原始需求 [2026-09-12]：「图标三级回退：route.icon（覆盖）→ 目录图标
 * （catalog entry.icon）→ 字母头像（现有 avatarHue 确定性色相逻辑保留）。」
 *
 * 正交意图：
 *   [1] 三级回退解析：resolveRouteIcon 单点收口（tab 条 / Identity / NewTab 共用）。
 *   [2] 字母头像：确定性色相（沿用旧画廊实现）+ SVG dataURL 生成（IconPicker 的
 *       Letter 色相选择持久化为 route.icon）与生成物识别（自有色底，豁免
 *       dark:invert——目录图标是黑/白透明底才需要反色）。
 */
import type { DshModelRoute, ModelProviderCatalogEntry } from "$shared/contracts/dsh-runtime.js";

/** provider id → 确定性色相。 */
export function avatarHue(provider: string): number {
  let hash = 0;
  for (const ch of provider) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return hash;
}

/** 生成字母头像的内部标记（data-* 属性，encodeURIComponent 后仍可子串识别）。 */
const LETTER_AVATAR_MARK = "sc-letter-avatar";

/** 字母头像的 SVG dataURL（IconPicker Letter 色相选择的持久化形态）。 */
export function letterAvatarDataUrl(letter: string, hue: number): string {
  const text = letter
    .replace(/[<>&"']/g, "")
    .slice(0, 1)
    .toUpperCase();
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" data-${LETTER_AVATAR_MARK}="1">` +
    `<rect width="32" height="32" rx="6" fill="hsl(${hue} 55% 45%)"/>` +
    `<text x="16" y="21.5" font-family="ui-sans-serif, system-ui, sans-serif" font-size="14" ` +
    `font-weight="600" fill="#ffffff" text-anchor="middle">${text}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** 是否为本模块生成的字母头像（自有色底，不参与 dark:invert）。 */
export function isLetterAvatar(icon: string): boolean {
  return icon.includes(LETTER_AVATAR_MARK);
}

/** 三级回退第 1-2 级：route.icon 覆盖 → 目录图标；null = UI 字母头像回退。 */
export function resolveRouteIcon(
  route: Pick<DshModelRoute, "icon" | "provider">,
  catalogEntry: ModelProviderCatalogEntry | undefined,
): string | null {
  return route.icon ?? catalogEntry?.icon ?? null;
}
