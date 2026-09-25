/**
 * CLI `wiki distill` 端到端测试（skill-wiki-maintainer task 1.5 门禁）。
 *
 * 用户原始需求 [2026-09-25]（design §4 / tasks 1.5）：「CLI `wiki distill
 * --workspace <ref> [--limit N(默认20,≤100)] [--json]`：--json 输出 = start +
 * status 轮询至终态 + ItemResult 全表（同一 schema，E 冻结）；三剧本 = 全部
 * 合法提案 / 混合非法（model-invalid 计数 + 合法继续）/ 全非法（run
 * failed(no-valid-proposals)）」。
 *
 * 正交意图：
 *   [1] 真实 daemon（bootDaemon in-process，withTray/withDshHost 关闭）+ 真实
 *       CLI 子进程（tsx 源码树）经 IPC status → /ws/rpc 的 oRPC 通路闭环；
 *       kernel stub 经 1.3 已有的 createSession seam 注入（fake ephemeral 工厂）。
 *   [2] 三剧本 --json 同源断言：stdout 以 wiki-distill 契约 schema
 *       （DistillStatusOutputSchema）逐字段 safeParse（非字符串包含）；
 *       审批经 daemon 进程内 mcpProposals（human-ui 决定面）驱动收敛。
 *   [3] 错误面与用法面：DISTILL_ACTIVE_RUN typed 拒绝（exit 非零 + 闭集 code）；
 *       --limit 越界 / `~` / 未注册 ref → 用法错误 exit 2；daemon 缺席 → exit 1；
 *       契约 limit 上限与 DISTILL_BUDGETS.patternsPerRun 的同源钉死。
 * 妥协声明：approval 由测试进程直接调用 daemon.domain.mcpProposals.approve
 *   （等价 GUI 决定面的人类动作——CLI 自身无决定面，审批红线在 human-ui）。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootDaemon, type DaemonHandles } from "../src/daemon/index.js";
import { appDir, setHomeOverride } from "../src/shared/paths.js";
import { readCliVersion } from "../src/cli/package-version.js";
import { opaquePathId } from "../src/daemon/path-safety.js";
import type { DistillJobDeps } from "../src/daemon/wiki-distill-service.js";
import type { EphemeralSession } from "../src/daemon/kernel/ephemeral-session.js";
import {
  DistillStartInputSchema,
  DistillStatusOutputSchema,
  type DistillStatusOutput,
} from "../src/shared/contracts/wiki-distill.js";
import { openWikiWorkspace, workspaceWikiDirectory, DISTILL_BUDGETS } from "skill-wiki";

const root = path.resolve(import.meta.dirname, "..");
const cliEntry = path.join(root, "src", "cli", "cli.ts");
// tsx 以绝对路径作为主模块传入：沙箱 cwd 下裸 "tsx" 无法解析。
const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");

const WORKSPACE_LABEL = "Frontend";

interface Sandbox {
  home: string;
  stateHome: string;
  wikiHome: string;
  opentrayHome: string;
  project: string;
  workspace: { id: string; label: string; path: string };
  workspacePatternHashes: Map<string, string>;
  /** 模型输出（fake session prompt 返回文本；测试逐剧本覆写）。 */
  modelOutput: { text: string };
  /** 真实 daemon（in-process；withTray/withDshHost 关闭，distill 走 fake session）。 */
  bootDaemon(): Promise<DaemonHandles>;
  /** `skill-creator wiki <args>` 子进程（真实 CLI 源码树）。 */
  run(args: string[]): Promise<{ stdout: string; stderr: string; code: number }>;
  /** run registry 的 corpus.json（--limit 端到端断言）。 */
  corpusOf(runId: string): { budgets: { patternsIncluded: number } };
  /** 等待 proposal store 出现 expected 个 pending（admission 完成的观察哨）。 */
  waitForPending(expected: number): Promise<void>;
  /** 审批本 daemon proposal store 的全部 pending（human-ui 决定面等价动作）。 */
  approveAllPending(expected: number): Promise<void>;
}

