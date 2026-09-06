/**
 * Steward run ↔ DSH session 绑定测试（openspec dsh-webui-composition task 2.1 step 3）。
 *
 * User input [2026-09-06] (tasks 2.1): "Skill Steward run 绑定 DSH session id 与
 * Manager run id；实时 stream 只做展示，durable audit 仍由 Manager 保存。"
 *
 * Orthogonal intents:
 *   [1] 绑定事实：真实官方 profile 组合内 openBoundSession 建立 workspace 归属的
 *       session（workspace.json 的 sessionIds 收录、store 可取回）。
 *   [2] transcript 事件语法：title/turn/step/user/assistant 事件与 agent-loop 形状
 *       一致；终态 reason completed。
 *   [3] 降级面：宿主不可用 → typed HOST_UNAVAILABLE；pipeline 注入后 run 结果与
 *       audit run 记录携带 dshSessionId。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDaemonDomain, type DaemonDomain } from "../src/daemon/domain.js";
import {
  bootOfficialWebProfile,
  type OfficialWebProfileOptions,
} from "../src/daemon/steward/dsh-official-profile.js";
import {
  createDshSessionBinder,
  type DshSessionBinder,
} from "../src/daemon/steward/dsh-session-binder.js";
import { createSkillStewardPipelineService } from "../src/daemon/steward/pipeline-service.js";
import type { MinimalDshWebHost } from "../src/daemon/steward/dsh-web-host.js";
import { setHomeOverride } from "../src/shared/paths.js";
import { ProviderIdSchema } from "../src/shared/contracts/workspaces.js";
import { deterministicSkillsCliProbe } from "./helpers/deterministic-probe.js";

let sandbox = "";
let host: MinimalDshWebHost | undefined;
let domain: DaemonDomain | undefined;
const providerId = ProviderIdSchema.parse("openclaw");

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-session-binder-"));
});

afterEach(async () => {
  await domain?.steward.dispose();
  await domain?.repository.dispose();
  domain = undefined;
  setHomeOverride(null);
  if (host) {
    await host.dispose().catch(() => undefined);
    host = undefined;
  }
  fs.rmSync(sandbox, { recursive: true, force: true });
});

/** 测试内读取 host ctx sessions 的最小收窄（与实现同源的结构面）。 */
function hostSessions(current: MinimalDshWebHost): {
  get(id: string): { log: Array<{ type: string }> } | undefined;
} {
  const ctx = current.ctx as unknown as Record<string, unknown>;
  const sessions = ctx.sessions as {
    get(id: string): { log: Array<{ type: string }> } | undefined;
  };
  return sessions;
}

