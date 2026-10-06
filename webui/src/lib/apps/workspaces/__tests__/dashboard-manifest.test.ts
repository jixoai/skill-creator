/**
 * workspaces dashboard manifest 路由测试（skills-dashboard 1.5/1.8 +
 * skills-tabs-redesign 批 1/批 2）。
 * 用户原始需求 [2026-10-02]：「Repository 作为一级导航退役，被 dashboard 吸收」
 * ——scan 实例迁子路由 repos/scan/:sourceId；深链切屏（批 1 起参数名 screen→tab）。
 * 批 2（Δ3）：SkillDetail 独立 activity `/w/:wsId/skills/:providerId/:skillId`
 * （三 schema load-time 收窄；非法 skillId parse-error → hygiene 渲染前 redirect；
 * `?from=` 搜索参数 ≤512）。
 * 正交意图：
 *   [1] reposScan 子路由匹配/参数校验（sourceId 字符集；非法 = parse-error）。
 *   [2] 根 search schema：tab 枚举（批 1 起参数名 screen→tab 直切；非法值
 *       parse-error → hygiene 清理）。
 *   [3] buildHrefById：reposScan 深链与 tab 参数序列化。
 *   [4] skillDetail activity：路径匹配 + 三 schema 校验 + from 参数 + 静态
 *       前缀不抢配（repos/scan 两段余量不被 :providerId/:skillId 吃掉）。
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
const SK = "sk_0123456789abcdef01234567";

function match(pathname: string, search = ""): ReturnType<typeof matchRouteTree> {
  const entry = workspacesApp.manifest.activities[0]!;
  return matchRouteTree(entry.root as never, pathname, search, entry.pattern);
}

/** skillDetail 是独立 activity（path param 不走 entry activity 的 search 别名）。 */
function matchDetail(pathname: string, search = ""): ReturnType<typeof matchRouteTree> {
  const entry = workspacesApp.manifest.activities.find(
    (activity) => activity.root.id === "workspaces.skillDetail",
  )!;
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

  it("keeps the dashboard root matching with ?tab= deep links", () => {
    for (const tab of ["skills", "agents", "repos"] as const) {
      const result = match(`/w/${WS}/skills`, `?tab=${tab}`);
      expect(result.kind).toBe("matched");
    }
    const bogus = match(`/w/${WS}/skills`, "?tab=bogus");
    expect(bogus.kind).toBe("parse-error");
    if (bogus.kind === "parse-error") expect(bogus.reason).toBe("search");
  });

  it("keeps the index route matching without the scan prefix (no partial steals)", () => {
    const result = match(`/w/${WS}/skills/repos/scan`);
    expect(result.kind).not.toBe("matched");
  });

  it("builds reposScan and tab deep links via id", () => {
    expect(buildHrefById("workspaces.reposScan", { wsId: WS, sourceId: "curated-source" })).toBe(
      `/w/${WS}/skills/repos/scan/curated-source`,
    );
    expect(
      buildHrefById("workspaces.provider", { wsId: WS }, { tab: "repos", reposQ: "vue" }),
    ).toBe(`/w/${WS}/skills?tab=repos&reposQ=vue`);
    expect(buildHrefById("workspaces.insights", { wsId: WS, providerId: "claude-code" })).toBe(
      `/w/${WS}/skills/insights/claude-code`,
    );
  });
});

describe("workspaces.skillDetail manifest（批 2 Δ3）", () => {
  it("matches the detail route with the full provider-copy identity", () => {
    const result = matchDetail(`/w/${WS}/skills/claude-code/${SK}`, `?from=q%3Dvue`);
    expect(result.kind).toBe("matched");
    if (result.kind !== "matched") return;
    const leaf = result.chain.at(-1);
    expect(leaf?.route.id).toBe("workspaces.skillDetail");
    expect(leaf?.rawParams).toMatchObject({ wsId: WS, providerId: "claude-code", skillId: SK });
  });

  it("rejects malformed identities at load time (parse-error → hygiene redirect)", () => {
    // 非法 skillId（非 sk_ 形状）→ parse-error；非法 wsId 同样收窄。
    for (const pathname of [
      `/w/${WS}/skills/claude-code/not-a-skill-id`,
      `/w/garbage/skills/claude-code/${SK}`,
      `/w/${WS}/skills/INVALID_PROVIDER/${SK}`,
    ]) {
      const result = matchDetail(pathname);
      expect(result.kind).toBe("parse-error");
      if (result.kind === "parse-error") expect(result.reason).toBe("params");
    }
  });

  it("does not steal the two-segment repos/scan remainder", () => {
    // /w/:wsId/skills/repos/scan（两段余量）不被 :providerId/:skillId 吃掉：
    // skillId schema 收窄使 "scan" 形状非法 = parse-error（绝不 matched）。
    const result = matchDetail(`/w/${WS}/skills/repos/scan`);
    expect(result.kind).not.toBe("matched");
  });

  it("builds detail hrefs via id without the provider search alias pollution", () => {
    // 独立 activity（无 searchParamAliases）：providerId 是 path param，
    // href 不被 entry activity 的 providerId→provider 别名追加 ?provider=。
    const href = buildHrefById("workspaces.skillDetail", {
      wsId: WS,
      providerId: "claude-code",
      skillId: SK,
    });
    expect(href).toBe(`/w/${WS}/skills/claude-code/${SK}`);
    const withFrom = buildHrefById(
      "workspaces.skillDetail",
      { wsId: WS, providerId: "claude-code", skillId: SK },
      { from: "q=vue" },
    );
    expect(withFrom).toBe(`/w/${WS}/skills/claude-code/${SK}?from=q%3Dvue`);
  });
});
