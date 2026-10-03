/**
 * 用户原始需求 [2026-07-27]：「三个导航意味着三个 ChromeTabs」。
 * 正交意图：
 *   [1] 判断 pathname 是否匹配 activity pattern 前缀。
 *   [2] 从 manifest 的 activities 中找最长前缀匹配的 activity。
 * 参考：gaubee.com/src/lib/apps/route-domain.ts（matchesRoutePrefix）。
 */
import type { AppActivity, AppManifest } from "./types.js";
import { getEntryActivity } from "./types.js";
import { matchPathPattern } from "./path-pattern.js";

/** 将 pattern（含 :param）转为前缀匹配：把 :param 段视为通配。 */
export function matchesRoutePrefix(pathname: string, pattern: string): boolean {
  return matchPathPattern(pattern, pathname, true) !== null;
}

/** 从 manifest 的 activities 中找最长前缀匹配的 activity；无匹配时回退到 entry。 */
export function resolveActivityForPath(
  manifest: AppManifest,
  pathname: string,
): AppActivity | null {
  let best: AppActivity | undefined;
  for (const a of manifest.activities) {
    if (matchesRoutePrefix(pathname, a.pattern)) {
      if (!best || a.pattern.length > best.pattern.length) best = a;
    }
  }
  return best ?? getEntryActivity(manifest) ?? null;
}
