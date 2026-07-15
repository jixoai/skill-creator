/**
 * Repository service lifecycle contract tests.
 *
 * User input [2026-07-15]: "按照你自己的节奏去推进开发迭代。"
 * Architecture decision [2026-07-15]: shutdown and eviction must not delete a
 * snapshot while an accepted Repository operation still owns it.
 *
 * Orthogonal intents:
 *   [1] Prove disposal is terminal for pending and future repository scans.
 *   [2] Prove an unretained clone snapshot is removed during the shutdown race.
 *   [3] Keep an evicted snapshot alive until its in-flight install releases it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  createRepositoryService,
  type RepositoryInstaller,
  type RepositoryService,
} from "../src/daemon/repository-service.js";
import { createSkillService } from "../src/daemon/skill-service.js";
import { createWorkspaceRegistry } from "../src/daemon/workspace-registry/index.js";
import { setHomeOverride } from "../src/shared/paths.js";

const previousHome = process.env.SKILL_CREATOR_HOME;
let sandbox = "";
let repository: RepositoryService | null = null;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-repository-lifecycle-test-"));
  const isolatedHome = path.join(sandbox, "state");
  process.env.SKILL_CREATOR_HOME = isolatedHome;
  setHomeOverride(isolatedHome);
});

afterEach(async () => {
  await repository?.dispose();
  repository = null;
  setHomeOverride(null);
  if (previousHome === undefined) delete process.env.SKILL_CREATOR_HOME;
  else process.env.SKILL_CREATOR_HOME = previousHome;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("repository service lifecycle", () => {
  it("cannot retain or preview a clone that finishes after disposal starts", async () => {
    const snapshot = path.join(sandbox, "snapshot");
    const skillDirectory = path.join(snapshot, "skills", "lifecycle");
    fs.mkdirSync(skillDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(skillDirectory, "SKILL.md"),
      '---\nname: "lifecycle"\ndescription: "Exercise repository disposal."\n---\n# Lifecycle\n',
      "utf8",
    );

    let signalStarted: () => void = () => {};
    let releaseClone: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const cloneReleased = new Promise<void>((resolve) => {
      releaseClone = resolve;
    });
    let cloneSignal: AbortSignal | null = null;
    const workspaces = createWorkspaceRegistry();
    repository = createRepositoryService(workspaces, createSkillService(workspaces), {
      clone: async (_source, _ref, cancelSignal) => {
        cloneSignal = cancelSignal;
        signalStarted();
        await cloneReleased;
        return { directory: snapshot, commit: "a".repeat(40) };
      },
    });

    const pendingScan = repository.scan("deferred://repository");
    await started;
    const disposing = Promise.resolve(repository.dispose());
    const cloneWasAborted = cloneSignal?.aborted;
    releaseClone();
    expect(cloneWasAborted).toBe(true);

    await expect(pendingScan).rejects.toThrow("Repository service is shutting down");
    await disposing;
    expect(fs.existsSync(snapshot)).toBe(false);
    await expect(repository.scan("deferred://repository")).rejects.toThrow(
      "Repository service is shutting down",
    );
  });

  it("rejects an invalid Git commit identity and removes its unretained snapshot", async () => {
    const snapshot = path.join(sandbox, "invalid-commit-snapshot");
    fs.mkdirSync(snapshot);
    const workspaces = createWorkspaceRegistry();
    repository = createRepositoryService(workspaces, createSkillService(workspaces), {
      clone: async () => ({ directory: snapshot, commit: "not-a-commit" }),
    });

    await expect(repository.scan("fixture://invalid-commit")).rejects.toBeInstanceOf(ZodError);
    expect(fs.existsSync(snapshot)).toBe(false);
  });

  it("defers deletion of an evicted snapshot until its active install finishes", async () => {
    const workspaces = createWorkspaceRegistry();
    const destination = path.join(sandbox, "destination");
    fs.mkdirSync(destination);
    const workspace = workspaces.import(destination, "Destination");
    const snapshots: string[] = [];
    let cloneIndex = 0;
    let signalInstallStarted: () => void = () => {};
    let releaseInstall: () => void = () => {};
    const installStarted = new Promise<void>((resolve) => {
      signalInstallStarted = resolve;
    });
    const installReleased = new Promise<void>((resolve) => {
      releaseInstall = resolve;
    });
    let leasedSnapshot = "";
    const install: RepositoryInstaller = async (options) => {
      leasedSnapshot = options.source;
      signalInstallStarted();
      await installReleased;
      const sourceFile = path.join(leasedSnapshot, "skills", "leased", "SKILL.md");
      expect(fs.existsSync(sourceFile)).toBe(true);
      const installedDirectory = path.join(destination, "leased");
      fs.mkdirSync(installedDirectory);
      fs.copyFileSync(sourceFile, path.join(installedDirectory, "SKILL.md"));
      return {
        results: [
          {
            skill: "leased",
            destination,
            path: installedDirectory,
            status: "installed",
          },
        ],
        installed: 1,
        skipped: 0,
        overwritten: 0,
        failed: 0,
      };
    };
    repository = createRepositoryService(workspaces, createSkillService(workspaces), {
      clone: async () => {
        cloneIndex += 1;
        const snapshot = path.join(sandbox, `snapshot-${cloneIndex}`);
        snapshots.push(snapshot);
        const skillDirectory = path.join(snapshot, "skills", "leased");
        fs.mkdirSync(skillDirectory, { recursive: true });
        fs.writeFileSync(
          path.join(skillDirectory, "SKILL.md"),
          '---\nname: "leased"\ndescription: "Keep the pinned snapshot leased."\n---\n# Leased\n',
          "utf8",
        );
        return { directory: snapshot, commit: cloneIndex.toString(16).padStart(40, "0") };
      },
      installSkills: install,
    });

    const oldest = await repository.scan("fixture://oldest");
    const selected = oldest.skills[0];
    if (!selected) throw new Error("Expected the oldest scan to discover a skill.");
    const installing = repository.install({
      sessionId: oldest.sessionId,
      skillIds: [selected.id],
      workspaceId: workspace.id,
    });
    await installStarted;

    for (let index = 0; index < 6; index += 1) {
      await repository.scan(`fixture://replacement-${index}`);
    }

    expect(leasedSnapshot).toBe(snapshots[0]);
    expect(fs.existsSync(leasedSnapshot)).toBe(true);
    await expect(repository.preview(oldest.sessionId, selected.id)).rejects.toThrow(
      "Repository session expired",
    );

    releaseInstall();
    await expect(installing).resolves.toMatchObject({ kind: "result", installed: 1 });
    expect(fs.existsSync(leasedSnapshot)).toBe(false);
  });
});
