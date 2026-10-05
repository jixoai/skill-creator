/** Canonical route matching and the legacy URL migration table. */
import { matchRouteTree, type RouteMatchResult } from "./match.js";
import { matchPathPattern } from "./path-pattern.js";
import { appRegistry } from "./registry.js";
import { getEntryActivity } from "./types.js";
import type { AppActivity, AppManifest } from "./types.js";

export const SHELL_HOME_PATH = "/w/~/skills";

export type HygieneDecision =
  | { readonly kind: "ok" }
  | { readonly kind: "redirect"; readonly path: string };

export interface ShellRouteMatch {
  readonly app: AppManifest;
  readonly activity: AppActivity;
  readonly result: RouteMatchResult;
}

export function resolveShellRoute(pathname: string, search: string): ShellRouteMatch | null {
  let parseError: ShellRouteMatch | null = null;
  for (const app of appRegistry.list()) {
    for (const activity of app.activities) {
      if (!matchPathPattern(activity.pattern, pathname, true)) continue;
      const result = matchRouteTree(activity.root, pathname, search, activity.pattern);
      if (result.kind === "matched") return { app, activity, result };
      if (result.kind === "parse-error" && parseError === null) {
        parseError = { app, activity, result };
      }
    }
  }
  return parseError;
}

export function sanitizeShellLocation(pathname: string, search: string): HygieneDecision {
  const legacyPath = redirectLegacyPath(pathname, search);
  if (legacyPath !== null) return { kind: "redirect", path: legacyPath };

  const matched = resolveShellRoute(pathname, search);
  if (matched?.result.kind === "matched") return { kind: "ok" };
  if (matched?.result.kind === "parse-error") {
    return matched.result.reason === "params"
      ? { kind: "redirect", path: entryPath(matched.app) }
      : { kind: "redirect", path: pathname };
  }

  const first = firstSegment(pathname);
  const app = appRegistry.get(first ?? "");
  return { kind: "redirect", path: app ? entryPath(app) : SHELL_HOME_PATH };
}

export function canonicalizeShellLocation(pathname: string, search: string): string {
  const redirect = redirectLegacyPath(pathname, search);
  return redirect ?? `${pathname}${search}`;
}

function entryPath(app: AppManifest): string {
  const entry = getEntryActivity(app);
  if (!entry) return SHELL_HOME_PATH;
  return entry.pattern.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (segment, name: string) =>
    name === "wsId" ? "~" : segment,
  );
}

function redirectLegacyPath(pathname: string, search: string): string | null {
  const parts = pathname.split("/").filter(Boolean).map(decodeSegment);
  const query = new URLSearchParams(search);
  const build = (path: string, values: Record<string, string | null | undefined>): string => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) {
      if (value !== null && value !== undefined && value !== "") params.set(key, value);
    }
    const suffix = params.toString();
    return suffix ? `${path}?${suffix}` : path;
  };

  if (pathname === "/workspaces") return SHELL_HOME_PATH;
  if (parts[0] === "workspaces" && parts[1] === "insights" && parts.length === 4) {
    return build(`/w/${encodePathPart(parts[2]!)}/skills/insights/${encodePathPart(parts[3]!)}`, {
      severity: query.get("severity"),
      skill: query.get("skill"),
    });
  }
  if (parts[0] === "workspaces" && parts.length === 3) {
    return build(`/w/${encodePathPart(parts[1]!)}/skills`, {
      q: query.get("q"),
      provider: parts[2]!,
      skill: query.get("skill"),
    });
  }
  if (pathname === "/creator") return "/w/~/creator";
  if (parts[0] === "creator" && parts[1] === "edit" && parts.length === 5) {
    return build(
      `/w/${encodePathPart(parts[2]!)}/creator/edit/${encodePathPart(parts[3]!)}/${encodePathPart(parts[4]!)}`,
      { subview: query.get("subview"), template: query.get("template") },
    );
  }
  if (parts[0] === "creator" && parts[1] === "new" && parts.length === 4) {
    return build(`/w/${encodePathPart(parts[2]!)}/creator/new/${encodePathPart(parts[3]!)}`, {
      template: query.get("template"),
    });
  }
  if (pathname === "/wiki") return "/w/~/wiki";
  if (parts[0] === "wiki" && parts.length === 2) {
    return `/w/${encodePathPart(parts[1]!)}/wiki`;
  }
  // Repository App 退役（skills-dashboard 1.8）：legacy 路由直指 dashboard 的
  // Repos screen 深链（?screen=repos；scan 实例子路由原样保留参数）。
  if (pathname === "/repository") return `${SHELL_HOME_PATH}?screen=repos`;
  if (parts[0] === "repository" && parts[1] === "scan" && parts.length === 3) {
    return build(`/w/~/skills/repos/scan/${encodePathPart(parts[2]!)}`, {
      selected: query.get("selected"),
      targets: query.get("targets"),
      skill: query.get("skill"),
    });
  }
  return null;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function encodePathPart(segment: string): string {
  return encodeURIComponent(segment === "%7E" || segment.toLowerCase() === "%7e" ? "~" : segment);
}

function firstSegment(pathname: string): string | null {
  return pathname.replace(/^\/+/, "").split("/")[0] || null;
}
