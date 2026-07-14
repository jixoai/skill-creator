/**
 * Repository service contract tests.
 *
 * Original request [2026-07-14]: exercise a real local Git repository through
 * scan, preview, pinned-session install/dry-run, and invalid-skill rejection.
 *
 * Orthogonal intents:
 *   [1] A scan session pins preview and install to one immutable commit.
 *   [2] Dry-run and selected-skill install target only the selected workspace,
 *       preserving counts while deduplicating shared destinations.
 *   [3] Uninstallable or unknown remote skill IDs are rejected.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as repositoryService from "../src/daemon/repository-service.js";
import * as workspaceService from "../src/daemon/workspace-service.js";
import { setHomeOverride } from "../src/shared/paths.js";

const previousHome = process.env.SKILL_CREATOR_HOME;
let sandbox = "";
let repository = "";

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-repository-test-"));
  const isolatedHome = path.join(sandbox, "state");
  process.env.SKILL_CREATOR_HOME = isolatedHome;
  setHomeOverride(isolatedHome);
  repository = path.join(sandbox, "source-repository");
  fs.mkdirSync(repository, { recursive: true });
  git("init", "--quiet");
  git("config", "user.name", "Skill Creator Test");
  git("config", "user.email", "skill-creator-test@example.invalid");
});

afterEach(() => {
  repositoryService.clearSessions();
  setHomeOverride(null);
  if (previousHome === undefined) delete process.env.SKILL_CREATOR_HOME;
  else process.env.SKILL_CREATOR_HOME = previousHome;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();
}

function writeSkill(directoryName: string, name: string, description: string, body: string): void {
  const directory = path.join(repository, "skills", directoryName);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "SKILL.md"),
    `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\n---\n${body}`,
    "utf8",
  );
}

function commit(message: string): string {
  git("add", ".");
  git("commit", "--quiet", "-m", message);
  return git("rev-parse", "HEAD");
}

function importDestination(): ReturnType<typeof workspaceService.add> {
  const destination = path.join(sandbox, "destination");
  fs.mkdirSync(destination, { recursive: true });
  return workspaceService.add(destination, "Destination");
}

function directoryPath(workspace: ReturnType<typeof workspaceService.add>): string {
  if (workspace.path === null) throw new Error("Expected an imported directory workspace.");
  return workspace.path;
}

describe("repository service", () => {
  it("pins scan, preview, dry-run, and single-skill install to the scanned commit", async () => {
    writeSkill(
      "reviewed",
      "reviewed",
      "Install the reviewed revision.",
      "# Reviewed\n\nversion one\n",
    );
    const scannedCommit = commit("add reviewed skill");
    const destination = importDestination();
    const destinationPath = directoryPath(destination);

    const scan = await repositoryService.scan(repository);
    const selected = scan.skills.find((skill) => skill.name === "reviewed");
    expect(scan.commit).toBe(scannedCommit);
    expect(selected).toMatchObject({ installable: true, relativePath: "skills/reviewed" });
    if (!selected) throw new Error("Expected the reviewed skill in the scan result.");

    const initialPreview = await repositoryService.preview(scan.sessionId, selected.id);
    expect(initialPreview.content).toContain("version one");

    const dryRun = await repositoryService.install({
      sessionId: scan.sessionId,
      skillIds: [selected.id],
      workspaceId: destination.id,
      dryRun: true,
    });
    expect(dryRun).toEqual({
      kind: "preview",
      skills: [{ name: "reviewed", description: "Install the reviewed revision." }],
      destinations: [{ path: fs.realpathSync(destinationPath), exists: true }],
      totalInstalls: 1,
    });
    expect(fs.existsSync(path.join(destinationPath, "reviewed"))).toBe(false);

    writeSkill(
      "reviewed",
      "reviewed",
      "Install the reviewed revision.",
      "# Reviewed\n\nversion two\n",
    );
    commit("change reviewed skill after scan");

    const pinnedPreview = await repositoryService.preview(scan.sessionId, selected.id);
    expect(pinnedPreview.content).toContain("version one");
    expect(pinnedPreview.content).not.toContain("version two");

    const installed = await repositoryService.install({
      sessionId: scan.sessionId,
      skillIds: [selected.id],
      workspaceId: destination.id,
    });
    expect(installed).toMatchObject({ kind: "result", installed: 1, failed: 0 });
    const installedContent = fs.readFileSync(
      path.join(destinationPath, "reviewed", "SKILL.md"),
      "utf8",
    );
    expect(installedContent).toContain("version one");
    expect(installedContent).not.toContain("version two");
  });

  it("deduplicates the shared destination in a multi-skill dry-run", async () => {
    writeSkill("alpha", "alpha", "Install alpha.", "# Alpha\n");
    writeSkill("beta", "beta", "Install beta.", "# Beta\n");
    commit("add two skills");
    const destination = importDestination();
    const destinationPath = directoryPath(destination);
    const scan = await repositoryService.scan(repository);

    const dryRun = await repositoryService.install({
      sessionId: scan.sessionId,
      skillIds: scan.skills.map((skill) => skill.id),
      workspaceId: destination.id,
      dryRun: true,
    });

    expect(dryRun).toEqual({
      kind: "preview",
      skills: [
        { name: "alpha", description: "Install alpha." },
        { name: "beta", description: "Install beta." },
      ],
      destinations: [{ path: fs.realpathSync(destinationPath), exists: true }],
      totalInstalls: 2,
    });
    expect(fs.readdirSync(destinationPath)).toEqual([]);
  });

  it("rejects a discovered skill that failed repository validation", async () => {
    writeSkill("unsafe", "../unsafe", "Escape the destination.", "# Unsafe\n");
    commit("add unsafe skill");
    const destination = importDestination();
    const destinationPath = directoryPath(destination);
    const scan = await repositoryService.scan(repository);
    const unsafe = scan.skills.find((skill) => skill.relativePath === "skills/unsafe");
    expect(unsafe?.installable).toBe(false);
    if (!unsafe) throw new Error("Expected the unsafe skill in the scan result.");

    await expect(
      repositoryService.install({
        sessionId: scan.sessionId,
        skillIds: [unsafe.id],
        workspaceId: destination.id,
      }),
    ).rejects.toThrow("is not installable");
    expect(fs.existsSync(path.join(destinationPath, "unsafe"))).toBe(false);
  });

  it("rejects a well-formed remote skill ID that is not part of the scan session", async () => {
    writeSkill("known", "known", "A known repository skill.", "# Known\n");
    commit("add known skill");
    const destination = importDestination();
    const destinationPath = directoryPath(destination);
    const scan = await repositoryService.scan(repository);

    await expect(
      repositoryService.install({
        sessionId: scan.sessionId,
        skillIds: ["rsk_000000000000000000000000"],
        workspaceId: destination.id,
      }),
    ).rejects.toThrow("Remote skill not found in scan session");
    expect(fs.readdirSync(destinationPath)).toEqual([]);
  });
});
