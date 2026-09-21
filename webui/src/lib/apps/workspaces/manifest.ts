/**
 * 用户原始需求 [2026-07-27]：「三个导航意味着三个 ChromeTabs」。
 * 正交意图：[1] 声明 Workspaces App 的 manifest（home / provider / intelligence）。
 * Steward activity 已下线（2026-09-11 用户裁决：Agent 面板 + 模式是唯一的 agent 面；
 * daemon steward 服务保留为内部面，无 UI 入口）。
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
    // home tab：产品首页（快速行动 + 库快照 + 位置索引）
    defineActivity({
      pattern: "/workspaces",
      entry: true,
      root: leafRoute({
        id: "workspaces.home",
        component: () => import("./WorkspacesHome.svelte"),
      }),
    }),
    // wiki tab：双级 scope 的碎片认知知识库（skill-wiki）。必须排在 provider
    // activity 之前——`:wsId/:providerId` 会结构性吞掉 `wiki/<scope>` 并触发
    // params parse-error 的渲染前重定向；静态段 wiki 先匹配才能落进 wiki 视图。
    defineActivity({
      pattern: "/workspaces",
      root: defineRoute({
        id: "workspaces.wiki",
        pattern: "wiki/:wsId",
        params: z.object({ wsId: WorkspaceIdSchema }),
        component: () => import("./WikiView.svelte"),
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
  ],
});
