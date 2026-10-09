/**
 * 用户原始需求 [2026-07-14]：「我们还需要有一个 创造、编辑 技能的路由(/creator)。二者是有机互联的」。
 * 修订 [2026-10-09]（creator-skill-store 批 2）：new 模式 store 化——providerId
 * 退出 new 身份（`/w/:wsId/creator/new/:providerId` 不再是合法形态，无兼容策略）；
 * 新增 store 列面（`/w/:wsId/creator/store`）与 store 编辑（`:directoryName`）路由。
 * 正交意图：[1] Creator App 的路由注册（home 会话工作台 / provider 编辑 / store
 * 直建 / store 管理+编辑四组 Activity）；[2] zod params 收窄（非法身份渲染前清理）。
 */
import IconPen from "@lucide/svelte/icons/file-pen-line";
import { defineApp, defineActivity, defineRoute } from "$lib/shell";
import { ProviderIdSchema, WorkspaceIdSchema } from "$shared/contracts/workspaces.js";
import { SkillIdSchema } from "$shared/contracts/skills.js";
import { SkillDirectoryNameSchema } from "$shared/contracts/creator.js";
import { z } from "zod";

const creatorSearch = z.object({
  // evaluating-dashboard 1.4：test/eval 子视图退役（评估迁独立 Evaluating 区块，
  // 三段路由深链）；Creator 保留 file/log/preview/validate 四子视图。
  subview: z.enum(["file", "log", "preview", "validate"]).optional(),
  template: z.string().optional(),
});

export const creatorApp = defineApp({
  id: "creator",
  name: "Creator",
  icon: IconPen,
  pageKind: "workspace",
  activities: [
    defineActivity({
      pattern: "/w/:wsId/creator",
      entry: true,
      root: defineRoute({
        id: "creator.home",
        pattern: "",
        params: z.object({ wsId: WorkspaceIdSchema }),
        component: () => import("./CreatorHome.svelte"),
      }),
    }),
    defineActivity({
      pattern: "/w/:wsId/creator",
      root: defineRoute({
        id: "creator.workspace",
        // creator-skill-store 批 2：new 退出本路由（store 化后 new 无 provider 身份，
        // 独立 `creator.new` Activity 承载）；mode 收窄为 edit——`new/:providerId`
        // 旧形态在此 zod 失败 → 渲染前重定向清理（本仓无兼容策略）。
        pattern: "edit/:providerId",
        params: z.object({
          wsId: WorkspaceIdSchema,
          providerId: ProviderIdSchema,
        }),
        search: creatorSearch,
        component: () => import("./CreatorWorkspace.svelte"),
        children: [
          defineRoute({
            id: "creator.workspace.skill",
            pattern: ":skillId",
            params: z.object({ skillId: SkillIdSchema }),
            search: creatorSearch,
            component: () => import("./CreatorWorkspace.svelte"),
          }),
        ],
      }),
    }),
    defineActivity({
      pattern: "/w/:wsId/creator",
      root: defineRoute({
        // store 直建（无 provider 身份；store 无 ws 归属，任何 ws 上下文同形）。
        id: "creator.new",
        pattern: "new",
        params: z.object({ wsId: WorkspaceIdSchema }),
        search: creatorSearch,
        component: () => import("./CreatorWorkspace.svelte"),
      }),
    }),
    defineActivity({
      pattern: "/w/:wsId/creator",
      root: defineRoute({
        // store 管理列面（应用/同步/卸载/删除根源；内容与 ws 无关）。
        id: "creator.store",
        pattern: "store",
        params: z.object({ wsId: WorkspaceIdSchema }),
        component: () => import("./CreatorStore.svelte"),
        children: [
          defineRoute({
            // store 技能编辑（身份 = directoryName；load/save 走 creatorStore.*）。
            id: "creator.store.skill",
            pattern: ":directoryName",
            params: z.object({
              wsId: WorkspaceIdSchema,
              directoryName: SkillDirectoryNameSchema,
            }),
            search: creatorSearch,
            component: () => import("./CreatorWorkspace.svelte"),
          }),
        ],
      }),
    }),
  ],
});
