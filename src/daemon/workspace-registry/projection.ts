/**
 * Dynamic Workspace projection.
 *
 * User input [2026-07-22]: "一个 Workspace 下，是可以包含多个 providers 的。"
 * Architecture decision [2026-07-22]: Provider observations are derived from
 * catalog roots and never persisted alongside Workspace identity.
 *
 * Orthogonal intents:
 *   [1] Count skills for one immutable registry snapshot.
 *   [2] Project availability, active state, and counts for the WebUI.
 */
import type { ListOptions } from "ccski";
import {
  GLOBAL_WORKSPACE_ID,
  type GlobalWorkspace,
  type ImportedWorkspace,
  type ProviderId,
  type Workspace,
  type WorkspaceId,
  type WorkspaceProvider,
} from "../../shared/contracts/workspaces.js";
import { PROVIDER_CATALOG } from "../../shared/provider-catalog.js";
import {
  globalProviderRoot,
  importedProviderRoot,
  providerRootAvailable,
} from "../provider-roots.js";
import { canonicalDirectory } from "../path-safety.js";
import type { StoredWorkspace, WorkspaceRegistryState } from "./state.js";

/** Dynamic ccski count adapter used to project an immutable Registry snapshot. */
export type WorkspaceSkillCounter = (options: ListOptions) => Promise<number>;

function providerCountKey(workspaceId: WorkspaceId, providerId: ProviderId): string {
  return `${workspaceId}:${providerId}`;
}

/** Count Home and Imported Workspace skills for one immutable state snapshot. */
export async function countWorkspaceSnapshot(
  state: WorkspaceRegistryState,
  countSkills: WorkspaceSkillCounter,
): Promise<ReadonlyMap<string, number>> {
  const tasks: Array<Promise<readonly [string, number]>> = [];
  const workspaces: Array<{ id: WorkspaceId; directory: string | null; global: boolean }> = [
    { id: GLOBAL_WORKSPACE_ID, directory: null, global: true },
    ...state.workspaces.map((workspace) => ({
      id: workspace.id,
      directory: availableDirectory(workspace.path),
      global: false,
    })),
  ];
  for (const workspace of workspaces) {
    for (const provider of PROVIDER_CATALOG) {
      const root = workspace.global
        ? globalProviderRoot(provider)
        : workspace.directory
          ? importedProviderRoot(workspace.directory, provider)
          : null;
      const providerId = provider.id as ProviderId;
      const count =
        root && providerRootAvailable(root)
          ? countSkills({
              customDirs: [root],
              customProvider: providerId,
              scanDefaultDirs: false,
              all: true,
            })
          : Promise.resolve(0);
      tasks.push(
        count.then((value) => [providerCountKey(workspace.id, providerId), value] as const),
      );
    }
  }
  return new Map(await Promise.all(tasks));
}

/** Combine authoritative identity with dynamic counts and availability. */
export function projectWorkspaceSnapshot(
  state: WorkspaceRegistryState,
  counts: ReadonlyMap<string, number>,
): Workspace[] {
  const global = projectGlobalWorkspace(state.activeId, counts);
  return [
    global,
    ...state.workspaces.map((workspace) =>
      projectImportedWorkspace(workspace, state.activeId, counts),
    ),
  ];
}

/** Project one persisted Imported Workspace without mutating Registry state. */
export function projectImportedWorkspace(
  workspace: StoredWorkspace,
  activeId: WorkspaceId,
  counts: ReadonlyMap<string, number>,
): ImportedWorkspace {
  const directory = availableDirectory(workspace.path);
  const providers = projectProviders(workspace.id, directory, counts);
  return {
    ...workspace,
    kind: "directory",
    active: workspace.id === activeId,
    available: directory !== null,
    skillCount: sumProviderCounts(providers),
    providers,
  };
}

function projectGlobalWorkspace(
  activeId: WorkspaceId,
  counts: ReadonlyMap<string, number>,
): GlobalWorkspace {
  const providers = projectProviders(GLOBAL_WORKSPACE_ID, null, counts);
  return {
    id: GLOBAL_WORKSPACE_ID,
    kind: "global",
    label: "Global Workspace",
    path: null,
    active: activeId === GLOBAL_WORKSPACE_ID,
    available: true,
    skillCount: sumProviderCounts(providers),
    providers,
  };
}

function projectProviders(
  workspaceId: WorkspaceId,
  workspaceDirectory: string | null,
  counts: ReadonlyMap<string, number>,
): WorkspaceProvider[] {
  return PROVIDER_CATALOG.map((provider) => {
    const root = workspaceDirectory
      ? importedProviderRoot(workspaceDirectory, provider)
      : globalProviderRoot(provider);
    const id = provider.id as ProviderId;
    return {
      id,
      label: provider.label,
      path: root,
      available: providerRootAvailable(root),
      writable: workspaceDirectory !== null && root !== null,
      skillCount: counts.get(providerCountKey(workspaceId, id)) ?? 0,
    };
  });
}

function sumProviderCounts(providers: readonly WorkspaceProvider[]): number {
  return providers.reduce((total, provider) => total + provider.skillCount, 0);
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
