/**
 * 内核 ephemeral distill 会话面测试（skill-wiki-maintainer tasks 1.3a）。
 *
 * 用户原始需求 [2026-09-25]（design K/W + tasks 1.3a 门禁）：
 * 「allowlist 过滤/未知名创建即拒/bridge 未 ready 创建即拒/prompt 超时与取消
 * typed/dispose 超时强制释放/propose 不可见/stop-timeout-cancel dispose 矩阵」
 *
 * 正交意图：
 *   [1] fake kernel surface 的逻辑矩阵：closed union 双重运行时校验、bridge
 *       等待/TOCTOU、restrict keep-only（deny-all 基线）、prompt 结算与 typed
 *       失败、dispose 有界强制释放与幂等——全部确定性（真实定时器 + 小期限）。
 *   [2] 真实内核集成：MCP 桥在场时创建真实 agent scope，listTools 恰三个
 *       scoped 注册名；无桥内核创建即拒（fail-closed 快路径）。
 * 妥协声明：prompt 的真实 LLM 驱动（followup → 模型 → turn/end）不在单测面
 *   （无本地模型路由）；firehose 事件注入验证收集/结算逻辑，端到端留待
 *   DistillJobService/CLI 集成轮（tasks 1.3/1.5）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import {
  createEphemeralSession,
  DISTILL_READONLY_TOOL_NAMES,
  EphemeralSessionError,
  type EphemeralKernelSurface,
} from "../src/daemon/kernel/ephemeral-session.js";
import type { DshKernelHandle } from "../src/daemon/kernel/dsh-kernel.js";

/* ------------------------------------------------------------------ */
/* fake kernel surface                                                 */
/* ------------------------------------------------------------------ */

interface FakeCreateCall {
  sessionId: string;
  meta?: { origin?: "subagent" };
  agentOptions?: { provider?: string; model?: string; reasoningEffort?: string };
}

interface FakePromptSection {
  name: string;
  order: number;
  text: string;
  complete?: boolean;
}

interface FakeSessionEvent {
  seq: number;
  type: string;
  data: unknown;
}

/** fake dsh-tools：keep-only allow / remove deny 的最小语义（与真实 restrict 同向）。 */
class FakeToolRuntime {
  readonly global = new Set<string>();
  readonly restrictions: Array<{ allow?: readonly string[]; deny?: readonly string[] }> = [];

  restrict(filter: { allow?: readonly string[]; deny?: readonly string[] }): () => void {
    this.restrictions.push(filter);
    return () => {
      const index = this.restrictions.indexOf(filter);
      if (index >= 0) this.restrictions.splice(index, 1);
    };
  }

  schemas(_scope?: unknown): Array<{ name?: string }> {
    let names = [...this.global];
    for (const filter of this.restrictions) {
      if (filter.allow !== undefined) {
        names = names.filter((name) => filter.allow!.includes(name));
      }
      if (filter.deny !== undefined) {
        names = names.filter((name) => !filter.deny!.includes(name));
      }
    }
    return names.map((name) => ({ name }));
  }
}

