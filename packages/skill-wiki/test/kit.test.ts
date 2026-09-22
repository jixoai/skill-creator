/**
 * 用户原始需求 [2026-09-22]（wiki-directory-standard 2.1/2.4）：「cli-kit 原子
 * 命令单元与宿主组装器：host 插槽限于 resolveScope / commandPrefix /
 * extraCommands；默认实例 MUST 与既有 bin 行为逐位一致（现有测试守护）」。
 * 正交意图：
 *   [1] 默认实例逐位一致性：--help 输出与重构前 USAGE 字面量逐字节相等；
 *       代表 argv 的 stdout/stderr/exit code 与 runCli 默认面完全一致。
 *   [2] 宿主插槽行为：commandPrefix 改写 usage 与错误前缀；extraCommands
 *       注册后可执行且出现在 usage；resolveScope 注入替换默认解析（含
 *       异步实现与 WikiUsageError → exit 2 接管）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWikiCli, runCli, WikiUsageError, type CliIo } from "../src/cli.js";
import { resolveWikiDirectory } from "../src/workspace.js";

/** 重构前的 USAGE 字面量（逐字节守门：默认实例 help 不得漂移）。 */
const LEGACY_USAGE = [
  "usage: skill-wiki <command> [options]",
  "",
  "commands:",
  "  list    [--workspace <path|~|./>] [--sort name|updated] [--offset 0] [--limit 100] [--json]",
  "  show    <name> [--workspace] [--json]",
  "  add     --title <t> [--workspace] [--no-similarity] [--json]   (body from stdin)",
  "  find    <query> [--workspace] [--json]",
  "  edit    <name> -f <edits.json> [--workspace] [--json]",
  "  remove  <name> [--workspace] [--json]",
  "  log     [--workspace] [--limit 20] [--json]",
  "  impact  [--workspace] [--filter accept|reject] [--json]",
  "",
  "options:",
  '  --workspace <w>   wiki workspace: "~" (global), "./" (default; the current',
  "                    directory's .agents/skill-wiki/), or any relative/absolute",
  "                    directory path (its .agents/skill-wiki/ — no registry needed)",
  "  --json            machine-readable output",
  "",
  "exit codes: 0 ok (incl. deduplicated) | 2 usage | 3 WIKI_INVALID_SCOPE",
  "            4 WIKI_INVALID_PATTERN | 5 WIKI_PATCH_FAILED",
].join("\n");

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

const previousHome = process.env.SKILL_WIKI_HOME;
let root = "";

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-wiki-kit-"));
  process.env.SKILL_WIKI_HOME = root;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.SKILL_WIKI_HOME;
  else process.env.SKILL_WIKI_HOME = previousHome;
  fs.rmSync(root, { recursive: true, force: true });
});

/** 跑一个 kit 实例并收集输出（内存 IO；stdin 喂 add 正文通道）。 */
async function runKit(
  cli: { run(argv: readonly string[], io: CliIo): Promise<number> },
  args: string[],
  stdin = "",
): Promise<RunResult> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await cli.run(args, {
    readStdin: async () => stdin,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  });
  return { code, stdout: out.join(""), stderr: err.join("") };
}

