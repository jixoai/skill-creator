/** Evaluating block placeholder for a workspace-scoped Page. */
import IconChart from "@lucide/svelte/icons/chart-no-axes-column-increasing";
import { defineApp, defineActivity, defineRoute } from "$lib/shell";
import { WorkspaceIdSchema } from "$shared/contracts/workspaces.js";
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
        component: () => import("$lib/shell/EvaluatingPage.svelte"),
      }),
    }),
  ],
});
