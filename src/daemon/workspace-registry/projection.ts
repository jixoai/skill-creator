/**
 * Dynamic Workspace projection.
 *
 * User input [2026-07-15]: "按照你自己的节奏去推进开发迭代。"
 * Architecture decision [2026-07-15]: availability and skill counts are
 * observations, never Registry facts that may overwrite newer state.
 *
 * Orthogonal intents:
 *   [1] Count skills for one immutable registry snapshot.
 *   [2] Project availability, active state, and counts for the WebUI.
 */
import type { ListOptions } from "ccski";
import {
  HOME_WORKSPACE_ID,
  type ImportedWorkspace,
  type Workspace,
  type WorkspaceId,
} from "../../shared/contracts/workspaces.js";
import { canonicalDirectory } from "../path-safety.js";
import type { StoredWorkspace, WorkspaceRegistryState } from "./state.js";

/** Dynamic ccski count adapter used to project an immutable Registry snapshot. */
export type WorkspaceSkillCounter = (options: ListOptions) => Promise<number>;

/** Count Home and Imported Workspace skills for one immutable state snapshot. */
export async function countWorkspaceSnapshot(
  state: WorkspaceRegistryState,
  countSkills: WorkspaceSkillCounter,
): Promise<ReadonlyMap<WorkspaceId, number>> {
  const tasks: Array<Promise<readonly [WorkspaceId, number]>> = [
    countSkills({ all: true }).then((count) => [HOME_WORKSPACE_ID, count] as const),
    ...state.workspaces.map(async (workspace) => {
      const directory = availableDirectory(workspace.path);
      const count = directory
        ? await countSkills({ skillDir: [directory], scanDefaultDirs: false, all: true })
        : 0;
      return [workspace.id, count] as const;
    }),
  ];
  return new Map(await Promise.all(tasks));
}

/** Combine authoritative identity with dynamic counts and availability. */
export function projectWorkspaceSnapshot(
  state: WorkspaceRegistryState,
  counts: ReadonlyMap<WorkspaceId, number>,
): Workspace[] {
  return [
    {
      id: HOME_WORKSPACE_ID,
      kind: "home",
      label: "All agent skills",
      path: null,
      active: state.activeId === HOME_WORKSPACE_ID,
      available: true,
      skillCount: counts.get(HOME_WORKSPACE_ID) ?? 0,
    },
    ...state.workspaces.map((workspace) =>
      projectImportedWorkspace(workspace, state.activeId, counts.get(workspace.id) ?? 0),
    ),
  ];
}

/** Project one persisted Imported Workspace without mutating Registry state. */
export function projectImportedWorkspace(
  workspace: StoredWorkspace,
  activeId: WorkspaceId,
  skillCount: number,
): ImportedWorkspace {
  return {
    ...workspace,
    kind: "directory",
    active: workspace.id === activeId,
    available: availableDirectory(workspace.path) !== null,
    skillCount,
  };
}

/** Return the unchanged canonical directory when a persisted path remains available. */
export function availableDirectory(storedPath: string): string | null {
  try {
    const canonical = canonicalDirectory(storedPath);
    return canonical === storedPath ? canonical : null;
  } catch {
    return null;
  }
}
