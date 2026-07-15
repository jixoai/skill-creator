/**
 * Repository service contract tests.
 *
 * User input [2026-07-14]: "我们还需要一个 `/repository/`，来支持远程仓库预览 skills 并安装 它们"
 * Architecture decisions:
 * - [2026-07-14] Exercise scan, preview, pinned install, dry-run, and
 *   invalid-skill rejection against a real local Git repository.
 * - [2026-07-15] Successful installs return the same local Skill identity that
 *   Workspace discovery exposes.
 *
 * Orthogonal intents:
 *   [1] A scan session pins preview and install to one immutable commit.
 *   [2] Dry-run and selected-skill install target only the selected workspace,
 *       preserving counts, local identity, and deduplicated destinations.
 *   [3] Invalid remote selections and untrusted installer outputs become safe,
 *       identity-free per-skill failures without hiding completed installs.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDaemonDomain, type DaemonDomain } from "../src/daemon/domain.js";
import {
  createRepositoryService,
  type RepositoryInstaller,
} from "../src/daemon/repository-service.js";
import { createSkillService } from "../src/daemon/skill-service.js";
import { createWorkspaceRegistry } from "../src/daemon/workspace-registry/index.js";
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
  writeSkillDocument(directory, name, description, body);
}

function writeSkillDocument(
  directory: string,
  name: string,
  description: string,
  body: string,
): void {
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
    expect(installed).toMatchObject({
      kind: "result",
      workspaceId: destination.id,
      installed: 1,
      failed: 0,
    });
    const localSkill = (await domain.skills.list(destination.id, true)).find(
      (skill) => skill.directoryName === "reviewed",
    );
    if (!localSkill) throw new Error("Expected Workspace discovery to expose the installed skill.");
    expect(installed.kind).toBe("result");
    if (installed.kind !== "result") throw new Error("Expected an actual install result.");
    expect(installed.results[0]).toMatchObject({
      status: "installed",
      skillId: localSkill.id,
    });
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

  it("preserves the workspace-scoped local identity when overwriting a skill", async () => {
    writeSkill("replaceable", "replaceable", "Overwrite this skill.", "# Replaceable\n");
    commit("add replaceable skill");
    const destination = importDestination();
    const scan = await domain.repository.scan(repository);
    const selected = scan.skills.find((skill) => skill.name === "replaceable");
    if (!selected) throw new Error("Expected the replaceable skill in the scan result.");

    const installed = await domain.repository.install({
      sessionId: scan.sessionId,
      skillIds: [selected.id],
      workspaceId: destination.id,
    });
    if (installed.kind !== "result") throw new Error("Expected an actual install result.");
    const installedEntry = installed.results[0];
    if (!installedEntry || installedEntry.status !== "installed") {
      throw new Error("Expected the initial install to succeed.");
    }

    const overwritten = await domain.repository.install({
      sessionId: scan.sessionId,
      skillIds: [selected.id],
      workspaceId: destination.id,
      force: true,
    });
    expect(overwritten).toMatchObject({
      kind: "result",
      workspaceId: destination.id,
      installed: 0,
      overwritten: 1,
    });
    if (overwritten.kind !== "result") throw new Error("Expected an actual install result.");
    expect(overwritten.results[0]).toMatchObject({
      status: "overwritten",
      skillId: installedEntry.skillId,
    });
  });

  it("keeps skipped and failed entries identity-free and derives counts from their statuses", async () => {
    writeSkill("skip-me", "skip-me", "Skip this skill.", "# Skip\n");
    writeSkill("fail-me", "fail-me", "Fail this skill.", "# Fail\n");
    commit("add non-successful install fixtures");
    const destinationPath = path.join(sandbox, "status-destination");
    fs.mkdirSync(destinationPath);
    const workspaces = createWorkspaceRegistry();
    const destination = workspaces.import(destinationPath, "Status destination");
    const installer: RepositoryInstaller = async (options) => {
      const skill = path.basename(options.path ?? "unknown");
      const status: "skipped" | "failed" = skill === "skip-me" ? "skipped" : "failed";
      return {
        results: [
          {
            skill,
            destination: destinationPath,
            path: path.join(destinationPath, skill),
            status,
            ...(status === "failed" ? { error: "Simulated installer failure." } : {}),
          },
        ],
        installed: 9,
        skipped: 9,
        overwritten: 9,
        failed: 9,
      };
    };
    const service = createRepositoryService(workspaces, createSkillService(workspaces), {
      installSkills: installer,
    });

    try {
      const scan = await service.scan(repository);
      const result = await service.install({
        sessionId: scan.sessionId,
        skillIds: scan.skills.map((skill) => skill.id),
        workspaceId: destination.id,
      });

      expect(result).toMatchObject({
        kind: "result",
        workspaceId: destination.id,
        installed: 0,
        skipped: 1,
        overwritten: 0,
        failed: 1,
      });
      if (result.kind !== "result") throw new Error("Expected an actual install result.");
      expect(result.results.map((entry) => entry.status).sort()).toEqual(["failed", "skipped"]);
      for (const entry of result.results) expect(entry).not.toHaveProperty("skillId");
    } finally {
      await service.dispose();
    }
  });

  it("converts a successful installer result outside its Workspace into a safe failure", async () => {
    writeSkill("escaped", "escaped", "Do not trust its result path.", "# Escaped\n");
    commit("add escaped install fixture");
    const destinationPath = path.join(sandbox, "bounded-destination");
    const escapedPath = path.join(sandbox, "outside-workspace", "escaped");
    fs.mkdirSync(destinationPath);
    fs.mkdirSync(escapedPath, { recursive: true });
    fs.writeFileSync(
      path.join(escapedPath, "SKILL.md"),
      '---\nname: "escaped"\ndescription: "Outside the Workspace."\n---\n# Escaped\n',
      "utf8",
    );
    const workspaces = createWorkspaceRegistry();
    const destination = workspaces.import(destinationPath, "Bounded destination");
    const installer: RepositoryInstaller = async () => ({
      results: [
        {
          skill: "escaped",
          destination: destinationPath,
          path: escapedPath,
          status: "installed",
        },
      ],
      installed: 1,
      skipped: 0,
      overwritten: 0,
      failed: 0,
    });
    const service = createRepositoryService(workspaces, createSkillService(workspaces), {
      installSkills: installer,
    });

    try {
      const scan = await service.scan(repository);
      const selected = scan.skills[0];
      if (!selected) throw new Error("Expected the escaped skill in the scan result.");
      const result = await service.install({
        sessionId: scan.sessionId,
        skillIds: [selected.id],
        workspaceId: destination.id,
      });
      if (result.kind !== "result") throw new Error("Expected an actual install result.");
      expect(result).toMatchObject({ installed: 0, failed: 1 });
      expect(result.results[0]).toMatchObject({
        skill: "escaped",
        destination: fs.realpathSync(destinationPath),
        path: path.join(fs.realpathSync(destinationPath), "escaped"),
        status: "failed",
      });
      expect(result.results[0]).not.toHaveProperty("skillId");
      expect(fs.readdirSync(destinationPath)).toEqual([]);
      expect(fs.existsSync(path.join(escapedPath, "SKILL.md"))).toBe(true);
    } finally {
      await service.dispose();
    }
  });

  it("does not sign a sibling skill identity for a selected remote skill", async () => {
    writeSkill("alpha", "alpha", "Install alpha.", "# Alpha\n");
    commit("add alpha skill");
    const destinationPath = path.join(sandbox, "sibling-destination");
    const siblingPath = path.join(destinationPath, "beta");
    writeSkillDocument(siblingPath, "beta", "A pre-existing sibling.", "# Beta\n");
    const workspaces = createWorkspaceRegistry();
    const destination = workspaces.import(destinationPath, "Sibling destination");
    const skills = createSkillService(workspaces);
    const installer: RepositoryInstaller = async () => ({
      results: [
        {
          skill: "alpha",
          destination: destinationPath,
          path: siblingPath,
          status: "installed",
        },
      ],
      installed: 1,
      skipped: 0,
      overwritten: 0,
      failed: 0,
    });
    const service = createRepositoryService(workspaces, skills, { installSkills: installer });

    try {
      const scan = await service.scan(repository);
      const alpha = scan.skills.find((skill) => skill.name === "alpha");
      if (!alpha) throw new Error("Expected alpha in the scan result.");
      const result = await service.install({
        sessionId: scan.sessionId,
        skillIds: [alpha.id],
        workspaceId: destination.id,
      });
      if (result.kind !== "result") throw new Error("Expected an actual install result.");
      expect(result).toMatchObject({ installed: 0, failed: 1 });
      expect(result.results[0]).toMatchObject({
        skill: "alpha",
        path: path.join(fs.realpathSync(destinationPath), "alpha"),
        status: "failed",
      });
      expect(result.results[0]).not.toHaveProperty("skillId");
      expect((await skills.list(destination.id)).map((skill) => skill.directoryName)).toEqual([
        "beta",
      ]);
    } finally {
      await service.dispose();
    }
  });

  it("retains an earlier installation when a later installed skill has invalid frontmatter", async () => {
    writeSkill("alpha", "alpha", "Install alpha.", "# Alpha\n");
    writeSkill("beta", "beta", "Install beta.", "# Beta\n");
    commit("add install validation fixtures");
    const destinationPath = path.join(sandbox, "validation-destination");
    fs.mkdirSync(destinationPath);
    const workspaces = createWorkspaceRegistry();
    const destination = workspaces.import(destinationPath, "Validation destination");
    const skills = createSkillService(workspaces);
    const installer: RepositoryInstaller = async (options) => {
      const name = path.basename(options.path ?? "");
      const installedPath = path.join(destinationPath, name);
      if (name === "alpha") {
        writeSkillDocument(installedPath, "alpha", "Install alpha.", "# Alpha\n");
      } else {
        fs.mkdirSync(installedPath, { recursive: true });
        fs.writeFileSync(
          path.join(installedPath, "SKILL.md"),
          "---\nname: beta\n---\n# Missing description\n",
          "utf8",
        );
      }
      return {
        results: [
          {
            skill: name,
            destination: destinationPath,
            path: installedPath,
            status: "installed" as const,
          },
        ],
        installed: 1,
        skipped: 0,
        overwritten: 0,
        failed: 0,
      };
    };
    const service = createRepositoryService(workspaces, skills, { installSkills: installer });

    try {
      const scan = await service.scan(repository);
      const alpha = scan.skills.find((skill) => skill.name === "alpha");
      const beta = scan.skills.find((skill) => skill.name === "beta");
      if (!alpha || !beta) throw new Error("Expected both fixtures in the scan result.");
      const result = await service.install({
        sessionId: scan.sessionId,
        skillIds: [alpha.id, beta.id],
        workspaceId: destination.id,
      });
      if (result.kind !== "result") throw new Error("Expected an actual install result.");
      expect(result).toMatchObject({ installed: 1, failed: 1 });
      const installed = result.results.find((entry) => entry.status === "installed");
      const failed = result.results.find((entry) => entry.status === "failed");
      const discoveredAlpha = (await skills.list(destination.id)).find(
        (skill) => skill.directoryName === "alpha",
      );
      expect(installed).toMatchObject({ skill: "alpha", skillId: discoveredAlpha?.id });
      expect(failed).toMatchObject({
        skill: "beta",
        status: "failed",
        error: expect.stringContaining("frontmatter is invalid"),
      });
      expect(failed).not.toHaveProperty("skillId");
    } finally {
      await service.dispose();
    }
  });

  it("retains earlier installation results when a later installer call throws", async () => {
    writeSkill("alpha", "alpha", "Install alpha.", "# Alpha\n");
    writeSkill("beta", "beta", "Install beta.", "# Beta\n");
    commit("add installer failure fixtures");
    const destinationPath = path.join(sandbox, "throwing-destination");
    fs.mkdirSync(destinationPath);
    const workspaces = createWorkspaceRegistry();
    const destination = workspaces.import(destinationPath, "Throwing destination");
    const skills = createSkillService(workspaces);
    const installer: RepositoryInstaller = async (options) => {
      const name = path.basename(options.path ?? "");
      if (name === "beta") throw new Error("Simulated installer failure.");
      const installedPath = path.join(destinationPath, name);
      writeSkillDocument(installedPath, name, `Install ${name}.`, `# ${name}\n`);
      return {
        results: [
          {
            skill: name,
            destination: destinationPath,
            path: installedPath,
            status: "installed" as const,
          },
        ],
        installed: 1,
        skipped: 0,
        overwritten: 0,
        failed: 0,
      };
    };
    const service = createRepositoryService(workspaces, skills, { installSkills: installer });

    try {
      const scan = await service.scan(repository);
      const alpha = scan.skills.find((skill) => skill.name === "alpha");
      const beta = scan.skills.find((skill) => skill.name === "beta");
      if (!alpha || !beta) throw new Error("Expected both fixtures in the scan result.");
      const result = await service.install({
        sessionId: scan.sessionId,
        skillIds: [alpha.id, beta.id],
        workspaceId: destination.id,
      });
      if (result.kind !== "result") throw new Error("Expected an actual install result.");
      expect(result).toMatchObject({ installed: 1, failed: 1 });
      expect(result.results.find((entry) => entry.status === "failed")).toMatchObject({
        skill: "beta",
        error: "Simulated installer failure.",
      });
    } finally {
      await service.dispose();
    }
  });

  it("converts an installer entry with an invalid runtime status into a per-skill failure", async () => {
    writeSkill("alpha", "alpha", "Install alpha.", "# Alpha\n");
    writeSkill("beta", "beta", "Install beta.", "# Beta\n");
    commit("add malformed installer result fixtures");
    const destinationPath = path.join(sandbox, "malformed-result-destination");
    fs.mkdirSync(destinationPath);
    const workspaces = createWorkspaceRegistry();
    const destination = workspaces.import(destinationPath, "Malformed result destination");
    const skills = createSkillService(workspaces);
    const installer: RepositoryInstaller = async (options) => {
      const name = path.basename(options.path ?? "");
      const installedPath = path.join(destinationPath, name);
      writeSkillDocument(installedPath, name, `Install ${name}.`, `# ${name}\n`);
      const entry = {
        skill: name,
        destination: destinationPath,
        path: installedPath,
        status: "installed" as const,
      };
      if (name === "beta") {
        Object.defineProperty(entry, "status", {
          configurable: true,
          enumerable: true,
          value: "unexpected",
          writable: true,
        });
      }
      return {
        results: [entry],
        installed: 1,
        skipped: 0,
        overwritten: 0,
        failed: 0,
      };
    };
    const service = createRepositoryService(workspaces, skills, { installSkills: installer });

    try {
      const scan = await service.scan(repository);
      const alpha = scan.skills.find((skill) => skill.name === "alpha");
      const beta = scan.skills.find((skill) => skill.name === "beta");
      if (!alpha || !beta) throw new Error("Expected both fixtures in the scan result.");
      const result = await service.install({
        sessionId: scan.sessionId,
        skillIds: [alpha.id, beta.id],
        workspaceId: destination.id,
      });
      if (result.kind !== "result") throw new Error("Expected an actual install result.");
      expect(result).toMatchObject({ installed: 1, failed: 1 });
      expect(result.results.find((entry) => entry.status === "failed")).toMatchObject({
        skill: "beta",
        error: "Installer returned an invalid result.",
      });
    } finally {
      await service.dispose();
    }
  });

  it.skipIf(process.platform === "win32")(
    "does not sign an installed SKILL.md symbolic link",
    async () => {
      writeSkill("linked", "linked", "Reject linked skill files.", "# Linked\n");
      commit("add linked skill fixture");
      const destinationPath = path.join(sandbox, "linked-skill-destination");
      fs.mkdirSync(destinationPath);
      const workspaces = createWorkspaceRegistry();
      const destination = workspaces.import(destinationPath, "Linked skill destination");
      const skills = createSkillService(workspaces);
      const installer: RepositoryInstaller = async (options) => {
        const name = path.basename(options.path ?? "");
        const installedPath = path.join(destinationPath, name);
        fs.mkdirSync(installedPath, { recursive: true });
        fs.writeFileSync(
          path.join(installedPath, "source.md"),
          `---\nname: ${JSON.stringify(name)}\ndescription: "Linked file."\n---\n# Linked\n`,
          "utf8",
        );
        fs.symlinkSync("source.md", path.join(installedPath, "SKILL.md"));
        return {
          results: [
            {
              skill: name,
              destination: destinationPath,
              path: installedPath,
              status: "installed" as const,
            },
          ],
          installed: 1,
          skipped: 0,
          overwritten: 0,
          failed: 0,
        };
      };
      const service = createRepositoryService(workspaces, skills, { installSkills: installer });

      try {
        const scan = await service.scan(repository);
        const linked = scan.skills.find((skill) => skill.name === "linked");
        if (!linked) throw new Error("Expected the linked fixture in the scan result.");
        const result = await service.install({
          sessionId: scan.sessionId,
          skillIds: [linked.id],
          workspaceId: destination.id,
        });
        if (result.kind !== "result") throw new Error("Expected an actual install result.");
        expect(result).toMatchObject({ installed: 0, failed: 1 });
        expect(result.results[0]).toMatchObject({
          skill: "linked",
          status: "failed",
          error: expect.stringContaining("regular SKILL.md file"),
        });
        expect(result.results[0]).not.toHaveProperty("skillId");
        expect(
          fs.lstatSync(path.join(destinationPath, "linked", "SKILL.md")).isSymbolicLink(),
        ).toBe(true);
      } finally {
        await service.dispose();
      }
    },
  );

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
