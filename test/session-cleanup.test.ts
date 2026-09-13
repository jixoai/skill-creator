/**
 * 面板会话清理测试（R14-C 2026-09-12）。
 *
 * 用户原始需求 [2026-09-12]：「要有专门的 Session 管理页面，并且要默认支持
 * 清理 30 天以外的 Session（可配置）。」
 *
 * 正交意图：
 *   [1] 清理核心：旧目录删除 / 新目录保留 / running 跳过 / live 释放 /
 *       all 与 sessionIds 范围 / 计数正确 / 契约 safeParse。
 *   [2] boot 钩子：按配置天数扫一遍 + 失败有界（不打断启动）；beforeDays=0
 *       边界（当日也被清理）经注入时钟钉死。
 *   [3] 配置字段：sessionCleanupDays 默认 30、旧持久化缺字段走默认、更新
 *       走 settings update 面、非法值被 schema 拒绝；RPC 路由全链接线。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDaemonDomain } from "../src/daemon/domain.js";
import {
  runBootSessionCleanup,
  runSessionCleanup,
  type SessionCleanupLiveControl,
} from "../src/daemon/kernel/session-cleanup.js";
import {
  createSessionTranscripts,
  type SessionTranscripts,
} from "../src/daemon/kernel/session-transcripts.js";
import { createRpcRouter } from "../src/daemon/rpc-router.js";
import { createDshSettingsService } from "../src/daemon/steward/dsh-settings.js";
import {
  AgentSessionsCleanupInputSchema,
  AgentSessionsCleanupResultSchema,
} from "../src/shared/contracts/agent.js";
import { DshStewardSettingsSchema } from "../src/shared/contracts/dsh-runtime.js";
import { appDir, setHomeOverride } from "../src/shared/paths.js";
import { deterministicSkillsCliProbe } from "./helpers/deterministic-probe.js";

const MS_PER_DAY = 86_400_000;
const previousHome = process.env.SKILL_CREATOR_HOME;
const previousDshHome = process.env.DSH_HOME;
let sandbox = "";

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-session-cleanup-"));
  const isolatedHome = path.join(sandbox, "state");
  process.env.SKILL_CREATOR_HOME = isolatedHome;
  setHomeOverride(isolatedHome);
  // dsh-settings update 会桥写 $DSH_HOME（路由变更）——沙箱隔离，防污染真实 ~/.dsh。
  process.env.DSH_HOME = path.join(sandbox, "dsh");
});

afterEach(() => {
  setHomeOverride(null);
  if (previousHome === undefined) delete process.env.SKILL_CREATOR_HOME;
  else process.env.SKILL_CREATOR_HOME = previousHome;
  if (previousDshHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = previousDshHome;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

/** 可编程 live 控制面（记录释放调用；running/idle/persisted 三态）。 */
function makeControl(): SessionCleanupLiveControl & {
  live: Map<string, "running" | "idle">;
  disposed: string[];
} {
  const live = new Map<string, "running" | "idle">();
  const disposed: string[] = [];
  return {
    live,
    disposed,
    liveStatusOf(sessionId) {
      const status = live.get(sessionId);
      if (status === undefined) return "persisted";
      return status === "running" ? "running" : "live";
    },
    async disposeLiveSession(sessionId) {
      live.delete(sessionId);
      disposed.push(sessionId);
    },
    async runUnderCleanupGate(_sessionId, fn) {
      await fn();
    },
    markCleaned(_sessionId) {},
  };
}

/** 播种一个 N 天前的会话（createdAt 驱动 YYYY/MM/DD 目录段）。 */
function seed(transcripts: SessionTranscripts, sessionId: string, daysAgo: number): void {
  transcripts.recordStart({
    sessionId,
    title: sessionId,
    createdAt: new Date(Date.now() - daysAgo * MS_PER_DAY).toISOString(),
    cwd: sandbox,
    mode: "free",
  });
}

function makeTranscripts(): SessionTranscripts {
  return createSessionTranscripts(path.join(sandbox, "sessions"));
}

