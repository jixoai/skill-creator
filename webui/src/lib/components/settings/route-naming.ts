/**
 * 路由 slug 编号与展示名派生（R7 8.4：Added 可重复添加 + (N) 累加）。
 *
 * 用户原始需求 [2026-09-12]：「已添加的 provider 可继续添加。重名处理：新增路由
 * provider slug 为 `${provider}-${n}`（n 从 2 起，扫描现有 routes 取下一个可用；
 * 如 zai → zai-2 → zai-3），展示 label 为 `${目录label} (1)`、`(2)`…（(1) 起步、
 * 累加最后一个 (数字)）。apiKeyEnv 随新 slug 派生（zai-2 → ZAI_2_API_KEY），
 * 凭据各自独立。」
 *
 * 正交意图：
 *   [1] slug 编号：nextRouteSlug 对已占用 provider 取现有编号最大值 +1
 *       （「累加最后一个数字」，不回填空洞；zai,zai-2,zai-4 → zai-5）。
 *   [2] 展示名：routeDisplayLabel 把编号 slug 投影回 `${目录label} (n-1)`；
 *       基础名命中目录或无编号时原样返回目录 label / provider id。
 */
import type { DshModelRoute, ModelProviderCatalogEntry } from "$shared/contracts/dsh-runtime.js";

/** slug 的编号后缀（`zai-2` → base "zai"、n 2）。 */
const NUMBERED_SUFFIX = /^(.*)-(\d+)$/;

/**
 * 目录卡片再次添加时的下一个 slug（codex R8 B5）：provider 未占用原样返回；
 * 已占用则「累加最后一个数字」——取现有编号最大值 +1（无编号时从 2 起），
 * 不回填空洞（zai、zai-2、zai-4 → zai-5；用户原文「累加最后一个 (\d)」语义）。
 */
export function nextRouteSlug(
  provider: string,
  existing: ReadonlyArray<Pick<DshModelRoute, "provider">>,
): string {
  const taken = new Set(existing.map((route) => route.provider));
  if (!taken.has(provider)) return provider;
  let maxN = 1;
  for (const slug of taken) {
    if (slug === provider) continue;
    const match = NUMBERED_SUFFIX.exec(slug);
    if (match === null || match[1] !== provider) continue;
    const n = Number(match[2]);
    if (Number.isInteger(n) && n > maxN) maxN = n;
  }
  return `${provider}-${maxN + 1}`;
}

/** 解析 slug 的编号后缀；无编号或 n<2 返回 null（编号从 2 起才算累加位）。 */
export function numberedSlugParts(provider: string): { base: string; n: number } | null {
  const match = NUMBERED_SUFFIX.exec(provider);
  if (match === null) return null;
  const n = Number(match[2]);
  if (!Number.isInteger(n) || n < 2) return null;
  return { base: match[1]!, n };
}

/**
 * 路由展示名：编号 slug（zai-2）→ 基础 provider 的目录 label + ` (n-1)`
 * （zai 的 label “Z.ai” → “Z.ai (1)”）；未编号/基础名不在目录时回退目录
 * label ?? provider id。
 */
export function routeDisplayLabel(
  route: Pick<DshModelRoute, "provider">,
  catalog: { providers: ModelProviderCatalogEntry[] } | null,
): string {
  const parts = numberedSlugParts(route.provider);
  if (parts !== null) {
    const base = catalog?.providers.find((entry) => entry.provider === parts.base);
    if (base) return `${base.label} (${parts.n - 1})`;
  }
  const direct = catalog?.providers.find((entry) => entry.provider === route.provider);
  return direct?.label ?? route.provider;
}
