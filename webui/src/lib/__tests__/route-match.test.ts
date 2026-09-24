/**
 * Island/SPA 路由匹配回归（openspec steward-product-workflow task 4.1；
 * wiki-directory-standard task 3.4：wiki 用例改指第四个一级 Wiki 面板；
 * settings-panel-zcode-source：Settings 页面面板用例）。
 *
 * 用户原始需求 [2026-09-07]：Workflow activity（task/target/selected-skills 选择面）
 * 必须在 island 路由树内可达；与既有 intelligence/steward 3 段路由同形。
 * 用户原始需求 [2026-09-22]（wiki-directory-standard）：wiki 视图迁移至 /wiki App，
 * 旧 /workspaces/wiki/:wsId 路由删除（无双入口残留）。
 * 用户原始需求 [2026-09-25]（settings-panel-zcode-source）：「放弃 Dialog，改成
 * 标准的页面面板」——/settings home + /settings/:section 分区子路由。
 *
 * 正交意图：
 *   [1] workspaces / wiki / settings 三个 App 的全部 activity 都能被 matchRouteTree 命中。
 *   [2] 失配路径返回 no-match（不误吞其他 activity 的路径；旧 wiki 地址不再命中；
 *       非法 settings 分区段不命中——渲染前重定向回入口）。
 */
import { describe, expect, it, vi } from "vitest";

const iconStub = vi.hoisted(() => ({ default: {} }));
vi.mock("@lucide/svelte/icons/boxes", () => iconStub);
vi.mock("@lucide/svelte/icons/book-open", () => iconStub);
vi.mock("@lucide/svelte/icons/settings", () => iconStub);
// sveltekit 虚拟模块的 node 测试替身（island 内由 $app/* shims 承担同一角色）。
vi.mock("$app/state", () => ({
  page: {
    url: { pathname: "/", searchParams: new URLSearchParams() },
  },
}));
vi.mock("$app/navigation", () => ({ goto: () => {} }));

import { matchRouteTree } from "../shell/match";
import type { AppEntry } from "../shell/types";
import { workspacesApp } from "../apps/workspaces/manifest";
import { wikiApp } from "../apps/wiki/manifest";
import { settingsApp } from "../apps/settings/manifest";

const WS = "ws_0123456789abcdef01234567";

/** 断言 app 内恰有 id 命中 path（无命中时报出各 activity 的结果类别）。 */
function expectMatched(app: AppEntry, path: string, id: string): void {
  const results = app.manifest.activities.map((candidate) => ({
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
}

describe("workspaces activity route matching", () => {
  const cases = [
    { path: "/workspaces", id: "workspaces.home" },
    { path: `/workspaces/${WS}/openclaw`, id: "workspaces.provider" },
    { path: `/workspaces/intelligence/${WS}/openclaw`, id: "workspaces.intelligence" },
  ];

  it.each(cases)("matches $id at $path", ({ path, id }) => {
    expectMatched(workspacesApp, path, id);
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

  it("no longer mounts the wiki view at the legacy /workspaces/wiki path", () => {
    for (const activity of workspacesApp.manifest.activities) {
      const result = matchRouteTree(activity.root, "/workspaces/wiki/%7E", "", activity.pattern);
      expect(result.kind).not.toBe("matched");
    }
  });
});

describe("wiki app route matching", () => {
  const cases = [
    { path: "/wiki", id: "wiki.home" },
    { path: "/wiki/%7E", id: "wiki.scope" },
    { path: `/wiki/${WS}`, id: "wiki.scope" },
  ];

  it.each(cases)("matches $id at $path", ({ path, id }) => {
    expectMatched(wikiApp, path, id);
  });

  it("does not match unknown prefixes or bare ids", () => {
    for (const activity of wikiApp.manifest.activities) {
      for (const path of ["/wiki/other/second-segment", "/wikis"]) {
        const result = matchRouteTree(activity.root, path, "", activity.pattern);
        expect(result.kind).not.toBe("matched");
      }
    }
  });
});

describe("settings app route matching", () => {
  const cases = [
    { path: "/settings", id: "settings.home" },
    { path: "/settings/general", id: "settings.section" },
    { path: "/settings/model", id: "settings.section" },
    { path: "/settings/agent", id: "settings.section" },
    { path: "/settings/sessions", id: "settings.section" },
  ];

  it.each(cases)("matches $id at $path", ({ path, id }) => {
    expectMatched(settingsApp, path, id);
  });

  it("does not match invalid section segments (route hygiene redirects before render)", () => {
    for (const activity of settingsApp.manifest.activities) {
      for (const path of ["/settings/unknown-section", "/settings/model/extra"]) {
        const result = matchRouteTree(activity.root, path, "", activity.pattern);
        expect(result.kind).not.toBe("matched");
      }
    }
  });
});
