/**
 * skills/model/setup 模型段 CLI 集成测试（cli-surface-parity D6）。
 *
 * 用户原始需求 [2026-09-30]：「skill-creator 自身也需要暴露更多的 cli 能力……比如
 * 技能的维护、清理和升级 等等」「setup 还需要支持更加复杂的参数，来支持 model 的
 * 配置……通过 cli 提供同源的支持」
 *
 * 正交意图：
 *   [1] 真实 CLI 进程（tsx + SKILL_CREATOR_HOME 沙箱）的 skills 族：引用解析
 *       矩阵（label 前缀/歧义/~）、list/info/validate/toggle（含 symlink
 *       conflict 投影）、duplicates 内容分组。
 *   [2] model 族与 setup --model 段：route add/remove/use/key/routes 的同源
 *       持久化（steward-store 同一份文件）、key 明文不回显、typed failed 不抛、
 *       半配置拒绝、link 结果不被模型段失败回滚。
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDaemonDomain, type DaemonDomain } from "../src/daemon/domain.js";
import { SELF_SKILL_ROOT_ENV } from "../src/daemon/self-skill.js";
import { setHomeOverride } from "../src/shared/paths.js";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const cliEntry = path.join(root, "src", "cli", "cli.ts");

/** provider catalog Global root env overrides（照 self-skill-cli 隔离集）。 */
const PROVIDER_HOME_OVERRIDES = [
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "VIBE_HOME",
  "HERMES_HOME",
  "AUTOHAND_HOME",
  "GROK_HOME",
] as const;

const previousEnv: Record<string, string | undefined> = {};
let sandbox = "";
let domain: DaemonDomain | null = null;

