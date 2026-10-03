/** Skills block for a workspace-scoped Page. */
import IconBoxes from "@lucide/svelte/icons/boxes";
import { defineApp, defineActivity, defineRoute } from "$lib/shell";
import { ProviderIdSchema, WorkspaceIdSchema } from "$shared/contracts/workspaces.js";
import { SkillIdSchema } from "$shared/contracts/skills.js";
import { z } from "zod";

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
        search: z.object({
          provider: ProviderIdSchema.optional(),
          q: z.string().optional(),
          skill: SkillIdSchema.optional(),
          view: z.enum(["list", "detail"]).optional(),
          selected: z.string().optional(),
          targets: z.string().optional(),
        }),
        component: () => import("$lib/shell/SkillsPage.svelte"),
      }),
    }),
    defineActivity({
      pattern: "/w/:wsId/skills",
      root: defineRoute({
        id: "workspaces.intelligence",
        pattern: "intelligence/:providerId",
        params: z.object({ wsId: WorkspaceIdSchema, providerId: ProviderIdSchema }),
        search: z.object({
          severity: z.enum(["all", "error", "warning", "info"]).optional(),
        }),
        component: () => import("./IntelligenceView.svelte"),
      }),
    }),
  ],
});
