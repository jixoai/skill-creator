/**
 * Workspace Registry module contract tests.
 *
 * User input [2026-07-15]: "按照你自己的节奏去推进开发迭代。"
 * Architecture decision [2026-07-15]: concurrent projections and mutations must
 * preserve every authoritative imported Workspace transition.
 * User input [2026-07-21]: "我们默认是破坏性更新的……遇到不兼容的就当是空值。"
 *
 * Orthogonal intents:
 *   [1] Prove collision-resistant identity and isolated discovery scopes.
 *   [2] Prove non-destructive persistence and recovery from incompatible stale state.
 *   [3] Prove asynchronous projections cannot overwrite or hide newer mutations.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ListOptions } from "ccski";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceRegistry } from "../src/daemon/workspace-registry/index.js";
import {
  HOME_WORKSPACE_ID,
  ImportedWorkspaceIdSchema,
} from "../src/shared/contracts/workspaces.js";
import { appDir, setHomeOverride } from "../src/shared/paths.js";

const previousHome = process.env.SKILL_CREATOR_HOME;
let sandbox = "";

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-workspace-registry-test-"));
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

function directory(...segments: string[]): string {
  const result = path.join(sandbox, ...segments);
  fs.mkdirSync(result, { recursive: true });
  return result;
}

function zeroCount(): Promise<number> {
  return Promise.resolve(0);
}

function activeId(
  workspaces: Awaited<ReturnType<ReturnType<typeof createWorkspaceRegistry>["list"]>>,
) {
  return workspaces.find((workspace) => workspace.active)?.id;
}

function deferredCounter(): {
  count: (options: ListOptions) => Promise<number>;
  started: Promise<void>;
  release: () => void;
} {
  let signalStarted: () => void = () => {};
  let signalRelease: () => void = () => {};
  let shouldPause = true;
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve;
  });
  const released = new Promise<void>((resolve) => {
    signalRelease = resolve;
  });

  return {
    started,
    release: signalRelease,
    count: async (options) => {
      if (shouldPause && !("skillDir" in options)) {
        shouldPause = false;
        signalStarted();
        await released;
      }
      return "skillDir" in options ? (options.skillDir?.[0]?.length ?? 0) : 7;
    },
  };
}

function deferredRejectingCounter(directory: string): {
  count: (options: ListOptions) => Promise<number>;
  started: Promise<void>;
  reject: () => void;
} {
  let signalStarted: () => void = () => {};
  let rejectCount: (error: Error) => void = () => {};
  let shouldReject = true;
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve;
  });
  const rejected = new Promise<never>((_resolve, reject) => {
    rejectCount = reject;
  });

  return {
    started,
    reject: () => rejectCount(new Error("Forgotten Workspace is unavailable.")),
    count: async (options) => {
      if (shouldReject && options.skillDir?.[0] === directory) {
        shouldReject = false;
        signalStarted();
        return rejected;
      }
      return 0;
    },
  };
}

describe("Workspace Registry", () => {
  it("assigns unique IDs and resolves home/imported discovery scopes", async () => {
    const registry = createWorkspaceRegistry({ countSkills: zeroCount });
    const commonRoot = ["organizations", "engineering", "skills"];
    const firstPath = directory(...commonRoot, "frontend");
    const secondPath = directory(...commonRoot, "backend");

    const first = registry.import(firstPath);
    const second = registry.import(secondPath);

    expect(first.id).toMatch(/^ws_[a-f0-9]{24}$/);
    expect(second.id).toMatch(/^ws_[a-f0-9]{24}$/);
    expect(first.id).not.toBe(second.id);
    expect((await registry.list()).map((workspace) => workspace.id)).toEqual([
      HOME_WORKSPACE_ID,
      first.id,
      second.id,
    ]);
    expect(registry.resolve(HOME_WORKSPACE_ID).options).toEqual({ all: true });
    expect(registry.resolve(first.id).options).toEqual({
      skillDir: [fs.realpathSync(firstPath)],
      scanDefaultDirs: false,
      all: true,
    });
  });

  it("persists active state across restart and forgets without deleting files", async () => {
    const firstRegistry = createWorkspaceRegistry({ countSkills: zeroCount });
    const firstPath = directory("first");
    const secondPath = directory("second");
    const marker = path.join(firstPath, "keep.txt");
    fs.writeFileSync(marker, "preserve", "utf8");
    const first = firstRegistry.import(firstPath, "First");
    const second = firstRegistry.import(secondPath, "Second");
    firstRegistry.activate(first.id);

    const restarted = createWorkspaceRegistry({ countSkills: zeroCount });
    expect(activeId(await restarted.list())).toBe(first.id);
    expect(restarted.resolve(second.id).directory).toBe(fs.realpathSync(secondPath));

    restarted.forget(first.id);
    expect(fs.readFileSync(marker, "utf8")).toBe("preserve");
    expect(activeId(await restarted.list())).toBe(HOME_WORKSPACE_ID);

    const persisted = fs.readFileSync(path.join(appDir(), "workspaces.json"), "utf8");
    expect(persisted).not.toContain("skillCount");
    expect(persisted).toContain('"schemaVersion": 1');
  });

  it("treats an incompatible persisted Registry as empty until a mutation commits v1", async () => {
    const legacySource = JSON.stringify({ activeId: null, workspaces: [] });
    fs.mkdirSync(appDir(), { recursive: true });
    const registryFile = path.join(appDir(), "workspaces.json");
    fs.writeFileSync(registryFile, legacySource, "utf8");

    const registry = createWorkspaceRegistry({ countSkills: zeroCount });
    expect((await registry.list()).map((workspace) => workspace.id)).toEqual([HOME_WORKSPACE_ID]);
    expect(fs.readFileSync(registryFile, "utf8")).toBe(legacySource);

    const imported = registry.import(directory("current"));
    expect(JSON.parse(fs.readFileSync(registryFile, "utf8"))).toMatchObject({
      schemaVersion: 1,
      activeId: imported.id,
      workspaces: [expect.objectContaining({ id: imported.id })],
    });
  });

  it("rejects a Registry file that is not valid JSON", () => {
    fs.mkdirSync(appDir(), { recursive: true });
    fs.writeFileSync(path.join(appDir(), "workspaces.json"), "{", "utf8");

    expect(() => createWorkspaceRegistry({ countSkills: zeroCount })).toThrow(
      "Cannot read workspace registry",
    );
  });

  it("rejects unknown IDs without changing the active Workspace", async () => {
    const registry = createWorkspaceRegistry({ countSkills: zeroCount });
    const known = registry.import(directory("known"));
    const unknownId = ImportedWorkspaceIdSchema.parse("ws_000000000000000000000000");

    expect(() => registry.resolve(unknownId)).toThrow(`Workspace not found: ${unknownId}`);
    expect(() => registry.activate(unknownId)).toThrow(`Workspace not found: ${unknownId}`);
    expect(() => registry.forget(unknownId)).toThrow(`Workspace not found: ${unknownId}`);
    expect(activeId(await registry.list())).toBe(known.id);
  });

  it("discards a persisted Workspace ID that does not belong to its path", async () => {
    const registry = createWorkspaceRegistry({ countSkills: zeroCount });
    const known = registry.import(directory("known"));
    const forgedId = ImportedWorkspaceIdSchema.parse("ws_000000000000000000000000");
    fs.writeFileSync(
      path.join(appDir(), "workspaces.json"),
      JSON.stringify({
        schemaVersion: 1,
        activeId: forgedId,
        workspaces: [{ id: forgedId, label: known.label, path: known.path }],
      }),
      "utf8",
    );

    const recovered = createWorkspaceRegistry({ countSkills: zeroCount });
    expect((await recovered.list()).map((workspace) => workspace.id)).toEqual([HOME_WORKSPACE_ID]);
  });

  it("discards a relative persisted Workspace path", async () => {
    const relativeId = ImportedWorkspaceIdSchema.parse("ws_2cf26298d998c2a65f9bc237");
    fs.mkdirSync(appDir(), { recursive: true });
    fs.writeFileSync(
      path.join(appDir(), "workspaces.json"),
      JSON.stringify({
        schemaVersion: 1,
        activeId: relativeId,
        workspaces: [{ id: relativeId, label: "Relative", path: "relative/workspace" }],
      }),
      "utf8",
    );

    const recovered = createWorkspaceRegistry({ countSkills: zeroCount });
    expect((await recovered.list()).map((workspace) => workspace.id)).toEqual([HOME_WORKSPACE_ID]);
  });

  it("discards a non-normalized persisted Workspace path", async () => {
    const canonicalPath = directory("normalized");
    const storedPath = `${canonicalPath}${path.sep}..${path.sep}${path.basename(canonicalPath)}`;
    const storedId = ImportedWorkspaceIdSchema.parse(
      `ws_${createHash("sha256").update(storedPath).digest("hex").slice(0, 24)}`,
    );
    fs.mkdirSync(appDir(), { recursive: true });
    fs.writeFileSync(
      path.join(appDir(), "workspaces.json"),
      JSON.stringify({
        schemaVersion: 1,
        activeId: storedId,
        workspaces: [{ id: storedId, label: "Normalized", path: storedPath }],
      }),
      "utf8",
    );

    const recovered = createWorkspaceRegistry({ countSkills: zeroCount });
    expect((await recovered.list()).map((workspace) => workspace.id)).toEqual([HOME_WORKSPACE_ID]);
  });

  it("restarts a projection when a Workspace is imported while counts are pending", async () => {
    const counter = deferredCounter();
    const registry = createWorkspaceRegistry({ countSkills: counter.count });
    const first = registry.import(directory("first"));

    const pendingList = registry.list();
    await counter.started;
    const second = registry.import(directory("second"));
    counter.release();

    const projected = await pendingList;
    expect(projected.map((workspace) => workspace.id)).toEqual([
      HOME_WORKSPACE_ID,
      first.id,
      second.id,
    ]);
    expect(activeId(projected)).toBe(second.id);

    const restarted = createWorkspaceRegistry({ countSkills: zeroCount });
    expect((await restarted.list()).map((workspace) => workspace.id)).toContain(second.id);
  });

  it("projects the latest forget and activation while counts are pending", async () => {
    const counter = deferredCounter();
    const registry = createWorkspaceRegistry({ countSkills: counter.count });
    const firstPath = directory("first");
    const first = registry.import(firstPath);
    const second = registry.import(directory("second"));
    registry.activate(first.id);

    const pendingList = registry.list();
    await counter.started;
    registry.forget(first.id);
    registry.activate(second.id);
    counter.release();

    const projected = await pendingList;
    expect(projected.map((workspace) => workspace.id)).toEqual([HOME_WORKSPACE_ID, second.id]);
    expect(activeId(projected)).toBe(second.id);
    expect(fs.existsSync(firstPath)).toBe(true);
  });

  it("discards a stale count failure after its Workspace is forgotten", async () => {
    const firstPath = directory("first");
    const counter = deferredRejectingCounter(fs.realpathSync(firstPath));
    const registry = createWorkspaceRegistry({ countSkills: counter.count });
    const first = registry.import(firstPath);
    const second = registry.import(directory("second"));

    const pendingList = registry.list();
    await counter.started;
    registry.forget(first.id);
    counter.reject();

    const projected = await pendingList;
    expect(projected.map((workspace) => workspace.id)).toEqual([HOME_WORKSPACE_ID, second.id]);
    expect(activeId(projected)).toBe(second.id);
  });
});
