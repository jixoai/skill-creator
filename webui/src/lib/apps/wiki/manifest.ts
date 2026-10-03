/** Wiki block for a workspace-scoped Page. */
import IconBookOpen from "@lucide/svelte/icons/book-open";
import { defineApp, defineActivity, defineRoute } from "$lib/shell";
import { WorkspaceIdSchema } from "$shared/contracts/workspaces.js";
import { z } from "zod";

export const wikiApp = defineApp({
  id: "wiki",
  name: "Wiki",
  icon: IconBookOpen,
  pageKind: "workspace",
  activities: [
    defineActivity({
      pattern: "/w/:wsId/wiki",
      entry: true,
      root: defineRoute({
        id: "wiki.scope",
        pattern: "",
        params: z.object({ wsId: WorkspaceIdSchema }),
        component: () => import("./WikiScopeView.svelte"),
      }),
    }),
  ],
});
