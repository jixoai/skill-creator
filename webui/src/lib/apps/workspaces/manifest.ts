/**
 * 用户原始需求 [2026-07-27]：「三个导航意味着三个 ChromeTabs」。
 * 修订 [2026-10-03]（skills-dashboard）：Skills Page = mobileScreen dashboard
 * （Skills/Agents/Repos 三屏网格；Repository 一级导航退役被吸收；scan 实例迁
 * 子路由 repos/scan/:sourceId；深链切屏）。
 * 修订 [2026-10-05]（workspace-page-polish）：/workspace 标准工作区管理页
 * （注册目录索引 + Remove 收口 + Import 入口；IMPORTED 词汇从用户面退役）。
 * 修订 [2026-10-06]（skills-tabs-redesign 批 1）：三屏网格 → TabsHeader 三一等
 * Tabs；深链参数 screen→tab 直切（无别名，AGENTS §8 无兼容策略）。
 * 修订 [2026-10-06]（skills-tabs-redesign 批 2，Δ3 定稿）：SkillDetail 独立路由
 * `/w/:wsId/skills/:providerId/:skillId`（独立 activity——providerId 是 path
 * param，不经 entry activity 的 providerId→provider search 别名注入，insights
 * 先例）；load-time 三 schema 收窄（非法身份 parse-error → hygiene 渲染前
 * redirect）；`?from=` 列表态回传（≤512，白名单解析在 skill-detail-route.ts）；
 * master-detail 身份参数 skill/view 同版本退役（AGENTS §8）。
 * 正交意图：[1] 声明 Skills dashboard App 的路由树（root = dashboard 网格 +
 * repos scan 子路由；intelligence 平行 activity）。[2] workspace 管理页
 * activity（全局作用域页面；tab 归属经 tabIdForPath → Global `~`）。
 * [3] skill detail activity（detail 永远绑定具体 provider copy；copies 是展示
 * 关系不承担权限/定位）。
 */
import IconBoxes from "@lucide/svelte/icons/boxes";
import { defineApp, defineActivity, defineRoute, leafRoute } from "$lib/shell";
import { ProviderIdSchema, WorkspaceIdSchema } from "$shared/contracts/workspaces.js";
import { SkillIdSchema } from "$shared/contracts/skills.js";
import { z } from "zod";

/** dashboard 根 search（?tab= 切屏 + 主屏筛选 + repos 源过滤；批 2 起 detail
 *  身份走独立路由，skill/view 参数退役）。 */
const DashboardSearchSchema = z.object({
  /** 深链 Tab（缺省 skills；skills-tabs-redesign 批 1 起参数名 screen→tab 直切，
   *  无别名——仓库无兼容策略，旧 URL 迁移归发布层）。 */
  tab: z.enum(["skills", "agents", "repos"]).optional(),
  provider: ProviderIdSchema.optional(),
  q: z.string().optional(),
  /** repos screen 的源过滤（与主屏技能搜索 q 分道）。 */
  reposQ: z.string().optional(),
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
    // SkillDetail 独立路由（批 2 Δ3）：detail 永远绑定具体 provider copy；
    // 三 schema load-time 收窄——非法身份 parse-error → hygiene 渲染前 redirect
    // （AGENTS §3.2 动态路由法则），wellformed 但不存在 → 页内 typed not-found。
    defineActivity({
      pattern: "/w/:wsId/skills",
      root: defineRoute({
        id: "workspaces.skillDetail",
        pattern: ":providerId/:skillId",
        params: z.object({
          wsId: WorkspaceIdSchema,
          providerId: ProviderIdSchema,
          skillId: SkillIdSchema,
        }),
        search: z.object({ from: z.string().max(512).optional() }),
        component: () => import("./SkillDetailPage.svelte"),
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
