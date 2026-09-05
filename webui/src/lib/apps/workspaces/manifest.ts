/**
 * 用户原始需求 [2026-07-27]：「三个导航意味着三个 ChromeTabs」。
 * 正交意图：[1] 声明 Workspaces App 的 manifest（home + provider 实例两个 activity）。
 * 妥协声明：当前只声明 manifest 骨架，视图组件引用现有路由页（后续 change 2 填充真实视图）。
 */
import IconBoxes from "@lucide/svelte/icons/boxes";
import { defineApp, defineActivity, defineRoute, leafRoute } from "$lib/shell";
import { ProviderIdSchema, WorkspaceIdSchema } from "$shared/contracts/workspaces.js";
import { z } from "zod";

/** Workspaces App：管理已有 Skills，浏览/启用/禁用/更新。 */
export const workspacesApp = defineApp({
  id: "workspaces",
  name: "Workspaces",
  icon: IconBoxes,
  activities: [
    // home tab：Skill Locations 索引
    defineActivity({
      pattern: "/workspaces",
      entry: true,
      root: leafRoute({
        id: "workspaces.home",
        component: () => import("./WorkspacesHome.svelte"),
      }),
    }),
    // 实例 tab：某个 Workspace.Provider 的技能列表 + 详情
    defineActivity({
      pattern: "/workspaces",
      root: defineRoute({
        id: "workspaces.provider",
        pattern: ":wsId/:providerId",
        params: z.object({
          wsId: WorkspaceIdSchema,
          providerId: ProviderIdSchema,
        }),
        search: z.object({
          q: z.string().optional(),
          skill: z.string().optional(),
          view: z.enum(["list", "detail"]).optional(),
        }),
        component: () => import("./ProviderView.svelte"),
      }),
    }),
  ],
});
