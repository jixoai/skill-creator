/**
 * Manager tools 事件 → 官方 transcript 关联测试（openspec dsh-webui-composition task 2.2）。
 *
 * User input [2026-09-06] (tasks 2.2): "将已注册的 Manager tools 事件接入官方
 * transcript……将 call id、结果与错误关联 Manager run/tool event，UI 不重新注册工具
 * 或建立执行入口。" "一次真实 DSH tool round 在 transcript 与 Manager audit 中可对应；
 * 重复渲染/重连不重新执行工具；领域白名单保持不变。"
 *
 * Orthogonal intents:
 *   [1] 关联事实：pipeline run（真实域工具轮）产生的 SkillToolCall.id 同时出现在
 *       DSH session 的 tool/call callId 与 Manager runs.jsonl 的 toolCalls[].id。
 *   [2] 幂等投影：recordToolRounds 对同一 callId 重复调用不追加第二份事件。
 *   [3] 白名单不变：transcript 投影不注册任何工具；域工具集仍由
 *       AGENT_ALLOWED_TOOLS 契约断言（denied 的非域调用照实投影）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AGENT_ALLOWED_TOOLS, type SkillToolCall } from "../src/shared/contracts/skill-steward.js";
import { createDaemonDomain, type DaemonDomain } from "../src/daemon/domain.js";
import { bootDshKernel, type DshKernelHandle } from "../src/daemon/kernel/dsh-kernel.js";
import { createDshSessionBinder } from "../src/daemon/steward/dsh-session-binder.js";
import { createSkillStewardPipelineService } from "../src/daemon/steward/pipeline-service.js";
import { setHomeOverride } from "../src/shared/paths.js";
import { ProviderIdSchema } from "../src/shared/contracts/workspaces.js";
import { deterministicSkillsCliProbe } from "./helpers/deterministic-probe.js";

let sandbox = "";
let host: DshKernelHandle | undefined;
let domain: DaemonDomain | undefined;
const providerId = ProviderIdSchema.parse("openclaw");

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-tool-composition-"));
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

interface SessionEventView {
  type: string;
  data?: { callId?: string };
}

function hostSessionLog(current: DshKernelHandle, sessionId: string): SessionEventView[] {
  const ctx = current.ctx as unknown as Record<string, unknown>;
  const sessions = ctx.sessions as {
    get(id: string): { log: unknown[] } | undefined;
  };
  return sessions.get(sessionId)?.log as SessionEventView[];
}

describe("manager tools into official transcript (task 2.2)", () => {
  it(
    "correlates tool round call ids between the DSH transcript and the Manager run audit",
    { timeout: 240_000 },
    async () => {
      host = await bootDshKernel({ home: path.join(sandbox, "dsh-home") });
      const binder = createDshSessionBinder({ host: () => host });

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
      const dshSessionId = result.dshSessionId!;

      // Manager audit：runs.jsonl 的 toolCalls 携带关联 id 与结果类别。
      const runs = fs
        .readFileSync(path.join(sandbox, "home", "steward-store", "runs.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map(
          (line) =>
            JSON.parse(line) as {
              dshSessionId?: string;
              toolCalls?: Array<{ id: string; tool: string; resultKind: string }>;
            },
        );
      const runRecord = runs.find((run) => run.dshSessionId === dshSessionId);
      expect(runRecord?.toolCalls?.length).toBeGreaterThan(0);

      // DSH transcript：每个 Manager call id 都有配对的 tool/call + tool/result。
      const log = hostSessionLog(host, dshSessionId);
      const callEvents = log.filter((event) => event.type === "tool/call");
      const resultEvents = log.filter((event) => event.type === "tool/result");
      expect(callEvents.length).toBe(runRecord!.toolCalls!.length);
      const transcriptCallIds = new Set(callEvents.map((event) => event.data?.callId));
      for (const call of runRecord!.toolCalls!) {
        expect(transcriptCallIds.has(call.id)).toBe(true);
      }
      // 官方渲染器契约（4.1 取证实测）：arguments 必须是可 JSON.parse 的字符串
      // （ui-chat 把它直接当 argsRaw 用；对象值会让官方 transcript 崩溃）。
      for (const event of callEvents) {
        const raw = (event.data as { arguments?: unknown }).arguments;
        expect(typeof raw).toBe("string");
        expect(typeof JSON.parse(raw as string)).toBe("object");
      }
      expect(resultEvents.length).toBe(callEvents.length);
      // 事件顺序：user → tool rounds → assistant → step/end → turn/end。
      const types = log.map((event) => event.type);
      expect(types.indexOf("user/message")).toBeLessThan(types.indexOf("tool/call"));
      expect(types.lastIndexOf("tool/result")).toBeLessThan(types.indexOf("assistant/message"));
      expect(types.indexOf("assistant/message")).toBeLessThan(types.indexOf("turn/end"));

      // 领域白名单不变：run 的域调用全部落在契约白名单内。
      for (const call of runRecord!.toolCalls!) {
        if (call.resultKind !== "denied") {
          expect((AGENT_ALLOWED_TOOLS as readonly string[]).includes(call.tool)).toBe(true);
        }
      }
    },
  );

  it(
    "re-projecting the same tool calls is idempotent (no second event pair)",
    { timeout: 240_000 },
    async () => {
      host = await bootDshKernel({ home: path.join(sandbox, "dsh-home") });
      const binder = createDshSessionBinder({ host: () => host });
      const workspaceDir = path.join(sandbox, "ws");
      fs.mkdirSync(workspaceDir, { recursive: true });
      const bound = await binder.openBoundSession({
        runId: "sr_dup",
        workspaceDir,
        taskText: "duplicate projection probe",
      });
      expect(bound.ok).toBe(true);
      if (!bound.ok) return;

      const call: SkillToolCall = {
        id: "stc_dup1",
        at: new Date().toISOString(),
        runId: "sr_dup",
        tool: "skills.list_context",
        principal: "agent",
        input: {},
        result: { kind: "ok", value: { skills: 1 } },
        observedRevisions: [],
      };
      const first = binder.recordToolRounds(bound.dshSessionId, [call]);
      expect(first).toEqual({ ok: true, projected: 1 });
      // 重连/重渲染等价：同一批调用再次投影——必须幂等跳过，不追加第二份事件。
      const second = binder.recordToolRounds(bound.dshSessionId, [call]);
      expect(second).toEqual({ ok: true, projected: 0 });
      const log = hostSessionLog(host, bound.dshSessionId);
      expect(log.filter((event) => event.type === "tool/call")).toHaveLength(1);
      expect(log.filter((event) => event.type === "tool/result")).toHaveLength(1);
    },
  );
});
