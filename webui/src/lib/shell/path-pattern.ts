/**
 * 用户原始需求 [2026-07-27]：「ChromeTabs 和路由做深度的绑定」。
 * 正交意图：
 *   [1] 编译相对 pattern 为正则 + 参数名列表。
 *   [2] 把 pattern + params 渲染成实际路径。
 * 参考：gaubee.com/src/lib/router/path-pattern.ts。
 */

/** 编译后的路径模式。 */
export interface CompiledPattern {
  /** 用于匹配绝对路径的正则（带 ^ $ 锚定）。 */
  readonly regex: RegExp;
  /** 按出现顺序的参数名列表（如 `["owner", "repo"]`）。 */
  readonly paramNames: readonly string[];
}

export interface PathPatternMatch {
  readonly params: Readonly<Record<string, string>>;
  readonly remainder: readonly string[];
}

/** Match a path against a segment pattern, optionally leaving a suffix for a route tree. */
export function matchPathPattern(
  pattern: string,
  pathname: string,
  allowRemainder = false,
): PathPatternMatch | null {
  const patternSegments = splitSegments(pattern);
  const pathSegments = splitSegments(pathname).map(decodeSegment);
  if (pathSegments.length < patternSegments.length) return null;
  if (!allowRemainder && pathSegments.length !== patternSegments.length) return null;

  const params: Record<string, string> = {};
  for (let index = 0; index < patternSegments.length; index += 1) {
    const expected = patternSegments[index]!;
    const actual = pathSegments[index]!;
    if (expected.startsWith(":")) {
      if (!actual) return null;
      params[expected.slice(1)] = actual;
    } else if (expected !== actual) {
      return null;
    }
  }

  return { params, remainder: pathSegments.slice(patternSegments.length) };
}

function splitSegments(path: string): string[] {
  const cleaned = path.replace(/^\/+|\/+$/g, "");
  return cleaned === "" ? [] : cleaned.split("/");
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** 编译相对 pattern 为正则 + 参数名列表。 */
export function compilePattern(pattern: string): CompiledPattern {
  const cleaned = pattern.trim().replace(/^\/+|\/+$/g, "");
  if (cleaned === "") {
    return { regex: /^\/?$/, paramNames: [] };
  }
  const paramNames: string[] = [];
  const regexSrc = cleaned
    .split("/")
    .map((segment) => {
      const parameter = /^:([A-Za-z_][A-Za-z0-9_]*)$/.exec(segment);
      if (parameter) {
        paramNames.push(parameter[1]!);
        return "([^/]+)";
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("\\/");
  return { regex: new RegExp(`^${regexSrc}\\/?$`), paramNames };
}

/** 拼接父级绝对前缀与子级相对 pattern。 */
export function joinPattern(parentAbsolute: string, childRelative: string): string {
  const p = parentAbsolute.replace(/\/+$/, "");
  const c = childRelative.replace(/^\/+|\/+$/g, "");
  if (c === "") return p;
  return `${p}/${c}`;
}

/** 把带 :param 的 pattern + 参数值对象，渲染成实际路径。 */
export function stringifyPattern(
  pattern: string,
  params: Readonly<Record<string, string>>,
): string {
  return pattern
    .split("/")
    .map((segment) => {
      const parameter = /^:([A-Za-z_][A-Za-z0-9_]*)$/.exec(segment);
      if (!parameter) return segment;
      const value = params[parameter[1]!];
      return value !== undefined ? encodeURIComponent(value) : segment;
    })
    .join("/");
}
