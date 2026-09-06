/**
 * Agent steward service + adapter contract tests.
 *
 * User input [2026-09-06] (openspec agent-steward): "Agent 不能越过 Manager apply、
 * approval 一次性、backend 不自动 fallback、daemon stop 无 orphan process。"
 * "backend 缺失、版本不匹配、协议 handshake 失败均显示 typed unavailable。"
 *
 * Orthogonal intents:
 *   [1] Manager authority: agent output only becomes drafts via propose; apply only via approve.
 *   [2] Lifecycle terminal states: cancel, disconnect, handshake failure, daemon stop.
 *   [3] Backend protocol mapping (codex app-server) against a scripted stdio peer.
 */
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDaemonDomain, type DaemonDomain } from "../src/daemon/domain.js";
import { deterministicSkillsCliProbe } from "./helpers/deterministic-probe.js";
import { DomainError } from "../src/daemon/domain-error.js";
import { createCodexAppServerAdapter } from "../src/daemon/steward/codex-adapter.js";
import { createDshHarnessAdapter } from "../src/daemon/steward/dsh-adapter.js";
import { createFixtureHarnessAdapter } from "../src/daemon/steward/fixture-adapter.js";
import type { HarnessAdapter } from "../src/daemon/steward/harness-adapter.js";
import type { RunEvent, StewardRun } from "../src/shared/contracts/agent-steward.js";
import { setHomeOverride } from "../src/shared/paths.js";
import {
  ProviderIdSchema,
  type ImportedWorkspace,
  type WorkspaceProviderTarget,
} from "../src/shared/contracts/workspaces.js";

const previousHome = process.env.SKILL_CREATOR_HOME;
let sandbox = "";
let domain: DaemonDomain;
const providerId = ProviderIdSchema.parse("openclaw");

function buildDomain(adapters: HarnessAdapter[]): DaemonDomain {
  return createDaemonDomain(undefined, {
    stewardAdapters: adapters,
    skillsCliProbe: deterministicSkillsCliProbe(),
  });
}

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-steward-test-"));
  const isolatedHome = path.join(sandbox, "state");
  process.env.SKILL_CREATOR_HOME = isolatedHome;
  setHomeOverride(isolatedHome);
  domain = buildDomain([createFixtureHarnessAdapter()]);
});

