/**
 * Workspace Registry persistence adapter.
 *
 * User input [2026-07-15]: "按照你自己的节奏去推进开发迭代。"
 * Architecture decision [2026-07-15]: commit one authoritative mutation state
 * atomically and never persist asynchronous observations.
 *
 * Orthogonal intents:
 *   [1] Load and strictly validate the private registry file.
 *   [2] Atomically commit a complete next state.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { appDir } from "../../shared/paths.js";
import { atomicWriteUtf8 } from "../path-safety.js";
import {
  emptyRegistryState,
  WorkspaceRegistryStateSchema,
  type WorkspaceRegistryState,
} from "./state.js";

const WORKSPACES_FILE = "workspaces.json";

/** Strict load and atomic commit adapter for the private Registry file. */
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
  if (!result.success) {
    throw new Error(`Invalid workspace registry ${file}: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}

function commitState(file: string, state: WorkspaceRegistryState): void {
  const validated = WorkspaceRegistryStateSchema.parse(state);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  atomicWriteUtf8(file, `${JSON.stringify(validated, null, 2)}\n`);
}
