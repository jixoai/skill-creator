/**
 * self-skill CLI/RPC 集成测试（self-skill-symlink）。
 *
 * 用户原始需求 [2026-09-30]：「在 cli 或者 webui 启动之后提醒用户……覆盖安装我们
 * 自己的版本（可选备份）；坚持使用用户自己已有的版本。」
 *
 * 正交意图：
 *   [1] 真实 CLI 进程（tsx 源码树 + 沙箱 HOME/状态根/self-skill 根隔离）：
 *       status 投影、install --backup 落链+备份、keep 记忆、用法错误 exit 1。
 *   [2] RPC 面（真实 domain + oRPC client）：state 投影 backupAvailable、
 *       resolve/keep 与 CLI 同源。
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createRouterClient } from "@orpc/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDaemonDomain, type DaemonDomain } from "../src/daemon/domain.js";
import { createRpcRouter } from "../src/daemon/rpc-router.js";
import { SELF_SKILL_DIRECTORY_NAME, SELF_SKILL_ROOT_ENV } from "../src/daemon/self-skill.js";
import { setHomeOverride } from "../src/shared/paths.js";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const cliEntry = path.join(root, "src", "cli", "cli.ts");

/** provider catalog Global root env overrides（照 rpc-search 隔离集）。 */
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

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "self-skill-cli-test-"));
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

function agentsRoot(): string {
  return process.env[SELF_SKILL_ROOT_ENV]!;
}

function entryPath(): string {
  return path.join(agentsRoot(), SELF_SKILL_DIRECTORY_NAME);
}

function writeUserConflict(): void {
  // 造新冲突前先移除既有条目：resolve 后条目是指向仓库技能源的 symlink，
  // 直接写会顺着链接覆盖仓库文件。
  const entry = entryPath();
  try {
    if (fs.lstatSync(entry).isSymbolicLink()) fs.unlinkSync(entry);
    else fs.rmSync(entry, { recursive: true, force: true });
  } catch {
    // 条目不存在（首次造冲突）。
  }
  fs.mkdirSync(path.join(entry, "references"), { recursive: true });
  fs.writeFileSync(
    path.join(entry, "SKILL.md"),
    "---\nname: skill-creator-v2\ndescription: my own copy\n---\n\nuser content\n",
  );
}

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

describe("CLI self-skill subcommand", () => {
  it("prints the conflict and resolves with backup, then reports linked", async () => {
    writeUserConflict();
    const status = await runCli(["self-skill", "status"]);
    expect(status.code).toBe(0);
    expect(status.stdout).toContain("CONFLICT (user-directory)");

    const install = await runCli(["self-skill", "install", "--backup"]);
    expect(install.code).toBe(0);
    expect(install.stdout).toContain("backed up to");
    expect(fs.lstatSync(entryPath()).isSymbolicLink()).toBe(true);
    const backups = fs.readdirSync(path.join(sandbox, "skills-backup"));
    expect(backups.length).toBe(1);

    const after = await runCli(["self-skill", "status"]);
    expect(after.stdout).toContain("self skill linked ->");
  });

  it("keeps the user version and stays silent on the next status", async () => {
    writeUserConflict();
    const keep = await runCli(["self-skill", "keep"]);
    expect(keep.code).toBe(0);
    const status = await runCli(["self-skill", "status"]);
    expect(status.stdout).toContain("kept as yours");
    expect(fs.readFileSync(path.join(entryPath(), "SKILL.md"), "utf8")).toContain("my own copy");
  });

  it("rejects usage errors with exit 1", async () => {
    expect((await runCli(["self-skill", "bogus"])).code).toBe(1);
    expect((await runCli(["self-skill", "keep", "--backup"])).code).toBe(1);
  });
});

describe("RPC selfSkill face", () => {
  it("projects conflict with backupAvailable and resolves/keeps through shared logic", async () => {
    domain = createDaemonDomain();
    const client = createRouterClient(
      createRpcRouter({ status: () => ({}) as never, domain: domain! }),
    );

    writeUserConflict();
    const conflict = (await client.selfSkill.state({})) as {
      state: string;
      conflict?: { kind: string; backupAvailable: boolean };
    };
    expect(conflict.state).toBe("conflict");
    expect(conflict.conflict!.kind).toBe("user-directory");
    expect(conflict.conflict!.backupAvailable).toBe(true);

    const resolved = (await client.selfSkill.resolve({ backup: true })) as {
      ok: boolean;
      backupPath?: string;
    };
    expect(resolved.ok).toBe(true);
    expect(resolved.backupPath).toContain("skills-backup");
    expect(fs.lstatSync(entryPath()).isSymbolicLink()).toBe(true);

    writeUserConflict();
    const kept = (await client.selfSkill.keep({})) as { ok: boolean };
    expect(kept.ok).toBe(true);
    const after = (await client.selfSkill.state({})) as { state: string };
    expect(after.state).toBe("kept");
  });
});
