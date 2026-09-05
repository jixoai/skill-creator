/**
 * Dynamic Workspace projection.
 *
 * User input [2026-07-22]: "一个 Workspace 下，是可以包含多个 providers 的。"
 * Architecture decision [2026-07-22]: Provider observations are derived from
 * catalog roots and never persisted alongside Workspace identity.
 * User input [2026-07-27] (workspaces-skill-preview): "同一物理技能被多个共享路径
 *   的 Provider 重复计入" —— Workspace 级聚合计数按 canonical path 去重。
 *
 * Orthogonal intents:
 *   [1] Count skills for one immutable registry snapshot.
 *   [2] Project availability, active state, and counts for the WebUI.
 *   [3] De-duplicate Workspace-level skill counts by canonical provider root + dir.
 */
import path from "node:path";
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

/** 单个技能目录项的最小观测（用于去重，不携带敏感字段）。 */
export interface ObservedSkillEntry {
  /** 技能目录名（同一性判据之一）。 */
  directoryName: string;
}

/**
 * 动态技能列表适配器：返回某 Provider 根目录下观测到的技能目录项。
 *
 * 用于 Workspace 级按 (canonicalRoot, directoryName) 去重的聚合计数。
 * 未提供时回退到不去重的 `sumProviderCounts`（保持向后兼容）。
 */
export type WorkspaceSkillLister = (options: ListOptions) => Promise<readonly ObservedSkillEntry[]>;

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

/**
 * 为每个 Workspace 收集按 canonical provider root 去重的技能标识集合。
 *
 * 去重键 = `canonical(providerRoot) + path.sep + directoryName`。
 * 返回 `Map<workspaceId, ReadonlySet<dedupKey>>`；未提供 lister 时返回空 Map
 * （调用方回退到 sumProviderCounts）。
 */
export async function collectWorkspaceSkillKeys(
  state: WorkspaceRegistryState,
  listSkills: WorkspaceSkillLister,
): Promise<ReadonlyMap<WorkspaceId, ReadonlySet<string>>> {
  const tasks: Array<Promise<readonly [WorkspaceId, ReadonlySet<string>]>> = [];
  const workspaces: Array<{ id: WorkspaceId; directory: string | null; global: boolean }> = [
    { id: GLOBAL_WORKSPACE_ID, directory: null, global: true },
    ...state.workspaces.map((workspace) => ({
      id: workspace.id,
      directory: availableDirectory(workspace.path),
      global: false,
    })),
  ];
  for (const workspace of workspaces) {
    const keySet = new Set<string>();
    tasks.push(listWorkspaceKeys(workspace, listSkills, keySet));
  }
  return new Map(await Promise.all(tasks));
}

async function listWorkspaceKeys(
  workspace: { id: WorkspaceId; directory: string | null; global: boolean },
  listSkills: WorkspaceSkillLister,
  keySet: Set<string>,
): Promise<readonly [WorkspaceId, ReadonlySet<string>]> {
  for (const provider of PROVIDER_CATALOG) {
    const root = workspace.global
      ? globalProviderRoot(provider)
      : workspace.directory
        ? importedProviderRoot(workspace.directory, provider)
        : null;
    if (!root || !providerRootAvailable(root)) continue;
    const providerId = provider.id as ProviderId;
    const entries = await listSkills({
      customDirs: [root],
      customProvider: providerId,
      scanDefaultDirs: false,
      all: true,
    });
    const canonicalRoot = safeCanonical(root) ?? root;
    for (const entry of entries) {
      // 去重键：canonical 根 + 平台分隔符 + 目录名（跨 Provider 共享路径下同一技能只计一次）。
      keySet.add(`${canonicalRoot}${path.sep}${entry.directoryName}`);
    }
  }
  return [workspace.id, keySet] as const;
}

/** Combine authoritative identity with dynamic counts and availability. */
export function projectWorkspaceSnapshot(
  state: WorkspaceRegistryState,
  counts: ReadonlyMap<string, number>,
  skillKeys?: ReadonlyMap<WorkspaceId, ReadonlySet<string>>,
): Workspace[] {
  const global = projectGlobalWorkspace(state.activeId, counts, skillKeys);
  return [
    global,
    ...state.workspaces.map((workspace) =>
      projectImportedWorkspace(workspace, state.activeId, counts, skillKeys),
    ),
  ];
}

/** Project one persisted Imported Workspace without mutating Registry state. */
export function projectImportedWorkspace(
  workspace: StoredWorkspace,
  activeId: WorkspaceId,
  counts: ReadonlyMap<string, number>,
  skillKeys?: ReadonlyMap<WorkspaceId, ReadonlySet<string>>,
): ImportedWorkspace {
  const directory = availableDirectory(workspace.path);
  const providers = projectProviders(workspace.id, directory, counts);
  return {
    ...workspace,
    kind: "directory",
    active: workspace.id === activeId,
    available: directory !== null,
    skillCount: workspaceSkillCount(workspace.id, providers, skillKeys),
    providers,
  };
}

function projectGlobalWorkspace(
  activeId: WorkspaceId,
  counts: ReadonlyMap<string, number>,
  skillKeys?: ReadonlyMap<WorkspaceId, ReadonlySet<string>>,
): GlobalWorkspace {
  const providers = projectProviders(GLOBAL_WORKSPACE_ID, null, counts);
  return {
    id: GLOBAL_WORKSPACE_ID,
    kind: "global",
    label: "Global Workspace",
    path: null,
    active: activeId === GLOBAL_WORKSPACE_ID,
    available: true,
    skillCount: workspaceSkillCount(GLOBAL_WORKSPACE_ID, providers, skillKeys),
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
      // Provider 级计数不受去重影响：每个 Provider 仍按其根目录报告全部技能。
      skillCount: counts.get(providerCountKey(workspaceId, id)) ?? 0,
    };
  });
}

/**
 * 计算 Workspace 级聚合计数。
 *
 * 优先使用按 canonical path 去重的技能集合大小（D4）；未提供集合时回退到
 * `sumProviderCounts`（向后兼容，语义为「不去重」）。
 */
function workspaceSkillCount(
  workspaceId: WorkspaceId,
  providers: readonly WorkspaceProvider[],
  skillKeys?: ReadonlyMap<WorkspaceId, ReadonlySet<string>>,
): number {
  if (skillKeys) {
    const keys = skillKeys.get(workspaceId);
    return keys ? keys.size : 0;
  }
  return sumProviderCounts(providers);
}

/** 求所有 Provider 计数的简单总和（不去重；保留以备 Provider 级聚合与回退场景）。 */
export function sumProviderCounts(providers: readonly WorkspaceProvider[]): number {
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

/** 安全求 canonical：失败时返回 null（不抛）。 */
function safeCanonical(target: string): string | null {
  try {
    return canonicalDirectory(target);
  } catch {
    return null;
  }
}
