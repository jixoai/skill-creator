/**
 * agent-sessions firehose 载荷收窄单测（2026-09-12 codex 阻塞 3 + R2 阻塞）。
 *
 * 用户原始需求 [2026-09-12]（codex 评审）：「event.data、assistant chunk、
 * todo/write payload 经 TS cast 直读」+ R2：「DSH firehose safeParse 只覆盖
 * chunk/todo，未覆盖 tool/message 事件；assistant reasoning 终帧未写入
 * transcript」——改为入口 Zod safeParse，畸形事件丢弃 + 有界诊断（≤200ch，
 * 不得打印全 payload），不抛、不污染合并缓冲、帧序列完好；reasoning 终帧
 * durable 落转录，reload 回放等价 live。
 *
 * 正交意图：
 *   [1] schema 面：入口 schema 家族的形状判定（chunk/todo + turn/end、
 *       session/title、user/assistant message、tool/call、tool/result）。
 *   [2] firehose 行为：畸形事件被丢弃（无帧、无缓冲/tool-name 残留），前后
 *       合法事件的帧序连续；诊断日志有界。
 *   [3] reasoning durable（R2 阻塞 2）：assistant/message 的 reasoning 终帧
 *       与正文同序落转录，dispose/reload 后 stream 回放仍含 assistant-reasoning。
 * 妥协声明：以 fake kernel（ctx.on 捕获 listener）替代真实 bootDshKernel——
 * 本测试只验证投影层的事件收窄与转录持久化，不触内核。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentChunkEventSchema,
  AgentStatusEventSchema,
  MessageEventSchema,
  SessionTitleEventSchema,
  TodoWriteEventSchema,
  ToolCallEventSchema,
  ToolResultEventSchema,
  TurnEndEventSchema,
  TurnStartEventSchema,
  createAgentSessionsService,
  type AgentSessionsService,
} from "../src/daemon/kernel/agent-sessions.js";
import type { DshKernelHandle } from "../src/daemon/kernel/dsh-kernel.js";
import { createSessionTranscripts } from "../src/daemon/kernel/session-transcripts.js";

type FirehoseListener = (
  session: { id: string },
  event: { seq: number; type: string; data: unknown },
) => void;

let sandbox = "";
let listeners: FirehoseListener[] = [];
let service: AgentSessionsService | null = null;
let warnSpy: ReturnType<typeof vi.spyOn> | null = null;

function makeFakeKernel(): DshKernelHandle {
  return {
    ctx: {
      on: (event: string, listener: FirehoseListener) => {
        if (event === "session/event") listeners.push(listener);
        return () => undefined;
      },
      agents: {
        create: async (options: { sessionId: string }) => ({
          agent: {
            id: options.sessionId,
            status: "idle",
            session: { id: options.sessionId, header: {} },
            // registerPanelAnswerer 经 agent.ctx.on 注册 answerer（本测试不触发）。
            ctx: { on: () => () => undefined },
            followup: () => undefined,
            cancel: () => undefined,
          },
          dispose: async () => undefined,
        }),
      },
    },
  } as unknown as DshKernelHandle;
}

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "agent-sessions-firehose-"));
  listeners = [];
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(async () => {
  await service?.dispose().catch(() => undefined);
  service = null;
  warnSpy?.mockRestore();
  warnSpy = null;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

/** 建 service + live 会话，返回事件注入器。 */
async function makeSession(): Promise<{
  emit: (type: string, data: unknown) => void;
  sessionId: string;
}> {
  const kernel = makeFakeKernel();
  service = createAgentSessionsService({
    kernel: () => kernel,
    modelSelection: async () => ({ provider: "deepseek-official", model: "deepseek-v4-flash" }),
    defaultMode: async () => "free",
    retention: 50,
    transcripts: createSessionTranscripts(path.join(sandbox, "transcripts")),
  });
  service.attach(kernel);
  const session = await service.create({ cwd: sandbox });
  return {
    sessionId: session.sessionId,
    emit: (type: string, data: unknown) => {
      for (const listener of listeners) listener({ id: session.sessionId }, { seq: 0, type, data });
    },
  };
}

