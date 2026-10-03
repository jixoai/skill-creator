/** Fixed Agent Page placeholder. */
import IconMessage from "@lucide/svelte/icons/message-square";
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
        component: () => import("$lib/shell/AgentPage.svelte"),
      }),
    }),
  ],
});
