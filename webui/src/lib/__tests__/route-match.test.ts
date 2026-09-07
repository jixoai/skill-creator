/**
 * Island/SPA 路由匹配回归（openspec steward-product-workflow task 4.1）。
 *
 * 用户原始需求 [2026-09-07]：Workflow activity（task/target/selected-skills 选择面）
 * 必须在 island 路由树内可达；与既有 intelligence/steward 3 段路由同形。
 *
 * 正交意图：
 *   [1] workspaces manifest 的全部 activity 都能被 matchRouteTree 命中各自路径。
 *   [2] 失配路径返回 no-match（不误吞其他 activity 的路径）。
 */
import { describe, expect, it, vi } from "vitest";

const iconStub = vi.hoisted(() => ({ default: {} }));
vi.mock("@lucide/svelte/icons/boxes", () => iconStub);
// sveltekit 虚拟模块的 node 测试替身（island 内由 $app/* shims 承担同一角色）。
vi.mock("$app/state", () => ({
  page: {
    url: { pathname: "/", searchParams: new URLSearchParams() },
  },
}));
vi.mock("$app/navigation", () => ({ goto: () => {} }));

import { matchRouteTree } from "../shell/match";
import { workspacesApp } from "../apps/workspaces/manifest";

const WS = "ws_0123456789abcdef01234567";

describe("workspaces activity route matching", () => {
  const cases = [
    { path: "/workspaces", id: "workspaces.home" },
    { path: `/workspaces/${WS}/openclaw`, id: "workspaces.provider" },
    { path: `/workspaces/intelligence/${WS}/openclaw`, id: "workspaces.intelligence" },
    { path: `/workspaces/steward/${WS}/openclaw`, id: "workspaces.steward" },
    { path: `/workspaces/workflow/${WS}/openclaw`, id: "workspaces.steward-workflow" },
  ];

  it.each(cases)("matches $id at $path", ({ path, id }) => {
    const results = workspacesApp.manifest.activities.map((candidate) => ({
      id: candidate.root.id,
      result: matchRouteTree(candidate.root, path, "", candidate.pattern),
    }));
    const matched = results.find(({ result }) => result.kind === "matched");
    expect(
      matched?.id ??
        `no-match (kinds: ${results
          .map(({ id: activityId, result }) => `${activityId}=${result.kind}`)
          .join(", ")})`,
      `expected ${id}`,
    ).toBe(id);
  });

  it("does not match unknown prefixes", () => {
    for (const activity of workspacesApp.manifest.activities) {
      const result = matchRouteTree(
        activity.root,
        `/workspaces/nope/${WS}/openclaw`,
        "",
        activity.pattern,
      );
      expect(result.kind).not.toBe("matched");
    }
  });
});
