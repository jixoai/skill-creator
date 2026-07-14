/**
 * Workspace registry and server-owned scope resolution.
 *
 * User intent [2026-07-14]: `/workspace/~/` manages default agent skills and
 * imported directories are isolated workspaces.
 * Original error request [2026-07-14]: expose expected workspace failures as
 * safe typed errors while registry corruption remains internal.
 *
 * Orthogonal intents:
 *   [1] Persist canonical imported directories with collision-resistant IDs.
 *   [2] Resolve every skill read/write to a server-owned workspace boundary.
 *   [3] Project active, available, and skill-count state to the WebUI.
 */
import fs from "node:fs";
import path from "node:path";
import { listSkills, type ListOptions } from "ccski";
import { z } from "zod";
import {
  HOME_WORKSPACE_ID,
  ImportedWorkspaceIdSchema,
  WorkspaceIdSchema,
  type Workspace,
  type WorkspaceId,
} from "../shared/contracts/workspaces.js";
import { appDir } from "../shared/paths.js";
import { DomainError } from "./domain-error.js";
import { atomicWriteUtf8, canonicalDirectory, opaquePathId } from "./path-safety.js";

const WORKSPACES_FILE = "workspaces.json";

const StoredWorkspaceSchema = z.object({
  id: ImportedWorkspaceIdSchema,
  label: z.string().trim().min(1),
  path: z.string().min(1),
  skillCount: z.number().int().nonnegative(),
});

const WorkspacesStoreSchema = z.object({
  activeId: WorkspaceIdSchema,
  workspaces: z.array(StoredWorkspaceSchema),
});
type WorkspacesStore = z.infer<typeof WorkspacesStoreSchema>;
type StoredWorkspace = z.infer<typeof StoredWorkspaceSchema>;

function workspacesPath(): string {
  return path.join(appDir(), WORKSPACES_FILE);
}

function emptyStore(): WorkspacesStore {
  return { activeId: HOME_WORKSPACE_ID, workspaces: [] };
}

