/**
 * Skill service external-adapter tests.
 *
 * User input [2026-07-21]: "任何外部输入都应该遵循这个规则：各种配置文件、数据库结构、网络返回等"
 * Architecture decision [2026-07-21]: incompatible ccski responses never enter
 * a Workspace projection or masquerade as a successful validation.
 *
 * Orthogonal intents:
 *   [1] Discard incompatible third-party discovery entries.
 *   [2] Project an incompatible third-party validation result as a safe failure.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSkillService } from "../src/daemon/skill-service.js";
import { createWorkspaceRegistry } from "../src/daemon/workspace-registry/index.js";
import { HOME_WORKSPACE_ID } from "../src/shared/contracts/workspaces.js";
import { setHomeOverride } from "../src/shared/paths.js";

const previousHome = process.env.SKILL_CREATOR_HOME;
let sandbox = "";

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-skill-service-test-"));
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

function discoveredSkill(directory: string): unknown {
  return {
    name: "valid-skill",
    description: "A valid third-party skill.",
    provider: "codex",
    location: "user",
    path: directory,
    hasReferences: false,
    hasScripts: false,
    hasAssets: false,
  };
}

describe("skill service", () => {
  it("discards incompatible ccski discovery entries", async () => {
    const validDirectory = path.join(sandbox, "valid-skill");
    fs.mkdirSync(validDirectory);
    const workspaces = createWorkspaceRegistry();
    const skills = createSkillService(workspaces, {
      discoverSkills: async () => [discoveredSkill(validDirectory), { name: 42 }],
    });

    await expect(skills.list(HOME_WORKSPACE_ID)).resolves.toMatchObject([
      { name: "valid-skill", path: fs.realpathSync(validDirectory) },
    ]);
  });

  it("projects an incompatible ccski validation result as a failed validation", async () => {
    const validDirectory = path.join(sandbox, "valid-skill");
    fs.mkdirSync(validDirectory);
    fs.writeFileSync(path.join(validDirectory, "SKILL.md"), "# Valid skill\n", "utf8");
    const workspaces = createWorkspaceRegistry();
    const skills = createSkillService(workspaces, {
      discoverSkills: async () => [discoveredSkill(validDirectory)],
      validateSkill: async () => ({ success: "yes" }),
    });
    const [skill] = await skills.list(HOME_WORKSPACE_ID);
    if (!skill) throw new Error("Expected the valid discovery fixture.");

    await expect(skills.validate(HOME_WORKSPACE_ID, skill.id)).resolves.toEqual({
      skillId: skill.id,
      name: skill.name,
      success: false,
      errors: ["ccski returned an incompatible validation result."],
      warnings: [],
    });
  });
});