afterEach(async () => {
  await domain.steward.dispose();
  await domain.repository.dispose();
  setHomeOverride(null);
  if (previousHome === undefined) delete process.env.SKILL_CREATOR_HOME;
  else process.env.SKILL_CREATOR_HOME = previousHome;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function importWorkspace(name: string): ImportedWorkspace {
  const directory = path.join(sandbox, name);
  fs.mkdirSync(directory, { recursive: true });
  return domain.workspaces.import(directory, name);
}

function target(workspace: ImportedWorkspace): WorkspaceProviderTarget {
  return { workspaceId: workspace.id, providerId };
}

async function createSkill(
  workspace: ImportedWorkspace,
  directoryName: string,
  description: string,
  allowedTools: string,
): Promise<void> {
  await domain.creator.save({
    mode: "create",
    workspaceId: workspace.id,
    providerId,
    directoryName,
    frontmatter: { name: directoryName, description, "allowed-tools": allowedTools },
    body: `# ${directoryName}\n\nUses \`scripts/build.sh\` and references ./assets/logo.png.\n`,
  });
}

/** 轮询等待条件成立（有界）。 */
async function waitForCondition(
  probe: () => Promise<boolean> | boolean,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await probe()) return;
    if (Date.now() > deadline) throw new Error("waitForCondition timed out");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function runEventKinds(runId: StewardRun["runId"]): string[] {
  return domain.steward.events({ runId }).events.map((event) => event.kind);
}

describe("steward full lifecycle (fixture backend)", () => {
  it("runs analyze → recommend → draft → validate → approval → apply with ordered events", async () => {
    const workspace = importWorkspace("lifecycle-root");
    await createSkill(workspace, "deploy-web", "Deploy the web app.", "Bash, Read");
    await createSkill(workspace, "deploy-api", "Deploy the api app.", "Bash, Read");

    const started = await domain.steward.start({
      backendId: "fixture",
      target: target(workspace),
    });
    const runId = started.run.runId;

    // 默认 fixture 流程包含一次 manager 中介授权：等待请求出现后批准。
    await waitForCondition(() =>
      domain.steward.events({ runId }).events.some((event) => event.kind === "permission-request"),
    );
    const permissionEvent = domain.steward
      .events({ runId })
      .events.find((event) => event.kind === "permission-request")!;
    const decided = await domain.steward.decidePermission({
      runId,
      requestId: permissionEvent.permissionRequestId!,
      decision: "granted",
    });
    expect(decided.run.permissionDecisions).toHaveLength(1);

    // 等待到达审批门。
    await waitForCondition(() => {
      const probe = domain.steward.events({ runId });
      return probe.status !== "running" || probe.phase === "awaiting-approval";
    });
    const gate = domain.steward.events({ runId });
    expect(gate.status).toBe("running");
    expect(gate.phase).toBe("awaiting-approval");

    const beforeSettled = domain.steward.list().runs.find((run) => run.runId === runId)!;
    expect(beforeSettled.observedRevisions.length).toBeGreaterThan(0);
    expect(beforeSettled.recommendations.length).toBe(1);
    expect(beforeSettled.proposalIds.length).toBe(1);

    const approved = await domain.steward.approveProposal({
      runId,
      proposalId: beforeSettled.proposalIds[0]!,
    });
    expect(approved.result.applied).toBeGreaterThan(0);

    const settledRun = await domain.steward.settled(runId);
    expect(settledRun.status).toBe("completed");
    expect(settledRun.phase).toBeNull();
    expect(settledRun.endedAt).not.toBeNull();

    // Manager apply 真实生效：disable 落盘为 .SKILL.md。
    const disabled = fs.existsSync(
      path.join(sandbox, "lifecycle-root", "skills", "deploy-web", ".SKILL.md"),
    );
    expect(disabled).toBe(true);

    // 事件顺序覆盖全部阶段 + 终态。
    const kinds = runEventKinds(runId);
    const indexOf = (kind: RunEvent["kind"]) => kinds.indexOf(kind);
    expect(indexOf("run-started")).toBeGreaterThanOrEqual(0);
    expect(indexOf("phase")).toBeGreaterThan(indexOf("run-started"));
    expect(indexOf("agent-message")).toBeGreaterThan(0);
    expect(indexOf("permission-request")).toBeGreaterThan(indexOf("agent-message"));
    expect(indexOf("permission-decision")).toBeGreaterThan(indexOf("permission-request"));
    expect(indexOf("recommendation")).toBeGreaterThan(indexOf("permission-decision"));
    expect(indexOf("draft-created")).toBeGreaterThan(indexOf("recommendation"));
    expect(indexOf("approval")).toBeGreaterThan(indexOf("draft-created"));
    expect(indexOf("apply")).toBeGreaterThan(indexOf("approval"));
    expect(kinds[kinds.length - 1]).toBe("run-terminal");
    const terminal = domain.steward
      .events({ runId })
      .events.find((event) => event.kind === "run-terminal")!;
    expect(terminal.terminalStatus).toBe("completed");

    // 隔离 execution root 已回收。
    expect(fs.existsSync(beforeSettled.executionRoot)).toBe(false);
  });
});

describe("terminal lifecycle paths", () => {
  it("cancels an active run and removes the execution root", async () => {
    domain = buildDomain([
      createFixtureHarnessAdapter({
        behaviors: [
          { type: "message", text: "working" },
          { type: "wait", ms: 10_000 },
          { type: "recommendations" },
        ],
      }),
    ]);
    const workspace = importWorkspace("cancel-root");
    await createSkill(workspace, "solo-skill", "A solo skill.", "Read");
    const started = await domain.steward.start({ backendId: "fixture", target: target(workspace) });
    const runId = started.run.runId;
    await waitForCondition(() => domain.steward.events({ runId }).phase === "recommending");

    const cancelled = await domain.steward.cancel({ runId });
    expect(cancelled.run.status).toBe("cancelled");
    expect(fs.existsSync(started.run.executionRoot)).toBe(false);
    const terminal = domain.steward
      .events({ runId })
      .events.find((event) => event.kind === "run-terminal")!;
    expect(terminal.terminalStatus).toBe("cancelled");
  });

  it("maps backend process loss to a disconnected terminal state", async () => {
    domain = buildDomain([
      createFixtureHarnessAdapter({
        behaviors: [
          { type: "message", text: "starting" },
          { type: "process-lost", message: "backend exited unexpectedly" },
        ],
      }),
    ]);
    const workspace = importWorkspace("disconnect-root");
    await createSkill(workspace, "solo-skill", "A solo skill.", "Read");
    const started = await domain.steward.start({ backendId: "fixture", target: target(workspace) });
    const settledRun = await domain.steward.settled(started.run.runId);
    expect(settledRun.status).toBe("disconnected");
    expect(settledRun.error).toContain("backend exited unexpectedly");
  });

  it("stops active runs on daemon dispose without leaving execution roots", async () => {
    domain = buildDomain([
      createFixtureHarnessAdapter({
        behaviors: [
          { type: "message", text: "working" },
          { type: "wait", ms: 10_000 },
        ],
      }),
    ]);
    const workspace = importWorkspace("stop-root");
    await createSkill(workspace, "solo-skill", "A solo skill.", "Read");
    const started = await domain.steward.start({ backendId: "fixture", target: target(workspace) });
    await waitForCondition(
      () => domain.steward.events({ runId: started.run.runId }).phase === "recommending",
    );
    await domain.steward.dispose();
    const run = domain.steward
      .list()
      .runs.find((candidate) => candidate.runId === started.run.runId)!;
    expect(run.status).toBe("stopped");
    expect(fs.existsSync(started.run.executionRoot)).toBe(false);
  });
});

describe("backend availability (no auto fallback)", () => {
  it("reports typed unavailable when handshake fails and does not create a run", async () => {
    domain = buildDomain([
      createFixtureHarnessAdapter({ handshakeError: "fixture handshake rejected" }),
    ]);
    const statuses = await domain.steward.backends();
    expect(statuses.backends).toHaveLength(1);
    expect(statuses.backends[0]!.state).toBe("unavailable");
    expect(statuses.backends[0]!.reason).toContain("fixture handshake rejected");

    const workspace = importWorkspace("unavailable-root");
    await createSkill(workspace, "solo-skill", "A solo skill.", "Read");
    await expect(
      domain.steward.start({ backendId: "fixture", target: target(workspace) }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(domain.steward.list().runs).toHaveLength(0);
  });

  it("never falls back to another backend when the selected one is unavailable", async () => {
    const healthy = createFixtureHarnessAdapter();
    domain = buildDomain([
      createFixtureHarnessAdapter({ handshakeError: "selected backend is down" }),
      healthy,
    ]);
    const workspace = importWorkspace("fallback-root");
    await createSkill(workspace, "solo-skill", "A solo skill.", "Read");
    // 显式选择 dsh 标识不可用 backend：请求必须失败，而不是改跑 fixture。
    await expect(
      domain.steward.start({ backendId: "dsh", target: target(workspace) }),
    ).rejects.toThrow(/Unknown steward backend|not available/i);
    expect(domain.steward.list().runs).toHaveLength(0);
  });

  it("rejects runs targeting the Global workspace", async () => {
    const workspace = importWorkspace("global-guard-root");
    await createSkill(workspace, "solo-skill", "A solo skill.", "Read");
    await expect(
      domain.steward.start({
        backendId: "fixture",
        target: { workspaceId: "~", providerId },
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});

describe("manager authority over agent output", () => {
  it("drops traversal payloads at drafting and never writes outside the provider root", async () => {
    const workspace = importWorkspace("authority-root");
    await createSkill(workspace, "victim-skill", "A victim skill.", "Read");
    // 内联恶意 backend：返回带目录穿越的 split 推荐。
    const malicious: HarnessAdapter = {
      backendId: "fixture",
      async handshake() {
        return {
          backendId: "fixture",
          version: "evil-1",
          streamingEvents: true,
          cancellation: true,
          permissionRequests: false,
          executionRoot: "isolated",
        };
      },
      async run(prompt) {
        const skill = prompt.skills[0]!;
        return {
          recommendations: [
            {
              id: "rcmd_0000000000000000" as never,
              kind: "split",
              skillIds: [skill.skillId],
              rationale: "Split with an unsafe target directory.",
              findingIds: [],
              payload: {
                kind: "split",
                source: {
                  workspaceId: prompt.target.workspaceId,
                  providerId: prompt.target.providerId,
                  skillId: skill.skillId,
                },
                targets: [
                  { directoryName: "../escaped", name: "escaped", description: "Escape." },
                  { directoryName: "part-b", name: "part-b", description: "Part B." },
                ],
              },
            },
          ],
          finalMessage: "",
        };
      },
      async dispose() {},
    };
    domain = buildDomain([malicious]);
    const started = await domain.steward.start({ backendId: "fixture", target: target(workspace) });
    const settledRun = await domain.steward.settled(started.run.runId);
    expect(settledRun.status).toBe("completed");
    expect(settledRun.proposalIds).toHaveLength(0);
    expect(settledRun.recommendations).toHaveLength(0);
    const events = domain.steward.events({ runId: started.run.runId }).events;
    expect(
      events.some(
        (event) =>
          event.kind === "agent-message" &&
          /failed contract validation and was dropped/.test(event.message ?? ""),
      ),
    ).toBe(true);
    expect(fs.existsSync(path.join(sandbox, "escaped"))).toBe(false);
    expect(fs.existsSync(path.join(sandbox, "authority-root", "escaped"))).toBe(false);
    expect(fs.existsSync(path.join(sandbox, "authority-root", "skills", "escaped"))).toBe(false);
  });

  it("parses untrusted agent text output through the recommendation contract", async () => {
    const workspace = importWorkspace("text-parse-root");
    await createSkill(workspace, "text-skill", "A text skill.", "Read");
    const scripted: HarnessAdapter = {
      backendId: "fixture",
      async handshake() {
        return {
          backendId: "fixture",
          version: "text-1",
          streamingEvents: true,
          cancellation: true,
          permissionRequests: false,
          executionRoot: "isolated",
        };
      },
      async run(prompt) {
        const skill = prompt.skills[0]!;
        const recommendation = {
          id: "rcmd_0123456789abcdef",
          kind: "disable",
          skillIds: [skill.skillId],
          rationale: "Text-derived disable recommendation.",
          findingIds: [],
          payload: {
            kind: "disable",
            selections: [
              {
                workspaceId: prompt.target.workspaceId,
                providerId: prompt.target.providerId,
                skillId: skill.skillId,
              },
            ],
            reason: "From final text.",
          },
        };
        return {
          recommendations: [],
          finalMessage: `Agent analysis:\n${JSON.stringify([recommendation, { bogus: true }])}`,
        };
      },
      async dispose() {},
    };
    domain = buildDomain([scripted]);
    const started = await domain.steward.start({ backendId: "fixture", target: target(workspace) });
    await waitForCondition(
      () => domain.steward.events({ runId: started.run.runId }).phase === "awaiting-approval",
    );
    const run = domain.steward
      .list()
      .runs.find((candidate) => candidate.runId === started.run.runId)!;
    expect(run.recommendations).toHaveLength(1);
    expect(run.proposalIds).toHaveLength(1);
    const events = domain.steward.events({ runId: started.run.runId }).events;
    expect(
      events.some(
        (event) =>
          event.kind === "agent-message" && /failed contract validation/.test(event.message ?? ""),
      ),
    ).toBe(true);
    // 拒绝收尾：草稿被消费，run 完成。
    await domain.steward.rejectProposal({
      runId: started.run.runId,
      proposalId: run.proposalIds[0]!,
    });
    const settledRun = await domain.steward.settled(started.run.runId);
    expect(settledRun.status).toBe("completed");
  });
});

describe("approval one-shot semantics", () => {
  it("rejects duplicate permission decisions and duplicate proposal decisions", async () => {
    const workspace = importWorkspace("oneshot-root");
    await createSkill(workspace, "oneshot-alpha", "Alpha skill.", "Bash, Read");
    await createSkill(workspace, "oneshot-beta", "Beta skill.", "Bash, Read");
    const started = await domain.steward.start({ backendId: "fixture", target: target(workspace) });
    const runId = started.run.runId;
    await waitForCondition(() =>
      domain.steward.events({ runId }).events.some((event) => event.kind === "permission-request"),
    );
    const permissionEvent = domain.steward
      .events({ runId })
      .events.find((event) => event.kind === "permission-request")!;
    await domain.steward.decidePermission({
      runId,
      requestId: permissionEvent.permissionRequestId!,
      decision: "granted",
    });
    await expect(
      domain.steward.decidePermission({
        runId,
        requestId: permissionEvent.permissionRequestId!,
        decision: "denied",
      }),
    ).rejects.toBeInstanceOf(DomainError);

    await waitForCondition(() => domain.steward.events({ runId }).phase === "awaiting-approval");
    const run = domain.steward.list().runs.find((candidate) => candidate.runId === runId)!;
    const proposalId = run.proposalIds[0]!;
    await domain.steward.rejectProposal({ runId, proposalId });
    await expect(domain.steward.rejectProposal({ runId, proposalId })).rejects.toBeInstanceOf(
      DomainError,
    );
    await expect(domain.steward.approveProposal({ runId, proposalId })).rejects.toBeInstanceOf(
      DomainError,
    );
    const settledRun = await domain.steward.settled(runId);
    expect(settledRun.status).toBe("completed");
  });

  it("rejects approvals on terminal (stale) runs", async () => {
    const workspace = importWorkspace("stale-root");
    await createSkill(workspace, "stale-alpha", "Alpha skill.", "Bash, Read");
    await createSkill(workspace, "stale-beta", "Beta skill.", "Bash, Read");
    const started = await domain.steward.start({ backendId: "fixture", target: target(workspace) });
    const runId = started.run.runId;
    await waitForCondition(() =>
      domain.steward.events({ runId }).events.some((event) => event.kind === "permission-request"),
    );
    const permissionEvent = domain.steward
      .events({ runId })
      .events.find((event) => event.kind === "permission-request")!;
    await domain.steward.decidePermission({
      runId,
      requestId: permissionEvent.permissionRequestId!,
      decision: "granted",
    });
    await waitForCondition(() => domain.steward.events({ runId }).phase === "awaiting-approval");
    const run = domain.steward.list().runs.find((candidate) => candidate.runId === runId)!;
    const proposalId = run.proposalIds[0]!;
    await domain.steward.rejectProposal({ runId, proposalId });
    const settledRun = await domain.steward.settled(runId);
    expect(settledRun.status).toBe("completed");
    await expect(domain.steward.approveProposal({ runId, proposalId })).rejects.toThrow(
      /terminal/i,
    );
  });
});

describe("dsh adapter availability", () => {
  it("reports typed unavailable when the configured ACP command is missing", async () => {
    const adapter = createDshHarnessAdapter({ commandSpec: "definitely-missing-dsh-acp" });
    await expect(adapter.handshake()).rejects.toBeInstanceOf(DomainError);
    await expect(adapter.handshake()).rejects.toThrow(/backend/i);
    await adapter.dispose();
  });

  it("rejects empty command configuration as typed unavailable", async () => {
    const adapter = createDshHarnessAdapter({ commandSpec: "   " });
    await expect(adapter.handshake()).rejects.toThrow(/SKILL_CREATOR_STEWARD_DSH_ACP_CMD/);
    await adapter.dispose();
  });
});

describe("codex app-server adapter protocol mapping", () => {
  /** 构造一个脚本化的 stdio 子进程替身（JSON-RPC peer）。 */
  function scriptedCodexPeer(script: { userAgent: string; threadId: string; frames: string[] }): {
    proc: ChildProcess;
    written: string[];
  } {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const bus = new EventEmitter();
    const written: string[] = [];
    const reply = (frame: string): void => {
      stdout.write(`${frame}\n`);
    };
    stdin.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        written.push(trimmed);
        bus.emit("frame", trimmed);
      }
    });
    bus.on("frame", (raw: string) => {
      let frame: { id?: unknown; method?: unknown };
      try {
        frame = JSON.parse(raw) as { id?: unknown; method?: unknown };
      } catch {
        return;
      }
      if (frame.method === "initialize") {
        reply(
          JSON.stringify({
            jsonrpc: "2.0",
            id: frame.id ?? null,
            result: { userAgent: script.userAgent },
          }),
        );
        return;
      }
      if (frame.method === "thread/start") {
        reply(
          JSON.stringify({
            jsonrpc: "2.0",
            id: frame.id ?? null,
            result: { thread: { threadId: script.threadId } },
          }),
        );
        return;
      }
      if (frame.method === "turn/start") {
        for (const notification of script.frames) stdout.write(`${notification}\n`);
        reply(
          JSON.stringify({
            jsonrpc: "2.0",
            id: frame.id ?? null,
            result: { turn: { turnId: "turn_1" } },
          }),
        );
      }
    });
    const proc = {
      once: bus.once.bind(bus),
      on: bus.on.bind(bus),
      kill: () => {
        bus.emit("exit", 0, null);
        return true;
      },
      pid: 424242,
      stdin,
      stdout,
      stderr,
      exitCode: null,
      signalCode: null,
    } as unknown as ChildProcess;
    return { proc, written };
  }

  it("handshakes with the pinned clientInfo and reports the server version", async () => {
    const peer = scriptedCodexPeer({ userAgent: "codex-test/9.9", threadId: "th_1", frames: [] });
    const adapter = createCodexAppServerAdapter({ spawn: () => peer.proc });
    const capabilities = await adapter.handshake();
    expect(capabilities.backendId).toBe("codex");
    expect(capabilities.version).toBe("codex-test/9.9");
    const initialize = peer.written.find((line) => line.includes('"initialize"'));
    expect(initialize).toContain("skill-creator-steward");
    await adapter.dispose();
  });

  it("maps item/started, item/completed, turn/completed to normalized events", async () => {
    const recommendationJson = JSON.stringify([
      {
        kind: "disable",
        skillIds: ["sk_000000000000000000000000"],
        rationale: "Codex-derived disable.",
        findingIds: [],
        payload: {
          kind: "disable",
          selections: [
            {
              workspaceId: "ws_000000000000000000000000",
              providerId: "openclaw",
              skillId: "sk_000000000000000000000000",
            },
          ],
          reason: "From codex final message.",
        },
      },
    ]);
    const peer = scriptedCodexPeer({
      userAgent: "codex-test/9.9",
      threadId: "th_1",
      frames: [
        JSON.stringify({
          jsonrpc: "2.0",
          method: "item/started",
          params: { threadId: "th_1", turnId: "turn_1", item: { type: "reasoning" } },
        }),
        JSON.stringify({
          jsonrpc: "2.0",
          method: "item/completed",
          params: {
            threadId: "th_1",
            turnId: "turn_1",
            item: { type: "agentMessage", text: `Final: ${recommendationJson}` },
          },
        }),
        JSON.stringify({
          jsonrpc: "2.0",
          method: "turn/completed",
          params: { threadId: "th_1", turn: { turnId: "turn_1" } },
        }),
      ],
    });
    const adapter = createCodexAppServerAdapter({ spawn: () => peer.proc });
    const events: string[] = [];
    const result = await adapter.run(
      {
        runId: "sr_000000000000000000000000" as never,
        target: {
          workspaceId: "ws_000000000000000000000000" as never,
          providerId: "openclaw" as never,
        },
        objective: "Analyze and recommend.",
        executionRoot: "/tmp/unused",
        skills: [],
        findings: [],
        outputContract: "Return JSON recommendations.",
      },
      {
        emit: (event) => {
          events.push(event.kind === "item" ? `item:${event.itemKind}` : event.kind);
        },
        permission: async () => "denied",
      },
      new AbortController().signal,
    );
    expect(events).toEqual(["item:reasoning", "item:agent-message"]);
    expect(result.finalMessage).toContain("Codex-derived disable.");
    const turnStart = peer.written.find((line) => line.includes('"turn/start"'));
    expect(turnStart).toContain('"threadId":"th_1"');
    await adapter.dispose();
  });

  it("reports disconnected when the turn ends without a completion notification", async () => {
    // turn/start 正常返回但不发 turn/completed 通知：等价于进程在 turn 完成前丢失。
    const peer = scriptedCodexPeer({ userAgent: "codex-test/9.9", threadId: "th_1", frames: [] });
    const adapter = createCodexAppServerAdapter({ spawn: () => peer.proc });
    await expect(
      adapter.run(
        {
          runId: "sr_000000000000000000000000" as never,
          target: {
            workspaceId: "ws_000000000000000000000000" as never,
            providerId: "openclaw" as never,
          },
          objective: "Analyze and recommend.",
          executionRoot: "/tmp/unused",
          skills: [],
          findings: [],
          outputContract: "Return JSON recommendations.",
        },
        { emit: () => {}, permission: async () => "denied" },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/completion/i);
    await adapter.dispose();
  });
});
