/**
 * 内核 inbox 队列面测试（composer-references-queue-actions C2）。
 *
 * 用户指示 [2026-09-16]：「继续完善遗留工作。完成 1/2/3」——2 = QueueDock
 * 行级编辑/移除/插话。daemon 面按官方 updateQueue 语义映射 ReactLoopInbox：
 * edit=replace（新文本 + 原附件块）、remove=remove、steer=next-turn→next-step
 * （仅 running）。真实内核的 no-credential 环境下队列瞬时排空（错误轮次立即
 * claim 下一条），端到端断言天然竞态——本套件以确定性 stub 内核钉死服务语义。
 *
 * 正交意图：
 *   [1] 投影：next-step 先、next-turn 随后；text 拼接 + 附件计数；畸形跳过。
 *   [2] 操作矩阵：edit 保留附件；remove 幂等拒绝；steer 仅 running 的
 *       next-turn；messageId 已消费 = typed NOT_FOUND。
 * 妥协声明：内核 inbox 本体的 durable 行为归 dsh-agent-loop 官方测试域。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import {
  createAgentSessionsService,
  type AgentSessionsService,
} from "../src/daemon/kernel/agent-sessions.js";
import type { DshKernelHandle } from "../src/daemon/kernel/dsh-kernel.js";
import { createSessionTranscripts } from "../src/daemon/kernel/session-transcripts.js";

let sandbox = "";
let service: AgentSessionsService | null = null;

/** stub inbox：内存实现 ReactLoopInbox 结构面（replace 签发新 id 与内核同法）。 */
function makeInbox() {
  const state = { nextTurn: [] as unknown[], nextStep: [] as unknown[] };
  const idOf = (message: unknown): string => String((message as { id: unknown }).id ?? "");
  return {
    state,
    get nextTurn() {
      return state.nextTurn;
    },
    get nextStep() {
      return state.nextStep;
    },
    replace(messageId: string, message: unknown): boolean {
      for (const key of ["nextTurn", "nextStep"] as const) {
        const index = state[key].findIndex((item) => idOf(item) === messageId);
        if (index >= 0) {
          state[key][index] = message;
          return true;
        }
      }
      return false;
    },
    remove(messageId: string): boolean {
      for (const key of ["nextTurn", "nextStep"] as const) {
        const index = state[key].findIndex((item) => idOf(item) === messageId);
        if (index >= 0) {
          state[key].splice(index, 1);
          return true;
        }
      }
      return false;
    },
    append(target: "next-turn" | "next-step", message: unknown): void {
      state[target === "next-turn" ? "nextTurn" : "nextStep"].push(message);
    },
  };
}

/** stub agent：status 可切换（steer 的 running 门）；followup 入 next-turn。 */
function makeStubAgent() {
  const inbox = makeInbox();
  const agent = {
    id: "agent-stub",
    status: "idle" as string,
    session: { id: "agent-stub", header: { cwd: sandbox } },
    followup(message: unknown): void {
      inbox.append("next-turn", message);
    },
    cancel(): void {},
    inbox,
    ctx: { on: () => () => undefined },
  };
  return agent;
}

type StubAgent = ReturnType<typeof makeStubAgent>;

/** 服务 + 同源 stub（agents.create 采纳服务分配的 sessionId——live map 键一致）。 */
function makeService(agent: StubAgent): AgentSessionsService {
  const kernel = {
    ctx: {
      agents: {
        create: async (options: { sessionId: string }) => {
          agent.id = options.sessionId;
          agent.session.id = options.sessionId;
          return { agent, dispose: async () => undefined };
        },
      },
      sessions: { list: () => [], get: () => null },
    },
  } as unknown as DshKernelHandle;
  return createAgentSessionsService({
    kernel: () => kernel,
    modelSelection: async () => ({ provider: "deepseek-official", model: "deepseek-v4-flash" }),
    defaultMode: async () => "free",
    transcripts: createSessionTranscripts(path.join(sandbox, "transcripts")),
  });
}

async function boot(agent: StubAgent) {
  service = makeService(agent);
  return await service.create({});
}

/** 入队一条消息（kernel followup 同法）。 */
function enqueue(agent: StubAgent, text: string, attachments = 0): string {
  const content: Array<Record<string, unknown>> = [{ type: "text", text }];
  for (let i = 0; i < attachments; i += 1) content.push({ type: "image", mediaType: "image/png" });
  const message = createUserMessage({
    source: { kind: "user" },
    content: content as never,
  });
  agent.followup(message);
  return String((message as { id: unknown }).id);
}

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "agent-queue-test-"));
});

afterEach(async () => {
  await service?.dispose().catch(() => undefined);
  service = null;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("agent queue projection (C2)", () => {
  it("lists next-step before next-turn with joined text and attachment counts, skipping malformed", async () => {
    const agent = makeStubAgent();
    const session = await boot(agent);
    const turnId = enqueue(agent, "second please", 1);
    agent.inbox.append(
      "next-step",
      createUserMessage({
        source: { kind: "user" },
        content: [{ type: "text", text: "steer now" }] as never,
      }),
    );
    agent.inbox.nextTurn.push({ not: "a-message" });

    const { items } = service!.queueList(session.sessionId);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ target: "next-step", text: "steer now", attachments: 0 });
    expect(items[1]).toMatchObject({
      messageId: turnId,
      target: "next-turn",
      text: "second please",
      attachments: 1,
    });
  });

  it("returns empty items for non-live sessions (revived-later boundary)", () => {
    service = makeService(makeStubAgent());
    expect(service.queueList("agent-unknown")).toEqual({ items: [] });
  });
});

describe("agent queue update (C2)", () => {
  it("edits text while preserving attachment blocks", async () => {
    const agent = makeStubAgent();
    const session = await boot(agent);
    const id = enqueue(agent, "original", 2);

    service!.queueUpdate(session.sessionId, { messageId: id, action: "edit", text: "edited" });

    const { items } = service!.queueList(session.sessionId);
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe("edited");
    expect(items[0].attachments).toBe(2);
  });

  it("removes a queued message and rejects stale ids with typed NOT_FOUND", async () => {
    const agent = makeStubAgent();
    const session = await boot(agent);
    const id = enqueue(agent, "bye");

    service!.queueUpdate(session.sessionId, { messageId: id, action: "remove" });
    expect(service!.queueList(session.sessionId).items).toHaveLength(0);
    expect(() =>
      service!.queueUpdate(session.sessionId, { messageId: id, action: "remove" }),
    ).toThrowError(/no longer pending/);
  });

  it("steers a next-turn item only while running", async () => {
    const agent = makeStubAgent();
    const session = await boot(agent);
    const id = enqueue(agent, "redirect");

    expect(() =>
      service!.queueUpdate(session.sessionId, { messageId: id, action: "steer" }),
    ).toThrowError(/needs a running turn/);

    agent.status = "running";
    service!.queueUpdate(session.sessionId, { messageId: id, action: "steer" });
    const { items } = service!.queueList(session.sessionId);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ target: "next-step", text: "redirect" });

    // 已是 next-step 的项再 steer → INVALID_OPERATION（无下一步边界可改）。
    expect(() =>
      service!.queueUpdate(session.sessionId, { messageId: items[0].messageId, action: "steer" }),
    ).toThrowError(/not a queued next-turn item/);
  });

  it("rejects updates on non-live sessions with typed NOT_FOUND", () => {
    service = makeService(makeStubAgent());
    expect(() =>
      service!.queueUpdate("agent-unknown", { messageId: "m1", action: "remove" }),
    ).toThrowError(/agent session not found/);
  });
});