function writeSkill(dir: string, name: string, description: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n${name} body\n`,
  );
}

/** 注册一个带 .claude/skills 语料的 Imported Workspace；返回 workspace 目录。 */
async function registerWorkspace(label: string, skillNames: string[]): Promise<string> {
  const wsDir = path.join(sandbox, "ws", label.replace(/\s+/g, "-").toLowerCase());
  for (const name of skillNames) {
    writeSkill(path.join(wsDir, ".claude", "skills", name), name, `${name} skill`);
  }
  domain!.workspaces.import(wsDir, label);
  return wsDir;
}

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "cli-surface-test-"));
  for (const name of [
    "HOME",
    "USERPROFILE",
    "SKILL_CREATOR_HOME",
    "XDG_CONFIG_HOME",
    SELF_SKILL_ROOT_ENV,
    ...PROVIDER_HOME_OVERRIDES,
  ]) {
    previousEnv[name] = process.env[name];
  }
  const home = path.join(sandbox, "home");
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.SKILL_CREATOR_HOME = path.join(sandbox, "state");
  process.env.XDG_CONFIG_HOME = path.join(home, ".config");
  process.env[SELF_SKILL_ROOT_ENV] = path.join(sandbox, "agents-skills");
  for (const name of PROVIDER_HOME_OVERRIDES) process.env[name] = path.join(sandbox, "iso", name);
  setHomeOverride(path.join(sandbox, "state"));
  domain = createDaemonDomain(undefined, { probeWarmup: false });
});

afterEach(async () => {
  setHomeOverride(null);
  for (const [name, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await domain?.skillSearch.dispose();
  domain = null;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["--import", "tsx", cliEntry, ...args],
      { cwd: root, encoding: "utf8", timeout: 60_000 },
    );
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number };
    return { stdout: failure.stdout ?? "", stderr: failure.stderr ?? "", code: failure.code ?? 1 };
  }
}

function settingsPath(): string {
  return path.join(sandbox, "state", "steward-store", "dsh-settings.json");
}

describe("CLI skills family (cli-surface-parity)", () => {
  it("lists skills via unique label prefix with --json contract shape", async () => {
    await registerWorkspace("Research Lab", ["alpha", "beta"]);
    const result = await runCli(["skills", "list", "research", "--json"]);
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      skills: { name: string; provider: string; state: string }[];
    };
    const names = parsed.skills.map((s) => s.name).sort();
    expect(names).toEqual(["alpha", "beta"]);
    expect(parsed.skills.every((s) => s.provider === "claude-code")).toBe(true);
  });

  it("rejects an ambiguous workspace reference with candidates (exit 2)", async () => {
    await registerWorkspace("Research Lab", ["alpha"]);
    await registerWorkspace("Research Deck", ["beta"]);
    const result = await runCli(["skills", "list", "research"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("ambiguous workspace");
    expect(result.stderr).toContain("Research Lab");
    expect(result.stderr).toContain("Research Deck");
  });

  it("shows info content and validates a skill", async () => {
    await registerWorkspace("Research Lab", ["alpha"]);
    const info = await runCli(["skills", "info", "research", "claude", "alpha"]);
    expect(info.code).toBe(0);
    expect(info.stdout).toContain("alpha body");
    const validate = await runCli(["skills", "validate", "research", "claude", "alpha"]);
    expect(validate.code).toBe(0);
    expect(validate.stdout).toContain("valid");
  });

  it("toggles a skill off and on, and projects symlink conflicts (exit 1)", async () => {
    const wsDir = await registerWorkspace("Research Lab", ["alpha"]);
    // symlink 条目：真实目录在 workspace 外，.claude/skills 内放链接。
    const target = path.join(sandbox, "external", "linked-skill");
    writeSkill(target, "linked-skill", "a symlinked skill");
    fs.symlinkSync(target, path.join(wsDir, ".claude", "skills", "linked-skill"), "dir");

    const off = await runCli(["skills", "toggle", "research", "claude", "alpha", "--disable"]);
    expect(off.code).toBe(0);
    expect(off.stdout).toContain("alpha: disabled");
    const conflict = await runCli([
      "skills",
      "toggle",
      "research",
      "claude",
      "linked-skill",
      "--disable",
    ]);
    expect(conflict.code).toBe(1);
    expect(conflict.stderr).toContain("linked-skill: conflict");
    const on = await runCli(["skills", "toggle", "research", "claude", "alpha", "--enable"]);
    expect(on.code).toBe(0);
    expect(on.stdout).toContain("alpha: enabled");
  });

  it("groups identical skill content across workspaces as duplicates", async () => {
    await registerWorkspace("Research Lab", ["alpha"]);
    await registerWorkspace("Archive", ["alpha"]);
    const result = await runCli(["skills", "duplicates"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("duplicate group");
    expect(result.stdout).toContain("alpha");
  });

  it("rejects update without an explicit scope", async () => {
    await registerWorkspace("Research Lab", ["alpha"]);
    const result = await runCli(["skills", "update", "check"]);
    expect(result.code).toBe(2);
  });
});

describe("CLI model family (cli-surface-parity)", () => {
  it("adds a route, stores a key, and routes output never echoes the key", async () => {
    const add = await runCli([
      "model",
      "route",
      "add",
      "local-gw",
      "--base-url",
      "http://127.0.0.1:9/anthropic",
      "--api",
      "anthropic-messages",
      "--model",
      "m1",
    ]);
    expect(add.code).toBe(0);
    expect(add.stdout).toContain("route added");

    const keySet = await runCli(["model", "key", "set", "local-gw", "test-key-123"]);
    expect(keySet.code).toBe(0);

    const routes = await runCli(["model", "routes"]);
    expect(routes.code).toBe(0);
    expect(routes.stdout).toContain("local-gw");
    expect(routes.stdout).toContain("configured");
    expect(routes.stdout).not.toContain("test-key-123");

    const routesJson = await runCli(["model", "routes", "--json"]);
    expect(routesJson.stdout).not.toContain("test-key-123");
  });

  it("rejects duplicate route add and active-route removal; use switches the active model", async () => {
    await runCli([
      "model",
      "route",
      "add",
      "local-gw",
      "--base-url",
      "http://127.0.0.1:9/anthropic",
      "--api",
      "anthropic-messages",
      "--model",
      "m1",
    ]);
    const dup = await runCli([
      "model",
      "route",
      "add",
      "local-gw",
      "--base-url",
      "http://127.0.0.1:10/anthropic",
      "--api",
      "anthropic-messages",
      "--model",
      "m2",
    ]);
    expect(dup.code).toBe(2);

    const use = await runCli(["model", "use", "local-gw", "m1"]);
    expect(use.code).toBe(0);
    expect(use.stdout).toContain("active model: local-gw/m1");

    const removeActive = await runCli(["model", "route", "remove", "local-gw"]);
    expect(removeActive.code).toBe(2);
    expect(removeActive.stderr).toContain("active");
  });

  it("auto-adds a catalog route on use and persists the same settings file", async () => {
    const use = await runCli(["model", "use", "zai-api", "GLM-5.3"]);
    expect(use.code).toBe(0);
    expect(use.stdout).toContain("route added for zai-api from catalog");
    const settings = JSON.parse(fs.readFileSync(settingsPath(), "utf8")) as {
      modelRoutes: { provider: string }[];
      model: { provider: string; model: string };
    };
    expect(settings.modelRoutes.some((r) => r.provider === "zai-api")).toBe(true);
    expect(settings.model).toEqual({ provider: "zai-api", model: "GLM-5.3" });
  });

  it("reports typed connection failure without throwing (exit 1)", async () => {
    await runCli([
      "model",
      "route",
      "add",
      "local-gw",
      "--base-url",
      "http://127.0.0.1:9/anthropic",
      "--api",
      "anthropic-messages",
      "--model",
      "m1",
    ]);
    const result = await runCli(["model", "test", "local-gw", "m1"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("failed");
  });
});

describe("setup --model section (cli-surface-parity D5)", () => {
  it("rejects model flags without --model (exit 2) and touches nothing", async () => {
    const result = await runCli(["setup", "--effort", "high"]);
    expect(result.code).toBe(2);
    expect(fs.existsSync(settingsPath())).toBe(false);
  });

  it("configures key-less model end-to-end and keeps link + agents-md results", async () => {
    const result = await runCli([
      "setup",
      "--model",
      "local-gw/m1",
      "--base-url",
      "http://127.0.0.1:9/anthropic",
      "--api",
      "anthropic-messages",
      "--api-key",
      "none",
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("route added");
    expect(result.stdout).toContain("active model: local-gw/m1");
    const settings = JSON.parse(fs.readFileSync(settingsPath(), "utf8")) as {
      model: { provider: string; model: string };
      modelRoutes: { provider: string }[];
    };
    expect(settings.model).toEqual({ provider: "local-gw", model: "m1" });
    expect(settings.modelRoutes.some((r) => r.provider === "local-gw")).toBe(true);
    // 凭据段被 --api-key none 跳过：credentials 文件不落盘。
    expect(
      fs.existsSync(path.join(sandbox, "state", "steward-store", "dsh-credentials.json")),
    ).toBe(false);
    // link + agents-md 结果在场（valve 沙箱内）。
    expect(
      fs.lstatSync(path.join(sandbox, "agents-skills", "skill-creator-v2")).isSymbolicLink(),
    ).toBe(true);
    expect(
      fs.readFileSync(path.join(sandbox, "agents-skills", "..", "AGENTS.md"), "utf8"),
    ).toContain("<skill-creator-v2>");
  });

  it("fails visibly (exit 1) when the model section cannot proceed, keeping link results", async () => {
    const result = await runCli(["setup", "--model", "unknown-provider/m1"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("unknown-provider");
    // link 结果不被回滚。
    expect(
      fs.lstatSync(path.join(sandbox, "agents-skills", "skill-creator-v2")).isSymbolicLink(),
    ).toBe(true);
  });
});
