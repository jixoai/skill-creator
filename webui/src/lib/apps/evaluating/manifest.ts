/**
 * Evaluating block（evaluating-dashboard design §3/§4，2026-10-03）。
 * 用户原始需求：评估升格为独立一级区块——总览（/w/:wsId/evaluating）+ 三段
 * 详情（path 三段无歧义可深链；?skill= 单参数在多 provider 同名技能下有歧义）。
 * 正交意图：[1] 声明 Evaluating App 的 manifest（home 总览 + detail 三段子路由）。
 */
import IconChart from "@lucide/svelte/icons/chart-no-axes-column-increasing";
import { defineApp, defineActivity, defineRoute } from "$lib/shell";
import { ProviderIdSchema, WorkspaceIdSchema } from "$shared/contracts/workspaces.js";
import { SkillIdSchema } from "$shared/contracts/skills.js";
import { z } from "zod";

export const evaluatingApp = defineApp({
  id: "evaluating",
  name: "Evaluating",
  icon: IconChart,
  pageKind: "workspace",
  activities: [
    defineActivity({
      pattern: "/w/:wsId/evaluating",
      entry: true,
      root: defineRoute({
        id: "evaluating.home",
        pattern: "",
        params: z.object({ wsId: WorkspaceIdSchema }),
        component: () => import("./EvaluatingOverview.svelte"),
        children: [
          // 详情：path 三段（workspace/provider/skill）唯一确定三元组（design §3 r2）。
          defineRoute({
            id: "evaluating.detail",
            pattern: ":providerId/:skillId",
            params: z.object({
              wsId: WorkspaceIdSchema,
              providerId: ProviderIdSchema,
              skillId: SkillIdSchema,
            }),
            component: () => import("./EvaluatingDetail.svelte"),
          }),
        ],
      }),
    }),
  ],
});
