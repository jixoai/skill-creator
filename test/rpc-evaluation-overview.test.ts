/**
 * evaluation.overview + run.start Global 前置闸 RPC 集成测试
 * （evaluating-dashboard task 1.1；design §1/§2）。
 *
 * 用户原始需求 [2026-10-03]（spec evaluation-corpus Scenario 集）：
 * 「cursor 分页稳定 / 单 target IO 失败降级 error 行 / overview 页大小判别 /
 * Global run 永不触达 adapter / recentRuns 限当前 workspace 且有界」。
 *
 * 正交意图：
 *   [1] 契约接线：真实 domain + oRPC client 的 overview 投影（沙箱语料）。
 *   [2] typed 拒绝面：limit 越界 / 非法 cursor = BAD_REQUEST；Global run.start =
 *       INVALID_OPERATION 且零落盘。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDaemonDomain, type DaemonDomain } from "../src/daemon/domain.js";
import { deterministicSkillsCliProbe } from "./helpers/deterministic-probe.js";
import { createRpcRouter } from "../src/daemon/rpc-router.js";
import { setHomeOverride } from "../src/shared/paths.js";
import { WorkspaceIdSchema, type WorkspaceId } from "../src/shared/contracts/workspaces.js";

const WS: WorkspaceId = WorkspaceIdSchema.parse("ws_0123456789abcdef01234567");
const revision = `sha256:${"a".repeat(64)}`;

let sandbox = "";
let stateRoot = "";
const previousEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "sc-rpc-evaluation-overview-"));
  const home = path.join(sandbox, "home");
  stateRoot = path.join(sandbox, "state");
  for (const name of ["HOME", "USERPROFILE", "SKILL_CREATOR_HOME", "XDG_CONFIG_HOME"]) {
    previousEnv[name] = process.env[name];
  }
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.SKILL_CREATOR_HOME = stateRoot;
  process.env.XDG_CONFIG_HOME = path.join(home, ".config");
  setHomeOverride(stateRoot);
});

afterEach(async () => {
  setHomeOverride(null);
  for (const name of ["HOME", "USERPROFILE", "SKILL_CREATOR_HOME", "XDG_CONFIG_HOME"]) {
    const previous = previousEnv[name];
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
    delete previousEnv[name];
  }
  for (const domain of createdDomains) await domain.skillSearch.dispose();
  createdDomains.length = 0;
  fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 10 });
});

const createdDomains: DaemonDomain[] = [];

function createClient() {
  const domain = createDaemonDomain(undefined, {
    skillsCliProbe: deterministicSkillsCliProbe(),
  });
  createdDomains.push(domain);
  return createRouterClient(
    createRpcRouter({
      status: () => ({
        active: true,
        pid: process.pid,
        version: "test",
        port: 0,
        startedAt: 0,
        tray: "headless",
      }),
      domain,
    }),
  );
}

/** 直接落盘一个 target 语料目录（cases/results 信封走磁盘真相）。 */
function seedTargetDir(
  skillHex: string,
  options: { cases?: number; runs?: Array<{ runId: string; endedAt: string }> } = {},
): { skillId: string; dir: string } {
  const skillId = `sk_${skillHex.padStart(24, "0")}`;
  const dir = path.join(stateRoot, ".skill-creator", "evaluation", WS, "claude-code", skillId);
  fs.mkdirSync(dir, { recursive: true });
  const cases = Array.from({ length: options.cases ?? 0 }, (_, index) => ({
    schemaVersion: 1 as const,
    caseId: `ev_${String(index).padStart(24, "0")}`,
    enabled: true,
    createdAt: "2026-10-03T00:00:00.000Z",
    updatedAt: "2026-10-03T00:00:00.000Z",
    source: "user" as const,
    boundRevision: revision,
    input: { prompt: `probe ${index}`, assertions: [{ kind: "contains" as const, value: "ok" }] },
  }));
  if (options.cases !== undefined || options.runs !== undefined) {
    fs.writeFileSync(
      path.join(dir, "cases.json"),
      `${JSON.stringify({ schemaVersion: 1, cases })}\n`,
    );
  }
  if (options.runs !== undefined && options.runs.length > 0) {
    const results = options.runs.flatMap((run, runIndex) =>
      cases.map((entry, caseIndex) => ({
        schemaVersion: 1 as const,
        resultId: `evr_${String(runIndex).padStart(23, "0")}${caseIndex}`,
        runId: run.runId,
        caseId: entry.caseId,
        target: { workspaceId: WS, providerId: "claude-code", skillId },
        expectedRevision: revision,
        observedStartRevision: revision,
        observedEndRevision: revision,
        runner: {
          kind: "analyzer" as const,
          version: { promptVersion: "1", toolVersion: "1", dshVersion: "n/a" },
        },
        startedAt: "2026-10-03T00:00:00.000Z",
        endedAt: run.endedAt,
        outcome: "passed" as const,
        assertions: [{ ref: 0, outcome: "passed" as const }],
      })),
    );
    fs.writeFileSync(
      path.join(dir, "results.json"),
      `${JSON.stringify({ schemaVersion: 1, results })}\n`,
    );
  }
  return { skillId, dir };
}

