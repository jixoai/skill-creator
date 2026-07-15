/**
 * Repository service contract tests.
 *
 * User input [2026-07-14]: "我们还需要一个 `/repository/`，来支持远程仓库预览 skills 并安装 它们"
 * Architecture decision [2026-07-14]: exercise scan, preview, pinned install,
 * dry-run, and invalid-skill rejection against a real local Git repository.
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
import { createDaemonDomain, type DaemonDomain } from "../src/daemon/domain.js";
import type { ImportedWorkspace } from "../src/shared/contracts/workspaces.js";
import { setHomeOverride } from "../src/shared/paths.js";

const previousHome = process.env.SKILL_CREATOR_HOME;
let sandbox = "";
let repository = "";
let domain: DaemonDomain;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-repository-test-"));
  const isolatedHome = path.join(sandbox, "state");
  process.env.SKILL_CREATOR_HOME = isolatedHome;
  setHomeOverride(isolatedHome);
  domain = createDaemonDomain();
  repository = path.join(sandbox, "source-repository");
  fs.mkdirSync(repository, { recursive: true });
  git("init", "--quiet");
  git("config", "user.name", "Skill Creator Test");
  git("config", "user.email", "skill-creator-test@example.invalid");
});

afterEach(async () => {
  await domain.repository.dispose();
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

function importDestination(): ImportedWorkspace {
  const destination = path.join(sandbox, "destination");
  fs.mkdirSync(destination, { recursive: true });
  return domain.workspaces.import(destination, "Destination");
}

function directoryPath(workspace: ImportedWorkspace): string {
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

    const scan = await domain.repository.scan(repository);
    const selected = scan.skills.find((skill) => skill.name === "reviewed");
    expect(scan.commit).toBe(scannedCommit);
    expect(selected).toMatchObject({ installable: true, relativePath: "skills/reviewed" });
    if (!selected) throw new Error("Expected the reviewed skill in the scan result.");

    const initialPreview = await domain.repository.preview(scan.sessionId, selected.id);
    expect(initialPreview.content).toContain("version one");

    const dryRun = await domain.repository.install({
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

    const pinnedPreview = await domain.repository.preview(scan.sessionId, selected.id);
    expect(pinnedPreview.content).toContain("version one");
    expect(pinnedPreview.content).not.toContain("version two");

    const installed = await domain.repository.install({
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
    const scan = await domain.repository.scan(repository);

    const dryRun = await domain.repository.install({
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
    const scan = await domain.repository.scan(repository);
    const unsafe = scan.skills.find((skill) => skill.relativePath === "skills/unsafe");
    expect(unsafe?.installable).toBe(false);
    if (!unsafe) throw new Error("Expected the unsafe skill in the scan result.");

    await expect(
      domain.repository.install({
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
    const scan = await domain.repository.scan(repository);

    await expect(
      domain.repository.install({
        sessionId: scan.sessionId,
        skillIds: ["rsk_000000000000000000000000"],
        workspaceId: destination.id,
      }),
    ).rejects.toThrow("Remote skill not found in scan session");
    expect(fs.readdirSync(destinationPath)).toEqual([]);
  });
});
