// @vitest-environment jsdom
/**
 * PageOutlet 冷启动重定向链路 DOM 测试（走查 12-fix）。
 * 用户原始需求 [2026-10-03]（ego-browser 走查 23 项之 12）：
 * 「手输 /evaluating/:p/:s（缺 ws 段）→ 重定向 /w/~/evaluating 落点卡
 * page-outlet-empty 永不清除；直开正常。」
 * 正交意图：
 *   [1] 冷载非法路径 → initializeTabSession 重定向 → outlet 落点非空态
 *       （redirect 后 page-outlet-empty 必须清除、叶子渲染）。
 *   [2] 冷载合法深链（matched search）→ outlet 直接渲染叶子、零重定向
 *       （冷直载回归钉）。
 * 仿真边界：$app/state / $app/navigation 经 kit-fake 最小仿真（goto 异步两段
 *   + is_navigating 门 + navigation token 旧航次废弃，语义对齐 SvelteKit 3
 *   client runtime）；+layout 的 boot 链路（initializeTabSession + redirect
 *   REPLACE）与 beforeNavigate 守卫按源码同序复刻。appRegistry 用隔离的
 *   stub App 注册（本文件独享 module graph，不污染其他测试的注册表实例）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$app/state", async () => {
  const kit = await import("./kit-fake.svelte.js");
  return { page: kit.mockPage };
});
vi.mock("$app/navigation", async () => {
  const kit = await import("./kit-fake.svelte.js");
  return {
    goto: (path: string, options?: { replace?: boolean }) => kit.mockGoto(path, options),
    beforeNavigate: (callback: Parameters<typeof kit.mockBeforeNavigate>[0]) =>
      kit.mockBeforeNavigate(callback),
  };
});
vi.mock("$lib/stores/workspaces.svelte", async () => {
  const { workspaceState } = await import("./workspaces-store-stub.svelte.js");
  return { workspaceState };
});

import { flushSync, mount, unmount } from "../../__tests__/svelte-client";
import type { Component } from "svelte";
import StubLeaf from "./stub-leaf.svelte";
import PageOutlet from "../PageOutlet.svelte";
import { defineApp, defineActivity, defineRoute } from "../index.js";
import { resetKitFake } from "./kit-fake.svelte.js";
import {
  consumeExpectedNavigation,
  initializeTabSession,
  navigateTab,
} from "../tab-session.svelte.js";
import { beforeNavigate } from "$app/navigation";
import { workspaceState } from "./workspaces-store-stub.svelte.js";
import { ProviderIdSchema, WorkspaceIdSchema } from "$shared/contracts/workspaces.js";
import { SkillIdSchema } from "$shared/contracts/skills.js";
import { z } from "zod";

// stub App：evaluating（entry /w/:wsId/evaluating + detail 三段）+ workspaces
//（/w/:wsId/skills + dashboard search）——resolveShellRoute/sanitizeShellLocation
// 全走真实实现，仅叶子组件替换为零依赖 stub。
const leaf = () => Promise.resolve({ default: StubLeaf });
defineApp({
  id: "evaluating",
  name: "Evaluating",
  icon: StubLeaf,
  pageKind: "workspace",
  activities: [
    defineActivity({
      pattern: "/w/:wsId/evaluating",
      entry: true,
      root: defineRoute({
        id: "evaluating.home",
        pattern: "",
        params: z.object({ wsId: WorkspaceIdSchema }),
        component: leaf,
        children: [
          defineRoute({
            id: "evaluating.detail",
            pattern: ":providerId/:skillId",
            params: z.object({
              wsId: WorkspaceIdSchema,
              providerId: ProviderIdSchema,
              skillId: SkillIdSchema,
            }),
            component: leaf,
          }),
        ],
      }),
    }),
  ],
});
defineApp({
  id: "workspaces",
  name: "Skills",
  icon: StubLeaf,
  pageKind: "workspace",
  activities: [
    defineActivity({
      pattern: "/w/:wsId/skills",
      entry: true,
      root: defineRoute({
        id: "workspaces.provider",
        pattern: "",
        params: z.object({ wsId: WorkspaceIdSchema }),
        search: z.object({
          provider: ProviderIdSchema.optional(),
          q: z.string().optional(),
          skill: SkillIdSchema.optional(),
          view: z.enum(["list", "detail"]).optional(),
        }),
        component: leaf,
      }),
    }),
  ],
});

// +layout.svelte 的 beforeNavigate 守卫（同序复刻：expected 消费否则 cancel
// 走 tab 面——external 导航一律经 navigateTab 的 sanitize 收口）。
beforeNavigate((navigation) => {
  if (!navigation.to || navigation.willUnload) return;
  const path = `${navigation.to.url.pathname}${navigation.to.url.search}`;
  if (consumeExpectedNavigation(path)) return;
  navigation.cancel();
  navigateTab(path, "PUSH");
});

const VALID_SKILL = `sk_${"a".repeat(24)}`;

let mounted: ReturnType<typeof mount> | null = null;

function mountOutlet(): HTMLElement {
  const target = document.createElement("div");
  document.body.appendChild(target);
  mounted = mount(PageOutlet as unknown as Component, { target });
  flushSync();
  return target;
}

async function settle(ms = 30): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
  flushSync();
}

/** +layout boot 链路复刻：initializeTabSession + redirect REPLACE。 */
function coldBoot(pathname: string, search: string): string | null {
  const redirect = initializeTabSession([], pathname, search);
  if (redirect) navigateTab(redirect, "REPLACE");
  return redirect;
}

beforeEach(() => {
  document.body.innerHTML = "";
  workspaceState.workspaces = [];
});

afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = null;
});

describe("PageOutlet 冷启动重定向链路（走查 12-fix）", () => {
  it("redirects an invalid evaluating triplet to the overview and clears the empty outlet", async () => {
    resetKitFake("/evaluating/claude-code/not-a-skill-id");
    mountOutlet();
    // 冷载非法路径（缺 ws 段）：match null → page-outlet-empty 占位。
    expect(document.querySelector(".page-outlet-empty")).not.toBeNull();

    const redirect = coldBoot("/evaluating/claude-code/not-a-skill-id", "");
    expect(redirect).toBe("/w/~/evaluating");
    await settle();

    // 落点断言：outlet 非空态——page-outlet-empty 清除 + 叶子渲染（回归钉：
    // redirect 后依赖传播恢复，不再永卡 Opening page…）。
    expect(document.querySelector(".page-outlet-empty")).toBeNull();
    expect(document.querySelector("[data-stub-leaf]")).not.toBeNull();
  });

  it("renders the matched deep link directly on cold load without redirect", async () => {
    resetKitFake(`/w/~/skills?provider=claude-code&skill=${VALID_SKILL}&view=detail`);
    mountOutlet();
    expect(document.querySelector(".page-outlet-empty")).toBeNull();
    await settle();
    expect(document.querySelector("[data-stub-leaf]")).not.toBeNull();

    const redirect = coldBoot(
      "/w/~/skills",
      `?provider=claude-code&skill=${VALID_SKILL}&view=detail`,
    );
    expect(redirect).toBeNull();
    await settle();
    expect(document.querySelector("[data-stub-leaf]")).not.toBeNull();
  });
});