function createFakeWorld(options?: { hangKernelDispose?: boolean }) {
  const tools = new FakeToolRuntime();
  for (const name of [
    ...DISTILL_READONLY_TOOL_NAMES,
    // 混入必须不可见的面：mutation propose 变体、distill 执行变体、通用工具。
    "mcp__skill-creator__wiki_append_propose",
    "mcp__skill-creator__wiki_distill_apply_propose",
    "mcp__skill-creator__workspace_list",
    "mcp__skill-creator__skills_toggle_propose",
    "ask_user_question",
    "bash",
    "subagent",
    "send_message",
  ]) {
    tools.global.add(name);
  }
  const created: FakeCreateCall[] = [];
  const followups: unknown[] = [];
  const cancels: Array<{ cause: unknown; options?: unknown }> = [];
  const sections: FakePromptSection[] = [];
  const questionHandlers: Array<
    () => Promise<{ answers: Array<{ id: string; selected: string[] }> }>
  > = [];
  const firehoseListeners: Array<(session: { id: string }, event: FakeSessionEvent) => void> = [];
  let kernelDisposeCalls = 0;
  let globalNames: () => string[] = () => [...tools.global];

  const ctx = {
    agents: {
      create(
        call: FakeCreateCall & {
          setup?: (agentCtx: unknown) => void | Promise<void>;
        },
      ): Promise<{
        agent: {
          id: string;
          status: string;
          session: { id: string };
          followup(message: unknown): void;
          cancel(cause: unknown, opts?: unknown): void;
        };
        dispose(): Promise<void>;
      }> {
        created.push({
          sessionId: call.sessionId,
          meta: call.meta,
          agentOptions: call.agentOptions,
        });
        call.setup?.({
          tools,
          systemPrompt: {
            section(section: FakePromptSection): () => void {
              sections.push(section);
              return () => undefined;
            },
          },
          on: (event: string, listener: never) => {
            if (event === "user-questions/request") questionHandlers.push(listener);
            return () => undefined;
          },
        });
        const agent = {
          id: call.sessionId,
          status: "idle",
          session: { id: call.sessionId },
          followup: (message: unknown) => {
            followups.push(message);
          },
          cancel: (cause: unknown, opts?: unknown) => {
            cancels.push({ cause, options: opts });
          },
        };
        return Promise.resolve({
          agent,
          dispose: async () => {
            kernelDisposeCalls += 1;
            if (options?.hangKernelDispose) await new Promise<void>(() => undefined);
          },
        });
      },
    },
    on: (
      event: string,
      listener: (session: { id: string }, event: FakeSessionEvent) => void,
    ): (() => void) => {
      if (event === "session/event") firehoseListeners.push(listener);
      return () => undefined;
    },
  };

  return {
    created,
    followups,
    cancels,
    sections,
    questionHandlers,
    restrictions: tools.restrictions,
    setGlobalNames(replacement: () => string[]): void {
      globalNames = replacement;
    },
    kernelDisposeCalls(): number {
      return kernelDisposeCalls;
    },
    emit(sessionId: string, event: FakeSessionEvent): void {
      for (const listener of [...firehoseListeners]) listener({ id: sessionId }, event);
    },
    surface(mcpBridgeConfigured = true): EphemeralKernelSurface {
      return {
        ctx: ctx as unknown as Context,
        globalToolNames: () => globalNames(),
        mcpBridgeConfigured,
      };
    },
  };
}

type FakeWorld = ReturnType<typeof createFakeWorld>;

const ALL_ALLOWLIST = DISTILL_READONLY_TOOL_NAMES;

function sessionOf(world: FakeWorld) {
  return world.created[0]?.sessionId ?? "";
}