describe("dsh session binder (task 2.1 step 3)", () => {
  it("returns typed HOST_UNAVAILABLE when no host is booted", async () => {
    const binder = createDshSessionBinder({ host: () => null });
    const bound = await binder.openBoundSession({
      runId: "sr_probe",
      workspaceDir: sandbox,
      taskText: "probe",
    });
    expect(bound).toEqual({ ok: false, failure: { kind: "HOST_UNAVAILABLE" } });
  });

  it(
    "binds a run to a workspace-owned session with official event grammar",
    { timeout: 240_000 },
    async () => {
      const options: OfficialWebProfileOptions = { home: path.join(sandbox, "dsh-home") };
      host = await bootOfficialWebProfile(options);
      const binder = createDshSessionBinder({ host: () => host });

      const workspaceDir = path.join(sandbox, "ws");
      fs.mkdirSync(workspaceDir, { recursive: true });
      const bound = await binder.openBoundSession({
        runId: "sr_abc123",
        workspaceDir,
        workspaceTitle: "binder-ws",
        taskText: "Skill Steward check run（Manager run id sr_abc123）",
      });
      expect(bound.ok).toBe(true);
      if (!bound.ok) return;
      expect(typeof bound.dshSessionId).toBe("string");
      expect(bound.dshSessionId.length).toBeGreaterThan(0);

      // workspace 持久记录收录该 session（sidebar 列表事实源；registry 写入是
      // 队列化持久，轮询等待落盘）。
      const storagePath = path.join(options.home, "storages", "workspace.json");
      let workspaceStorage:
        | {
            global: { workspaceIds: string[] };
            tables: { workspaces: Record<string, { sessionIds: string[]; title: string }> };
          }
        | undefined;
      for (let attempt = 0; attempt < 50 && workspaceStorage === undefined; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (fs.existsSync(storagePath)) {
          workspaceStorage = JSON.parse(fs.readFileSync(storagePath, "utf8"));
        }
      }
      expect(workspaceStorage).toBeDefined();
      const record = Object.values(workspaceStorage!.tables.workspaces).find((entry) =>
        entry.sessionIds.includes(bound.dshSessionId),
      );
      expect(record?.title).toBe("binder-ws");

      // store 内事件语法与 agent-loop 一致（title + turn/step + user turn 打开侧）。
      const session = hostSessions(host).get(bound.dshSessionId);
      expect(session).toBeDefined();
      const types = session!.log.map((event) => event.type);
      expect(types).toContain("session/title");
      expect(types).toContain("turn/start");
      expect(types).toContain("step/start");
      expect(types).toContain("user/message");

      const completed = binder.completeBoundSession({
        dshSessionId: bound.dshSessionId,
        summary: {
          terminal: "completed",
          acceptedResponses: 2,
          droppedLateResponses: 0,
          toolCalls: 3,
          proposals: 1,
        },
      });
      expect(completed).toEqual({ ok: true });
      const finalTypes = hostSessions(host)
        .get(bound.dshSessionId)!
        .log.map((e) => e.type);
      expect(finalTypes).toContain("assistant/message");
      expect(finalTypes).toContain("step/end");
      expect(finalTypes).toContain("turn/end");
    },
  );

  it(
    "pipeline startRun carries the binding into result and persisted run record",
    { timeout: 240_000 },
    async () => {
      const options: OfficialWebProfileOptions = { home: path.join(sandbox, "dsh-home") };
      host = await bootOfficialWebProfile(options);
      const binder: DshSessionBinder = createDshSessionBinder({ host: () => host });

      process.env.SKILL_CREATOR_HOME = path.join(sandbox, "home");
      setHomeOverride(path.join(sandbox, "home"));
      domain = createDaemonDomain(undefined, { skillsCliProbe: deterministicSkillsCliProbe() });
      const directory = path.join(sandbox, "ws");
      fs.mkdirSync(directory, { recursive: true });
      const workspace = domain.workspaces.import(directory, "ws");
      await domain.creator.save({
        mode: "create",
        workspaceId: workspace.id,
        providerId,
        directoryName: "probe-skill",
        frontmatter: { name: "probe-skill", description: "probe skill." },
        body: "# probe-skill\n",
      });

      const pipeline = createSkillStewardPipelineService({
        workspaces: domain.workspaces,
        skills: domain.skills,
        creator: domain.creator,
        dshSessionBinder: binder,
      });
      const result = await pipeline.startRun({
        target: { workspaceId: workspace.id, providerId },
        taskKind: "check",
      });
      expect(typeof result.dshSessionId).toBe("string");

      // durable 事实仍在 Manager audit store（dshSessionId 是关联键投影）。
      const store = path.join(sandbox, "home", "steward-store", "runs.jsonl");
      expect(fs.existsSync(store)).toBe(true);
      const runs = fs
        .readFileSync(store, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { dshSessionId?: string; terminal: string });
      const boundRun = runs.find((run) => run.dshSessionId === result.dshSessionId);
      expect(boundRun?.terminal).toBe(result.terminal);

      // 同一 session 在 DSH 侧呈现 run 终态叙述。
      const session = hostSessions(host).get(result.dshSessionId!);
      const types = session?.log.map((event) => event.type);
      expect(types).toContain("assistant/message");
      expect(types).toContain("turn/end");
    },
  );
});
