/**
 * Repository service contract tests.
 *
 * User input [2026-07-14]: "我们还需要一个 `/repository/`，来支持远程仓库预览 skills 并安装 它们"
 * Architecture decisions:
 * - [2026-07-14] Exercise scan, preview, pinned install, dry-run, and
 *   invalid-skill rejection against a real local Git repository.
 * - [2026-07-15] Successful installs return the same local Skill identity that
 *   Workspace discovery exposes.
 * - [2026-07-21] Incompatible external installer results become domain-empty
 *   previews or per-skill failures instead of transport exceptions.
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
import { deterministicSkillsCliProbe } from "./helpers/deterministic-probe.js";
import {
  createRepositoryService,
  toContractRelativePath,
  type RepositoryKernel,
} from "../src/daemon/repository-service.js";
import type { EnsureEntityResult, ProjectEntityResult } from "ccski";
import { createSkillService } from "../src/daemon/skill-service.js";
import { createWorkspaceRegistry } from "../src/daemon/workspace-registry/index.js";
import {
  ProviderIdSchema,
  type ImportedWorkspace,
  type WorkspaceProviderTarget,
} from "../src/shared/contracts/workspaces.js";
import { setHomeOverride } from "../src/shared/paths.js";

const previousHome = process.env.SKILL_CREATOR_HOME;
let sandbox = "";
let repository = "";
let domain: DaemonDomain;
const openClawProviderId = ProviderIdSchema.parse("openclaw");

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-repository-test-"));
  const isolatedHome = path.join(sandbox, "state");
  process.env.SKILL_CREATOR_HOME = isolatedHome;
  setHomeOverride(isolatedHome);
  domain = createDaemonDomain(undefined, { skillsCliProbe: deterministicSkillsCliProbe() });
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
  return importWorkspace("destination", "Destination");
}

function importWorkspace(directoryName: string, label: string): ImportedWorkspace {
  const destination = path.join(sandbox, directoryName);
  fs.mkdirSync(destination, { recursive: true });
  return domain.workspaces.import(destination, label);
}

function directoryPath(workspace: ImportedWorkspace): string {
  return path.join(workspace.path, "skills");
}

function target(workspace: ImportedWorkspace): WorkspaceProviderTarget {
  return { workspaceId: workspace.id, providerId: openClawProviderId };
}

/** 内核 ok 收据（typed 语义；测试 fake 直用）。 */
function kernelOk(
  status: "created" | "exists" | "replaced",
  projection: "projected" | "unchanged",
): { ensure: EnsureEntityResult; project: ProjectEntityResult } {
  return {
    ensure: {
      kind: "ok",
      status,
      entity: {
        scope: "project",
        logicalName: "",
        folderName: "",
        path: "",
        revision: "r".repeat(64),
        provenance: { source: "", installedAt: "", updatedAt: "" },
        createdAt: "",
        updatedAt: "",
      },
      generation: 1,
      lockSyncPending: true,
      warnings: [],
    },
    project: {
      kind: "ok",
      entity: {
        scope: "project",
        logicalName: "",
        folderName: "",
        path: "",
        revision: "r".repeat(64),
        provenance: { source: "", installedAt: "", updatedAt: "" },
        createdAt: "",
        updatedAt: "",
      },
      results: [
        {
          root: "",
          rootId: "",
          path: "",
          status: projection,
          mode: "link",
          targetKind: "projection",
        },
      ],
      projected: projection === "projected" ? 1 : 0,
      unchanged: projection === "unchanged" ? 1 : 0,
      failed: 0,
      generation: 1,
    },
  };
}

