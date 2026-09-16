/**
 * SkillSearchService 默认装配测试（server-owned roots 的生产路径）。
 *
 * User input [2026-09-17]: "roots 只来自 provider catalog 与 workspace registry 持久态的
 * server 侧解析，不接受调用方传入的任意路径。" —— 本套件走默认构造（零参数），
 * 以 HOME + SKILL_CREATOR_HOME 沙箱驱动 catalog globalPath 与 imported workspaces
 * 两条真实解析路径，证明生产 root seam 无注入面。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSkillSearchService } from "../src/daemon/skill-search/service.js";
import { setHomeOverride } from "../src/shared/paths.js";

let sandbox = "";
let previousHome: string | undefined;
let previousAppHome: string | undefined;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-search-service-test-"));
  previousHome = process.env.HOME;
  previousAppHome = process.env.SKILL_CREATOR_HOME;
  process.env.HOME = path.join(sandbox, "home");
  process.env.SKILL_CREATOR_HOME = path.join(sandbox, "state");
  setHomeOverride(path.join(sandbox, "state"));
});

afterEach(() => {
  setHomeOverride(null);
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  if (previousAppHome === undefined) delete process.env.SKILL_CREATOR_HOME;
  else process.env.SKILL_CREATOR_HOME = previousAppHome;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function writeSkill(root: string, name: string, description: string): string {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\nbody of ${name}\n`,
  );
  return directory;
}

describe("skill search service default assembly", () => {
  it("discovers catalog global roots and imported workspaces without caller paths", async () => {
    // Global 路径：HOME 沙箱下的 ~/.claude/skills 与 ~/.agents/skills（catalog 解析）。
    writeSkill(
      path.join(sandbox, "home", ".claude", "skills"),
      "global-claude",
      "claude global skill",
    );
    const agentsRoot = path.join(sandbox, "home", ".agents", "skills");
    writeSkill(agentsRoot, "global-agents", "agents global skill");
    // Imported Workspace：workspaces.json 持久态 + provider workspacePath 派生根。
    const workspaceRoot = path.join(sandbox, "ws");
    fs.mkdirSync(workspaceRoot, { recursive: true });
    const stateDir = path.join(sandbox, "state", ".skill-creator");
    fs.mkdirSync(stateDir, { recursive: true });
    const canonical = fs.realpathSync(workspaceRoot);
    const crypto = await import("node:crypto");
    const digest = crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 24);
    fs.writeFileSync(
      path.join(stateDir, "workspaces.json"),
      JSON.stringify({
        schemaVersion: 2,
        activeId: "~",
        workspaces: [{ id: `ws_${digest}`, label: "test-ws", path: canonical }],
      }),
    );
    writeSkill(
      path.join(workspaceRoot, ".agents", "skills"),
      "imported-codex",
      "imported workspace skill",
    );

    const service = createSkillSearchService();
    const results = await service.search("global skill", { limit: 10 });
    const names = new Set(results.map((result) => result.name));
    expect(names.has("global-claude")).toBe(true);
    expect(names.has("global-agents")).toBe(true);

    const imported = await service.search("imported workspace skill", { limit: 10 });
    const hit = imported.find((result) => result.name === "imported-codex");
    expect(hit).toBeDefined();
    // 多个 catalog provider 共享 .agents/skills workspacePath：同一物理入口按
    // provider 逐一生成 installation（语义正确的多观察），断言包含 codex 三元组。
    expect(
      hit?.installations.some(
        (installation) =>
          installation.path === path.join(canonical, ".agents", "skills", "imported-codex") &&
          installation.workspaceId === `ws_${digest}` &&
          installation.providerId === "codex",
      ),
    ).toBe(true);
    expect(
      hit?.installations.every((installation) => installation.workspaceId === `ws_${digest}`),
    ).toBe(true);

    // global-claude 的 installation 绑定 Global 作用域。
    const claudeHit = results.find((result) => result.name === "global-claude");
    expect(
      claudeHit?.installations.some(
        (installation) =>
          installation.workspaceId === "~" && installation.providerId === "claude-code",
      ),
    ).toBe(true);
  });
});
