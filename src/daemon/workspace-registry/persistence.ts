/**
 * Workspace Registry persistence adapter.
 *
 * User input [2026-07-15]: "按照你自己的节奏去推进开发迭代。"
 * Architecture decision [2026-07-15]: commit one authoritative mutation state
 * atomically and never persist asynchronous observations.
 * User input [2026-07-21]: "我们默认是破坏性更新的……使用 zod 的 safeParse
 * 来统一解决这个问题，遇到不兼容的就当是空值。"
 *
 * Orthogonal intents:
 *   [1] Load the current private Registry shape or discard incompatible stale state.
 *   [2] Atomically commit a complete next state.
 */
import fs from "node:fs";
import path from "node:path";
import { appDir } from "../../shared/paths.js";
import { atomicWriteUtf8 } from "../path-safety.js";
import {
  emptyRegistryState,
  WorkspaceRegistryStateSchema,
  type WorkspaceRegistryState,
} from "./state.js";

const WORKSPACES_FILE = "workspaces.json";

/** Load only the current Registry shape and atomically commit authoritative state. */
export interface WorkspaceRegistryPersistence {
  load: () => WorkspaceRegistryState;
  commit: (state: WorkspaceRegistryState) => void;
}

/** Bind Registry persistence to the current application data directory. */
export function createWorkspaceRegistryPersistence(): WorkspaceRegistryPersistence {
  const file = path.join(appDir(), WORKSPACES_FILE);
  return {
    load: () => loadState(file),
    commit: (state) => commitState(file, state),
  };
}

function loadState(file: string): WorkspaceRegistryState {
  if (!fs.existsSync(file)) return emptyRegistryState();
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(
      `Cannot read workspace registry ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const result = WorkspaceRegistryStateSchema.safeParse(parsed);
  return result.success ? result.data : emptyRegistryState();
}

function commitState(file: string, state: WorkspaceRegistryState): void {
  const validated = WorkspaceRegistryStateSchema.parse(state);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  atomicWriteUtf8(file, `${JSON.stringify(validated, null, 2)}\n`);
}
