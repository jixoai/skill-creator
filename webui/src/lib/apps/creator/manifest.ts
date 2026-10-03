/** Creator block for a workspace-scoped Page. */
import IconPen from "@lucide/svelte/icons/file-pen-line";
import { defineApp, defineActivity, defineRoute } from "$lib/shell";
import { ProviderIdSchema, WorkspaceIdSchema } from "$shared/contracts/workspaces.js";
import { SkillIdSchema } from "$shared/contracts/skills.js";
import { z } from "zod";

const creatorSearch = z.object({
  subview: z.enum(["file", "log", "preview", "validate", "test", "eval"]).optional(),
  template: z.string().optional(),
});

export const creatorApp = defineApp({
  id: "creator",
  name: "Creator",
  icon: IconPen,
  pageKind: "workspace",
  activities: [
    defineActivity({
      pattern: "/w/:wsId/creator",
      entry: true,
      root: defineRoute({
        id: "creator.home",
        pattern: "",
        params: z.object({ wsId: WorkspaceIdSchema }),
        component: () => import("./CreatorHome.svelte"),
      }),
    }),
    defineActivity({
      pattern: "/w/:wsId/creator",
      root: defineRoute({
        id: "creator.workspace",
        pattern: ":mode/:providerId",
        params: z.object({
          mode: z.enum(["edit", "new"]),
          wsId: WorkspaceIdSchema,
          providerId: ProviderIdSchema,
        }),
        search: creatorSearch,
        component: () => import("./CreatorWorkspace.svelte"),
        children: [
          defineRoute({
            id: "creator.workspace.skill",
            pattern: ":skillId",
            params: z.object({ skillId: SkillIdSchema }),
            search: creatorSearch,
            component: () => import("./CreatorWorkspace.svelte"),
          }),
        ],
      }),
    }),
  ],
});
