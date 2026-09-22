/**
 * CLI wiki 子命令集成测试（无 daemon，真实进程；wiki-directory-standard 2.3/2.4）。
 *
 * spec 输入 [2026-09-22]：`skill-creator wiki <子命令>` 经 cli-kit 组装——
 * `--workspace` 支持 registry label/ws_id 解析（进程内只读 registry）与路径直传；
 * 含 `scopes` 扩展命令（scope 清单 × pattern 计数 × label）；解析失败为用法
 * 错误 exit 2；缺省 `./`；退出码透传 wiki 域。
 *
 * Orthogonal intents:
 *   [1] 真实 CLI 进程（tsx 源码树）+ 沙箱 SKILL_CREATOR_HOME / SKILL_WIKI_HOME /
 *       tmp cwd 的端到端 wiki 闭环。
 *   [2] workspace 感知解析契约：label 前缀 / ws_* id / 路径 / `~` / 缺省 `./`；
 *       label 歧义与零匹配 → exit 2；scopes 人读表格与 --json 形状。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { opaquePathId } from "../src/daemon/path-safety.js";

const root = path.resolve(import.meta.dirname, "..");
const cliEntry = path.join(root, "src", "cli", "cli.ts");
// tsx 以绝对路径作为主模块传入：沙箱 cwd（tmp project）下裸 "tsx" 无法解析。
const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.promises.rm(directory, { recursive: true, force: true })),
  );
});

interface Sandbox {
  home: string;
  stateHome: string;
  wikiHome: string;
  project: string;
  /** 预置一个 registry workspace（目录真实创建，id 由 canonical path digest 派生）。 */
  registerWorkspace(label: string): { id: string; label: string; path: string };
  /** `skill-creator wiki <args>`（进程内真跑；stdin 喂 add 正文通道）。 */
  run(args: string[], stdin?: string): Promise<{ stdout: string; stderr: string; code: number }>;
}

function makeTemp(prefix: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function createSandbox(): Promise<Sandbox> {
  const home = makeTemp("sc-wiki-cli-home-");
  const stateHome = path.join(home, "state");
  const wikiHome = makeTemp("sc-wiki-cli-global-");
  const project = makeTemp("sc-wiki-cli-project-");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    SKILL_CREATOR_HOME: stateHome,
    SKILL_WIKI_HOME: wikiHome,
  };
  const workspaces: Array<{ id: string; label: string; path: string }> = [];

  const writeRegistry = (): void => {
    const file = path.join(stateHome, ".skill-creator", "workspaces.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      `${JSON.stringify({ schemaVersion: 2, activeId: "~", workspaces }, null, 2)}\n`,
    );
  };

  return {
    home,
    stateHome,
    wikiHome,
    project,
    registerWorkspace(label: string) {
      const directory = makeTemp("sc-wiki-cli-ws-");
      const entry = { id: opaquePathId("ws", directory), label, path: directory };
      workspaces.push(entry);
      writeRegistry();
      return entry;
    },
    run(args: string[], stdin = "") {
      return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [tsxCli, cliEntry, "wiki", ...args], {
          cwd: project,
          env,
          stdio: ["pipe", "pipe", "pipe"],
        });
        const out: Buffer[] = [];
        const err: Buffer[] = [];
        child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
        child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
        child.on("error", reject);
        child.on("close", (code) => {
          resolve({
            code: code ?? -1,
            stdout: Buffer.concat(out).toString("utf8"),
            stderr: Buffer.concat(err).toString("utf8"),
          });
        });
        child.stdin.end(stdin);
      });
    },
  };
}

interface ScopeJsonRow {
  id: string;
  label: string;
  workspacePath: string;
  exists: boolean;
  patternCount: number;
}

