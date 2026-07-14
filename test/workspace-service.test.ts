/**
 * Workspace service contract tests.
 *
 * Original request [2026-07-14]: prove collision-resistant workspace identity,
 * home/imported scope isolation, and rejection of unknown workspaces.
 *
 * Orthogonal intents:
 *   [1] Workspace IDs remain unique for paths with a long common prefix.
 *   [2] Home and imported workspaces resolve to distinct ccski scopes.
 *   [3] Unknown workspace IDs never fall back to another workspace.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HOME_WORKSPACE_ID } from "../src/shared/contracts/workspaces.js";
import { setHomeOverride } from "../src/shared/paths.js";
import * as workspaceService from "../src/daemon/workspace-service.js";

const previousHome = process.env.SKILL_CREATOR_HOME;
let sandbox = "";

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-workspace-test-"));
  const isolatedHome = path.join(sandbox, "state");
  process.env.SKILL_CREATOR_HOME = isolatedHome;
  setHomeOverride(isolatedHome);
});

afterEach(() => {
  setHomeOverride(null);
  if (previousHome === undefined) delete process.env.SKILL_CREATOR_HOME;
  else process.env.SKILL_CREATOR_HOME = previousHome;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("workspace service", () => {
  it("assigns unique IDs to imported paths with the same long prefix", () => {
    const commonRoot = path.join(sandbox, "organizations", "engineering", "skills");
    const firstPath = path.join(commonRoot, "frontend");
    const secondPath = path.join(commonRoot, "backend");
    fs.mkdirSync(firstPath, { recursive: true });
    fs.mkdirSync(secondPath, { recursive: true });

    const first = workspaceService.add(firstPath);
    const second = workspaceService.add(secondPath);

    expect(first.id).toMatch(/^ws_[a-f0-9]{24}$/);
    expect(second.id).toMatch(/^ws_[a-f0-9]{24}$/);
    expect(first.id).not.toBe(second.id);
    expect(workspaceService.list().map((workspace) => workspace.id)).toEqual([
      HOME_WORKSPACE_ID,
      first.id,
      second.id,
    ]);
  });

  it("resolves home and imported workspaces to different discovery scopes", () => {
    const importedPath = path.join(sandbox, "imported-skills");
    fs.mkdirSync(importedPath, { recursive: true });
    const imported = workspaceService.add(importedPath);

    expect(workspaceService.readOptions(HOME_WORKSPACE_ID)).toEqual({ all: true });
    expect(workspaceService.readOptions(imported.id)).toEqual({
      skillDir: [fs.realpathSync(importedPath)],
      scanDefaultDirs: false,
      all: true,
    });
    expect(workspaceService.writableDirectory(imported.id)).toBe(fs.realpathSync(importedPath));
  });

  it("rejects unknown workspaces instead of falling back to the active workspace", () => {
    const importedPath = path.join(sandbox, "known-workspace");
    fs.mkdirSync(importedPath, { recursive: true });
    const known = workspaceService.add(importedPath);
    const unknownId = "ws_000000000000000000000000";

    expect(workspaceService.getActiveId()).toBe(known.id);
    expect(() => workspaceService.get(unknownId)).toThrow(`Workspace not found: ${unknownId}`);
    expect(() => workspaceService.setActive(unknownId)).toThrow(
      `Workspace not found: ${unknownId}`,
    );
    expect(() => workspaceService.readOptions(unknownId)).toThrow(
      `Workspace not found: ${unknownId}`,
    );
    expect(() => workspaceService.writableDirectory(unknownId)).toThrow(
      `Workspace not found: ${unknownId}`,
    );
    expect(workspaceService.getActiveId()).toBe(known.id);
  });
});
