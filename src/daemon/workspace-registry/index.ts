/**
 * Workspace Registry deep module.
 *
 * User inputs:
 * - [2026-07-14] "skills manager 只是路由的一部分(`/workspace/~/`)；我们还需要支持导入 workspace"
 * - [2026-07-15] "按照你自己的节奏去推进开发迭代。"
 * Architecture decision [2026-07-15]: one daemon-owned Registry preserves
 * imported Workspace identity independently from dynamic projections.
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
  HOME_WORKSPACE_ID,
  ImportedWorkspaceIdSchema,
  type ImportedWorkspace,
  type ImportedWorkspaceId,
  type Workspace,
  type WorkspaceId,
} from "../../shared/contracts/workspaces.js";
import { DomainError } from "../domain-error.js";
import { canonicalDirectory, opaquePathId } from "../path-safety.js";
import { createWorkspaceRegistryPersistence } from "./persistence.js";
import {
  availableDirectory,
  countWorkspaceSnapshot,
  projectImportedWorkspace,
  projectWorkspaceSnapshot,
  type WorkspaceSkillCounter,
} from "./projection.js";
import {
  activateWorkspace,
  forgetWorkspace,
  importWorkspace,
  type StoredWorkspace,
  type WorkspaceRegistryState,
} from "./state.js";

/** Resolved ccski scope and optional writable directory owned by the Registry. */
export type WorkspaceScope =
  | {
      id: typeof HOME_WORKSPACE_ID;
      kind: "home";
      label: string;
      directory: null;
      options: ListOptions;
    }
  | {
      id: ImportedWorkspaceId;
      kind: "directory";
      label: string;
      directory: string;
      options: ListOptions;
    };

/** Complete interface for registry commands, projections, and scope resolution. */
export interface WorkspaceRegistry {
  list: () => Promise<Workspace[]>;
  import: (directory: string, label?: string) => ImportedWorkspace;
  forget: (id: ImportedWorkspaceId) => WorkspaceId;
  activate: (id: WorkspaceId) => WorkspaceId;
  resolve: (id: WorkspaceId, includeDisabled?: boolean) => WorkspaceScope;
}

/** Test seam for replacing ccski's dynamic skill counter. */
export interface WorkspaceRegistryOptions {
  countSkills?: WorkspaceSkillCounter;
}

/** Create one daemon-owned Workspace Registry instance. */
export function createWorkspaceRegistry(options: WorkspaceRegistryOptions = {}): WorkspaceRegistry {
  const persistence = createWorkspaceRegistryPersistence();
  let state = persistence.load();
  let revision = 0;
  const countSkills = options.countSkills ?? countCcskiSkills;

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
          const counts = await countWorkspaceSnapshot(snapshot, countSkills);
          if (revision === observedRevision) return projectWorkspaceSnapshot(snapshot, counts);
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
      return projectImportedWorkspace(result.entry, state.activeId, 0);
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

    resolve(id, includeDisabled = true) {
      if (id === HOME_WORKSPACE_ID) {
        return {
          id: HOME_WORKSPACE_ID,
          kind: "home",
          label: "All agent skills",
          directory: null,
          options: { all: includeDisabled },
        };
      }
      const entry = state.workspaces.find((workspace) => workspace.id === id);
      if (!entry) throw new DomainError("NOT_FOUND", `Workspace not found: ${id}`);
      const directory = availableDirectory(entry.path);
      if (!directory) {
        throw new DomainError("UNAVAILABLE", `Workspace directory is unavailable: ${entry.label}`);
      }
      return {
        id: entry.id,
        kind: "directory",
        label: entry.label,
        directory,
        options: {
          skillDir: [directory],
          scanDefaultDirs: false,
          all: includeDisabled,
        },
      };
    },
  };
}

async function countCcskiSkills(options: ListOptions): Promise<number> {
  return (await listSkills(options)).length;
}