function loadStore(): WorkspacesStore {
  const file = workspacesPath();
  if (!fs.existsSync(file)) return emptyStore();
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(
      `Cannot read workspace registry ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const result = WorkspacesStoreSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid workspace registry ${file}: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}

function saveStore(store: WorkspacesStore): void {
  fs.mkdirSync(appDir(), { recursive: true, mode: 0o700 });
  atomicWriteUtf8(workspacesPath(), `${JSON.stringify(store, null, 2)}\n`);
}

function homeWorkspace(store: WorkspacesStore, skillCount: number): Workspace {
  return {
    id: HOME_WORKSPACE_ID,
    kind: "home",
    label: "All agent skills",
    path: null,
    active: store.activeId === HOME_WORKSPACE_ID,
    available: true,
    skillCount,
  };
}

function isAvailableDirectory(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function projectWorkspace(entry: StoredWorkspace, activeId: WorkspaceId): Workspace {
  return {
    ...entry,
    kind: "directory",
    active: entry.id === activeId,
    available: isAvailableDirectory(entry.path),
  };
}

/** Return the home workspace followed by imported directories. */
export function list(): Workspace[] {
  const store = loadStore();
  return [
    homeWorkspace(store, 0),
    ...store.workspaces.map((workspace) => projectWorkspace(workspace, store.activeId)),
  ];
}

/** Resolve one server-owned workspace ID without implicit fallback. */
export function get(id: WorkspaceId): Workspace {
  const store = loadStore();
  if (id === HOME_WORKSPACE_ID) return homeWorkspace(store, 0);
  const entry = store.workspaces.find((workspace) => workspace.id === id);
  if (!entry) throw new DomainError("NOT_FOUND", `Workspace not found: ${id}`);
  return projectWorkspace(entry, store.activeId);
}

/** Return the workspace currently selected by the daemon registry. */
export function getActiveId(): WorkspaceId {
  return loadStore().activeId;
}

/** Import a canonical directory. Existing directories are returned idempotently. */
export function add(dirPath: string, label?: string): Workspace {
  const resolvedPath = path.resolve(dirPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new DomainError("NOT_FOUND", "Workspace directory was not found.");
  }
  if (!fs.statSync(resolvedPath).isDirectory()) {
    throw new DomainError("INVALID_OPERATION", "Workspace path must be a directory.");
  }
  const canonicalPath = canonicalDirectory(resolvedPath);
  const store = loadStore();
  const existing = store.workspaces.find((workspace) => workspace.path === canonicalPath);
  if (existing) return projectWorkspace(existing, store.activeId);

  const entry: StoredWorkspace = {
    id: ImportedWorkspaceIdSchema.parse(opaquePathId("ws", canonicalPath)),
    label: label?.trim() || path.basename(canonicalPath),
    path: canonicalPath,
    skillCount: 0,
  };
  store.workspaces.push(entry);
  store.activeId = entry.id;
  saveStore(store);
  return projectWorkspace(entry, store.activeId);
}

/** Remove an imported workspace registration without deleting its directory. */
export function remove(id: string): WorkspaceId {
  const parsedId = ImportedWorkspaceIdSchema.parse(id);
  const store = loadStore();
  const index = store.workspaces.findIndex((workspace) => workspace.id === parsedId);
  if (index < 0) throw new DomainError("NOT_FOUND", `Workspace not found: ${parsedId}`);
  store.workspaces.splice(index, 1);
  if (store.activeId === parsedId) store.activeId = HOME_WORKSPACE_ID;
  saveStore(store);
  return store.activeId;
}

/** Select a known home or imported workspace. */
export function setActive(id: string): WorkspaceId {
  const parsedId = WorkspaceIdSchema.parse(id);
  const store = loadStore();
  if (
    parsedId !== HOME_WORKSPACE_ID &&
    !store.workspaces.some((workspace) => workspace.id === parsedId)
  ) {
    throw new DomainError("NOT_FOUND", `Workspace not found: ${parsedId}`);
  }
  store.activeId = parsedId;
  saveStore(store);
  return parsedId;
}

/** Resolve a workspace ID to ccski discovery options. */
export function readOptions(id: WorkspaceId, includeDisabled = true): ListOptions {
  if (id === HOME_WORKSPACE_ID) {
    return { all: includeDisabled };
  }
  const workspace = get(id);
  if (!workspace.path || !workspace.available) {
    throw new DomainError("UNAVAILABLE", `Workspace directory is unavailable: ${workspace.label}`);
  }
  return {
    skillDir: [workspace.path],
    scanDefaultDirs: false,
    all: includeDisabled,
  };
}

/** Resolve an imported workspace to its canonical writable root. */
export function writableDirectory(id: string): string {
  const parsedId = ImportedWorkspaceIdSchema.parse(id);
  const workspace = get(parsedId);
  if (!workspace.path || !workspace.available) {
    throw new DomainError("UNAVAILABLE", `Workspace directory is unavailable: ${workspace.label}`);
  }
  return canonicalDirectory(workspace.path);
}

/** Refresh counts without changing active workspace or swallowing registry corruption. */
export async function listWithFreshCounts(): Promise<Workspace[]> {
  const store = loadStore();
  const homeSkills = await listSkills(readOptions(HOME_WORKSPACE_ID, true));
  for (const workspace of store.workspaces) {
    if (!isAvailableDirectory(workspace.path)) {
      workspace.skillCount = 0;
      continue;
    }
    const skills = await listSkills({
      skillDir: [workspace.path],
      scanDefaultDirs: false,
      all: true,
    });
    workspace.skillCount = skills.length;
  }
  saveStore(store);
  return [
    homeWorkspace(store, homeSkills.length),
    ...store.workspaces.map((workspace) => projectWorkspace(workspace, store.activeId)),
  ];
}