const temporaryDirectories: string[] = [];

function makeTemp(prefix: string): string {
  // POSIX 上用 /tmp 前缀：os.tmpdir()（macOS /var/folders/...）会让 IPC Unix
  // socket 路径超过 104 字符上限（daemon-domain.test.ts 同款约束）。
  const base = process.platform === "win32" ? os.tmpdir() : "/tmp";
  const directory = fs.mkdtempSync(path.join(base, prefix));
  temporaryDirectories.push(directory);
  return directory;
}

const PREVIOUS_ENV: Record<string, string | undefined> = {};
for (const key of [
  "HOME",
  "USERPROFILE",
  "SKILL_CREATOR_HOME",
  "SKILL_WIKI_HOME",
  "SKILL_CREATOR_DISABLE_TRAY",
  "OPENTRAY_HOME",
]) {
  PREVIOUS_ENV[key] = process.env[key];
}

async function createSandbox(patternTitles: string[]): Promise<Sandbox> {
  const home = makeTemp("sc-distill-cli-home-");
  const stateHome = path.join(home, "state");
  const wikiHome = makeTemp("sc-distill-cli-global-");
  const opentrayHome = path.join(home, "opentray");
  const project = makeTemp("sc-distill-cli-project-");
  const wsPath = path.join(home, "ws-frontend");
  fs.mkdirSync(wsPath, { recursive: true });

  const wsWikiDirectory = workspaceWikiDirectory(wsPath);
  const wsWiki = openWikiWorkspace(wsWikiDirectory);
  for (const title of patternTitles) {
    wsWiki.appendPattern({ title, body: `workspace fragment for ${title}\n` });
  }
  const patternsDir = path.join(wsWikiDirectory, "patterns");
  const workspacePatternHashes = new Map<string, string>();
  for (const file of fs.readdirSync(patternsDir)) {
    workspacePatternHashes.set(file, hashOfFile(path.join(patternsDir, file)));
  }

  const workspace = { id: opaquePathId("ws", wsPath), label: WORKSPACE_LABEL, path: wsPath };
  const registryFile = path.join(stateHome, ".skill-creator", "workspaces.json");
  fs.mkdirSync(path.dirname(registryFile), { recursive: true });
  fs.writeFileSync(
    registryFile,
    `${JSON.stringify({ schemaVersion: 2, activeId: "~", workspaces: [workspace] }, null, 2)}\n`,
  );

  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.SKILL_CREATOR_HOME = stateHome;
  process.env.SKILL_WIKI_HOME = wikiHome;
  process.env.SKILL_CREATOR_DISABLE_TRAY = "1";
  process.env.OPENTRAY_HOME = opentrayHome;
  setHomeOverride(stateHome);

  const modelOutput = { text: "[]" };
  const cliVersion = readCliVersion();
  const createSession: DistillJobDeps["createSession"] = async () =>
    fakeSession(() => modelOutput.text);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    SKILL_CREATOR_HOME: stateHome,
    SKILL_WIKI_HOME: wikiHome,
    SKILL_CREATOR_DISABLE_TRAY: "1",
    OPENTRAY_HOME: opentrayHome,
  };

  return {
    home,
    stateHome,
    wikiHome,
    opentrayHome,
    project,
    workspace,
    workspacePatternHashes,
    modelOutput,
    async bootDaemon() {
      const webuiDir = path.join(home, "webui");
      fs.mkdirSync(webuiDir, { recursive: true });
      fs.writeFileSync(path.join(webuiDir, "index.html"), "<!doctype html><title>t</title>");
      const daemon = await bootDaemon({
        cliVersion,
        webuiDir,
        withTray: false,
        withDshHost: false,
        distillSession: createSession,
        exitProcess: () => {},
      });
      if (!daemon) throw new Error("Expected the test daemon to own its isolated IPC endpoint.");
      return daemon;
    },
    run(args) {
      return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [tsxCli, cliEntry, "wiki", ...args], {
          cwd: project,
          env,
          stdio: ["ignore", "pipe", "pipe"],
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
      });
    },
    corpusOf(runId) {
      const file = path.join(appDir(), "wiki-distill", runId, "corpus.json");
      const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
      const corpus = parsed as { budgets: { patternsIncluded: number } };
      return { budgets: corpus.budgets };
    },
    async waitForPending(expected) {
      await vi.waitFor(
        () => {
          const pending =
            daemonStore()
              ?.list()
              .filter((view) => view.status === "pending") ?? [];
          expect(pending.length).toBe(expected);
        },
        { timeout: 15_000 },
      );
    },
    async approveAllPending(expected) {
      await this.waitForPending(expected);
      for (const view of daemonStore()?.list() ?? []) {
        if (view.status === "pending") await daemonStore()?.approve(view.proposalId);
      }
    },
  };
}

