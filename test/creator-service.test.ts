/**
 * Creator service contract tests.
 *
 * User input [2026-07-14]: "我们还需要有一个 创造、编辑 技能的路由(/creator)。二者是有机互联的"
 * User input [2026-07-21]: "任何外部输入都应该遵循这个规则：各种配置文件、数据库结构、网络返回等"
 * Architecture decision [2026-07-14]: verify containment, frontmatter round-trip,
 * revision conflicts, and bounded deletion at the Creator service boundary.
 * Architecture decision [2026-10-09]（creator-skill-store 批 1）：new 模式唯一
 * 归宿 = origin store（`<home>/creator-skills`）+ auto-apply entity-local；edit
 * 模式（已安装技能）契约不动；程序化 provider 创建走 createInWorkspace。
 *
 * Orthogonal intents:
 *   [1] Create accepts only safe store directory names.
 *   [2] Load/update preserves the complete skill document.
 *   [3] Update/delete require the observed revision and workspace identity.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCreatorService } from "../src/daemon/creator-service.js";
import { createCreatorStoreService } from "../src/daemon/creator-store-service.js";
import { createDaemonDomain, type DaemonDomain } from "../src/daemon/domain.js";
import { deterministicSkillsCliProbe } from "./helpers/deterministic-probe.js";
import type { SkillService } from "../src/daemon/skill-service.js";
import { SkillIdSchema, type SkillMetadata } from "../src/shared/contracts/skills.js";
import {
  ProviderIdSchema,
  type ImportedWorkspace,
  type WorkspaceProviderTarget,
} from "../src/shared/contracts/workspaces.js";
import { setHomeOverride } from "../src/shared/paths.js";

const previousHome = process.env.SKILL_CREATOR_HOME;
let sandbox = "";
let home = "";
let domain: DaemonDomain;
const openClawProviderId = ProviderIdSchema.parse("openclaw");

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-creator-test-"));
  home = path.join(sandbox, "state");
  process.env.SKILL_CREATOR_HOME = home;
  setHomeOverride(home);
  domain = createDaemonDomain(undefined, { skillsCliProbe: deterministicSkillsCliProbe() });
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
  return path.join(workspace.path, "skills");
}

function target(workspace: ImportedWorkspace): WorkspaceProviderTarget {
  return { workspaceId: workspace.id, providerId: openClawProviderId };
}

function skillServiceForFile(skill: SkillMetadata, file: string): SkillService {
  return {
    list: async () => [skill],
    resolve: async () => skill,
    skillFile: () => file,
    info: async () => ({
      ...skill,
      size: 0,
      content: "",
      revision: `sha256:${"0".repeat(64)}`,
    }),
    toggle: async () => ({
      mode: "enable",
      results: [],
      succeeded: 0,
      skipped: 0,
      conflicts: 0,
      failed: 0,
    }),
    validate: async () => ({
      skillId: skill.id,
      name: skill.name,
      success: true,
      errors: [],
      warnings: [],
    }),
  };
}

describe("creator service", () => {
  it("rejects parent traversal without creating files outside the store", async () => {
    const escaped = path.join(sandbox, "escaped");

    await expect(
      domain.creator.save({
        mode: "create",
        directoryName: "../escaped",
        frontmatter: { name: "escaped", description: "Must not be written." },
        body: "# Unsafe\n",
      }),
    ).rejects.toThrow();

    expect(fs.existsSync(escaped)).toBe(false);
  });

  it("creates into the origin store and auto-applies the global canonical root", async () => {
    const created = await domain.creator.save({
      mode: "create",
      directoryName: "release-guide",
      frontmatter: {
        name: "release-guide",
        description: "Guide a production release.",
        license: "MIT",
        metadata: { audience: ["release-engineering"], maturity: "stable" },
      },
      body: "# Release\n\nShip the reviewed artifact.\n",
    });
    if (!created.created) throw new Error("Expected a store creation result.");

    // store 是唯一根源：SKILL.md 落 <home>/creator-skills/<name>/。
    const storeFile = path.join(home, "creator-skills", "release-guide", "SKILL.md");
    expect(fs.existsSync(storeFile)).toBe(true);
    expect(created.document.frontmatter).toMatchObject({
      name: "release-guide",
      license: "MIT",
      metadata: { audience: ["release-engineering"], maturity: "stable" },
    });
    expect(created.document.body).toBe("# Release\n\nShip the reviewed artifact.\n");

    // auto-apply：`~/.agents/skills` entity-local（实体在场、无 symlink、state 记账）。
    const entityDirectory = path.join(home, ".agents", "skills", "release-guide");
    const entityStat = fs.lstatSync(entityDirectory);
    expect(entityStat.isDirectory()).toBe(true);
    expect(entityStat.isSymbolicLink()).toBe(false);
    const state = JSON.parse(
      fs.readFileSync(path.join(home, ".agents", ".ccski-state.json"), "utf8"),
    ) as { entities: Record<string, unknown> };
    expect(Object.keys(state.entities)).toContain("release-guide");
    expect(created.autoApply.results).toHaveLength(1);
    expect(created.autoApply.results[0]).toMatchObject({
      status: "unchanged",
      mode: "entity-local",
      entity: "created",
      root: path.join(home, ".agents", "skills"),
    });
  });

  it("round-trips additional frontmatter through store create and revision-safe save", async () => {
    const created = await domain.creator.save({
      mode: "create",
      directoryName: "round-trip-store",
      frontmatter: {
        name: "round-trip-store",
        description: "Guide a production release.",
        license: "MIT",
        metadata: { audience: ["release-engineering"], maturity: "stable" },
      },
      body: "# Release\n\nShip the reviewed artifact.\n",
    });
    if (!created.created) throw new Error("Expected a store creation result.");

    const updated = await domain.creatorStore.save({
      directoryName: "round-trip-store",
      expectedRevision: created.document.revision,
      frontmatter: {
        ...created.document.frontmatter,
        description: "Guide a verified production release.",
      },
      body: "# Release\n\nShip only the verified artifact.\n",
    });

    expect(updated.document.frontmatter).toEqual({
      name: "round-trip-store",
      description: "Guide a verified production release.",
      license: "MIT",
      metadata: { audience: ["release-engineering"], maturity: "stable" },
    });
    expect(updated.document.body).toBe("# Release\n\nShip only the verified artifact.\n");
    expect(updated.document.revision).not.toBe(created.document.revision);
  });

  it("projects incompatible disk frontmatter as an invalid Creator operation", async () => {
    const workspace = importWorkspace("invalid-document-root");
    const skillDirectory = path.join(directoryPath(workspace), "invalid-document");
    const skillFile = path.join(skillDirectory, "SKILL.md");
    fs.mkdirSync(skillDirectory, { recursive: true });
    fs.writeFileSync(skillFile, "---\nname: 42\ndescription: null\n---\n# Invalid\n", "utf8");
    const skill: SkillMetadata = {
      id: SkillIdSchema.parse("sk_000000000000000000000000"),
      name: "invalid-document",
      description: "An invalid document fixture.",
      directoryName: "invalid-document",
      disabled: false,
      provider: "fixture",
      location: "project",
      path: skillDirectory,
      hasReferences: false,
      hasScripts: false,
      hasAssets: false,
      pluginInfo: null,
    };
    const creator = createCreatorService(domain.workspaces, skillServiceForFile(skill, skillFile), {
      store: createCreatorStoreService(domain.workspaces),
    });

    await expect(creator.load(target(workspace), skill.id)).rejects.toMatchObject({
      code: "INVALID_OPERATION",
      message: "The skill document frontmatter is incompatible with the current format.",
    });
  });

  it("rejects a store save based on a stale revision", async () => {
    const created = await domain.creator.save({
      mode: "create",
      directoryName: "incident-guide",
      frontmatter: { name: "incident-guide", description: "Handle an incident." },
      body: "# Incident\n\nUse the initial runbook.\n",
    });
    if (!created.created) throw new Error("Expected a store creation result.");
    const file = path.join(home, "creator-skills", "incident-guide", "SKILL.md");
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
      domain.creatorStore.save({
        directoryName: "incident-guide",
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
    const created = await domain.creator.createInWorkspace({
      workspaceId: sourceWorkspace.id,
      providerId: openClawProviderId,
      directoryName: "protected-skill",
      frontmatter: { name: "protected-skill", description: "Remain in the source workspace." },
      body: "# Protected\n",
    });
    const sourceDirectory = path.join(directoryPath(sourceWorkspace), "protected-skill");

    await expect(
      domain.creator.remove(
        target(otherWorkspace),
        created.document.skillId,
        created.document.revision,
      ),
    ).rejects.toThrow("Skill not found in Workspace Provider");

    expect(fs.existsSync(sourceDirectory)).toBe(true);
  });
});