describe("runSessionCleanup (R14-C core)", () => {
  it("deletes sessions older than beforeDays and keeps recent ones", async () => {
    const transcripts = makeTranscripts();
    seed(transcripts, "agent-old-a", 40);
    seed(transcripts, "agent-old-b", 31);
    seed(transcripts, "agent-new-a", 2);
    seed(transcripts, "agent-new-b", 5);
    const control = makeControl();

    const result = await runSessionCleanup({ transcripts, control }, { beforeDays: 30 });

    expect(result.deleted).toBe(2);
    expect(result.kept).toBe(2);
    expect([...(result.deletedIds ?? [])].sort()).toEqual(["agent-old-a", "agent-old-b"]);
    const remaining = transcripts
      .listAll()
      .map((meta) => meta.sessionId)
      .sort();
    expect(remaining).toEqual(["agent-new-a", "agent-new-b"]);
    // 空日期目录链被修剪（root 下不再有旧年份段目录）。
    expect(
      transcripts
        .listDayBuckets()
        .map((bucket) => bucket.sessionIds)
        .flat()
        .sort(),
    ).toEqual(["agent-new-a", "agent-new-b"]);
  });

  it("skips running sessions and disposes idle live ones before deleting", async () => {
    const transcripts = makeTranscripts();
    seed(transcripts, "agent-run", 40);
    seed(transcripts, "agent-live", 40);
    seed(transcripts, "agent-persisted", 40);
    const control = makeControl();
    control.live.set("agent-run", "running");
    control.live.set("agent-live", "idle");

    const result = await runSessionCleanup({ transcripts, control }, { beforeDays: 30 });

    expect(result).toMatchObject({ kind: "summary", deleted: 2, kept: 1 });
    expect(control.disposed).toEqual(["agent-live"]);
    expect(transcripts.listAll().map((meta) => meta.sessionId)).toEqual(["agent-run"]);
  });

  it("removes every non-running session with all:true and is a no-op with all:false", async () => {
    const transcripts = makeTranscripts();
    seed(transcripts, "agent-a", 1);
    seed(transcripts, "agent-b", 0);
    seed(transcripts, "agent-c", 0);
    const control = makeControl();
    control.live.set("agent-c", "running");

    const result = await runSessionCleanup({ transcripts, control }, { all: true });
    expect(result).toMatchObject({ kind: "summary", deleted: 2, kept: 1 });
    expect(transcripts.listAll().map((meta) => meta.sessionId)).toEqual(["agent-c"]);

    const noOp = await runSessionCleanup({ transcripts, control }, { all: false });
    expect(noOp).toEqual({ kind: "summary", deleted: 0, kept: 1 });
  });

  it("removes exactly the requested session with the sessionIds variant", async () => {
    const transcripts = makeTranscripts();
    seed(transcripts, "agent-a", 0);
    seed(transcripts, "agent-b", 0);
    seed(transcripts, "agent-c", 0);

    const result = await runSessionCleanup(
      { transcripts, control: makeControl() },
      {
        sessionIds: ["agent-b", "agent-missing"],
      },
    );

    expect(result).toMatchObject({ kind: "summary", deleted: 1, kept: 0 });
    expect(
      transcripts
        .listAll()
        .map((meta) => meta.sessionId)
        .sort(),
    ).toEqual(["agent-a", "agent-c"]);
  });

  it("treats beforeDays 0 as the today boundary via the injected clock", async () => {
    const transcripts = makeTranscripts();
    seed(transcripts, "agent-yesterday", 1);
    seed(transcripts, "agent-today", 0);
    // 固定 now = 今日 12:00：today 午夜 < now（当日删除）、昨日更旧（删除）。
    const now = new Date();
    now.setHours(12, 0, 0, 0);

    const atNoon = await runSessionCleanup(
      { transcripts, control: makeControl(), now: () => now },
      { beforeDays: 0 },
    );
    expect(atNoon).toMatchObject({ kind: "summary", deleted: 2, kept: 0 });

    // 固定 now = 今日午夜整点：today 午夜 < now 为假（当日保留）、昨日删除。
    const transcripts2 = makeTranscripts();
    seed(transcripts2, "agent-yesterday", 1);
    seed(transcripts2, "agent-today", 0);
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const atMidnight = await runSessionCleanup(
      { transcripts: transcripts2, control: makeControl(), now: () => midnight },
      { beforeDays: 0 },
    );
    expect(atMidnight).toMatchObject({ kind: "summary", deleted: 1, kept: 1 });
  });

  it("round-trips the shared contract schemas", async () => {
    const transcripts = makeTranscripts();
    seed(transcripts, "agent-old", 40);
    seed(transcripts, "agent-new", 1);
    const result = await runSessionCleanup(
      { transcripts, control: makeControl() },
      { beforeDays: 30 },
    );
    // 输入/输出都是外部边界值：schema 双向 safeParse 通过。
    expect(AgentSessionsCleanupInputSchema.safeParse({ beforeDays: 30 }).success).toBe(true);
    expect(AgentSessionsCleanupInputSchema.safeParse({ beforeDays: 0 }).success).toBe(true);
    expect(AgentSessionsCleanupInputSchema.safeParse({ all: true }).success).toBe(true);
    expect(AgentSessionsCleanupInputSchema.safeParse({ sessionIds: ["agent-x"] }).success).toBe(
      true,
    );
    for (const bad of [
      { beforeDays: -1 },
      { beforeDays: 1.5 },
      { all: "yes" },
      { sessionIds: [] },
      {},
    ]) {
      expect(AgentSessionsCleanupInputSchema.safeParse(bad).success).toBe(false);
    }
    const checked = AgentSessionsCleanupResultSchema.safeParse(result);
    expect(checked.success).toBe(true);
  });
});