let activeDaemon: DaemonHandles | null = null;

function daemonStore() {
  return activeDaemon?.domain.mcpProposals ?? null;
}

function fakeSession(readText: () => string): EphemeralSession {
  return {
    prompt: async () => ({ text: readText() }),
    listTools: () => [],
    dispose: async () => {},
  };
}

function hashOfFile(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

beforeEach(() => {
  activeDaemon = null;
});

afterEach(async () => {
  if (activeDaemon) await activeDaemon.stop();
  activeDaemon = null;
  setHomeOverride(null);
  for (const [key, value] of Object.entries(PREVIOUS_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.promises.rm(directory, { recursive: true, force: true })),
  );
});

/** 同源断言：CLI --json stdout 必须被 E 冻结 schema 逐字段收窄（非字符串包含）。 */
function parseStatusJson(stdout: string): DistillStatusOutput {
  const parsed = DistillStatusOutputSchema.safeParse(JSON.parse(stdout));
  if (!parsed.success) {
    throw new Error(
      `CLI --json output rejected by DistillStatusOutputSchema: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

const VALID_CREATE = (title: string, suffix: string) => ({
  action: "create",
  title,
  body: `generalized guidance ${suffix}\n`,
  sourcePatternIds: ["retry-on-conflict"],
});
/** 纯汉字标题：slugify v1 折叠为空 → model-invalid(empty-slug)。 */
const EMPTY_SLUG_CREATE = {
  action: "create",
  title: "纯汉字标题",
  body: "no ascii slug\n",
  sourcePatternIds: ["retry-on-conflict"],
};

describe("CLI wiki distill (daemon RPC, kernel stub via 1.3 seam)", () => {
  it("runs a fully valid proposal set to completed (--json parses with the frozen schema)", async () => {
    const sandbox = await createSandbox([
      "Retry on conflict",
      "Log rotation",
      "Cache invalidation",
    ]);
    sandbox.modelOutput.text = JSON.stringify([
      VALID_CREATE("Global insight", "one"),
      VALID_CREATE("Global guardrail", "two"),
    ]);
    activeDaemon = await sandbox.bootDaemon();

    const child = sandbox.run(["distill", "--workspace", WORKSPACE_LABEL, "--json"]);
    await sandbox.approveAllPending(2);
    const result = await child;

    expect(result.code).toBe(0);
    const status = parseStatusJson(result.stdout);
    expect(status.state).toBe("completed");
    expect(status.reason).toBeNull();
    expect(status.counters.applied).toBe(2);
    expect(status.proposalRefs).toHaveLength(2);
    for (const ref of status.proposalRefs) {
      expect(ref.status).toBe("applied");
      expect(ref.proposalId).toMatch(/^mcp_[0-9a-f]{16}$/);
    }
    // 泛化页落 global wiki（足迹 round-trip 在 1.1 门禁；此处钉端到端落盘）。
    expect(fs.existsSync(path.join(sandbox.wikiHome, "patterns", "global-insight.md"))).toBe(true);
    expect(fs.existsSync(path.join(sandbox.wikiHome, "patterns", "global-guardrail.md"))).toBe(
      true,
    );
    // workspace 原文零改动（spec：蒸馏只写 global）。
    const patternsDir = path.join(workspaceWikiDirectory(sandbox.workspace.path), "patterns");
    for (const [file, before] of sandbox.workspacePatternHashes) {
      expect(hashOfFile(path.join(patternsDir, file))).toBe(before);
    }
    // --limit 缺省 = corpusPatternDefault：corpus 覆盖全部 3 个 source patterns。
    expect(sandbox.corpusOf(status.runId).budgets.patternsIncluded).toBe(3);
  }, 90_000);

  it("counts model-invalid items and continues the valid ones (mixed scenario, --limit end-to-end)", async () => {
    const sandbox = await createSandbox([
      "Retry on conflict",
      "Log rotation",
      "Cache invalidation",
    ]);
    sandbox.modelOutput.text = JSON.stringify([
      VALID_CREATE("Global insight", "mixed"),
      EMPTY_SLUG_CREATE,
    ]);
    activeDaemon = await sandbox.bootDaemon();

    const child = sandbox.run([
      "distill",
      "--workspace",
      sandbox.workspace.id,
      "--limit",
      "1",
      "--json",
    ]);
    // 混合剧本：合法项照常产 proposal → 并发审批驱动收敛；model-invalid 项只计数。
    await sandbox.approveAllPending(1);
    const result = await child;

    expect(result.code).toBe(0);
    const status = parseStatusJson(result.stdout);
    expect(status.state).toBe("completed");
    expect(status.counters["model-invalid"]).toBe(1);
    expect(status.counters.applied).toBe(1);
    expect(status.proposalRefs).toHaveLength(1);
    // --limit 1 端到端：corpus 只纳入 1 个 source pattern（契约 → router →
    // service → buildCorpus 的全链路）。
    expect(sandbox.corpusOf(status.runId).budgets.patternsIncluded).toBe(1);
  }, 90_000);

  it("fails with no-valid-proposals when every model item is invalid (non-zero exit)", async () => {
    const sandbox = await createSandbox(["Retry on conflict"]);
    sandbox.modelOutput.text = JSON.stringify([EMPTY_SLUG_CREATE, { action: "bogus", nope: true }]);
    activeDaemon = await sandbox.bootDaemon();

    const result = await sandbox.run(["distill", "--workspace", WORKSPACE_LABEL, "--json"]);

    expect(result.code).toBe(1);
    const status = parseStatusJson(result.stdout);
    expect(status.state).toBe("failed");
    expect(status.reason).toBe("no-valid-proposals");
    expect(status.counters["model-invalid"]).toBe(2);
    expect(status.proposalRefs).toHaveLength(0);
    expect(fs.existsSync(path.join(sandbox.wikiHome, "patterns"))).toBe(false);
  }, 90_000);

  it("surfaces DISTILL_ACTIVE_RUN as a typed non-zero error while a run is active", async () => {
    const sandbox = await createSandbox(["Retry on conflict", "Log rotation"]);
    sandbox.modelOutput.text = JSON.stringify([VALID_CREATE("Global insight", "active")]);
    activeDaemon = await sandbox.bootDaemon();

    const first = sandbox.run(["distill", "--workspace", WORKSPACE_LABEL, "--json"]);
    // 首个 run 进入 awaiting-approval（活跃）后，同 source 二次 start 必须被拒。
    await vi.waitFor(
      () => {
        const pending =
          daemonStore()
            ?.list()
            .filter((view) => view.status === "pending") ?? [];
        expect(pending.length).toBe(1);
      },
      { timeout: 15_000 },
    );
    const second = await sandbox.run(["distill", "--workspace", WORKSPACE_LABEL, "--json"]);
    expect(second.code).toBe(1);
    expect(second.stderr).toContain("DISTILL_ACTIVE_RUN");
    expect(second.stdout).toBe("");

    await sandbox.approveAllPending(1);
    const firstResult = await first;
    expect(firstResult.code).toBe(0);
    expect(parseStatusJson(firstResult.stdout).state).toBe("completed");
  }, 120_000);

  it("prints human progress on stderr and a summary table on stdout without --json", async () => {
    const sandbox = await createSandbox(["Retry on conflict"]);
    sandbox.modelOutput.text = JSON.stringify([VALID_CREATE("Global insight", "human")]);
    activeDaemon = await sandbox.bootDaemon();

    const child = sandbox.run(["distill", "--workspace", WORKSPACE_LABEL]);
    // 审批前留出一个轮询窗口：CLI 的首个 status 必然落在 awaiting-approval
    // （start 阻塞到 admission 后立即拉一次）——1.2s 后再审批，进度行可稳定观察。
    await sandbox.waitForPending(1);
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    await sandbox.approveAllPending(1);
    const result = await child;

    expect(result.code).toBe(0);
    expect(result.stderr).toContain("awaiting approval");
    expect(result.stdout).toContain("distill run wd_");
    expect(result.stdout).toContain("completed");
    expect(result.stdout).toContain("items:");
    expect(result.stdout).toContain("#0");
    expect(result.stdout).toContain("applied");
  }, 90_000);

  it("rejects over-range and non-integer --limit, global scope, and unregistered refs as usage errors (exit 2)", async () => {
    const sandbox = await createSandbox(["Retry on conflict"]);
    // 用法错误在连接 daemon 前拒绝：无需 boot（沙箱内也无 daemon）。
    for (const args of [
      [
        "distill",
        "--workspace",
        WORKSPACE_LABEL,
        "--limit",
        String(DISTILL_BUDGETS.patternsPerRun + 1),
      ],
      ["distill", "--workspace", WORKSPACE_LABEL, "--limit", "0"],
      ["distill", "--workspace", WORKSPACE_LABEL, "--limit", "abc"],
      ["distill", "--workspace", "~"],
      ["distill", "--workspace", "NoSuchWorkspace"],
    ]) {
      const failed = await sandbox.run(args);
      expect(failed.code, `args: ${args.join(" ")}`).toBe(2);
      expect(failed.stdout, `args: ${args.join(" ")}`).toBe("");
      expect(failed.stderr, `args: ${args.join(" ")}`).toContain("usage:");
    }
  }, 120_000);

  it("exits non-zero with a recovery hint when no daemon is reachable", async () => {
    const sandbox = await createSandbox(["Retry on conflict"]);
    const result = await sandbox.run(["distill", "--workspace", WORKSPACE_LABEL]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("skill-creator start");
  }, 60_000);

  it("pins the start-input limit bounds to DISTILL_BUDGETS (contract stays in sync)", () => {
    const source = { source: "ws_a1b2c3d4e5f6a7b8c9d0e1f2" } as const;
    expect(
      DistillStartInputSchema.safeParse({ ...source, limit: DISTILL_BUDGETS.patternsPerRun })
        .success,
    ).toBe(true);
    expect(
      DistillStartInputSchema.safeParse({
        ...source,
        limit: DISTILL_BUDGETS.patternsPerRun + 1,
      }).success,
    ).toBe(false);
    expect(DistillStartInputSchema.safeParse({ ...source, limit: 0 }).success).toBe(false);
    // strictObject：CLI --limit 之外的未知键仍被拒绝（E 冻结纪律）。
    expect(DistillStartInputSchema.safeParse({ ...source, extra: 1 }).success).toBe(false);
    // 缺省路径：GUI 1.6 只传 source（limit 可选，不破坏既有消费者）。
    expect(DistillStartInputSchema.safeParse(source).success).toBe(true);
  });
});
