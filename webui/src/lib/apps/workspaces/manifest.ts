/**
 * 用户原始需求 [2026-07-27]：「三个导航意味着三个 ChromeTabs」。
 * 修订 [2026-10-03]（skills-dashboard）：Skills Page = mobileScreen dashboard
 * （Skills/Agents/Repos 三屏网格；Repository 一级导航退役被吸收；scan 实例迁
 * 子路由 repos/scan/:sourceId；深链切屏）。
 * 修订 [2026-10-05]（workspace-page-polish）：/workspace 标准工作区管理页
 * （注册目录索引 + Remove 收口 + Import 入口；IMPORTED 词汇从用户面退役）。
 * 修订 [2026-10-06]（skills-tabs-redesign 批 1）：三屏网格 → TabsHeader 三一等
 * Tabs；深链参数 screen→tab 直切（无别名，AGENTS §8 无兼容策略）。
 * 正交意图：[1] 声明 Skills dashboard App 的路由树（root = dashboard 网格 +
 * repos scan 子路由；intelligence 平行 activity）。[2] workspace 管理页
 * activity（全局作用域页面；tab 归属经 tabIdForPath → Global `~`）。
 */
import IconBoxes from "@lucide/svelte/icons/boxes";
import { defineApp, defineActivity, defineRoute, leafRoute } from "$lib/shell";
import { ProviderIdSchema, WorkspaceIdSchema } from "$shared/contracts/workspaces.js";
import { SkillIdSchema } from "$shared/contracts/skills.js";
import { z } from "zod";

/** dashboard 根 search（?tab= 切屏 + 主屏筛选/详情身份 + repos 源过滤）。 */
const DashboardSearchSchema = z.object({
  /** 深链 Tab（缺省 skills；skills-tabs-redesign 批 1 起参数名 screen→tab 直切，
   *  无别名——仓库无兼容策略，旧 URL 迁移归发布层）。 */
  tab: z.enum(["skills", "agents", "repos"]).optional(),
  provider: ProviderIdSchema.optional(),
  q: z.string().optional(),
  /** repos screen 的源过滤（与主屏技能搜索 q 分道）。 */
  reposQ: z.string().optional(),
  skill: SkillIdSchema.optional(),
  view: z.enum(["list", "detail"]).optional(),
  /** duplicates-only 过滤开关（出现 = 开）。 */
  duplicates: z.literal("1").optional(),
});

export const workspacesApp = defineApp({
  id: "workspaces",
  name: "Skills",
  icon: IconBoxes,
  pageKind: "workspace",
  activities: [
    defineActivity({
      pattern: "/w/:wsId/skills",
      entry: true,
      searchParamAliases: { providerId: "provider" },
      root: defineRoute({
        id: "workspaces.provider",
        pattern: "",
        params: z.object({ wsId: WorkspaceIdSchema, providerId: ProviderIdSchema.optional() }),
        search: DashboardSearchSchema,
        component: () => import("./SkillsDashboard.svelte"),
        children: [
          // repos 扫描实例：sourceId（curated 或 user_）path param；选中/预览走
          // search（组件 $state 表单的 targets 除外——D5 妥协见 RepositoryView 注释）。
          defineRoute({
            id: "workspaces.reposScan",
            pattern: "repos/scan/:sourceId",
            params: z.object({
              wsId: WorkspaceIdSchema,
              sourceId: z
                .string()
                .min(1)
                .max(128)
                .regex(/^[a-z0-9_-]+$/i),
            }),
            search: z.object({
              selected: z.string().optional(),
              skill: z.string().optional(),
              targets: z.string().optional(),
            }),
            component: () => import("./RepositoryScan.svelte"),
          }),
        ],
      }),
    }),
    defineActivity({
      pattern: "/w/:wsId/skills",
      root: defineRoute({
        id: "workspaces.insights",
        pattern: "insights/:providerId",
        params: z.object({ wsId: WorkspaceIdSchema, providerId: ProviderIdSchema }),
        search: z.object({
          severity: z.enum(["all", "error", "warning", "info"]).optional(),
          skill: SkillIdSchema.optional(),
        }),
        component: () => import("./IntelligenceView.svelte"),
      }),
    }),
    // 工作区管理页（workspace-page-polish）：全局作用域（非 ws 参数路由）——
    // 注册进 shell route registry 的方式沿 settings 页先例（独立 activity pattern）。
    defineActivity({
      pattern: "/workspace",
      root: leafRoute({
        id: "workspaces.manage",
        component: () => import("./WorkspaceManager.svelte"),
      }),
    }),
  ],
});
