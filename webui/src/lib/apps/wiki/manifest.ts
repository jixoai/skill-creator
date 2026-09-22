/**
 * 用户原始需求 [2026-09-22]（wiki-directory-standard Owner 裁决）：「skill-creator
 * GUI 新增第四个一级面板 Wiki（与 Workspaces 面板同构：home=scope 索引，
 * detail=patterns 列表）」。
 * 正交意图：[1] 声明 Wiki App 的 manifest（home scope 索引 + scope detail）。
 * 迁移注记：旧 /workspaces/wiki/:wsId 视图已迁入本 App（无双入口），WorkspacesHome
 * 的 wiki 入口改指 /wiki/<wsId|%7E>。
 */
import IconBookOpen from "@lucide/svelte/icons/book-open";
import { defineApp, defineActivity, defineRoute, leafRoute } from "$lib/shell";
import { WorkspaceIdSchema } from "$shared/contracts/workspaces.js";
import { z } from "zod";

/** Wiki App：双级 scope 的碎片认知知识库（skill-wiki 目录映射标准）。 */
export const wikiApp = defineApp({
  id: "wiki",
  name: "Wiki",
  icon: IconBookOpen,
  activities: [
    // home tab：scope 索引（Global 卡 + registry workspace wiki 卡）
    defineActivity({
      pattern: "/wiki",
      entry: true,
      root: leafRoute({
        id: "wiki.home",
        component: () => import("./WikiHome.svelte"),
      }),
    }),
    // detail tab：某 scope 的 patterns 列表（URL 里 Global id "~" 编码为 %7E，
    // 与 providerPath 先例同口径；match 层 decodeURIComponent 后经 zod 收窄）。
    defineActivity({
      pattern: "/wiki",
      root: defineRoute({
        id: "wiki.scope",
        pattern: ":wsId",
        params: z.object({ wsId: WorkspaceIdSchema }),
        component: () => import("./WikiScopeView.svelte"),
      }),
    }),
  ],
});
