/**
 * CLI search 集成测试（无 daemon，真实进程）。
 *
 * User input [2026-09-17]: "`skill-creator search <query...>` 进程内完成；--json 时 stdout
 * 仅含合法 JSON；空 query 或 flag 解析失败 exit 1；同一索引下输出可重放。"
 *
 * Orthogonal intents:
 *   [1] 真实 CLI 进程（tsx 源码树）+ 沙箱 HOME/SKILL_CREATOR_HOME 隔离的端到端检索。
 *   [2] JSON 字段契约、可重放次序与退出码/flag 用法错误边界。
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const cliEntry = path.join(root, "src", "cli", "cli.ts");
const temporaryDirectories: string[] = [];

const PROVIDER_HOME_OVERRIDES = [
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "VIBE_HOME",
  "HERMES_HOME",
  "AUTOHAND_HOME",
  "GROK_HOME",
] as const;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.promises.rm(directory, { recursive: true, force: true })),
  );
});

async function createSandboxHome(): Promise<{ home: string; stateHome: string }> {
  const home = await fs.promises.mkdtemp("/tmp/sc-search-cli-test-");
  temporaryDirectories.push(home);
  return { home, stateHome: path.join(home, "state") };
}

function writeSkill(home: string, name: string, description: string, body: string): string {
  const directory = path.join(home, ".claude", "skills", name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n\n${body}\n`,
  );
  return directory;
}

async function runCli(
  home: string,
  stateHome: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    SKILL_CREATOR_HOME: stateHome,
    XDG_CONFIG_HOME: path.join(home, ".config"),
  };
  for (const variable of PROVIDER_HOME_OVERRIDES) delete env[variable];
  try {
    const result = await execFileAsync(process.execPath, ["--import", "tsx", cliEntry, ...args], {
      cwd: root,
      env,
      encoding: "utf8",
      timeout: 60_000,
    });
    return { ...result, code: 0 };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
      code: failure.code ?? 1,
    };
  }
}

interface CliSearchResult {
  id: string;
  name: string;
  description: string;
  canonicalPath: string;
  installations: Array<{ path: string; workspaceId: string; providerId: string }>;
  contentHash: string;
  score: number;
  disabled: boolean;
  conflict: boolean;
  duplicates: Array<{ id: string; canonicalPath: string }>;
}

const RESULT_FIELD_SET = [
  "id",
  "name",
  "description",
  "canonicalPath",
  "installations",
  "contentHash",
  "score",
  "disabled",
  "conflict",
  "duplicates",
].sort();

describe("CLI search (in-process, no daemon)", () => {
  it("returns stable JSON results for a CJK query across runs and replays identically", async () => {
    const { home, stateHome } = await createSandboxHome();
    writeSkill(
      home,
      "react-component-design",
      "Design React components with care.",
      "Composition over inheritance.",
    );
    writeSkill(
      home,
      "typescript-type-safety",
      "TypeScript 类型安全指南。",
      "unknown 收窄与 safeParse。",
    );

    const first = await runCli(home, stateHome, ["search", "React组件设计", "--json"]);
    expect(first.code).toBe(0);
    const parsed = JSON.parse(first.stdout) as { results: CliSearchResult[] };
    expect(parsed.results.length).toBeGreaterThan(0);
    expect(parsed.results[0]?.name).toBe("react-component-design");
    expect(Object.keys(parsed.results[0] ?? {}).sort()).toEqual(RESULT_FIELD_SET);
    expect(parsed.results[0]?.id).toMatch(/^sk_[a-f0-9]{24}$/);
    expect(parsed.results[0]?.canonicalPath).toBe(
      fs.realpathSync(path.join(home, ".claude", "skills", "react-component-design")),
    );
    expect(parsed.results[0]?.installations).toEqual([
      {
        path: path.join(home, ".claude", "skills", "react-component-design"),
        workspaceId: "~",
        providerId: "claude-code",
      },
    ]);

    // 可重放：同一索引（stat 未变 → fresh）下第二次运行逐字节相等。
    const second = await runCli(home, stateHome, ["search", "React组件设计", "--json"]);
    expect(second.code).toBe(0);
    expect(second.stdout).toBe(first.stdout);
    // 两层信封持久化在 appDir/search/ 下（登记表 + 包索引目录）。
    expect(fs.existsSync(path.join(stateHome, ".skill-creator", "search", "meta.json"))).toBe(true);
  });

  it("merges symlink installations from multiple provider roots and exits 0 with zero results", async () => {
    const { home, stateHome } = await createSandboxHome();
    const target = writeSkill(
      home,
      "shared-skill",
      "A skill installed in many roots.",
      "shared body",
    );
    for (const providerDir of [".codex/skills", ".agents/skills"]) {
      const providerRoot = path.join(home, providerDir);
      fs.mkdirSync(providerRoot, { recursive: true });
      fs.symlinkSync(target, path.join(providerRoot, "shared-skill"));
    }

    const found = await runCli(home, stateHome, ["search", "shared-skill", "--json"]);
    expect(found.code).toBe(0);
    const parsed = JSON.parse(found.stdout) as { results: CliSearchResult[] };
    expect(parsed.results).toHaveLength(1);
    const providers = parsed.results[0]?.installations.map((i) => i.providerId).sort();
    // .agents/skills 是 cline/dexto/kimi-code-cli/loaf/warp/zed 等多个 provider 的
    // 共享 global root；.codex/skills 是 codex 专属 root——全部按 provider 分列进 installations。
    expect(providers).toContain("claude-code");
    expect(providers).toContain("codex");
    expect(providers).toContain("zed");
    expect(providers?.length).toBeGreaterThanOrEqual(8);
    for (const installation of parsed.results[0]?.installations ?? []) {
      expect(fs.realpathSync(installation.path)).toBe(parsed.results[0]?.canonicalPath);
    }

    // 查询词不与任何 token 重叠（含 fuzzy 距离）时返回 0 结果、exit 0。
    const none = await runCli(home, stateHome, ["search", "qqqqwwwwzzzz", "--json"]);
    expect(none.code).toBe(0);
    expect(JSON.parse(none.stdout)).toEqual({ results: [] });
  });

  it("supports --limit and --limit=N forms with the 1..50 bound", async () => {
    const { home, stateHome } = await createSandboxHome();
    for (let index = 0; index < 3; index += 1) {
      writeSkill(home, `react-skill-${index}`, `React skill ${index}`, "react body");
    }
    const limited = await runCli(home, stateHome, ["search", "react", "--json", "--limit", "2"]);
    expect(limited.code).toBe(0);
    expect((JSON.parse(limited.stdout) as { results: CliSearchResult[] }).results).toHaveLength(2);

    const limitedForm = await runCli(home, stateHome, ["search", "react", "--limit=1", "--json"]);
    expect(limitedForm.code).toBe(0);
    expect((JSON.parse(limitedForm.stdout) as { results: CliSearchResult[] }).results).toHaveLength(
      1,
    );

    for (const bad of [
      "--limit",
      "--limit=0",
      "--limit=51",
      "--limit=abc",
      "--limit=1.5",
      "--bogus",
    ]) {
      const failed = await runCli(home, stateHome, ["search", "react", bad]);
      expect(failed.code, `expected exit 1 for ${bad}`).toBe(1);
      expect(failed.stderr).toContain("Usage: skill-creator search");
    }
  });

  it("exits 1 for an empty query and prints usage on stderr", async () => {
    const { home, stateHome } = await createSandboxHome();
    writeSkill(home, "any-skill", "any", "body");
    const empty = await runCli(home, stateHome, ["search", "--json"]);
    expect(empty.code).toBe(1);
    expect(empty.stderr).toContain("Usage: skill-creator search");
    expect(empty.stdout).toBe("");
  });

  it("prints human-readable output on stdout with diagnostics on stderr", async () => {
    const { home, stateHome } = await createSandboxHome();
    const skillDir = writeSkill(home, "react-component-design", "Design React components.", "body");
    const human = await runCli(home, stateHome, ["search", "react component"]);
    expect(human.code).toBe(0);
    expect(human.stdout).toContain("react-component-design");
    expect(human.stdout).toContain(fs.realpathSync(skillDir));
    expect(human.stdout).toContain("installations: 1");
    expect(human.stderr).toContain("1 result(s)");
  });

  it("exposes search in help output", async () => {
    const { home, stateHome } = await createSandboxHome();
    const help = await runCli(home, stateHome, ["help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("skill-creator search");
    expect(help.stdout).toContain("Search local skills (BM25 + skill tokenizer)");
  });
});
