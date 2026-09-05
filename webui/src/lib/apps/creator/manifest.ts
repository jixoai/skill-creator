/**
 * 用户原始需求 [2026-07-27]：「Creator 用来编写 Skill，深度融合 AI」。
 * 正交意图：[1] 声明 Creator App 的 manifest（home + 编辑/新建实例 activity）。
 * 妥协声明：当前只声明 manifest 骨架，视图组件后续 change 5 填充。
 */
import IconPen from "@lucide/svelte/icons/file-pen-line";
import { defineApp, defineActivity, defineRoute, leafRoute } from "$lib/shell";
import { ProviderIdSchema, WorkspaceIdSchema } from "$shared/contracts/workspaces.js";
import { SkillIdSchema } from "$shared/contracts/skills.js";
import { z } from "zod";

/** Creator App：AI 驱动的技能编写工作台。 */
export const creatorApp = defineApp({
  id: "creator",
  name: "Creator",
  icon: IconPen,
  activities: [
    // home tab：引导（模板画廊 + 最近编辑 + 打开/新建入口）
    defineActivity({
      pattern: "/creator",
      entry: true,
      root: leafRoute({
        id: "creator.home",
        component: () => import("./CreatorHome.svelte"),
      }),
    }),
    // 实例 tab：编辑或新建技能（左右分栏 ACP 对话 + 子视图）
    defineActivity({
      pattern: "/creator",
      root: defineRoute({
        id: "creator.workspace",
        pattern: ":mode/:wsId/:providerId",
        params: z.object({
          mode: z.enum(["edit", "new"]),
          wsId: WorkspaceIdSchema,
          providerId: ProviderIdSchema,
        }),
        search: z.object({
          subview: z.enum(["file", "log", "preview", "validate", "test"]).optional(),
          template: z.string().optional(),
        }),
        component: () => import("./CreatorWorkspace.svelte"),
        children: [
          defineRoute({
            id: "creator.workspace.skill",
            pattern: ":skillId",
            params: z.object({
              skillId: SkillIdSchema,
            }),
            component: () => import("./CreatorWorkspace.svelte"),
          }),
        ],
      }),
    }),
  ],
});
