/**
 * 用户原始需求 [2026-07-27]：「Repository 用来浏览远程 skills 仓库」。
 * 正交意图：[1] 声明 Repository App 的 manifest（home Discover + scan 实例 activity）。
 * 妥协声明：home 与 scan 共用一个 entry activity 的 Route 树（Shell 当前每 App 渲染一个
 * entry activity AppShell）；scan 子路由作为 home 根 Route 的 children，使同一 AppShell 既能
 * 匹配 `/repository`（home）也能匹配 `/repository/scan/:sourceId`（实例扫描）。
 */
import IconGit from "@lucide/svelte/icons/git-branch";
import { defineApp, defineActivity, defineRoute, leafRoute } from "$lib/shell";
import { z } from "zod";

/** Repository App：浏览远程 skills 仓库并安装。 */
export const repositoryApp = defineApp({
  id: "repository",
  name: "Repository",
  icon: IconGit,
  activities: [
    // entry activity：home Discover（根）+ scan 实例（子路由）
    defineActivity({
      pattern: "/repository",
      entry: true,
      root: defineRoute({
        id: "repository.home",
        pattern: "",
        search: z.object({
          q: z.string().optional(),
        }),
        component: () => import("./RepositoryHome.svelte"),
        children: [
          // 实例扫描：源 id（curated 或 user_）作为 path param；选中技能 / 安装目标走 search。
          defineRoute({
            id: "repository.scan",
            pattern: "scan/:sourceId",
            params: z.object({
              sourceId: z
                .string()
                .min(1)
                .max(128)
                .regex(/^[a-z0-9_-]+$/i),
            }),
            search: z.object({
              selected: z.string().optional(),
              targets: z.string().optional(),
              skill: z.string().optional(),
            }),
            component: () => import("./RepositoryScan.svelte"),
          }),
        ],
      }),
    }),
  ],
});
