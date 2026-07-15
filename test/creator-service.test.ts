/**
 * Creator service contract tests.
 *
 * User input [2026-07-14]: "我们还需要有一个 创造、编辑 技能的路由(/creator)。二者是有机互联的"
 * Architecture decision [2026-07-14]: verify containment, frontmatter round-trip,
 * revision conflicts, and bounded deletion at the Creator service boundary.
 *
 * Orthogonal intents:
 *   [1] Create accepts only safe direct-child directories.
 *   [2] Load/update preserves the complete skill document.
 *   [3] Update/delete require the observed revision and workspace identity.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDaemonDomain, type DaemonDomain } from "../src/daemon/domain.js";
import type { ImportedWorkspace } from "../src/shared/contracts/workspaces.js";
import { setHomeOverride } from "../src/shared/paths.js";

const previousHome = process.env.SKILL_CREATOR_HOME;
let sandbox = "";
let domain: DaemonDomain;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-creator-test-"));
  const isolatedHome = path.join(sandbox, "state");
  process.env.SKILL_CREATOR_HOME = isolatedHome;
  setHomeOverride(isolatedHome);
  domain = createDaemonDomain();
});

afterEach(async () => {
  await domain.repository.dispose();
  setHomeOverride(null);
  if (previousHome === undefined) delete process.env.SKILL_CREATOR_HOME;
  else process.env.SKILL_CREATOR_HOME = previousHome;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function importWorkspace(name: string): ImportedWorkspace {
  const directory = path.join(sandbox, name);
  fs.mkdirSync(directory, { recursive: true });
  return domain.workspaces.import(directory, name);
}

function directoryPath(workspace: ImportedWorkspace): string {
  return workspace.path;
}

describe("creator service", () => {
  it("rejects parent traversal without creating files outside the workspace", async () => {
    const workspace = importWorkspace("safe-root");
    const escaped = path.join(sandbox, "escaped");

    await expect(
      domain.creator.save({
        mode: "create",
        workspaceId: workspace.id,
        directoryName: "../escaped",
        frontmatter: { name: "escaped", description: "Must not be written." },
        body: "# Unsafe\n",
      }),
    ).rejects.toThrow();

    expect(fs.existsSync(escaped)).toBe(false);
  });

  it("round-trips additional frontmatter through create, load, and update", async () => {
    const workspace = importWorkspace("round-trip-root");
    const created = await domain.creator.save({
      mode: "create",
      workspaceId: workspace.id,
      directoryName: "release-guide",
      frontmatter: {
        name: "release-guide",
        description: "Guide a production release.",
        license: "MIT",
        metadata: { audience: ["release-engineering"], maturity: "stable" },
      },
      body: "# Release\n\nShip the reviewed artifact.\n",
    });

    const loaded = await domain.creator.load(workspace.id, created.document.skillId);
    expect(loaded.frontmatter).toEqual({
      name: "release-guide",
      description: "Guide a production release.",
      license: "MIT",
      metadata: { audience: ["release-engineering"], maturity: "stable" },
    });
    expect(loaded.body).toBe("# Release\n\nShip the reviewed artifact.\n");

    const updated = await domain.creator.save({
      mode: "update",
      workspaceId: workspace.id,
      skillId: loaded.skillId,
      expectedRevision: loaded.revision,
      frontmatter: {
        ...loaded.frontmatter,
        description: "Guide a verified production release.",
      },
      body: "# Release\n\nShip only the verified artifact.\n",
    });

    expect(updated.created).toBe(false);
    expect(updated.document.frontmatter).toMatchObject({
      description: "Guide a verified production release.",
      license: "MIT",
      metadata: { audience: ["release-engineering"], maturity: "stable" },
    });
    expect(updated.document.body).toBe("# Release\n\nShip only the verified artifact.\n");
  });

  it("rejects an update based on a stale revision", async () => {
    const workspace = importWorkspace("revision-root");
    const created = await domain.creator.save({
      mode: "create",
      workspaceId: workspace.id,
      directoryName: "incident-guide",
      frontmatter: { name: "incident-guide", description: "Handle an incident." },
      body: "# Incident\n\nUse the initial runbook.\n",
    });
    const file = path.join(directoryPath(workspace), "incident-guide", "SKILL.md");
    const concurrentContent = [
      "---",
      "name: incident-guide",
      "description: Handle an incident.",
      "---",
      "# Incident",
      "",
      "A concurrent editor changed this runbook.",
      "",
    ].join("\n");
    fs.writeFileSync(file, concurrentContent, "utf8");

    await expect(
      domain.creator.save({
        mode: "update",
        workspaceId: workspace.id,
        skillId: created.document.skillId,
        expectedRevision: created.document.revision,
        frontmatter: created.document.frontmatter,
        body: "# Incident\n\nOverwrite the concurrent edit.\n",
      }),
    ).rejects.toThrow("This skill changed on disk. Reload it before saving your edits.");

    expect(fs.readFileSync(file, "utf8")).toBe(concurrentContent);
  });

  it("rejects deleting a skill through a different workspace boundary", async () => {
    const sourceWorkspace = importWorkspace("source-root");
    const otherWorkspace = importWorkspace("other-root");
    const created = await domain.creator.save({
      mode: "create",
      workspaceId: sourceWorkspace.id,
      directoryName: "protected-skill",
      frontmatter: { name: "protected-skill", description: "Remain in the source workspace." },
      body: "# Protected\n",
    });
    const sourceDirectory = path.join(directoryPath(sourceWorkspace), "protected-skill");

    await expect(
      domain.creator.remove(otherWorkspace.id, created.document.skillId, created.document.revision),
    ).rejects.toThrow("Skill not found in workspace");

    expect(fs.existsSync(sourceDirectory)).toBe(true);
  });
});
