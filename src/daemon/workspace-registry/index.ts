/**
 * Workspace Registry deep module.
 *
 * User inputs:
 * - [2026-07-22] "home 目录定义为一个特殊的 Workspace，或者叫 GlobalWorkspace。"
 * - [2026-07-22] "一个 Workspace 下，是可以包含多个 providers 的。"
 * Architecture decision [2026-07-22]: one daemon-owned Registry preserves
 * Workspace identity while catalog roots project its Provider scopes.
 *
 * Orthogonal intents:
 *   [1] Own the single in-memory and persisted Workspace registry truth.
 *   [2] Resolve server-owned discovery and writable scopes.
 *   [3] Publish retry-consistent dynamic Workspace projections.
 */
import fs from "node:fs";
import path from "node:path";
import { listSkills, type ListOptions } from "ccski";
import {
  GLOBAL_WORKSPACE_ID,
  ImportedWorkspaceIdSchema,
  type ImportedWorkspace,
  type ImportedWorkspaceId,
  type Workspace,
  type WorkspaceId,
  type WorkspaceProviderTarget,
} from "../../shared/contracts/workspaces.js";
import { DomainError } from "../domain-error.js";
import { canonicalDirectory, opaquePathId } from "../path-safety.js";
import { globalProviderRoot, importedProviderRoot, requireProvider } from "../provider-roots.js";
import { createWorkspaceRegistryPersistence } from "./persistence.js";
import {
  availableDirectory,
  projectImportedWorkspace,
  projectWorkspaceSnapshot,
  scanWorkspaceSnapshot,
  type WorkspaceSkillLister,
} from "./projection.js";
import {
  activateWorkspace,
  forgetWorkspace,
  importWorkspace,
  type StoredWorkspace,
  type WorkspaceRegistryState,
} from "./state.js";

/** Resolved ccski scope and writable Provider directory owned by the Registry. */
export interface WorkspaceProviderScope {
  target: WorkspaceProviderTarget;
  workspaceKind: "global" | "directory";
  workspaceLabel: string;
  directory: string;
  options: ListOptions;
}

/** Complete interface for registry commands, projections, and scope resolution. */
export interface WorkspaceRegistry {
  list: () => Promise<Workspace[]>;
  import: (directory: string, label?: string) => ImportedWorkspace;
  forget: (id: ImportedWorkspaceId) => WorkspaceId;
  activate: (id: WorkspaceId) => WorkspaceId;
  resolve: (target: WorkspaceProviderTarget, includeDisabled?: boolean) => WorkspaceProviderScope;
  resolveWritable: (target: WorkspaceProviderTarget) => WorkspaceProviderScope;
  /**
   * 轻量 Imported 查询（不触发 ccski 扫描）：wiki 等 scope 校验方只需要
   * 「id 是否注册」，不应付出全量投影代价。Global `~` 一律 null。
   */
  lookup: (id: WorkspaceId) => { id: ImportedWorkspaceId; label: string } | null;
}

/** Test seam for replacing ccski's dynamic skill scan（单遍产出计数与去重键）。 */
export interface WorkspaceRegistryOptions {
  listSkills?: WorkspaceSkillLister;
}