describe("default instance (bitwise parity with the pre-kit bin)", () => {
  it("prints the legacy usage byte for byte on --help", async () => {
    const result = await runKit(createWikiCli(), ["--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(`${LEGACY_USAGE}\n`);
  });

  it("matches runCli exactly on representative argv (stdout/stderr/exit code)", async () => {
    // 输出不含时间戳的代表序列：add（stdout 稳定）、list（人读行）、typed
    // exit 3/4、usage 2。统一 --workspace ~ 走两侧各自的隔离根，序列相同 →
    // 输出必须完全一致（缺省 ./ 会误写进程 cwd——repo 根，禁止）。
    const sequence: Array<{ args: string[]; stdin?: string }> = [
      { args: ["add", "--title", "Kit check", "--workspace", "~"], stdin: "kit body\n" },
      { args: ["list", "--workspace", "~"] },
      { args: ["list", "--workspace", ""] },
      { args: ["frobnicate"] },
      { args: ["show", "does-not-exist", "--workspace", "~"] },
    ];
    for (const { args, stdin } of sequence) {
      const rootA = fs.mkdtempSync(path.join(os.tmpdir(), "skill-wiki-kit-a-"));
      const rootB = fs.mkdtempSync(path.join(os.tmpdir(), "skill-wiki-kit-b-"));
      try {
        process.env.SKILL_WIKI_HOME = rootA;
        const viaLegacy = await runKit({ run: (argv, io) => runCli(argv, io) }, args, stdin);
        process.env.SKILL_WIKI_HOME = rootB;
        const viaKit = await runKit(createWikiCli(), args, stdin);
        expect(viaKit).toEqual(viaLegacy);
      } finally {
        process.env.SKILL_WIKI_HOME = root;
        fs.rmSync(rootA, { recursive: true, force: true });
        fs.rmSync(rootB, { recursive: true, force: true });
      }
    }
  });

  it("resolves '~' through the default resolveScope (SKILL_WIKI_HOME override)", async () => {
    const added = await runKit(
      createWikiCli(),
      ["add", "--title", "Default scope", "--workspace", "~"],
      "body\n",
    );
    expect(added.code).toBe(0);
    expect(fs.existsSync(path.join(root, "patterns", "default-scope.md"))).toBe(true);
  });
});

describe("host slot: commandPrefix", () => {
  it("rewrites the usage header and the error message prefix", async () => {
    const cli = createWikiCli({ commandPrefix: "myapp wiki" });
    const help = await runKit(cli, ["--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("usage: myapp wiki <command> [options]");
    expect(help.stdout).not.toContain("usage: skill-wiki");

    const bad = await runKit(cli, ["frobnicate"]);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain("myapp wiki: unknown command: frobnicate");
    expect(bad.stderr).toContain("usage: myapp wiki <command> [options]");
  });
});

describe("host slot: extraCommands", () => {
  it("registers an executable command that also appears in usage", async () => {
    const cli = createWikiCli({
      extraCommands: {
        hello: {
          usage: "[--json]",
          minPositionals: 0,
          maxPositionals: 0,
          run: (ctx) => {
            ctx.io.stdout(`hello${ctx.options.has("json") ? " json" : ""}\n`);
            return 0;
          },
        },
      },
    });
    const plain = await runKit(cli, ["hello"]);
    expect(plain.code).toBe(0);
    expect(plain.stdout).toBe("hello\n");

    const json = await runKit(cli, ["hello", "--json"]);
    expect(json.stdout).toBe("hello json\n");

    const help = await runKit(cli, ["--help"]);
    expect(help.stdout).toContain("hello   [--json]");

    // 内部命令面零新增：与扩展命令并存且互不干扰（隔离根为空）。
    const listed = await runKit(cli, ["list", "--json", "--workspace", "~"]);
    expect(listed.code).toBe(0);
    expect((JSON.parse(listed.stdout) as { total: number }).total).toBe(0);
  });
});

describe("host slot: resolveScope", () => {
  it("replaces the default resolution (host maps a bare name to its own directory)", async () => {
    const custom = path.join(root, "custom-wiki");
    const cli = createWikiCli({
      resolveScope: ({ requested }) =>
        requested === "myapp" ? custom : resolveWikiDirectory(requested ?? "./"),
    });
    const added = await runKit(
      cli,
      ["add", "--title", "Host scoped", "--workspace", "myapp"],
      "host body\n",
    );
    expect(added.code).toBe(0);
    expect(fs.existsSync(path.join(custom, "patterns", "host-scoped.md"))).toBe(true);

    const listed = await runKit(cli, ["list", "--workspace", "myapp"]);
    expect(listed.stdout).toContain("host-scoped — Host scoped");
    // 未注入语义的值仍走默认解析（global 隔离根为空）。
    expect(fs.existsSync(path.join(root, "patterns"))).toBe(false);
  });

  it("accepts an async host implementation and WikiUsageError → exit 2", async () => {
    const cli = createWikiCli({
      commandPrefix: "host app",
      resolveScope: async ({ requested }) => {
        if (requested === undefined) return resolveWikiDirectory("./");
        throw new WikiUsageError(`unsupported workspace reference: ${requested}`);
      },
    });
    const failed = await runKit(cli, ["list", "--workspace", "anything"]);
    expect(failed.code).toBe(2);
    expect(failed.stderr).toContain("host app: unsupported workspace reference: anything");
  });
});