describe("runBootSessionCleanup (R14-C boot hook)", () => {
  it("applies the configured retention policy once at boot", async () => {
    const transcripts = makeTranscripts();
    seed(transcripts, "agent-ancient", 10);
    seed(transcripts, "agent-recent", 3);
    const control = makeControl();
    const logs: string[] = [];

    await runBootSessionCleanup({
      cleanupDays: async () => 7,
      cleanup: (beforeDays) => runSessionCleanup({ transcripts, control }, { beforeDays }),
      log: (message) => logs.push(message),
    });

    expect(transcripts.listAll().map((meta) => meta.sessionId)).toEqual(["agent-recent"]);
    expect(logs[0]).toContain("deleted 1, kept 1");
  });

  it("never throws when settings or cleanup fails (bounded)", async () => {
    await expect(
      runBootSessionCleanup({
        cleanupDays: async () => {
          throw new Error("settings unavailable");
        },
        cleanup: () => {
          throw new Error("unreachable");
        },
        log: () => undefined,
      }),
    ).resolves.toBeUndefined();
    await expect(
      runBootSessionCleanup({
        cleanupDays: async () => 30,
        cleanup: async () => {
          throw new Error("fs gone");
        },
        log: () => undefined,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("sessionCleanupDays settings field (R14-C config)", () => {
  const legacySettings = {
    configVersion: 1,
    revision: 0,
    model: { provider: "deepseek", model: "deepseek-v4-flash" },
    preset: "deterministic",
    permissions: { approvalPolicy: "ask" },
    session: { streamRetention: 100, streamProjection: "enabled" },
  };

  it("defaults to 30 when the persisted file predates the field", () => {
    const parsed = DshStewardSettingsSchema.safeParse(legacySettings);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.session.sessionCleanupDays).toBe(30);
    expect(DshStewardSettingsSchema.safeParse(legacySettings).success).toBe(true);
    // 显式值保留；越界拒绝。
    const withDays = DshStewardSettingsSchema.safeParse({
      ...legacySettings,
      session: { ...legacySettings.session, sessionCleanupDays: 7 },
    });
    if (withDays.success) expect(withDays.data.session.sessionCleanupDays).toBe(7);
    expect(
      DshStewardSettingsSchema.safeParse({
        ...legacySettings,
        session: { ...legacySettings.session, sessionCleanupDays: 0 },
      }).success,
    ).toBe(false);
    expect(
      DshStewardSettingsSchema.safeParse({
        ...legacySettings,
        session: { ...legacySettings.session, sessionCleanupDays: 366 },
      }).success,
    ).toBe(false);
  });

  it("round-trips through the settings update face with change detection", async () => {
    const service = createDshSettingsService();
    expect((await service.getView()).settings.session.sessionCleanupDays).toBe(30);

    const updated = await service.update({ session: { sessionCleanupDays: 7 } });
    if (updated.outcome !== "updated") throw new Error("expected updated");
    expect(updated.changed).toBe(true);
    expect(updated.revision).toBe(1);
    expect(updated.view.settings.session.sessionCleanupDays).toBe(7);

    // 同值补丁 no-op；新实例从盘重读持久值。
    const noOp = await service.update({ session: { sessionCleanupDays: 7 } });
    if (noOp.outcome !== "updated") throw new Error("expected updated");
    expect(noOp.changed).toBe(false);
    expect((await createDshSettingsService().getView()).settings.session.sessionCleanupDays).toBe(
      7,
    );
  });
});

describe("agent.sessions.cleanup RPC wiring", () => {
  it("cleans transcripts through the real router and domain", async () => {
    // 预播种 daemon 域的真实转录根（home 已隔离到沙箱）。
    const seedTranscripts = createSessionTranscripts(path.join(appDir(), "sessions"));
    seed(seedTranscripts, "agent-old", 45);
    seed(seedTranscripts, "agent-new", 1);

    const client = createRouterClient(
      createRpcRouter({
        status: () => ({
          active: true,
          pid: process.pid,
          version: "test",
          port: 0,
          startedAt: 0,
          tray: "headless",
        }),
        domain: createDaemonDomain(undefined, { skillsCliProbe: deterministicSkillsCliProbe() }),
      }),
    );

    const result = await client.agent.sessions.cleanup({ beforeDays: 30 });
    expect(result).toMatchObject({ kind: "summary", deleted: 1, kept: 1 });
    // 持久层事实：旧目录消失、新目录保留。
    const remaining = createSessionTranscripts(path.join(appDir(), "sessions"))
      .listAll()
      .map((meta) => meta.sessionId);
    expect(remaining).toEqual(["agent-new"]);
  });
});

describe("cleanup input strict mutual exclusion (R15 codex P1-1)", () => {
  it("rejects multi-key shapes that would widen the deletion scope", async () => {
    const { AgentSessionsCleanupInputSchema } = await import("../src/shared/contracts/agent.js");
    expect(
      AgentSessionsCleanupInputSchema.safeParse({ all: true, sessionIds: ["x"] }).success,
    ).toBe(false);
    expect(AgentSessionsCleanupInputSchema.safeParse({ beforeDays: 1, all: true }).success).toBe(
      false,
    );
    expect(AgentSessionsCleanupInputSchema.safeParse({ all: false }).success).toBe(false);
    expect(AgentSessionsCleanupInputSchema.safeParse({ beforeDays: 7 }).success).toBe(true);
    expect(AgentSessionsCleanupInputSchema.safeParse({ all: true }).success).toBe(true);
    expect(AgentSessionsCleanupInputSchema.safeParse({ sessionIds: ["a"] }).success).toBe(true);
  });
});

describe("deletedIds truncation (R15 终验 P1-5)", () => {
  it("caps deletedIds at 1000 and sets the truncation flag", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-trunc-"));
    const transcripts = createSessionTranscripts(dir);
    for (let i = 0; i < 1002; i += 1) {
      seed(transcripts, `agent-mass-${i}`, 40);
    }
    const control = makeControl();
    try {
      const result = await runSessionCleanup({ transcripts, control: control }, { beforeDays: 30 });
      expect(result.deleted).toBe(1002);
      expect(result.deletedIds?.length).toBe(1000);
      expect(result.deletedIdsTruncated).toBe(true);
      // 结果必须通过共享契约（截断前的实现会在此失败）。
      const { AgentSessionsCleanupResultSchema } = await import("../src/shared/contracts/agent.js");
      expect(AgentSessionsCleanupResultSchema.safeParse(result).success).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
