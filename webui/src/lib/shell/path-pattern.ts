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

const PARAM_RE = /:([A-Za-z_][A-Za-z0-9_]*)/g;

/** 编译相对 pattern 为正则 + 参数名列表。 */
export function compilePattern(pattern: string): CompiledPattern {
  const cleaned = pattern.trim().replace(/^\/+|\/+$/g, "");
  if (cleaned === "") {
    return { regex: /^\/?$/, paramNames: [] };
  }
  const paramNames: string[] = [];
  let regexSrc = cleaned.replace(PARAM_RE, (_, name: string) => {
    paramNames.push(name);
    return "([^/]+)";
  });
  regexSrc = regexSrc.replace(/\//g, "\\/");
  regexSrc = `^${regexSrc}\\/?$`;
  return { regex: new RegExp(regexSrc), paramNames };
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
  return pattern.replace(PARAM_RE, (_, name: string) => {
    const v = params[name];
    return v !== undefined ? encodeURIComponent(v) : `:${name}`;
  });
}
