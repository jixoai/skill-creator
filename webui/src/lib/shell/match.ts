/**
 * 用户原始需求 [2026-07-27]：「ChromeTabs 和路由做深度的绑定」。
 * 正交意图：
 *   [1] Route 树的 URL 解析（纯函数）：pathname + search → matched chain 或 no-match。
 *   [2] 对匹配结果跑 zod parse（params 合并链上所有节点，search 仅叶子节点）。
 * 参考：gaubee.com/src/lib/router/match.ts（段数组模型）。
 */
import type { ZodSchema } from "zod";
import { parseSearchString } from "./search.js";
import type { ErasedRouteContract } from "./contract.js";

/** 匹配成功时的单层节点信息。 */
export interface MatchedRouteNode {
  /** 该 Route 的绝对 pattern（含全部父级前缀）。 */
  readonly absolutePattern: string;
  /** 该 Route 的契约。 */
  readonly route: ErasedRouteContract;
  /** 从 URL 提取的原始参数（字符串值，未经 zod parse）。 */
  readonly rawParams: Readonly<Record<string, string>>;
}

/** 树匹配结果（discriminated union）。 */
export type RouteMatchResult =
  | { readonly kind: "matched"; readonly chain: readonly MatchedRouteNode[] }
  | { readonly kind: "no-match"; readonly reason: "no-route" }
  | {
      readonly kind: "parse-error";
      readonly reason: "params" | "search";
      readonly chain: readonly MatchedRouteNode[];
      readonly errors: unknown;
    };

/**
 * 对一棵 Route 树 + 完整 location 做匹配。
 *
 * @param root           Activity 的根 Route
 * @param pathname       完整 pathname（如 `/workspaces/ws_abc/claude-code`）
 * @param search         完整 search 串（如 `?q=filter&skill=sk_xxx`）
 * @param activityPrefix Activity 的绝对前缀（如 `/workspaces/ws_abc/claude-code`）
 */
export function matchRouteTree(
  root: ErasedRouteContract,
  pathname: string,
  search: string,
  activityPrefix: string,
): RouteMatchResult {
  const relativePath = stripPrefix(pathname, activityPrefix);
  const segments = splitSegments(relativePath);

  const chain = matchChain(root, segments, activityPrefix);
  if (chain.length === 0) {
    return { kind: "no-match", reason: "no-route" };
  }

  const mergedRaw = mergeRawParams(chain);
  const leaf = chain[chain.length - 1].route;
  const paramsSchema = leaf.params as ZodSchema | undefined;
  if (paramsSchema) {
    const parsed = paramsSchema.safeParse(mergedRaw);
    if (!parsed.success) {
      return { kind: "parse-error", reason: "params", chain, errors: parsed.error };
    }
  }

  const searchSchema = leaf.search as ZodSchema | undefined;
  if (searchSchema) {
    const searchObj = parseSearchString(search);
    const parsed = searchSchema.safeParse(searchObj);
    if (!parsed.success) {
      return { kind: "parse-error", reason: "search", chain, errors: parsed.error };
    }
  }

  return { kind: "matched", chain };
}

function stripPrefix(path: string, prefix: string): string {
  const p = prefix.replace(/\/+$/, "");
  if (path === p) return "";
  if (path.startsWith(p + "/")) return path.slice(p.length);
  return path;
}

function splitSegments(path: string): string[] {
  const cleaned = path.replace(/^\/+|\/+$/g, "");
  if (cleaned === "") return [];
  return cleaned.split("/").map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
}

interface PatternSegment {
  kind: "static" | "param";
  value: string;
}

function splitPatternSegments(pattern: string): PatternSegment[] {
  const cleaned = pattern.replace(/^\/+|\/+$/g, "");
  if (cleaned === "") return [];
  return cleaned.split("/").map((seg) => {
    if (seg.startsWith(":")) {
      return { kind: "param" as const, value: seg.slice(1) };
    }
    return { kind: "static" as const, value: seg };
  });
}

function joinAbsolute(parent: string, relative: string): string {
  const p = parent.replace(/\/+$/, "");
  const r = relative.replace(/^\/+|\/+$/g, "");
  if (r === "") return p;
  return `${p}/${r}`;
}

function matchChain(
  route: ErasedRouteContract,
  segments: readonly string[],
  parentAbsolute: string,
): MatchedRouteNode[] {
  const absolutePattern = joinAbsolute(parentAbsolute, route.pattern);
  const patternSegs = splitPatternSegments(route.pattern);

  if (segments.length < patternSegs.length) {
    return [];
  }

  const rawParams: Record<string, string> = {};
  for (let i = 0; i < patternSegs.length; i++) {
    const ps = patternSegs[i];
    const actual = segments[i];
    if (!actual) return [];
    if (ps.kind === "static") {
      if (ps.value !== actual) return [];
    } else {
      rawParams[ps.value] = actual;
    }
  }

  const node: MatchedRouteNode = { absolutePattern, route, rawParams };
  const remaining = segments.slice(patternSegs.length);

  if (remaining.length === 0) {
    return [node];
  }

  if (route.children && route.children.length > 0) {
    for (const child of route.children) {
      const childChain = matchChain(child, remaining, absolutePattern);
      if (childChain.length > 0) {
        return [node, ...childChain];
      }
    }
  }

  return [];
}

function mergeRawParams(chain: readonly MatchedRouteNode[]): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const node of chain) {
    Object.assign(merged, node.rawParams);
  }
  return merged;
}