/** helper：等一个微任务拍（auto-dispose 的 fire-and-forget 落地）。 */
async function microtasks(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/* ------------------------------------------------------------------ */
/* fake-surface 逻辑矩阵                                                */
/* ------------------------------------------------------------------ */

describe("ephemeral distill session — fake kernel surface (task 1.3a)", () => {
  it("filters the tool surface to exactly the three scoped readonly names (deny-all baseline)", async () => {
    const world = createFakeWorld();
    const session = await createEphemeralSession(world.surface(), {
      systemPrompt: "sys",
      toolAllowlist: ALL_ALLOWLIST,
    });
    expect([...session.listTools()].sort()).toEqual([...ALL_ALLOWLIST].sort());
    // 负面钉死：propose/distill 变体、通用行、ask-user 全部不可见（K 负测试）。
    for (const name of session.listTools()) {
      expect(name).not.toMatch(/_propose$/);
      expect(name).not.toMatch(/distill/);
    }
    expect(session.listTools()).not.toContain("ask_user_question");
    expect(session.listTools()).not.toContain("bash");
    expect(session.listTools()).not.toContain("subagent");
    // restrict 以 keep-only allow 落在 agent scope（deny-all 基线 = allow 白名单）。
    expect(world.restrictions).toEqual([{ allow: [...ALL_ALLOWLIST] }]);
    await session.dispose();
  });

  it("rejects creation for a name outside the closed union before publishing any session", async () => {
    const world = createFakeWorld();
    await expect(
      createEphemeralSession(world.surface(), {
        systemPrompt: "sys",
        // 编译期不可拼出；运行时以 as 模拟外部输入的闭集外值。
        toolAllowlist: [
          "mcp__skill-creator__wiki_list",
          "mcp__skill-creator__wiki_append_propose" as never,
        ],
      }),
    ).rejects.toMatchObject({
      code: "DISTILL_TOOL_UNREGISTERED",
      name: "EphemeralSessionError",
    });
    expect(world.created).toHaveLength(0);
  });

  it("rejects an empty allowlist at creation (fail closed, no session)", async () => {
    const world = createFakeWorld();
    await expect(
      createEphemeralSession(world.surface(), { systemPrompt: "sys", toolAllowlist: [] }),
    ).rejects.toMatchObject({ code: "DISTILL_TOOL_UNREGISTERED" });
    expect(world.created).toHaveLength(0);
  });

  it("rejects creation immediately when the kernel has no MCP bridge composed", async () => {
    const world = createFakeWorld();
    await expect(
      createEphemeralSession(world.surface(false), {
        systemPrompt: "sys",
        toolAllowlist: ALL_ALLOWLIST,
      }),
    ).rejects.toMatchObject({ code: "DISTILL_BRIDGE_NOT_READY" });
    expect(world.created).toHaveLength(0);
  });

  it("rejects creation typed when the bridge does not become ready within the deadline", async () => {
    const world = createFakeWorld();
    world.setGlobalNames(() => ["mcp__skill-creator__wiki_list"]);
    const failure = createEphemeralSession(world.surface(), {
      systemPrompt: "sys",
      toolAllowlist: ALL_ALLOWLIST,
      bridgeReadyTimeoutMs: 60,
    });
    await expect(failure).rejects.toBeInstanceOf(EphemeralSessionError);
    await expect(failure).rejects.toMatchObject({ code: "DISTILL_BRIDGE_NOT_READY" });
    expect(world.created).toHaveLength(0);
  });

  it("re-checks the live registry after the bridge wait (TOCTOU fail-closed)", async () => {
    const world = createFakeWorld();
    let reads = 0;
    world.setGlobalNames(() => {
      reads += 1;
      // 第一次读（bridge 等待）全名在场；第二次读（逐一比对）丢了 scopes。
      return reads <= 1
        ? [...ALL_ALLOWLIST]
        : ALL_ALLOWLIST.filter((name) => name !== "mcp__skill-creator__wiki_scopes");
    });
    await expect(
      createEphemeralSession(world.surface(), {
        systemPrompt: "sys",
        toolAllowlist: ALL_ALLOWLIST,
      }),
    ).rejects.toMatchObject({ code: "DISTILL_TOOL_UNREGISTERED" });
    expect(world.created).toHaveLength(0);
  });

  it("composes an isolated scope: origin=subagent, complete system-prompt section, no preset rows", async () => {
    const world = createFakeWorld();
    await createEphemeralSession(world.surface(), {
      systemPrompt: "DISTILL COGNITION PROMPT",
      toolAllowlist: ALL_ALLOWLIST,
      agentOptions: { provider: "p", model: "m", reasoningEffort: "high" },
    });
    expect(world.created).toHaveLength(1);
    expect(world.created[0]?.sessionId.startsWith("distill-")).toBe(true);
    expect(world.created[0]?.meta).toEqual({ origin: "subagent" });
    expect(world.created[0]?.agentOptions).toEqual({
      provider: "p",
      model: "m",
      reasoningEffort: "high",
    });
    expect(world.sections).toEqual([
      {
        name: "ephemeral-distill-system-prompt",
        order: 0,
        text: "DISTILL COGNITION PROMPT",
        complete: true,
      },
    ]);
    // user-questions 红线：无人类面，结构化空答案（绝不挂起）。
    expect(world.questionHandlers).toHaveLength(1);
    await expect(world.questionHandlers[0]?.()).resolves.toEqual({ answers: [] });
  });

  it("resolves prompt with the final assistant text on turn/end(completed)", async () => {
    const world = createFakeWorld();
    const session = await createEphemeralSession(world.surface(), {
      systemPrompt: "sys",
      toolAllowlist: ALL_ALLOWLIST,
    });
    const settled = session.prompt("corpus prompt");
    expect(world.followups).toHaveLength(1);
    const content = (world.followups[0] as { content?: Array<{ type?: string; text?: string }> })
      .content;
    expect(content?.some((block) => block.type === "text" && block.text === "corpus prompt")).toBe(
      true,
    );
    // 多步轮：最后一条非空 assistant 消息 = 终文本。
    world.emit(sessionOf(world), {
      seq: 1,
      type: "assistant/message",
      data: {
        message: { source: { kind: "assistant" }, content: [{ type: "text", text: "draft" }] },
      },
    });
    world.emit(sessionOf(world), {
      seq: 2,
      type: "assistant/message",
      data: {
        message: { source: { kind: "assistant" }, content: [{ type: "text", text: "final json" }] },
      },
    });
    world.emit(sessionOf(world), {
      seq: 3,
      type: "turn/end",
      data: { turn: 1, reason: { kind: "completed" } },
    });
    await expect(settled).resolves.toEqual({ text: "final json" });
    await session.dispose();
  });

  it("rejects prompt typed DISTILL_TIMEOUT on deadline, cancels the turn, and auto-disposes", async () => {
    const world = createFakeWorld();
    const session = await createEphemeralSession(world.surface(), {
      systemPrompt: "sys",
      toolAllowlist: ALL_ALLOWLIST,
    });
    await expect(session.prompt("x", { deadlineMs: 40 })).rejects.toMatchObject({
      code: "DISTILL_TIMEOUT",
    });
    expect(world.cancels).toContainEqual({
      cause: { kind: "hook", reason: "ephemeral-prompt-timeout" },
      options: undefined,
    });
    // K 矩阵：timeout 路径 dispose（调用方 dispose 幂等加入同一次释放）。
    await session.dispose();
    expect(world.kernelDisposeCalls()).toBe(1);
    expect(session.listTools()).toEqual([]);
  });

  it("rejects prompt typed DISTILL_CANCELLED on signal abort, and auto-disposes", async () => {
    const world = createFakeWorld();
    const session = await createEphemeralSession(world.surface(), {
      systemPrompt: "sys",
      toolAllowlist: ALL_ALLOWLIST,
    });
    const controller = new AbortController();
    const settled = session.prompt("x", { signal: controller.signal, deadlineMs: 5_000 });
    setTimeout(() => controller.abort(), 20);
    await expect(settled).rejects.toBeInstanceOf(EphemeralSessionError);
    await expect(settled).rejects.toMatchObject({ code: "DISTILL_CANCELLED" });
    expect(world.cancels).toContainEqual({ cause: { kind: "user" }, options: undefined });
    await session.dispose();
    expect(world.kernelDisposeCalls()).toBe(1);
  });

  it("maps non-completed turn ends to typed failures (failed → DISTILL_TURN_FAILED)", async () => {
    const world = createFakeWorld();
    const session = await createEphemeralSession(world.surface(), {
      systemPrompt: "sys",
      toolAllowlist: ALL_ALLOWLIST,
    });
    const settled = session.prompt("x");
    world.emit(sessionOf(world), {
      seq: 1,
      type: "turn/end",
      data: { turn: 1, reason: { kind: "failed", error: { code: "UNKNOWN" } } },
    });
    await expect(settled).rejects.toMatchObject({ code: "DISTILL_TURN_FAILED" });
    await session.dispose();
  });

  it("maps externally aborted turn ends to typed DISTILL_CANCELLED", async () => {
    const world = createFakeWorld();
    const session = await createEphemeralSession(world.surface(), {
      systemPrompt: "sys",
      toolAllowlist: ALL_ALLOWLIST,
    });
    const settled = session.prompt("x");
    world.emit(sessionOf(world), {
      seq: 1,
      type: "turn/end",
      data: { turn: 1, reason: { kind: "aborted", reason: { kind: "user" } } },
    });
    await expect(settled).rejects.toMatchObject({ code: "DISTILL_CANCELLED" });
    await session.dispose();
  });

  it("dispose is bounded and forces kernel-side release when handle dispose hangs", async () => {
    const world = createFakeWorld({ hangKernelDispose: true });
    const session = await createEphemeralSession(world.surface(), {
      systemPrompt: "sys",
      toolAllowlist: ALL_ALLOWLIST,
    });
    const startedAt = Date.now();
    await session.dispose({ deadlineMs: 40 });
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(world.kernelDisposeCalls()).toBe(1);
    expect(world.cancels).toContainEqual({ cause: { kind: "disposed" }, options: undefined });
    expect(session.listTools()).toEqual([]);
  });

  it("dispose is idempotent: repeat and concurrent calls share one release", async () => {
    const world = createFakeWorld();
    const session = await createEphemeralSession(world.surface(), {
      systemPrompt: "sys",
      toolAllowlist: ALL_ALLOWLIST,
    });
    await Promise.all([session.dispose(), session.dispose()]);
    await session.dispose();
    await session.dispose({ deadlineMs: 1_000 });
    expect(world.kernelDisposeCalls()).toBe(1);
  });

  it("stop path: dispose during an in-flight prompt rejects it typed DISTILL_CANCELLED", async () => {
    const world = createFakeWorld();
    const session = await createEphemeralSession(world.surface(), {
      systemPrompt: "sys",
      toolAllowlist: ALL_ALLOWLIST,
    });
    const settled = session.prompt("x", { deadlineMs: 5_000 });
    await session.dispose({ deadlineMs: 500 });
    await expect(settled).rejects.toMatchObject({ code: "DISTILL_CANCELLED" });
    expect(world.kernelDisposeCalls()).toBe(1);
    await microtasks();
  });

  it("guards one-shot misuse: prompt after dispose / concurrent / after completion", async () => {
    const world = createFakeWorld();
    const session = await createEphemeralSession(world.surface(), {
      systemPrompt: "sys",
      toolAllowlist: ALL_ALLOWLIST,
    });
    // 并发 prompt：第二个立即 typed 拒绝。
    const first = session.prompt("a", { deadlineMs: 5_000 });
    await expect(session.prompt("b")).rejects.toMatchObject({ code: "DISTILL_PROMPT_BUSY" });
    world.emit(sessionOf(world), {
      seq: 1,
      type: "turn/end",
      data: { turn: 1, reason: { kind: "completed" } },
    });
    await expect(first).resolves.toEqual({ text: "" });
    // 一次性会话已消耗。
    await expect(session.prompt("c")).rejects.toMatchObject({ code: "DISTILL_PROMPT_BUSY" });
    await session.dispose();
    // dispose 后新 prompt。
    await expect(session.prompt("d")).rejects.toMatchObject({ code: "DISTILL_CANCELLED" });
  });

  it("drops malformed assistant/message payloads without settling (final text survives)", async () => {
    const world = createFakeWorld();
    const session = await createEphemeralSession(world.surface(), {
      systemPrompt: "sys",
      toolAllowlist: ALL_ALLOWLIST,
    });
    const settled = session.prompt("x");
    world.emit(sessionOf(world), { seq: 1, type: "assistant/message", data: "garbage" });
    world.emit(sessionOf(world), {
      seq: 2,
      type: "assistant/message",
      data: { message: { content: [{ type: "text", text: "kept" }] } },
    });
    world.emit(sessionOf(world), { seq: 3, type: "turn/end", data: { turn: 1 } });
    await expect(settled).resolves.toEqual({ text: "kept" });
    await session.dispose();
  });
});

/* ------------------------------------------------------------------ */
/* 真实内核集成（slow boots）                                           */
/* ------------------------------------------------------------------ */

let sandbox = "";

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-kernel-ephemeral-test-"));
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("ephemeral distill session — real kernel (integration)", () => {
  it(
    "creates a session over the real MCP bridge with exactly the three readonly wiki tools",
    { timeout: 240_000 },
    async () => {
      // 形态 A /mcp 端点（真实 WebServer + capability registry；同 task 4.1b 模式）。
      const { createDaemonDomain } = await import("../src/daemon/domain.js");
      const { WebServer } = await import("../src/daemon/web-server.js");
      const { setHomeOverride } = await import("../src/shared/paths.js");
      const { randomBytes } = await import("node:crypto");
      const { bootDshKernel } = await import("../src/daemon/kernel/dsh-kernel.js");
      const isolatedHome = path.join(sandbox, "state");
      process.env.SKILL_CREATOR_HOME = isolatedHome;
      setHomeOverride(isolatedHome);
      const domain = createDaemonDomain();
      const webuiDir = path.join(sandbox, "webui");
      fs.mkdirSync(webuiDir, { recursive: true });
      fs.writeFileSync(path.join(webuiDir, "index.html"), "<!doctype html><title>M</title>");
      const token = randomBytes(24).toString("base64url");
      const web = new WebServer({
        webToken: token,
        webuiDir,
        domain,
        status: () => ({
          active: true,
          pid: process.pid,
          version: "test",
          port: 0,
          startedAt: Date.now(),
          tray: "headless",
        }),
      });
      const port = await web.start(0);
      const { createSkillCreatorMcpServer } =
        await import("../src/daemon/mcp/skill-creator-mcp.js");
      web.mountMcp(() =>
        createSkillCreatorMcpServer({
          capabilities: domain.managerCapabilities,
          face: "in-process",
        }),
      );
      let kernel: DshKernelHandle | undefined;
      try {
        kernel = await bootDshKernel({
          home: path.join(sandbox, "dsh-home"),
          mcp: { url: `http://127.0.0.1:${port}/mcp`, token },
        });
        // bridge 先就绪（同 4.1b 轮询模式），再走 ephemeral 面。
        for (let attempt = 0; attempt < 30; attempt += 1) {
          const ready = DISTILL_READONLY_TOOL_NAMES.every((name) =>
            kernel.globalToolNames().includes(name),
          );
          if (ready) break;
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
        const session = await kernel.createEphemeralSession({
          systemPrompt: "You distill wiki patterns; output JSON only.",
          toolAllowlist: DISTILL_READONLY_TOOL_NAMES,
        });
        try {
          const tools = session.listTools();
          expect([...tools].sort()).toEqual([...DISTILL_READONLY_TOOL_NAMES].sort());
          // 负面钉死：真实注册面上的 propose/distill 不可见（listTools 恰三个
          // 已由上式保证；此处冗余断言便于失败诊断）。
          for (const name of tools) {
            expect(name).not.toMatch(/_propose$/);
            expect(name).not.toMatch(/distill/);
          }
        } finally {
          await session.dispose({ deadlineMs: 10_000 });
        }
      } finally {
        if (kernel) await kernel.dispose().catch(() => undefined);
        await web.stop({ graceMs: 0 });
        await domain.repository.dispose();
        await domain.steward.dispose();
        setHomeOverride(null);
      }
    },
  );

  it(
    "fails closed immediately on a kernel without the MCP bridge",
    { timeout: 180_000 },
    async () => {
      const { bootDshKernel } = await import("../src/daemon/kernel/dsh-kernel.js");
      const kernel: DshKernelHandle = await bootDshKernel({
        home: path.join(sandbox, "dsh-home"),
      });
      try {
        await expect(
          kernel.createEphemeralSession({
            systemPrompt: "sys",
            toolAllowlist: DISTILL_READONLY_TOOL_NAMES,
            bridgeReadyTimeoutMs: 200,
          }),
        ).rejects.toMatchObject({ code: "DISTILL_BRIDGE_NOT_READY" });
      } finally {
        await kernel.dispose().catch(() => undefined);
      }
    },
  );
});
