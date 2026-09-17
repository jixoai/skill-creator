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
import os from "node:os";
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

/** 单个技能目录项的最小观测（用于去重，不携带敏感字段）。 */
export interface ObservedSkillEntry {
  /** 技能目录名（同一性判据之一）。 */
  directoryName: string;
}

/**
 * 动态技能列表适配器：返回某 Provider 根目录下观测到的技能目录项。
 *
 * 单次扫描同时产出 Provider 级计数与 Workspace 级去重集合
 * （perf-firstscreen：此前 counter 与 lister 各跑一遍 ccski 全量扫描，
 * 真实语料下单次 registry.list 放大到 ~1.8s 同步 IO）。
 */
export type WorkspaceSkillLister = (options: ListOptions) => Promise<readonly ObservedSkillEntry[]>;

/** 单遍扫描产物：Provider 计数 + Workspace 去重键集合。 */
export interface WorkspaceScanResult {
  /** `workspaceId:providerId` → 该 Provider root 观测到的技能数。 */
  counts: ReadonlyMap<string, number>;
  /** workspaceId → (canonicalRoot, directoryName) 去重键集合。 */
  skillKeys: ReadonlyMap<WorkspaceId, ReadonlySet<string>>;
}

function providerCountKey(workspaceId: WorkspaceId, providerId: ProviderId): string {
  return `${workspaceId}:${providerId}`;
}

/**
 * 非 claude-code Provider 的插件发现重定向目标（永不存在的路径）：
 * ccski 的 list API 不透传 skipPlugins（buildRegistryOptions 白名单），
 * 但 pluginsFile/pluginsRoot 缺失时插件发现静默跳过——以此消除「扫一个
 * root 却读 ~/.claude settings/plugins + 遍历插件 installPath」的全局
 * 副作用（真实语料 50 roots 下重复 50 遍）。claude-code 保留默认行为。
 */
const SKIP_PLUGINS_PATH = path.join(os.tmpdir(), ".skill-creator-skip-plugins");

/**
 * 单遍扫描一个 immutable snapshot：每个存在的 root 只调一次 lister，
 * 同一份 entries 同时产出 Provider 计数与 Workspace 去重集合。
 *
 * 非 claude-code Provider 传 `n: true` 跳过 ccski 的 Claude 插件全局
 * 发现副作用（读 ~/.claude settings + 扫插件 installPath——与该 root 的
 * 技能发现无关，真实语料 50 roots 循环下重复执行 50 遍）；claude-code
 * 保留插件技能语义。
 */
export async function scanWorkspaceSnapshot(
  state: WorkspaceRegistryState,
  listSkills: WorkspaceSkillLister,
): Promise<WorkspaceScanResult> {
  const counts = new Map<string, number>();
  const skillKeys = new Map<WorkspaceId, ReadonlySet<string>>();
  const workspaces: Array<{ id: WorkspaceId; directory: string | null; global: boolean }> = [
    { id: GLOBAL_WORKSPACE_ID, directory: null, global: true },
    ...state.workspaces.map((workspace) => ({
      id: workspace.id,
      directory: availableDirectory(workspace.path),
      global: false,
    })),
  ];
  const tasks: Array<Promise<void>> = [];
  for (const workspace of workspaces) {
    const keySet = new Set<string>();
    skillKeys.set(workspace.id, keySet);
    for (const provider of PROVIDER_CATALOG) {
      const root = workspace.global
        ? globalProviderRoot(provider)
        : workspace.directory
          ? importedProviderRoot(workspace.directory, provider)
          : null;
      const providerId = provider.id as ProviderId;
      const scan =
        root && providerRootAvailable(root)
          ? listSkills({
              customDirs: [root],
              customProvider: providerId,
              scanDefaultDirs: false,
              all: true,
              ...(provider.id === "claude-code"
                ? {}
                : { claudePluginsFile: SKIP_PLUGINS_PATH, claudePluginsRoot: SKIP_PLUGINS_PATH }),
            })
          : Promise.resolve([]);
      tasks.push(
        scan.then((entries) => {
          counts.set(providerCountKey(workspace.id, providerId), entries.length);
          const canonicalRoot = root === null ? "" : (safeCanonical(root) ?? root);
          for (const entry of entries) {
            // 去重键：canonical 根 + 平台分隔符 + 目录名（跨 Provider 共享路径下同一技能只计一次）。
            keySet.add(`${canonicalRoot}${path.sep}${entry.directoryName}`);
          }
        }),
      );
    }
  }
  await Promise.all(tasks);
  return { counts, skillKeys };
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
