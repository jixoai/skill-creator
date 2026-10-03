/**
 * Fixed Agent Page manifest（skills-agent-page 1.2：SkillsAgentPage 实体化）。
 *
 * 用户原始需求 [2026-10-03]（design §1）：固定、不可关闭的 Agent tab——左树/
 * Chat/右 panelTabs/下终端容器四区布局壳；`?session=` 深链（workspace 面板
 * 「在 Agent 页打开」入口，agent-surface spec「deep link」场景）。
 *
 * 正交意图：[1] Agent tab 的路由登记（/agent + session search 参数）。
 */
import IconMessage from "@lucide/svelte/icons/message-square";
import { z } from "zod";
import { defineApp, defineActivity, leafRoute } from "$lib/shell";

export const agentApp = defineApp({
  id: "agent",
  name: "Agent",
  icon: IconMessage,
  pageKind: "agent",
  activities: [
    defineActivity({
      pattern: "/agent",
      entry: true,
      root: leafRoute({
        id: "agent.home",
        search: z.object({ session: z.string().min(1).optional() }),
        component: () => import("./SkillsAgentPage.svelte"),
      }),
    }),
  ],
});
