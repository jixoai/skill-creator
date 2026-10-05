/**
 * workspaces dashboard manifest 路由测试（skills-dashboard 1.5/1.8）。
 * 用户原始需求 [2026-10-02]：「Repository 作为一级导航退役，被 dashboard 吸收」
 * ——scan 实例迁子路由 repos/scan/:sourceId；?screen= 深链切屏。
 * 正交意图：
 *   [1] reposScan 子路由匹配/参数校验（sourceId 字符集；非法 = parse-error）。
 *   [2] 根 search schema：screen 枚举（非法值 parse-error → hygiene 清理）。
 *   [3] buildHrefById：reposScan 深链与 screen 参数序列化。
 */
import { describe, expect, it, vi } from "vitest";

const iconStub = vi.hoisted(() => ({ default: {} }));
vi.mock("@lucide/svelte/icons/boxes", () => iconStub);
vi.mock("$app/state", () => ({
  page: { url: { pathname: "/", search: "", searchParams: new URLSearchParams() } },
}));
vi.mock("$app/navigation", () => ({ goto: () => {} }));

import { matchRouteTree } from "$lib/shell/match.js";
import { buildHrefById } from "$lib/shell/navigate.js";
import { workspacesApp } from "../manifest.js";

const WS = "ws_0123456789abcdef01234567";

function match(pathname: string, search = ""): ReturnType<typeof matchRouteTree> {
  const entry = workspacesApp.manifest.activities[0]!;
  return matchRouteTree(entry.root as never, pathname, search, entry.pattern);
}

describe("workspaces dashboard manifest", () => {
  it("matches the repos scan child route with sourceId param", () => {
    const result = match(`/w/${WS}/skills/repos/scan/curated-source`, "?selected=rsk_1");
    expect(result.kind).toBe("matched");
    if (result.kind !== "matched") return;
    const leaf = result.chain.at(-1);
    expect(leaf?.route.id).toBe("workspaces.reposScan");
    // 叶子节点合并继承参数（wsId 继承自 activity 前缀，sourceId 来自子段）。
    expect(leaf?.rawParams.sourceId).toBe("curated-source");
    expect(leaf?.rawParams.wsId).toBe(WS);
  });

  it("rejects malformed sourceId before rendering (parse-error, reason=params)", () => {
    const result = match(`/w/${WS}/skills/repos/scan/bad.source!id`);
    expect(result.kind).toBe("parse-error");
    if (result.kind === "parse-error") expect(result.reason).toBe("params");
  });

  it("keeps the dashboard root matching with ?screen= deep links", () => {
    for (const screen of ["skills", "agents", "repos"] as const) {
      const result = match(`/w/${WS}/skills`, `?screen=${screen}`);
      expect(result.kind).toBe("matched");
    }
    const bogus = match(`/w/${WS}/skills`, "?screen=bogus");
    expect(bogus.kind).toBe("parse-error");
    if (bogus.kind === "parse-error") expect(bogus.reason).toBe("search");
  });

  it("keeps the index route matching without the scan prefix (no partial steals)", () => {
    const result = match(`/w/${WS}/skills/repos/scan`);
    expect(result.kind).not.toBe("matched");
  });

  it("builds reposScan and screen deep links via id", () => {
    expect(buildHrefById("workspaces.reposScan", { wsId: WS, sourceId: "curated-source" })).toBe(
      `/w/${WS}/skills/repos/scan/curated-source`,
    );
    expect(
      buildHrefById("workspaces.provider", { wsId: WS }, { screen: "repos", reposQ: "vue" }),
    ).toBe(`/w/${WS}/skills?screen=repos&reposQ=vue`);
    expect(buildHrefById("workspaces.insights", { wsId: WS, providerId: "claude-code" })).toBe(
      `/w/${WS}/skills/insights/claude-code`,
    );
  });
});
