/**
 * Persisted Workspace Registry state and pure transitions.
 *
 * User input [2026-07-15]: "按照你自己的节奏去推进开发迭代。"
 * Architecture decision [2026-07-15]: concurrent Workspace projections must
 * never overwrite a newer import, forget, or activation.
 *
 * Orthogonal intents:
 *   [1] Define the strict, count-free persisted registry state.
 *   [2] Produce immutable next states for registry mutations.
 */
import path from "node:path";
import { z } from "zod";
import {
  HOME_WORKSPACE_ID,
  ImportedWorkspaceIdSchema,
  WorkspaceIdSchema,
} from "../../shared/contracts/workspaces.js";
import { opaquePathId } from "../path-safety.js";

/** Persisted Imported Workspace identity without dynamic observations. */
export const StoredWorkspaceSchema = z
  .object({
    id: ImportedWorkspaceIdSchema,
    label: z.string().trim().min(1),
    path: z
      .string()
      .min(1)
      .refine(path.isAbsolute, "Workspace path must be absolute.")
      .refine((value) => path.normalize(value) === value, "Workspace path must be normalized."),
  })
  .strict();

/** Strict versioned Registry state with identity, uniqueness, and active-scope invariants. */
export const WorkspaceRegistryStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    activeId: WorkspaceIdSchema,
    workspaces: z.array(StoredWorkspaceSchema),
  })
  .strict()
  .superRefine((state, context) => {
    const ids = new Set<string>();
    const paths = new Set<string>();
    for (const [index, workspace] of state.workspaces.entries()) {
      if (workspace.id !== opaquePathId("ws", workspace.path)) {
        context.addIssue({
          code: "custom",
          message: "Workspace ID does not match its path.",
          path: ["workspaces", index, "id"],
        });
      }
      if (ids.has(workspace.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate Workspace ID: ${workspace.id}`,
          path: ["workspaces", index, "id"],
        });
      }
      if (paths.has(workspace.path)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate Workspace path: ${workspace.path}`,
          path: ["workspaces", index, "path"],
        });
      }
      ids.add(workspace.id);
      paths.add(workspace.path);
    }
    if (state.activeId !== HOME_WORKSPACE_ID && !ids.has(state.activeId)) {
      context.addIssue({
        code: "custom",
        message: `Active Workspace is not registered: ${state.activeId}`,
        path: ["activeId"],
      });
    }
  });

/** Persisted Imported Workspace identity. */
export type StoredWorkspace = z.infer<typeof StoredWorkspaceSchema>;
/** Complete authoritative Registry state. */
export type WorkspaceRegistryState = z.infer<typeof WorkspaceRegistryStateSchema>;

/** Construct an empty Registry with Home Workspace active. */
export function emptyRegistryState(): WorkspaceRegistryState {
  return { schemaVersion: 1, activeId: HOME_WORKSPACE_ID, workspaces: [] };
}

/** Return the immutable next state for an idempotent Workspace import. */
export function importWorkspace(
  state: WorkspaceRegistryState,
  entry: StoredWorkspace,
): { state: WorkspaceRegistryState; entry: StoredWorkspace; changed: boolean } {
  const existing = state.workspaces.find((workspace) => workspace.path === entry.path);
  if (existing) return { state, entry: existing, changed: false };
  const collision = state.workspaces.find((workspace) => workspace.id === entry.id);
  if (collision) {
    throw new Error(`Workspace ID collision between ${collision.path} and ${entry.path}`);
  }
  return {
    state: {
      ...state,
      activeId: entry.id,
      workspaces: [...state.workspaces, entry],
    },
    entry,
    changed: true,
  };
}

/** Return the immutable next state for a non-destructive Registry removal. */
export function forgetWorkspace(
  state: WorkspaceRegistryState,
  id: StoredWorkspace["id"],
): WorkspaceRegistryState | null {
  if (!state.workspaces.some((workspace) => workspace.id === id)) return null;
  return {
    ...state,
    activeId: state.activeId === id ? HOME_WORKSPACE_ID : state.activeId,
    workspaces: state.workspaces.filter((workspace) => workspace.id !== id),
  };
}

/** Return the immutable next state for an existing active Workspace transition. */
export function activateWorkspace(
  state: WorkspaceRegistryState,
  id: WorkspaceRegistryState["activeId"],
): WorkspaceRegistryState | null {
  if (id !== HOME_WORKSPACE_ID && !state.workspaces.some((workspace) => workspace.id === id)) {
    return null;
  }
  if (state.activeId === id) return state;
  return { ...state, activeId: id };
}
