/**
 * 用户原始需求 [2026-09-21]（jixoai-search-core 3.3-3.8）：「CLI 命令面随包私有…
 * add 幂等/相似警告、edit 原子失败、exit code 映射、分页元数据、派生物自愈」。
 * 正交意图：
 *   [1] runCli 纯函数面（注入内存 IO + SKILL_WIKI_HOME 隔离根）：命令语义、
 *       exit code 全映射、--json 形状。
 *   [2] 查重闭环：add 相似警告触发与 --no-similarity、find 召回、edit/remove
 *       后索引随动。
 *   [3] child_process 冒烟（tsx 直跑 bin）：进程适配层与退出码透传。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { openWikiWorkspace } from "../src/workspace.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const BIN_PATH = path.join(REPO_ROOT, "packages/skill-wiki/bin/skill-wiki.ts");
const TSX_CLI = path.join(REPO_ROOT, "node_modules/tsx/dist/cli.mjs");

const previousHome = process.env.SKILL_WIKI_HOME;
let root = "";

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-wiki-cli-"));
  process.env.SKILL_WIKI_HOME = root;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.SKILL_WIKI_HOME;
  else process.env.SKILL_WIKI_HOME = previousHome;
  fs.rmSync(root, { recursive: true, force: true });
});

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function run(args: string[], stdin = ""): Promise<RunResult> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(args, {
    readStdin: async () => stdin,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  });
  return { code, stdout: out.join(""), stderr: err.join("") };
}

function spawnCli(args: string[], stdin = ""): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [TSX_CLI, BIN_PATH, ...args], {
      env: { ...process.env, SKILL_WIKI_HOME: root },
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
}

describe("add / list / show basics", () => {
  it("captures a pattern from stdin, lists it, and shows the raw page", async () => {
    const added = await run(
      ["add", "--title", "Pin exit codes"],
      "Gate commands must branch on exit code.\n",
    );
    expect(added.code).toBe(0);
    expect(added.stdout).toContain('Captured "Pin exit codes" as pin-exit-codes');

    const listed = await run(["list"]);
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain("pin-exit-codes — Pin exit codes");

    const shown = await run(["show", "pin-exit-codes"]);
    expect(shown.code).toBe(0);
    expect(shown.stdout).toContain("---");
    expect(shown.stdout).toContain("title: Pin exit codes");
    expect(shown.stdout).toContain("Gate commands must branch on exit code.");
  });

  it("add is idempotent by contentHash: deduplicated is success exit 0", async () => {
    const body = "Shared body across two adds.\n";
    await run(["add", "--title", "First"], body);
    const again = await run(["add", "--title", "Second"], body);
    expect(again.code).toBe(0);
    expect(again.stdout).toContain('Already captured as "first"');

    const json = await run(["add", "--title", "Third", "--json"], body);
    expect(json.code).toBe(0);
    const payload = JSON.parse(json.stdout) as { deduplicated: boolean; name: string };
    expect(payload.deduplicated).toBe(true);
    expect(payload.name).toBe("first");

    const listed = await run(["list", "--json"]);
    const listPayload = JSON.parse(listed.stdout) as { total: number };
    expect(listPayload.total).toBe(1);
  });

  it("paginates list with --json metadata (total / nextOffset)", async () => {
    for (let index = 1; index <= 5; index += 1) {
      await run(["add", "--title", `Pattern ${index}`], `body number ${index}\n`);
    }
    const firstPage = await run(["list", "--limit", "2", "--offset", "0", "--json"]);
    expect(firstPage.code).toBe(0);
    const first = JSON.parse(firstPage.stdout) as {
      patterns: { name: string }[];
      total: number;
      nextOffset: number | null;
    };
    expect(first.patterns).toHaveLength(2);
    expect(first.total).toBe(5);
    expect(first.nextOffset).toBe(2);

    const lastPage = await run(["list", "--limit", "2", "--offset", "4", "--json"]);
    const last = JSON.parse(lastPage.stdout) as { patterns: unknown[]; nextOffset: number | null };
    expect(last.patterns).toHaveLength(1);
    expect(last.nextOffset).toBeNull();
  });

  it("sorts list by updated descending with --sort updated", async () => {
    await run(["add", "--title", "Alpha"], "alpha body\n");
    await run(["add", "--title", "Beta"], "beta body\n");
    const listed = await run(["list", "--sort", "updated"]);
    expect(listed.code).toBe(0);
    const names = listed.stdout
      .split("\n")
      .filter((line) => line.includes(" — "))
      .map((line) => line.split(" — ")[0]);
    expect(names[0]).toBe("beta");
  });
});

describe("similarity pipeline", () => {
  const FIRST_TITLE = "Pin exit codes in gates";
  const FIRST_BODY =
    "Gate commands must branch on the real exit code, never on piped stdout. Piping through tail swallows the failure.";
  const NEAR_TITLE = "Always branch on real exit codes";
  const NEAR_BODY =
    "Commands in gates must branch on the real exit code and never on piped stdout; piping through tail swallows failures.";

  it("warns about a semantically near-duplicate after writing (exit stays 0)", async () => {
    await run(["add", "--title", FIRST_TITLE], `${FIRST_BODY}\n`);
    const second = await run(["add", "--title", NEAR_TITLE], `${NEAR_BODY}\n`);
    expect(second.code).toBe(0);
    expect(second.stdout).toContain('Captured "');
    expect(second.stdout).toMatch(/^similar: pin-exit-codes-in-gates \(0\.\d+\)/m);
  });

  it("--no-similarity skips the warning", async () => {
    await run(["add", "--title", FIRST_TITLE], `${FIRST_BODY}\n`);
    const second = await run(["add", "--title", NEAR_TITLE, "--no-similarity"], `${NEAR_BODY}\n`);
    expect(second.code).toBe(0);
    expect(second.stdout).not.toContain("similar:");
  });

  it("--json carries similar: [{name, score}]", async () => {
    await run(["add", "--title", FIRST_TITLE], `${FIRST_BODY}\n`);
    const second = await run(["add", "--title", NEAR_TITLE, "--json"], `${NEAR_BODY}\n`);
    const payload = JSON.parse(second.stdout) as {
      deduplicated: boolean;
      similar: { name: string; score: number }[];
    };
    expect(payload.deduplicated).toBe(false);
    expect(payload.similar.length).toBeGreaterThan(0);
    expect(payload.similar[0]?.name).toBe("pin-exit-codes-in-gates");
    expect(payload.similar[0]?.score).toBeGreaterThan(0.35);
  });

  it("unrelated bodies produce no similar line", async () => {
    await run(["add", "--title", FIRST_TITLE], `${FIRST_BODY}\n`);
    const other = await run(
      ["add", "--title", "Rename variables descriptively"],
      "Prefer descriptive variable names over single letters in review feedback.\n",
    );
    expect(other.code).toBe(0);
    expect(other.stdout).not.toContain("similar:");
  });

  it("find retrieves lexically matching patterns", async () => {
    await run(["add", "--title", FIRST_TITLE], `${FIRST_BODY}\n`);
    const found = await run(["find", "branch exit code piped stdout"]);
    expect(found.code).toBe(0);
    expect(found.stdout).toContain("pin-exit-codes-in-gates");

    const json = await run(["find", "branch exit code", "--json"]);
    const payload = JSON.parse(json.stdout) as {
      results: { name: string; title: string; score: number }[];
      total: number;
    };
    expect(payload.results[0]?.name).toBe("pin-exit-codes-in-gates");
    expect(payload.results[0]?.title).toBe(FIRST_TITLE);
  });

  it("edit and remove keep the search index in step", async () => {
    await run(["add", "--title", FIRST_TITLE], `${FIRST_BODY}\n`);
    const editsFile = path.join(root, "edits.json");
    fs.writeFileSync(
      editsFile,
      JSON.stringify([{ op: "append", content: "\nAlso set pipefail everywhere." }]),
      "utf8",
    );
    const edited = await run(["edit", "pin-exit-codes-in-gates", "-f", editsFile]);
    expect(edited.code).toBe(0);
    const found = await run(["find", "pipefail everywhere"]);
    expect(found.stdout).toContain("pin-exit-codes-in-gates");

    const removed = await run(["remove", "pin-exit-codes-in-gates"]);
    expect(removed.code).toBe(0);
    const after = await run(["find", "pipefail everywhere"]);
    expect(after.stdout).not.toContain("pin-exit-codes-in-gates");
  });
});

describe("edit atomicity and remove footprint", () => {
  it("fails the whole batch with exit 5 and zero page changes when an anchor misses", async () => {
    await run(["add", "--title", "Stable page"], "keep this line\nand this one\n");
    const pageFile = path.join(root, "~", "patterns", "stable-page.md");
    const before = fs.readFileSync(pageFile, "utf8");
    const editsFile = path.join(root, "edits.json");
    fs.writeFileSync(
      editsFile,
      JSON.stringify([
        { op: "replace", target: "keep this line", content: "changed line" },
        { op: "replace", target: "NO_SUCH_ANCHOR", content: "boom" },
      ]),
      "utf8",
    );
    const failed = await run(["edit", "stable-page", "-f", editsFile]);
    expect(failed.code).toBe(5);
    expect(failed.stderr).toContain("WIKI_PATCH_FAILED");
    expect(fs.readFileSync(pageFile, "utf8")).toBe(before);
  });

  it("rejects malformed edits files as usage errors (exit 2)", async () => {
    await run(["add", "--title", "Stable page"], "body\n");
    const badFile = path.join(root, "bad-edits.json");
    fs.writeFileSync(badFile, JSON.stringify([{ op: "replace", content: "no target" }]), "utf8");
    const failed = await run(["edit", "stable-page", "-f", badFile]);
    expect(failed.code).toBe(2);

    const missing = await run(["edit", "stable-page", "-f", path.join(root, "nope.json")]);
    expect(missing.code).toBe(2);
  });

  it("remove deletes the page and appends a logs.md footprint line", async () => {
    await run(["add", "--title", "Doomed insight"], "temporary knowledge\n");
    const removed = await run(["remove", "doomed-insight"]);
    expect(removed.code).toBe(0);
    expect(removed.stdout).toContain("Removed doomed-insight");

    const logs = fs.readFileSync(path.join(root, "~", "logs.md"), "utf8");
    expect(logs).toContain("removed pattern doomed-insight");
    expect(logs).toContain("Doomed insight");

    const listed = await run(["list", "--json"]);
    expect((JSON.parse(listed.stdout) as { total: number }).total).toBe(0);
  });
});

describe("derived artifact self-healing", () => {
  it("read commands refresh index.md after external pattern edits (no reindex command)", async () => {
    await run(["add", "--title", "Healing"], "original body\n");
    const scopeDir = path.join(root, "~");
    // 外部编辑器直接改 patterns/ + 弄脏 index.md。
    fs.writeFileSync(
      path.join(scopeDir, "patterns", "hand-written.md"),
      [
        "---",
        "title: Hand Written",
        "created: 2026-09-21T00:00:00.000Z",
        "updated: 2026-09-21T00:00:00.000Z",
        "origin: ~",
        "promotedFrom:",
        "---",
        "",
        "added by hand",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(path.join(scopeDir, "index.md"), "stale index\n", "utf8");

    const listed = await run(["list"]);
    expect(listed.stdout).toContain("hand-written — Hand Written");
    const index = fs.readFileSync(path.join(scopeDir, "index.md"), "utf8");
    expect(index).toContain("hand-written — Hand Written");
    expect(index).not.toContain("stale index");
    // 命令面无 reindex：unknown command 佐证。
    const unknown = await run(["reindex"]);
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain("unknown command: reindex");
  });
});

describe("log and impact", () => {
  it("log tails the last N lines", async () => {
    const wiki = openWikiWorkspace(path.join(root, "~"));
    for (let index = 1; index <= 5; index += 1) wiki.appendLog(`event ${index}`);
    const tailed = await run(["log", "--limit", "2"]);
    expect(tailed.code).toBe(0);
    const lines = tailed.stdout.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("event 4");
    expect(lines[1]).toContain("event 5");
  });

  it("impact filters by decision and emits --json", async () => {
    const wiki = openWikiWorkspace(path.join(root, "~"));
    const entry = (decision: "accept" | "reject", skill: string) => ({
      date: `2026-09-21T00:0${skill.length}:00.000Z`,
      proposal: { action: "create", skill, summary: `summary for ${skill}` },
      decision,
      reason: `reason for ${skill}`,
    });
    wiki.appendImpact(entry("accept", "alpha"));
    wiki.appendImpact(entry("reject", "beta"));

    const rejected = await run(["impact", "--filter", "reject"]);
    expect(rejected.stdout).toContain("reject create beta");
    expect(rejected.stdout).not.toContain("alpha");

    const json = await run(["impact", "--json"]);
    const payload = JSON.parse(json.stdout) as { entries: { decision: string }[] };
    expect(payload.entries).toHaveLength(2);

    const badFilter = await run(["impact", "--filter", "maybe"]);
    expect(badFilter.code).toBe(2);
  });
});

describe("exit code mapping", () => {
  it("maps usage / scope / pattern failures to 2 / 3 / 4", async () => {
    expect((await run(["list", "--scope", "Bad_Scope"])).code).toBe(3);
    expect((await run(["list", "--scope", "ws_" + "a".repeat(24)])).code).toBe(3);
    expect((await run(["frobnicate"])).code).toBe(2);
    expect((await run(["add"])).code).toBe(2);
    expect((await run(["add", "--title"])).code).toBe(2);
    expect((await run(["show", "does-not-exist"])).code).toBe(4);
    expect((await run(["remove", "does-not-exist"])).code).toBe(4);
    expect((await run(["list", "--sort", "bogus"])).code).toBe(2);
    expect((await run([])).code).toBe(2);
    expect((await run(["--help"])).code).toBe(0);
  });

  it("stderr carries the typed code for scope failures", async () => {
    const scope = await run(["list", "--scope", "Bad_Scope"]);
    expect(scope.stderr).toContain("WIKI_INVALID_SCOPE");
  });
});

describe("child-process smoke (tsx)", () => {
  it("runs the bin via tsx: help exits 0 and an isolated root round-trips add/list", async () => {
    const help = await spawnCli(["--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("usage: skill-wiki");

    const added = await spawnCli(["add", "--title", "Smoke test"], "smoke body\n");
    expect(added.code).toBe(0);
    expect(added.stdout).toContain("Captured");

    const listed = await spawnCli(["list", "--json"]);
    expect(listed.code).toBe(0);
    const payload = JSON.parse(listed.stdout) as { total: number };
    expect(payload.total).toBe(1);
  }, 30_000);
});