describe("event schemas", () => {
  it("accepts the three chunk shapes (text/reasoning/tool-call delta)", () => {
    expect(
      AgentChunkEventSchema.safeParse({ chunk: { type: "text-delta", text: "hi" } }).success,
    ).toBe(true);
    expect(
      AgentChunkEventSchema.safeParse({ chunk: { type: "reasoning-delta", text: "hmm" } }).success,
    ).toBe(true);
    expect(
      AgentChunkEventSchema.safeParse({
        chunk: { type: "tool-call-delta", id: "c1", name: "bash", argumentsDelta: '{"comm' },
      }).success,
    ).toBe(true);
  });

  it("rejects malformed chunk payloads", () => {
    expect(AgentChunkEventSchema.safeParse(undefined).success).toBe(false);
    expect(AgentChunkEventSchema.safeParse("chunk").success).toBe(false);
    expect(AgentChunkEventSchema.safeParse({ chunk: 42 }).success).toBe(false);
    expect(AgentChunkEventSchema.safeParse({ chunk: { text: "no type" } }).success).toBe(false);
    // 错误类型的字段（text 非字符串）不得直读进缓冲。
    expect(
      AgentChunkEventSchema.safeParse({ chunk: { type: "text-delta", text: 42 } }).success,
    ).toBe(false);
  });

  it("accepts todo snapshots of {content,status} and rejects malformed ones", () => {
    expect(
      TodoWriteEventSchema.safeParse({
        todos: [{ content: "draft", status: "in_progress" }],
      }).success,
    ).toBe(true);
    expect(TodoWriteEventSchema.safeParse({ todos: "nope" }).success).toBe(false);
    expect(TodoWriteEventSchema.safeParse({}).success).toBe(false);
    expect(TodoWriteEventSchema.safeParse({ todos: [{ content: "x", status: 42 }] }).success).toBe(
      false,
    );
    expect(TodoWriteEventSchema.safeParse({ todos: [{ content: "missing status" }] }).success).toBe(
      false,
    );
  });

  it("accepts the two message envelope forms (data is message / {message})", () => {
    // user/message 实测：data 即 message。
    expect(
      MessageEventSchema.safeParse({
        source: { kind: "user" },
        content: [{ type: "text", text: "hi" }],
      }).success,
    ).toBe(true);
    // assistant/message 实测：{turn, step, message:{content:[...]}}（信封外键忽略）。
    expect(
      MessageEventSchema.safeParse({
        turn: 1,
        step: 1,
        message: {
          source: { kind: "model" },
          content: [
            { type: "reasoning", text: "think" },
            { type: "tool-call", id: "c1", name: "bash", arguments: "{}" },
            { type: "image", attachment: { name: "shot.png" } },
          ],
        },
      }).success,
    ).toBe(true);
  });

  it("rejects malformed message payloads (blocks, source, content)", () => {
    expect(MessageEventSchema.safeParse(undefined).success).toBe(false);
    // content 契约必在且非空：空消息事件按畸形丢弃，不产帧不消耗 seq。
    expect(MessageEventSchema.safeParse({}).success).toBe(false);
    expect(MessageEventSchema.safeParse({ message: {} }).success).toBe(false);
    expect(MessageEventSchema.safeParse({ content: [] }).success).toBe(false);
    expect(MessageEventSchema.safeParse({ message: { content: [] } }).success).toBe(false);
    expect(MessageEventSchema.safeParse({ content: "not-an-array" }).success).toBe(false);
    expect(MessageEventSchema.safeParse({ content: [{ text: "no type" }] }).success).toBe(false);
    expect(MessageEventSchema.safeParse({ content: [{ type: "text", text: 42 }] }).success).toBe(
      false,
    );
    // source 存在即必须是对象（kind 任意字符串——非 user 走分支静默丢弃，非畸形）。
    expect(MessageEventSchema.safeParse({ source: "user" }).success).toBe(false);
    expect(MessageEventSchema.safeParse({ source: { kind: 7 } }).success).toBe(false);
  });

  it("accepts turn/end, session/title, tool/call shapes and rejects malformed ones", () => {
    expect(TurnEndEventSchema.safeParse({ turn: 1, reason: { kind: "completed" } }).success).toBe(
      true,
    );
    expect(
      TurnEndEventSchema.safeParse({ reason: { kind: "error", failure: { code: "X" } } }).success,
    ).toBe(true);
    expect(TurnEndEventSchema.safeParse({ reason: "completed" }).success).toBe(false);
    expect(TurnEndEventSchema.safeParse({ reason: { kind: 42 } }).success).toBe(false);

    expect(SessionTitleEventSchema.safeParse({ title: "New chat" }).success).toBe(true);
    expect(SessionTitleEventSchema.safeParse({}).success).toBe(true); // 缺失合法——分支静默丢弃
    expect(SessionTitleEventSchema.safeParse({ title: 42 }).success).toBe(false);

    expect(
      ToolCallEventSchema.safeParse({ callId: "c1", name: "bash", arguments: '{"cmd":1}' }).success,
    ).toBe(true);
    // callId/name 契约必填（dsh-session types.d.ts）：缺失即畸形——空事件不得
    // 消耗 seq 或产出不可关联帧（codex R3 阻塞 1）。
    expect(ToolCallEventSchema.safeParse({}).success).toBe(false);
    expect(ToolCallEventSchema.safeParse({ name: "bash" }).success).toBe(false);
    expect(ToolCallEventSchema.safeParse({ callId: "c1" }).success).toBe(false);
    expect(ToolCallEventSchema.safeParse({ name: 42, callId: "c1" }).success).toBe(false);
    expect(ToolCallEventSchema.safeParse({ name: "", callId: "c1" }).success).toBe(false);
    expect(ToolCallEventSchema.safeParse({ callId: 42, name: "bash" }).success).toBe(false);
    // arguments 契约必填 string（codex R4 阻塞 1）：缺失/非字符串即畸形。
    expect(ToolCallEventSchema.safeParse({ callId: "c1", name: "bash" }).success).toBe(false);
    expect(
      ToolCallEventSchema.safeParse({ callId: "c1", name: "bash", arguments: 42 }).success,
    ).toBe(false);

    // turn/start 与 agent/status 的 record 门：undefined/null/标量/数组全部拒绝，
    // 真实对象通过（`event.data ?? {}` 归一化已被移除——codex R4 阻塞 2）。
    for (const probe of [undefined, null, "str", 42, [1]]) {
      expect(TurnStartEventSchema.safeParse(probe).success).toBe(false);
      expect(AgentStatusEventSchema.safeParse(probe).success).toBe(false);
    }
    expect(TurnStartEventSchema.safeParse({ turn: 1 }).success).toBe(true);
    expect(AgentStatusEventSchema.safeParse({ phase: "working" }).success).toBe(true);
  });

  it("accepts the nested tool/result shape and rejects malformed ones", () => {
    expect(
      ToolResultEventSchema.safeParse({
        turn: 1,
        step: 1,
        message: {
          source: { kind: "tool", callId: "c1" },
          content: [
            {
              type: "tool-result",
              toolCallId: "c1",
              content: [{ type: "text", text: '{"ok":true}' }],
            },
          ],
        },
      }).success,
    ).toBe(true);
    // message 契约必在：缺失即畸形丢弃（不再有无 message 降级路径）。
    expect(ToolResultEventSchema.safeParse({}).success).toBe(false);
    expect(ToolResultEventSchema.safeParse({ message: 42 }).success).toBe(false);
    expect(ToolResultEventSchema.safeParse({ message: { content: "nope" } }).success).toBe(false);
    expect(
      ToolResultEventSchema.safeParse({
        message: { content: [{ toolCallId: 42 }] },
      }).success,
    ).toBe(false);
    // 内层 text 非字符串：旧代码会把 42 写进帧 text——schema 门必须拦下。
    expect(
      ToolResultEventSchema.safeParse({
        message: { content: [{ content: [{ type: "text", text: 42 }] }] },
      }).success,
    ).toBe(false);
    expect(
      ToolResultEventSchema.safeParse({
        message: { source: { callId: 42 } },
      }).success,
    ).toBe(false);
    // 空 result 负边界（codex R4 阻塞 1）：空 message / 空 content / 空 block /
    // 缺 source.callId / 块内空 content 全部畸形——不得造帧不得消耗 seq。
    expect(ToolResultEventSchema.safeParse({ message: {} }).success).toBe(false);
    expect(ToolResultEventSchema.safeParse({ message: { content: [] } }).success).toBe(false);
    expect(ToolResultEventSchema.safeParse({ message: { content: [{}] } }).success).toBe(false);
    expect(
      ToolResultEventSchema.safeParse({
        message: { content: [{ toolCallId: "c1", content: [] }] },
      }).success,
    ).toBe(false);
    expect(
      ToolResultEventSchema.safeParse({
        message: { source: { kind: "tool" }, content: [{ content: [{}] }] },
      }).success,
    ).toBe(false);
    // discriminant 锁死（codex R5）：source.kind 必须字面量 'tool'，外层块 type
    // 必须字面量 'tool-result'，块内必须有非空 text part（纯 image/未知块拒收）。
    expect(
      ToolResultEventSchema.safeParse({
        message: {
          source: { kind: "model", callId: "c" },
          content: [
            { type: "tool-result", toolCallId: "c", content: [{ type: "text", text: "ok" }] },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      ToolResultEventSchema.safeParse({
        message: {
          source: { kind: "tool", callId: "c" },
          content: [{ type: "text", toolCallId: "c", content: [{ type: "text", text: "ok" }] }],
        },
      }).success,
    ).toBe(false);
    expect(
      ToolResultEventSchema.safeParse({
        message: {
          source: { kind: "tool", callId: "c" },
          content: [
            {
              type: "tool-result",
              toolCallId: "c",
              content: [{ type: "image", attachment: { name: "shot.png" } }],
            },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      ToolResultEventSchema.safeParse({
        message: {
          source: { kind: "tool", callId: "c" },
          content: [
            {
              type: "tool-result",
              toolCallId: "c",
              content: [{ type: "text", text: "" }],
            },
          ],
        },
      }).success,
    ).toBe(false);
  });
});

describe("firehose malformed-payload behavior (codex 阻塞 3)", () => {
  it("drops malformed assistant/chunk events without throwing or polluting buffers", async () => {
    const { emit, sessionId } = await makeSession();
    expect(() => {
      emit("assistant/chunk", undefined);
      emit("assistant/chunk", { chunk: { type: "text-delta", text: 42 } });
      emit("assistant/chunk", "raw string");
    }).not.toThrow();

    // 帧序列完好：紧跟的合法事件照常投影（无 delta 残留帧、seq 从 1 连续）。
    emit("turn/start", { turn: 1 });
    const after = service!.stream(sessionId, 0, 50);
    expect(after.frames.map((frame) => frame.kind)).toEqual(["turn-start"]);
    expect(after.frames[0]!.seq).toBe(1);
    expect(warnSpy).toHaveBeenCalledTimes(3);
  });

  it("keeps valid chunk accumulation intact around a malformed chunk", async () => {
    const { emit, sessionId } = await makeSession();
    emit("assistant/chunk", { chunk: { type: "text-delta", text: "wor" } });
    emit("assistant/chunk", { chunk: { type: "text-delta", text: 99 } }); // 畸形：丢弃
    emit("assistant/chunk", { chunk: { type: "text-delta", text: "ld" } });
    emit("turn/start", { turn: 1 }); // 非 chunk 事件先冲刷缓冲。

    const { frames } = service!.stream(sessionId, 0, 50);
    expect(frames.map((frame) => frame.kind)).toEqual(["assistant-delta", "turn-start"]);
    expect(frames[0]).toMatchObject({ kind: "assistant-delta", text: "world" });
    expect(frames.map((frame) => frame.seq)).toEqual([1, 2]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("drops malformed todo/write events and projects the next valid snapshot", async () => {
    const { emit, sessionId } = await makeSession();
    emit("todo/write", { todos: [{ content: "no status" }] });
    emit("todo/write", { todos: "not-an-array" });
    expect(service!.stream(sessionId, 0, 50).frames).toEqual([]);

    emit("todo/write", { todos: [{ content: "draft", status: "unknown-status" }] });
    const { frames } = service!.stream(sessionId, 0, 50);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ kind: "todo-snapshot" });
    expect(frames[0]!.payload).toMatchObject({
      todos: [{ content: "draft", status: "pending" }], // 非法状态归一 pending。
    });
    expect(frames[0]!.seq).toBe(1);
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it("logs a bounded diagnostic: ≤200 chars and never the full payload", async () => {
    const { emit } = await makeSession();
    const huge = "A".repeat(5000);
    emit("todo/write", { todos: [{ content: huge, status: 42 }] });
    emit("assistant/chunk", { chunk: huge });

    expect(warnSpy).toHaveBeenCalledTimes(2);
    for (const call of warnSpy!.mock.calls) {
      const line = String(call[0]);
      expect(line.length).toBeLessThanOrEqual(200);
      expect(line).not.toContain(huge);
      expect(line).toMatch(
        /^\[agent-sessions\] dropped malformed (todo\/write|assistant\/chunk) event for agent-/,
      );
    }
  });

  it("drops malformed tool/call events without frame or tool-name pollution (R2)", async () => {
    const { emit, sessionId } = await makeSession();
    // 畸形 name（非字符串）：整事件丢弃，不登记 toolNames、不产帧。
    emit("tool/call", { callId: "call-bad", name: 42, arguments: "{}" });
    expect(service!.stream(sessionId, 0, 50).frames).toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // 后续合法 tool/call 照常投影，seq 从 1 连续。
    emit("tool/call", { callId: "call-1", name: "bash", arguments: '{"command":"ls"}' });
    // 被丢弃事件的 callId 在 tool/result 侧不得解析出名字（toolNames 无污染）。
    emit("tool/result", {
      message: {
        source: { kind: "tool", callId: "call-bad" },
        content: [
          {
            type: "tool-result",
            toolCallId: "call-bad",
            content: [{ type: "text", text: '"ok"' }],
          },
        ],
      },
    });
    const { frames } = service!.stream(sessionId, 0, 50);
    expect(frames.map((frame) => frame.kind)).toEqual(["tool-call", "tool-result"]);
    expect(frames.map((frame) => frame.seq)).toEqual([1, 2]);
    expect(frames[0]).toMatchObject({ kind: "tool-call", toolName: "bash", toolCallId: "call-1" });
    expect(frames[1]).toMatchObject({
      kind: "tool-result",
      toolName: undefined,
      toolCallId: "call-bad",
    });
  });

  it("drops malformed tool/result events and keeps the next valid result continuous (R2)", async () => {
    const { emit, sessionId } = await makeSession();
    emit("tool/call", { callId: "c1", name: "bash", arguments: "{}" });
    // 畸形：内层 text 非字符串（旧路径会把 42 写进帧 text）。
    emit("tool/result", {
      message: { content: [{ toolCallId: "c1", content: [{ type: "text", text: 42 }] }] },
    });
    // 畸形：content 非数组。
    emit("tool/result", { message: { content: "not-an-array" } });
    expect(service!.stream(sessionId, 0, 50).frames.map((frame) => frame.kind)).toEqual([
      "tool-call",
    ]);
    expect(warnSpy).toHaveBeenCalledTimes(2);

    emit("tool/result", {
      message: {
        source: { kind: "tool", callId: "c1" },
        content: [
          { type: "tool-result", toolCallId: "c1", content: [{ type: "text", text: '"done"' }] },
        ],
      },
    });
    const { frames } = service!.stream(sessionId, 0, 50);
    expect(frames.map((frame) => frame.seq)).toEqual([1, 2]);
    expect(frames[1]).toMatchObject({
      kind: "tool-result",
      toolName: "bash",
      toolCallId: "c1",
      text: '"done"',
    });
  });

  it("drops empty events without consuming seq and keeps the next frame at 1 (codex R3 阻塞 1)", async () => {
    const { emit, sessionId } = await makeSession();
    // 空事件序列：tool/call 的 {}、tool/result 的 {}、assistant/message 的
    // {message:{}} 与 {} 全部在 schema 门丢弃——不产帧、不消耗 seq。
    emit("tool/call", {});
    emit("tool/result", {});
    emit("assistant/message", { message: {} });
    emit("assistant/message", {});
    // discriminant 错误的 tool/result（合法结构、错误 kind/type/无可消费 text）
    // 同样零帧零 seq、无 toolNames 污染（codex R5 阻塞 1）。
    emit("tool/result", {
      message: {
        source: { kind: "model", callId: "cx" },
        content: [
          { type: "tool-result", toolCallId: "cx", content: [{ type: "text", text: "x" }] },
        ],
      },
    });
    emit("tool/result", {
      message: {
        source: { kind: "tool", callId: "cx" },
        content: [{ type: "text", toolCallId: "cx", content: [{ type: "text", text: "x" }] }],
      },
    });
    emit("tool/result", {
      message: {
        source: { kind: "tool", callId: "cx" },
        content: [{ type: "tool-result", toolCallId: "cx", content: [{ type: "image" }] }],
      },
    });
    expect(service!.stream(sessionId, 0, 50).frames).toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(7);

    // 下一合法事件从 seq 1 起（丢弃事件不污染帧序）。
    emit("tool/call", { callId: "c9", name: "bash", arguments: "{}" });
    const { frames } = service!.stream(sessionId, 0, 50);
    expect(frames.map((frame) => frame.seq)).toEqual([1]);
  });

  it("drops malformed assistant/message events entirely (no reasoning leak, no frames) (R2)", async () => {
    const { emit, sessionId } = await makeSession();
    // 畸形：text 块非字符串——整个事件丢弃，reasoning 块也不得单独漏出。
    emit("assistant/message", {
      message: {
        content: [
          { type: "reasoning", text: "leak?" },
          { type: "text", text: 42 },
        ],
      },
    });
    expect(service!.stream(sessionId, 0, 50).frames).toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    emit("assistant/message", {
      message: {
        content: [
          { type: "reasoning", text: "think" },
          { type: "text", text: "answer" },
        ],
      },
    });
    const { frames } = service!.stream(sessionId, 0, 50);
    expect(frames.map((frame) => frame.kind)).toEqual(["assistant-reasoning", "assistant-text"]);
    expect(frames.map((frame) => frame.seq)).toEqual([1, 2]);
  });

  it("emits no empty text frame for reasoning-only assistant steps (codex R4)", async () => {
    const { emit, sessionId } = await makeSession();
    // reasoning-only 步骤（真实网关全量轮实测形态）：只产 reasoning 帧，usage
    // 白名单挂其 payload；绝不产 text 为 undefined/空的 assistant-text 帧。
    emit("assistant/message", {
      message: {
        source: { kind: "model" },
        content: [{ type: "reasoning", text: "silent step" }],
      },
      usage: { inputTokens: 12, outputTokens: 3 },
    });
    const { frames } = service!.stream(sessionId, 0, 50);
    expect(frames.map((frame) => frame.kind)).toEqual(["assistant-reasoning"]);
    expect(frames[0]).toMatchObject({ kind: "assistant-reasoning", text: "silent step" });
    expect(frames[0]?.payload).toMatchObject({ usage: { inputTokens: 12, outputTokens: 3 } });
  });

  it("drops malformed user/message events and keeps non-user sources silent (R2)", async () => {
    const { emit, sessionId } = await makeSession();
    // 畸形：text 块非字符串。
    emit("user/message", {
      source: { kind: "user" },
      content: [{ type: "text", text: 42 }],
    });
    expect(service!.stream(sessionId, 0, 50).frames).toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // 非 user source（内核注入）是合法路径：静默丢弃，无诊断（与旧行为等价）。
    emit("user/message", {
      source: { kind: "plugin", plugin: "runtime" },
      content: [{ type: "text", text: "injected" }],
    });
    expect(service!.stream(sessionId, 0, 50).frames).toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    emit("user/message", {
      source: { kind: "user" },
      content: [{ type: "text", text: "real question" }],
    });
    const { frames } = service!.stream(sessionId, 0, 50);
    expect(frames.map((frame) => frame.kind)).toEqual(["user-text"]);
    expect(frames[0]).toMatchObject({ kind: "user-text", text: "real question", seq: 1 });
  });
});

describe("assistant reasoning durability (codex R2 阻塞 2)", () => {
  it("persists the reasoning terminally and replays it identically after a reload", async () => {
    const transcriptsRoot = path.join(sandbox, "transcripts");
    const { emit, sessionId } = await makeSession();
    emit("assistant/message", {
      message: {
        source: { kind: "model" },
        content: [
          { type: "reasoning", text: "weigh options" },
          { type: "text", text: "final answer" },
        ],
      },
    });

    // live：内存环同时含 reasoning + text（reasoning 在前，seq 连续）。
    const live = service!.stream(sessionId, 0, 50);
    expect(live.frames.map((frame) => frame.kind)).toEqual([
      "assistant-reasoning",
      "assistant-text",
    ]);
    expect(live.frames[0]).toMatchObject({ kind: "assistant-reasoning", text: "weigh options" });
    expect(live.frames.map((frame) => frame.seq)).toEqual([1, 2]);

    // 模拟 daemon 重启：dispose live 会话，以同一持久层重建 service（新内核句柄）。
    await service!.dispose();
    service = null;
    const kernel2 = makeFakeKernel();
    service = createAgentSessionsService({
      kernel: () => kernel2,
      modelSelection: async () => ({ provider: "deepseek-official", model: "deepseek-v4-flash" }),
      defaultMode: async () => "free",
      retention: 50,
      transcripts: createSessionTranscripts(transcriptsRoot),
    });
    service.attach(kernel2);

    // 转录回放：durable transcript 含 assistant-reasoning，与 live 等价。
    const replay = service!.stream(sessionId, 0, 50);
    expect(replay.status).toBe("disposed");
    expect(replay.frames.map((frame) => [frame.kind, frame.seq])).toEqual([
      ["assistant-reasoning", 1],
      ["assistant-text", 2],
    ]);
    expect(replay.frames[0]).toMatchObject({ kind: "assistant-reasoning", text: "weigh options" });
    expect(replay.frames[1]).toMatchObject({ kind: "assistant-text", text: "final answer" });
  });
});