describe("evaluation.overview RPC (evaluating-dashboard task 1.1)", () => {
  it("projects seeded corpus targets with persisted recentRuns; unknown skills degrade to error rows", async () => {
    const client = createClient();
    seedTargetDir("01", {
      cases: 2,
      runs: [{ runId: "run_" + "a".repeat(24), endedAt: "2026-10-03T00:00:09.000Z" }],
    });
    seedTargetDir("02", { cases: 1 });

    const output = await client.evaluation.overview({ wsId: WS });
    expect(output.targets.map((row) => row.target.skillId)).toEqual([
      `sk_${"0".repeat(24 - 2)}01`,
      `sk_${"0".repeat(24 - 2)}02`,
    ]);
    // 沙箱 home 无技能可解析 → 两个 target 都是 typed error 行（技能不可解析）。
    for (const row of output.targets) {
      expect("error" in row).toBe(true);
      if ("error" in row) expect(row.error.code).toBe("unavailable");
    }
    // 持久 run 仍进 recentRuns（completed 投影 + resultIds）。
    expect(output.recentRuns).toHaveLength(1);
    expect(output.recentRuns[0]).toMatchObject({
      runId: "run_" + "a".repeat(24),
      status: "completed",
      endedAt: "2026-10-03T00:00:09.000Z",
      resultIds: ["evr_" + "0".repeat(23) + "0", "evr_" + "0".repeat(23) + "1"],
    });
    expect(output.nextCursor).toBeUndefined();
  });

  it("paginates 60 targets with the default page size of 50", async () => {
    const client = createClient();
    for (let index = 0; index < 60; index += 1) {
      seedTargetDir(String(index + 1).padStart(2, "0"), { cases: 1 });
    }
    const first = await client.evaluation.overview({ wsId: WS });
    expect(first.targets).toHaveLength(50);
    expect(first.nextCursor).toBeDefined();
    const second = await client.evaluation.overview({ wsId: WS, cursor: first.nextCursor });
    expect(second.targets).toHaveLength(10);
    expect(second.nextCursor).toBeUndefined();

    const keys = [...first.targets, ...second.targets].map(
      (row) => `${row.target.providerId}:${row.target.skillId}`,
    );
    expect(new Set(keys).size).toBe(60);
    expect(keys).toEqual([...keys].sort());
  });

  it("rejects limit above 200 and malformed cursors as typed validation errors", async () => {
    const client = createClient();
    await expect(client.evaluation.overview({ wsId: WS, limit: 201 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(client.evaluation.overview({ wsId: WS, cursor: "???" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("returns an empty projection for a workspace without corpus directories", async () => {
    const client = createClient();
    const output = await client.evaluation.overview({ wsId: "~" });
    expect(output).toEqual({ targets: [], recentRuns: [] });
  });
});

describe("evaluation.run.start Global pre-gate (design §2)", () => {
  it("rejects a Global target with INVALID_OPERATION and writes nothing", async () => {
    const client = createClient();
    await expect(
      client.evaluation.run.start({
        target: {
          workspaceId: "~",
          providerId: "claude-code",
          skillId: "sk_" + "1".repeat(24),
        },
        caseIds: ["ev_" + "1".repeat(24)],
        runner: "analyzer",
      }),
    ).rejects.toMatchObject({ code: "INVALID_OPERATION" });
    // 零落盘：Global evaluation 目录从未创建。
    expect(fs.existsSync(path.join(stateRoot, ".skill-creator", "evaluation", "~"))).toBe(false);
  });
});