/** 按名字把 staged 源物化进目标 root 的内核 fake（typed ok；hook 在写盘后运行）。 */
function materializingKernel(
  destinationRoot: string,
  hook?: (name: string) => void,
): RepositoryKernel {
  return {
    ensureEntity: async (options) => {
      const name = path.basename(options.source.skillPath ?? "");
      if (name) {
        fs.cpSync(options.source.dir, path.join(destinationRoot, name), { recursive: true });
        hook?.(name);
      }
      return kernelOk("created", "projected").ensure;
    },
    projectEntity: async () => kernelOk("created", "projected").project,
  };
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
      targets: [target(destination)],
      dryRun: true,
    });
    expect(dryRun).toEqual({
      kind: "preview",
      skills: [{ name: "reviewed", description: "Install the reviewed revision." }],
      destinations: [
        { target: target(destination), path: fs.realpathSync(destinationPath), exists: true },
      ],
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
      targets: [target(destination)],
    });
    expect(installed).toMatchObject({
      kind: "result",
      targets: [target(destination)],
      installed: 1,
      failed: 0,
    });
    // 两阶段物理事实（ccski-3-host-migration 批 2.1）：Provider root 下是 symlink
    // 投影，实体入库在 Imported Workspace 的 .agents/skills 实体库内。
    const projectionPath = path.join(destinationPath, "reviewed");
    expect(fs.lstatSync(projectionPath).isSymbolicLink()).toBe(true);
    const entityPath = path.join(destination.path, ".agents", "skills", "reviewed");
    expect(fs.realpathSync(projectionPath)).toBe(fs.realpathSync(entityPath));
    expect(fs.lstatSync(path.join(entityPath, "SKILL.md")).isFile()).toBe(true);
    const localSkill = (await domain.skills.list(target(destination), true)).find(
      (skill) => skill.directoryName === "reviewed",
    );
    if (!localSkill) throw new Error("Expected Workspace discovery to expose the installed skill.");
    expect(localSkill).toMatchObject({ ownership: "ccski", entryKind: "symlink" });
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
      targets: [target(destination)],
      dryRun: true,
    });

    expect(dryRun).toEqual({
      kind: "preview",
      skills: [
        { name: "alpha", description: "Install alpha." },
        { name: "beta", description: "Install beta." },
      ],
      destinations: [
        { target: target(destination), path: fs.realpathSync(destinationPath), exists: true },
      ],
      totalInstalls: 2,
    });
    expect(fs.readdirSync(destinationPath)).toEqual([]);
  });

  it("installs each selected skill into every selected Workspace Provider", async () => {
    writeSkill("shared", "shared", "Install into each target.", "# Shared\n");
    commit("add multi-target skill");
    const first = importWorkspace("first-target", "First target");
    const second = importWorkspace("second-target", "Second target");
    const scan = await domain.repository.scan(repository);
    const selected = scan.skills[0];
    if (!selected) throw new Error("Expected the multi-target fixture.");

    const preview = await domain.repository.install({
      sessionId: scan.sessionId,
      skillIds: [selected.id],
      targets: [target(first), target(second)],
      dryRun: true,
    });
    expect(preview).toMatchObject({
      kind: "preview",
      destinations: [
        { target: target(first), path: directoryPath(first), exists: true },
        { target: target(second), path: directoryPath(second), exists: true },
      ],
      totalInstalls: 2,
    });

    const installed = await domain.repository.install({
      sessionId: scan.sessionId,
      skillIds: [selected.id],
      targets: [target(first), target(second)],
    });
    expect(installed).toMatchObject({
      kind: "result",
      targets: [target(first), target(second)],
      installed: 2,
      failed: 0,
    });
    await expect(domain.skills.list(target(first))).resolves.toMatchObject([
      expect.objectContaining({ directoryName: "shared" }),
    ]);
    await expect(domain.skills.list(target(second))).resolves.toMatchObject([
      expect.objectContaining({ directoryName: "shared" }),
    ]);
  });

  it("maps a kernel NAME_COLLISION typed error to an identity-free per-skill failure", async () => {
    writeSkill("collided", "collided", "Collide in the store.", "# Collided\n");
    commit("add collision fixture");
    const destination = importDestination();
    const kernel: RepositoryKernel = {
      ensureEntity: async () => ({
        kind: "error",
        code: "NAME_COLLISION",
        message: "RAW KERNEL INTERNAL DETAIL must not leak",
      }),
      projectEntity: async () => kernelOk("created", "projected").project,
    };
    const service = createRepositoryService(domain.workspaces, domain.skills, { kernel });

    try {
      const scan = await service.scan(repository);
      const selected = scan.skills.find((skill) => skill.name === "collided");
      if (!selected) throw new Error("Expected the collision fixture.");

      const result = await service.install({
        sessionId: scan.sessionId,
        skillIds: [selected.id],
        targets: [target(destination)],
      });
      if (result.kind !== "result") throw new Error("Expected an actual install result.");
      expect(result).toMatchObject({ installed: 0, failed: 1 });
      const entry = result.results[0];
      if (!entry) throw new Error("Expected one result entry.");
      expect(entry.status).toBe("failed");
      expect(entry.error).toContain("ccski code: NAME_COLLISION");
      // 不裸透传内核 message。
      expect(entry.error).not.toContain("RAW KERNEL INTERNAL DETAIL");
      expect(entry).not.toHaveProperty("skillId");
    } finally {
      await service.dispose();
    }
  });

  it("force clears a foreign occupant before projecting the link", async () => {
    writeSkill("foreign", "foreign", "Replace a foreign directory.", "# Foreign\n");
    commit("add foreign fixture");
    const destination = importDestination();
    const destinationPath = directoryPath(destination);
    // 目标被一个非 ccski 管辖的普通目录占据（legacy 物化残留）。
    writeSkillDocument(path.join(destinationPath, "foreign"), "foreign", "Old copy.", "# Old\n");
    const scan = await domain.repository.scan(repository);
    const selected = scan.skills.find((skill) => skill.name === "foreign");
    if (!selected) throw new Error("Expected the foreign fixture.");

    const nonForce = await domain.repository.install({
      sessionId: scan.sessionId,
      skillIds: [selected.id],
      targets: [target(destination)],
    });
    if (nonForce.kind !== "result") throw new Error("Expected an actual install result.");
    expect(nonForce.results[0]).toMatchObject({ status: "skipped" });
    expect(nonForce.results[0]).not.toHaveProperty("skillId");

    const forced = await domain.repository.install({
      sessionId: scan.sessionId,
      skillIds: [selected.id],
      targets: [target(destination)],
      force: true,
    });
    expect(forced).toMatchObject({ kind: "result", overwritten: 1, failed: 0 });
    // 清障后落盘的是 link 投影，内容来自 pinned commit。
    expect(fs.lstatSync(path.join(destinationPath, "foreign")).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(destinationPath, "foreign", "SKILL.md"), "utf8")).toContain(
      "Replace a foreign directory.",
    );
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
      targets: [target(destination)],
    });
    if (installed.kind !== "result") throw new Error("Expected an actual install result.");
    const installedEntry = installed.results[0];
    if (!installedEntry || installedEntry.status !== "installed") {
      throw new Error("Expected the initial install to succeed.");
    }

    const overwritten = await domain.repository.install({
      sessionId: scan.sessionId,
      skillIds: [selected.id],
      targets: [target(destination)],
      force: true,
    });
    expect(overwritten).toMatchObject({
      kind: "result",
      targets: [target(destination)],
      installed: 0,
      overwritten: 1,
    });
    if (overwritten.kind !== "result") throw new Error("Expected an actual install result.");
    expect(overwritten.results[0]).toMatchObject({
      status: "overwritten",
      skillId: installedEntry.skillId,
    });
  });

  it("keeps NAME_EXISTS (different source) entries skipped and identity-free", async () => {
    writeSkill("skip-me", "skip-me", "Skip this skill.", "# Skip\n");
    commit("add skip fixture");
    const workspaceDirectory = path.join(sandbox, "status-destination");
    const destinationPath = path.join(workspaceDirectory, "skills");
    fs.mkdirSync(destinationPath, { recursive: true });
    const workspaces = createWorkspaceRegistry();
    const destination = workspaces.import(workspaceDirectory, "Status destination");
    const kernel: RepositoryKernel = {
      ensureEntity: async () => ({
        kind: "error",
        code: "NAME_EXISTS",
        message: "kernel detail",
        existing: {
          logicalName: "skip-me",
          folderName: "skip-me",
          source: "other://source",
          revision: "r".repeat(64),
          expectedRevision: "r".repeat(64),
        },
      }),
      projectEntity: async () => kernelOk("exists", "unchanged").project,
    };
    const service = createRepositoryService(workspaces, createSkillService(workspaces), { kernel });

    try {
      const scan = await service.scan(repository);
      const result = await service.install({
        sessionId: scan.sessionId,
        skillIds: scan.skills.map((skill) => skill.id),
        targets: [target(destination)],
      });

      expect(result).toMatchObject({
        kind: "result",
        targets: [target(destination)],
        installed: 0,
        skipped: 1,
        overwritten: 0,
        failed: 0,
      });
      if (result.kind !== "result") throw new Error("Expected an actual install result.");
      expect(result.results[0]).toMatchObject({
        status: "skipped",
        error: expect.stringContaining("different source"),
      });
      expect(result.results[0]).not.toHaveProperty("skillId");
    } finally {
      await service.dispose();
    }
  });

  it("fails safely when the kernel reports success but nothing landed on disk", async () => {
    writeSkill("ghost", "ghost", "Kernel ok without disk writes.", "# Ghost\n");
    commit("add ghost fixture");
    const workspaceDirectory = path.join(sandbox, "bounded-destination");
    const destinationPath = path.join(workspaceDirectory, "skills");
    fs.mkdirSync(destinationPath, { recursive: true });
    const workspaces = createWorkspaceRegistry();
    const destination = workspaces.import(workspaceDirectory, "Bounded destination");
    const service = createRepositoryService(workspaces, createSkillService(workspaces), {
      kernel: {
        ensureEntity: async () => kernelOk("created", "projected").ensure,
        projectEntity: async () => kernelOk("created", "projected").project,
      },
    });

    try {
      const scan = await service.scan(repository);
      const selected = scan.skills[0];
      if (!selected) throw new Error("Expected the ghost skill in the scan result.");
      const result = await service.install({
        sessionId: scan.sessionId,
        skillIds: [selected.id],
        targets: [target(destination)],
      });
      if (result.kind !== "result") throw new Error("Expected an actual install result.");
      expect(result).toMatchObject({ installed: 0, failed: 1 });
      expect(result.results[0]).toMatchObject({
        skill: "ghost",
        status: "failed",
        error: expect.stringContaining("not present at the expected destination"),
      });
      expect(result.results[0]).not.toHaveProperty("skillId");
      expect(fs.readdirSync(destinationPath)).toEqual([]);
    } finally {
      await service.dispose();
    }
  });

  it("does not sign an identity whose on-disk frontmatter does not match the selection", async () => {
    writeSkill("alpha", "alpha", "Install alpha.", "# Alpha\n");
    commit("add alpha skill");
    const workspaceDirectory = path.join(sandbox, "sibling-destination");
    const destinationPath = path.join(workspaceDirectory, "skills");
    fs.mkdirSync(destinationPath, { recursive: true });
    const workspaces = createWorkspaceRegistry();
    const destination = workspaces.import(workspaceDirectory, "Sibling destination");
    const skills = createSkillService(workspaces);
    // 内核 fake 落盘了错误名字的内容（sibling 冒名）。
    const service = createRepositoryService(workspaces, skills, {
      kernel: materializingKernel(destinationPath, (name) => {
        if (name === "alpha") {
          fs.rmSync(path.join(destinationPath, "alpha"), { recursive: true, force: true });
          writeSkillDocument(
            path.join(destinationPath, "alpha"),
            "beta",
            "A pre-existing sibling.",
            "# Beta\n",
          );
        }
      }),
    });

    try {
      const scan = await service.scan(repository);
      const alpha = scan.skills.find((skill) => skill.name === "alpha");
      if (!alpha) throw new Error("Expected alpha in the scan result.");
      const result = await service.install({
        sessionId: scan.sessionId,
        skillIds: [alpha.id],
        targets: [target(destination)],
      });
      if (result.kind !== "result") throw new Error("Expected an actual install result.");
      expect(result).toMatchObject({ installed: 0, failed: 1 });
      expect(result.results[0]).toMatchObject({
        skill: "alpha",
        status: "failed",
        error: expect.stringContaining("frontmatter name does not match"),
      });
      expect(result.results[0]).not.toHaveProperty("skillId");
    } finally {
      await service.dispose();
    }
  });

  it("retains an earlier installation when a later installed skill has invalid frontmatter", async () => {
    writeSkill("alpha", "alpha", "Install alpha.", "# Alpha\n");
    writeSkill("beta", "beta", "Install beta.", "# Beta\n");
    commit("add install validation fixtures");
    const workspaceDirectory = path.join(sandbox, "validation-destination");
    const destinationPath = path.join(workspaceDirectory, "skills");
    fs.mkdirSync(destinationPath, { recursive: true });
    const workspaces = createWorkspaceRegistry();
    const destination = workspaces.import(workspaceDirectory, "Validation destination");
    const skills = createSkillService(workspaces);
    const service = createRepositoryService(workspaces, skills, {
      kernel: materializingKernel(destinationPath, (name) => {
        if (name !== "beta") return;
        fs.rmSync(path.join(destinationPath, "beta"), { recursive: true, force: true });
        fs.mkdirSync(path.join(destinationPath, "beta"), { recursive: true });
        fs.writeFileSync(
          path.join(destinationPath, "beta", "SKILL.md"),
          "---\nname: beta\n---\n# Missing description\n",
          "utf8",
        );
      }),
    });

    try {
      const scan = await service.scan(repository);
      const alpha = scan.skills.find((skill) => skill.name === "alpha");
      const beta = scan.skills.find((skill) => skill.name === "beta");
      if (!alpha || !beta) throw new Error("Expected both fixtures in the scan result.");
      const result = await service.install({
        sessionId: scan.sessionId,
        skillIds: [alpha.id, beta.id],
        targets: [target(destination)],
      });
      if (result.kind !== "result") throw new Error("Expected an actual install result.");
      expect(result).toMatchObject({ installed: 1, failed: 1 });
      const installed = result.results.find((entry) => entry.status === "installed");
      const failed = result.results.find((entry) => entry.status === "failed");
      const discoveredAlpha = (await skills.list(target(destination))).find(
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

  it("retains earlier installation results when a later kernel call throws", async () => {
    writeSkill("alpha", "alpha", "Install alpha.", "# Alpha\n");
    writeSkill("beta", "beta", "Install beta.", "# Beta\n");
    commit("add kernel failure fixtures");
    const workspaceDirectory = path.join(sandbox, "throwing-destination");
    const destinationPath = path.join(workspaceDirectory, "skills");
    fs.mkdirSync(destinationPath, { recursive: true });
    const workspaces = createWorkspaceRegistry();
    const destination = workspaces.import(workspaceDirectory, "Throwing destination");
    const skills = createSkillService(workspaces);
    const service = createRepositoryService(workspaces, skills, {
      kernel: materializingKernel(destinationPath, (name) => {
        if (name === "beta") throw new Error("Simulated kernel failure.");
      }),
    });

    try {
      const scan = await service.scan(repository);
      const alpha = scan.skills.find((skill) => skill.name === "alpha");
      const beta = scan.skills.find((skill) => skill.name === "beta");
      if (!alpha || !beta) throw new Error("Expected both fixtures in the scan result.");
      const result = await service.install({
        sessionId: scan.sessionId,
        skillIds: [alpha.id, beta.id],
        targets: [target(destination)],
      });
      if (result.kind !== "result") throw new Error("Expected an actual install result.");
      expect(result).toMatchObject({ installed: 1, failed: 1 });
      expect(result.results.find((entry) => entry.status === "failed")).toMatchObject({
        skill: "beta",
        error: "Simulated kernel failure.",
      });
    } finally {
      await service.dispose();
    }
  });

  it("maps a per-root projection failure (TARGET_DENIED) into a per-skill failure", async () => {
    writeSkill("denied", "denied", "Projection root denies writes.", "# Denied\n");
    commit("add denied fixture");
    const workspaceDirectory = path.join(sandbox, "denied-destination");
    const destinationPath = path.join(workspaceDirectory, "skills");
    fs.mkdirSync(destinationPath, { recursive: true });
    const workspaces = createWorkspaceRegistry();
    const destination = workspaces.import(workspaceDirectory, "Denied destination");
    const service = createRepositoryService(workspaces, createSkillService(workspaces), {
      kernel: {
        ensureEntity: async () => kernelOk("created", "projected").ensure,
        projectEntity: async () =>
          ({
            ...kernelOk("created", "unchanged").project,
            results: [
              {
                root: destinationPath,
                rootId: "",
                path: path.join(destinationPath, "denied"),
                status: "failed",
                errorCode: "TARGET_DENIED",
                error: "kernel detail",
              },
            ],
            failed: 1,
          }) satisfies ProjectEntityResult,
      },
    });

    try {
      const scan = await service.scan(repository);
      const selected = scan.skills[0];
      if (!selected) throw new Error("Expected the denied fixture.");
      const result = await service.install({
        sessionId: scan.sessionId,
        skillIds: [selected.id],
        targets: [target(destination)],
      });
      if (result.kind !== "result") throw new Error("Expected an actual install result.");
      expect(result).toMatchObject({ installed: 0, failed: 1 });
      expect(result.results[0]).toMatchObject({
        status: "failed",
        error: expect.stringContaining("ccski code: TARGET_DENIED"),
      });
      expect(result.results[0]?.error).not.toContain("kernel detail");
    } finally {
      await service.dispose();
    }
  });

  it.skipIf(process.platform === "win32")(
    "does not sign an installed SKILL.md symbolic link",
    async () => {
      writeSkill("linked", "linked", "Reject linked skill files.", "# Linked\n");
      commit("add linked skill fixture");
      const workspaceDirectory = path.join(sandbox, "linked-skill-destination");
      const destinationPath = path.join(workspaceDirectory, "skills");
      fs.mkdirSync(destinationPath, { recursive: true });
      const workspaces = createWorkspaceRegistry();
      const destination = workspaces.import(workspaceDirectory, "Linked skill destination");
      const skills = createSkillService(workspaces);
      const service = createRepositoryService(workspaces, skills, {
        kernel: materializingKernel(destinationPath, (name) => {
          const installedPath = path.join(destinationPath, name);
          fs.rmSync(installedPath, { recursive: true, force: true });
          fs.mkdirSync(installedPath, { recursive: true });
          fs.writeFileSync(
            path.join(installedPath, "source.md"),
            `---\nname: ${JSON.stringify(name)}\ndescription: "Linked file."\n---\n# Linked\n`,
            "utf8",
          );
          fs.symlinkSync("source.md", path.join(installedPath, "SKILL.md"));
        }),
      });

      try {
        const scan = await service.scan(repository);
        const linked = scan.skills.find((skill) => skill.name === "linked");
        if (!linked) throw new Error("Expected the linked fixture in the scan result.");
        const result = await service.install({
          sessionId: scan.sessionId,
          skillIds: [linked.id],
          targets: [target(destination)],
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
        targets: [target(destination)],
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
        targets: [target(destination)],
      }),
    ).rejects.toThrow("Remote skill not found in scan session");
    expect(fs.existsSync(destinationPath)).toBe(false);
  });
});

describe("contract relative path normalization (windows test debt 2026-09-25)", () => {
  it("normalizes win32 path.relative separators to the contract `/` form", () => {
    // Windows 上 path.relative 产出 `skills\reviewed`（两处 Windows 失败的根因：
    // 契约字段/测试等值比较/rsk_ 摘要都按 `/` 形状冻结）。显式构造 Windows
    // 形状输入钉住归一化，不依赖 Windows 主机。
    expect(toContractRelativePath("skills\\reviewed")).toBe("skills/reviewed");
    expect(toContractRelativePath("skills\\nested\\deep")).toBe("skills/nested/deep");
    expect(toContractRelativePath(".")).toBe(".");
    expect(toContractRelativePath("skills/reviewed")).toBe("skills/reviewed");
  });
});