describe("CLI wiki subcommand (in-process, no daemon)", () => {
  it("round-trips add/list against --workspace ~ (SKILL_WIKI_HOME) and passes wiki exit codes through", async () => {
    const sandbox = await createSandbox();
    const added = await sandbox.run(
      ["add", "--title", "Global insight", "--workspace", "~"],
      "global body\n",
    );
    expect(added.code).toBe(0);
    expect(added.stdout).toContain('Captured "Global insight" as global-insight');
    expect(fs.existsSync(path.join(sandbox.wikiHome, "patterns", "global-insight.md"))).toBe(true);

    const listed = await sandbox.run(["list", "--workspace", "~"]);
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain("global-insight — Global insight");

    // wiki 域 typed 退出码透传：未知 pattern = WIKI_INVALID_PATTERN → 4。
    const missing = await sandbox.run(["show", "does-not-exist", "--workspace", "~"]);
    expect(missing.code).toBe(4);
  }, 30_000);

  it("resolves a registry workspace by label prefix, lowercase prefix, and ws_* id", async () => {
    const sandbox = await createSandbox();
    const workspace = sandbox.registerWorkspace("Frontend");
    const added = await sandbox.run(
      ["add", "--title", "WS pattern", "--workspace", "Frontend"],
      "workspace body\n",
    );
    expect(added.code).toBe(0);
    expect(
      fs.existsSync(
        path.join(workspace.path, ".agents", "skill-wiki", "patterns", "ws-pattern.md"),
      ),
    ).toBe(true);
    // global（SKILL_WIKI_HOME）不受 workspace 写入影响。
    expect(fs.existsSync(path.join(sandbox.wikiHome, "patterns"))).toBe(false);

    for (const reference of ["Front", "front", workspace.id]) {
      const listed = await sandbox.run(["list", "--workspace", reference, "--json"]);
      expect(listed.code, `reference ${reference}`).toBe(0);
      expect((JSON.parse(listed.stdout) as { total: number }).total).toBe(1);
    }
  }, 60_000);

  it("rejects an ambiguous label prefix as a usage error (exit 2) naming both matches", async () => {
    const sandbox = await createSandbox();
    sandbox.registerWorkspace("Frontend App");
    sandbox.registerWorkspace("Frontend Docs");
    const failed = await sandbox.run(["list", "--workspace", "Frontend"]);
    expect(failed.code).toBe(2);
    expect(failed.stderr).toContain('ambiguous workspace "Frontend"');
    expect(failed.stderr).toContain("Frontend App");
    expect(failed.stderr).toContain("Frontend Docs");
  }, 30_000);

  it("rejects an unknown label with exit 2 and passes plain paths through unchanged", async () => {
    const sandbox = await createSandbox();
    sandbox.registerWorkspace("Frontend");
    const failed = await sandbox.run(["list", "--workspace", "Nope"]);
    expect(failed.code).toBe(2);
    expect(failed.stderr).toContain('no workspace matches "Nope"');

    // 路径直传不走 registry：沙箱 project 目录显式寻址。
    const added = await sandbox.run(
      ["add", "--title", "By path", "--workspace", sandbox.project],
      "path body\n",
    );
    expect(added.code).toBe(0);
    expect(
      fs.existsSync(path.join(sandbox.project, ".agents", "skill-wiki", "patterns", "by-path.md")),
    ).toBe(true);
  }, 30_000);

  it("enumerates scopes with pattern counts (human table and --json)", async () => {
    const sandbox = await createSandbox();
    await sandbox.run(["add", "--title", "Global one", "--workspace", "~"], "g1\n");
    const frontend = sandbox.registerWorkspace("Frontend");
    await sandbox.run(["add", "--title", "F one", "--workspace", "Frontend"], "f1\n");
    await sandbox.run(["add", "--title", "F two", "--workspace", "Frontend"], "f2\n");
    const docs = sandbox.registerWorkspace("Docs"); // 注册但无 wiki 目录 → exists:false。

    const json = await sandbox.run(["scopes", "--json"]);
    expect(json.code).toBe(0);
    const payload = JSON.parse(json.stdout) as { scopes: ScopeJsonRow[] };
    expect(payload.scopes[0]).toEqual({
      id: "~",
      label: "global",
      workspacePath: "~",
      exists: true,
      patternCount: 1,
    });
    const byId = new Map(payload.scopes.map((row) => [row.id, row]));
    expect(byId.get(frontend.id)).toEqual({
      id: frontend.id,
      label: "Frontend",
      workspacePath: frontend.path,
      exists: true,
      patternCount: 2,
    });
    expect(byId.get(docs.id)).toEqual({
      id: docs.id,
      label: "Docs",
      workspacePath: docs.path,
      exists: false,
      patternCount: 0,
    });

    const human = await sandbox.run(["scopes"]);
    expect(human.code).toBe(0);
    expect(human.stdout).toContain("global");
    expect(human.stdout).toContain("Frontend");
    expect(human.stdout).toContain(docs.path);
    expect(human.stdout).toContain("(missing)");
  }, 60_000);

  it("scopes does not create patterns/ under a partially initialized wiki root (codex r1 P1)", async () => {
    const sandbox = await createSandbox();
    const partial = sandbox.registerWorkspace("Partial");
    // 只建 wiki 根目录、不建 patterns/（手工或半途状态的等价物）。
    fs.mkdirSync(path.join(partial.path, ".agents", "skill-wiki"), { recursive: true });

    const json = await sandbox.run(["scopes", "--json"]);
    expect(json.code).toBe(0);
    const payload = JSON.parse(json.stdout) as { scopes: ScopeJsonRow[] };
    const row = payload.scopes.find((entry) => entry.id === partial.id);
    expect(row).toEqual({
      id: partial.id,
      label: "Partial",
      workspacePath: partial.path,
      exists: true,
      patternCount: 0,
    });
    expect(fs.existsSync(path.join(partial.path, ".agents", "skill-wiki", "patterns"))).toBe(false);
  }, 60_000);

  it("treats a Windows-shaped relative path (backslash) as a path, not a label (codex r1 P2)", async () => {
    const sandbox = await createSandbox();
    // POSIX 上 `sub\dir` 是含反斜杠的单段文件名——路径直传语义下解析为该字面
    // 目录；绝不能落入 label 匹配（exit 2 "no workspace matches"）。
    const result = await sandbox.run(
      ["add", "--title", "Win path", "--workspace", "sub\\dir"],
      "w\n",
    );
    expect(result.code).toBe(0);
    // POSIX 字面目录；Windows 上 path.sep 会将其拆为 sub/dir——两种平台都
    // 落在 cwd 之下，断言以平台分隔符拼接的等价路径存在。
    const resolved = path.resolve(sandbox.project, "sub\\dir", ".agents", "skill-wiki");
    expect(fs.existsSync(path.join(resolved, "patterns"))).toBe(true);
  }, 60_000);

  it("surfaces registry read failures as hard errors, not empty-registry label misses (codex r1 P2)", async () => {
    if (process.platform === "win32") return; // chmod 对 Windows ACL 无效
    const sandbox = await createSandbox();
    sandbox.registerWorkspace("Frontend");
    const registry = path.join(sandbox.stateHome, ".skill-creator", "workspaces.json");
    fs.chmodSync(registry, 0o000);
    try {
      const result = await sandbox.run(["list", "--workspace", "Frontend"]);
      expect(result.code).not.toBe(2); // 用法错误（零匹配）是被禁止的投影
      expect(result.stderr).toContain("cannot read workspace registry");
      expect(result.stderr).not.toContain("no workspace matches");
    } finally {
      fs.chmodSync(registry, 0o600);
    }
  }, 60_000);

  it("defaults --workspace to ./ (the cwd's .agents/skill-wiki, no registry)", async () => {
    const sandbox = await createSandbox();
    const added = await sandbox.run(["add", "--title", "Project local"], "project body\n");
    expect(added.code).toBe(0);
    const wikiDir = path.join(sandbox.project, ".agents", "skill-wiki");
    expect(fs.existsSync(path.join(wikiDir, "patterns", "project-local.md"))).toBe(true);

    const listed = await sandbox.run(["list"]);
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain("project-local — Project local");

    // 显式 ./ 与缺省同址。
    const explicit = await sandbox.run(["list", "--workspace", "./"]);
    expect(explicit.stdout).toContain("project-local");
  }, 30_000);

  it("exposes wiki in help surfaces (command table + prefixed subcommand usage)", async () => {
    const sandbox = await createSandbox();
    const topHelp = await new Promise<{ stdout: string; code: number }>((resolve, reject) => {
      const child = spawn(process.execPath, [tsxCli, cliEntry, "help"], {
        cwd: sandbox.project,
        env: { ...process.env, HOME: sandbox.home, SKILL_CREATOR_HOME: sandbox.stateHome },
      });
      const out: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
      child.on("error", reject);
      child.on("close", (code) =>
        resolve({ stdout: Buffer.concat(out).toString("utf8"), code: code ?? -1 }),
      );
    });
    expect(topHelp.code).toBe(0);
    expect(topHelp.stdout).toContain("skill-creator wiki");
    expect(topHelp.stdout).toContain("Persistent agent-experience wiki");

    const subHelp = await sandbox.run(["--help"]);
    expect(subHelp.code).toBe(0);
    expect(subHelp.stdout).toContain("usage: skill-creator wiki <command> [options]");
    expect(subHelp.stdout).toContain("scopes");
    expect(subHelp.stdout).toContain(
      "exit codes: 0 ok (incl. deduplicated) | 2 usage | 3 WIKI_INVALID_SCOPE",
    );
  }, 30_000);
});
