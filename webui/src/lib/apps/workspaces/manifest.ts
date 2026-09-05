/**
 * 用户原始需求 [2026-07-27]：「三个导航意味着三个 ChromeTabs」。
 * 正交意图：[1] 声明 Workspaces App 的 manifest（home / provider / intelligence / steward activity）。
 */
import IconBoxes from "@lucide/svelte/icons/boxes";
import { defineApp, defineActivity, defineRoute, leafRoute } from "$lib/shell";
import { ProviderIdSchema, WorkspaceIdSchema } from "$shared/contracts/workspaces.js";
import { z } from "zod";

/** Workspaces App：管理已有 Skills，浏览/启用/禁用/更新/分析。 */
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
    // 智能 tab：对选定 Provider 的技能做只读分析 + proposal 审查
    defineActivity({
      pattern: "/workspaces",
      root: defineRoute({
        id: "workspaces.intelligence",
        pattern: "intelligence/:wsId/:providerId",
        params: z.object({
          wsId: WorkspaceIdSchema,
          providerId: ProviderIdSchema,
        }),
        search: z.object({
          severity: z.enum(["all", "error", "warning", "info"]).optional(),
        }),
        component: () => import("./IntelligenceView.svelte"),
      }),
    }),
    // 管家 tab：Agent steward run（backend 选择、事件流、审批门）
    defineActivity({
      pattern: "/workspaces",
      root: defineRoute({
        id: "workspaces.steward",
        pattern: "steward/:wsId/:providerId",
        params: z.object({
          wsId: WorkspaceIdSchema,
          providerId: ProviderIdSchema,
        }),
        component: () => import("./StewardView.svelte"),
      }),
    }),
  ],
});
