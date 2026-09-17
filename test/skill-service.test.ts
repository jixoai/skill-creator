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
import {
  GLOBAL_WORKSPACE_ID,
  ProviderIdSchema,
  type WorkspaceProviderTarget,
} from "../src/shared/contracts/workspaces.js";
import { setHomeOverride } from "../src/shared/paths.js";

const previousHome = process.env.SKILL_CREATOR_HOME;
let sandbox = "";
const codexTarget: WorkspaceProviderTarget = {
  workspaceId: GLOBAL_WORKSPACE_ID,
  providerId: ProviderIdSchema.parse("codex"),
};

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

    await expect(skills.list(codexTarget)).resolves.toMatchObject([
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
    const [skill] = await skills.list(codexTarget);
    if (!skill) throw new Error("Expected the valid discovery fixture.");

    await expect(skills.validate(codexTarget, skill.id)).resolves.toEqual({
      skillId: skill.id,
      name: skill.name,
      success: false,
      errors: ["ccski returned an incompatible validation result."],
      warnings: [],
    });
  });
});

describe("skill service discovery cache (perf-firstscreen B-6)", () => {
  /**
   * 用户原始需求 [2026-09-18]：「性能很差，经常 loading」——同 target 的
   * list/resolve/info/toggle/validate 原本各自重跑整 root discovery；读链路
   * 复用短 TTL 结果，toggle 成功后必须失效。
   */
  it("shares one in-flight discovery across concurrent reads of the same target", async () => {
    const validDirectory = path.join(sandbox, "cached-skill");
    fs.mkdirSync(validDirectory);
    fs.writeFileSync(path.join(validDirectory, "SKILL.md"), "# cached\n", "utf8");
    let discoveries = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const workspaces = createWorkspaceRegistry();
    const skills = createSkillService(workspaces, {
      discoverSkills: async () => {
        discoveries += 1;
        await gate;
        return [discoveredSkill(validDirectory)];
      },
    });
    const pending = [
      skills.list(codexTarget),
      skills.list(codexTarget),
      skills.resolve(codexTarget, "pending" as unknown as never),
    ];
    release();
    const [first, second] = await Promise.allSettled(pending);
    expect(first.status).toBe("fulfilled");
    expect(second.status).toBe("fulfilled");
    expect(discoveries).toBe(1);
  });

  it("invalidates the cache after a successful toggle", async () => {
    const skillDir = path.join(sandbox, "toggle-skill");
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# toggle\n", "utf8");
    let disabled = false;
    const workspaces = createWorkspaceRegistry();
    const skills = createSkillService(workspaces, {
      discoverSkills: async () => [{ ...discoveredSkill(skillDir), disabled }],
    });
    const [first] = await skills.list(codexTarget);
    if (!first) throw new Error("Expected the toggle fixture.");
    expect(first.disabled).toBe(false);

    // toggle 读到旧态（disabled=false）→ rename 记账 succeeded；随后桩重放
    // rename 后的新磁盘态，toggle 完成后的读必须看到它（invalidate 生效）。
    const summary = await skills.toggle(codexTarget, [first.id], "disable");
    expect(summary.succeeded).toBe(1);
    disabled = true;

    const [after] = await skills.list(codexTarget);
    if (!after) throw new Error("Expected the post-toggle fixture.");
    expect(after.disabled).toBe(true);
  });
});