/** Create one daemon-owned Workspace Registry instance. */
export function createWorkspaceRegistry(options: WorkspaceRegistryOptions = {}): WorkspaceRegistry {
  const persistence = createWorkspaceRegistryPersistence();
  let state = persistence.load();
  let revision = 0;
  // 默认 ccski 扫描器：未注入桩时用于生产（计数与去重同源单遍）。
  const listSkills: WorkspaceSkillLister = options.listSkills ?? listCcskiSkills;

  const commit = (next: WorkspaceRegistryState): void => {
    if (next === state) return;
    persistence.commit(next);
    state = next;
    revision += 1;
  };

  return {
    async list() {
      for (;;) {
        const observedRevision = revision;
        const snapshot = state;
        try {
          const { counts, skillKeys } = await scanWorkspaceSnapshot(snapshot, listSkills);
          if (revision !== observedRevision) continue;
          return projectWorkspaceSnapshot(snapshot, counts, skillKeys);
        } catch (error) {
          if (revision === observedRevision) throw error;
        }
      }
    },

    import(directory, label) {
      const resolvedPath = path.resolve(directory);
      if (!fs.existsSync(resolvedPath)) {
        throw new DomainError("NOT_FOUND", "Workspace directory was not found.");
      }
      if (!fs.statSync(resolvedPath).isDirectory()) {
        throw new DomainError("INVALID_OPERATION", "Workspace path must be a directory.");
      }
      const canonicalPath = canonicalDirectory(resolvedPath);
      const entry: StoredWorkspace = {
        id: ImportedWorkspaceIdSchema.parse(opaquePathId("ws", canonicalPath)),
        label: label?.trim() || path.basename(canonicalPath) || canonicalPath,
        path: canonicalPath,
      };
      const result = importWorkspace(state, entry);
      if (result.changed) commit(result.state);
      return projectImportedWorkspace(result.entry, state.activeId, new Map());
    },

    forget(id) {
      const next = forgetWorkspace(state, ImportedWorkspaceIdSchema.parse(id));
      if (!next) throw new DomainError("NOT_FOUND", `Workspace not found: ${id}`);
      commit(next);
      return state.activeId;
    },

    activate(id) {
      const next = activateWorkspace(state, id);
      if (!next) throw new DomainError("NOT_FOUND", `Workspace not found: ${id}`);
      commit(next);
      return state.activeId;
    },

    resolve(target, includeDisabled = true) {
      const provider = requireProvider(target.providerId);
      if (target.workspaceId === GLOBAL_WORKSPACE_ID) {
        const directory = globalProviderRoot(provider);
        if (!directory) {
          throw new DomainError(
            "INVALID_OPERATION",
            `${provider.label} does not support Global Workspace skills.`,
          );
        }
        return providerScope(target, "global", "Global Workspace", directory, includeDisabled);
      }
      const entry = state.workspaces.find((workspace) => workspace.id === target.workspaceId);
      if (!entry) {
        throw new DomainError("NOT_FOUND", `Workspace not found: ${target.workspaceId}`);
      }
      const workspaceDirectory = availableDirectory(entry.path);
      if (!workspaceDirectory) {
        throw new DomainError("UNAVAILABLE", `Workspace directory is unavailable: ${entry.label}`);
      }
      return providerScope(
        target,
        "directory",
        entry.label,
        importedProviderRoot(workspaceDirectory, provider),
        includeDisabled,
      );
    },

    resolveWritable(target) {
      if (target.workspaceId === GLOBAL_WORKSPACE_ID) {
        throw new DomainError(
          "INVALID_OPERATION",
          "Global Workspace providers are not writable installation targets.",
        );
      }
      return this.resolve(target, true);
    },

    lookup(id) {
      if (id === GLOBAL_WORKSPACE_ID) return null;
      const entry = state.workspaces.find((workspace) => workspace.id === id);
      return entry ? { id: entry.id, label: entry.label } : null;
    },
  };
}

/** 默认 ccski 技能扫描适配器：单遍 listSkills 同时供计数与去重键。 */
async function listCcskiSkills(options: ListOptions) {
  const skills = await listSkills(options);
  return skills.map((skill) => ({ directoryName: path.basename(skill.path) }));
}

function providerScope(
  target: WorkspaceProviderTarget,
  workspaceKind: WorkspaceProviderScope["workspaceKind"],
  workspaceLabel: string,
  directory: string,
  includeDisabled: boolean,
): WorkspaceProviderScope {
  return {
    target,
    workspaceKind,
    workspaceLabel,
    directory,
    options: {
      customDirs: [directory],
      customProvider: target.providerId,
      scanDefaultDirs: false,
      all: includeDisabled,
    },
  };
}
