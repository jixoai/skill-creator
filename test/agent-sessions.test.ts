/**
 * 内核 agent 会话服务集成测试（dsh-kernel-rebase task 2.2）。
 *
 * 用户原始需求 [2026-09-08]：「我们可以简单理解成，我们在 skill creator 的右侧
 * 嵌入了一个聊天对话框。」——面板会话经内核 ctx.agents 驱动：create → prompt →
 * stream 轮询 → cancel 的全链（无凭据环境下 LLM 调用失败仍是类型化事件流，
 * 管道连通性不依赖真实 provider）。
 *
 * 正交意图：
 *   [1] 生命周期：create 返回产品 preset 会话；prompt accepted；cancel 幂等；
 *       内核未挂载时 typed UNAVAILABLE。
 *   [2] stream 投影：prompt 后 firehose 产出帧（turn-start 至少出现；脱敏）。
 * 妥协声明：断言不依赖 LLM 成功——无凭据时 turn 以 error 结束同样产生帧。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootDshKernel, type DshKernelHandle } from "../src/daemon/kernel/dsh-kernel.js";
import {
  createAgentSessionsService,
  type AgentSessionsService,
} from "../src/daemon/kernel/agent-sessions.js";
import { createSessionTranscripts } from "../src/daemon/kernel/session-transcripts.js";

let sandbox = "";
let kernel: DshKernelHandle | null = null;
let service: AgentSessionsService | null = null;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "agent-sessions-test-"));
});

afterEach(async () => {
  await service?.dispose().catch(() => undefined);
  service = null;
  await kernel?.dispose().catch(() => undefined);
  kernel = null;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function makeService(transcriptsRoot?: string): AgentSessionsService {
  return createAgentSessionsService({
    kernel: () => kernel,
    modelSelection: async () => ({
      provider: "deepseek-official",
      model: "deepseek-v4-flash",
    }),
    retention: 50,
    transcripts: createSessionTranscripts(transcriptsRoot ?? path.join(sandbox, "transcripts")),
  });
}

describe("agent sessions over the headless kernel (task 2.2)", () => {
  it("returns typed UNAVAILABLE before the kernel is attached", () => {
    service = makeService();
    expect(() => service!.list()).toThrowError(/kernel is not mounted/);
    // stream 走 live → 转录回退，不触内核：未知会话仍是 NOT_FOUND。
    expect(() => service!.stream("agent-x", 0, 5)).toThrowError(/not found/);
    // prompt 的复活路径先过 requireKernel（异步面）。
    void expect(service!.prompt("agent-x", "hi")).rejects.toThrowError(/kernel is not mounted/);
  });

  it(
    "creates a product-preset session, prompts it, observes frames, and cancels",
    { timeout: 180_000 },
    async () => {
      kernel = await bootDshKernel({ home: path.join(sandbox, "dsh-home") });
      service = makeService();
      service.attach(kernel);

      const session = await service.create({
        cwd: sandbox,
        prompt: "hello from the panel test",
      });
      expect(session.sessionId).toMatch(/^agent-/);
      expect(session.status).toMatch(/idle|running/);
      expect(session.cwd).toBe(sandbox);

      // list 包含新会话。
      const listed = service.list();
      expect(listed.find((item) => item.sessionId === session.sessionId)).toBeDefined();

      // prompt 后 firehose 至少产出一帧（无凭据环境 turn 会以失败收尾，仍投影）。
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const first = service.stream(session.sessionId, 0, 50);
      expect(first.status).toMatch(/idle|running/);
      expect(first.frames.length).toBeGreaterThan(0);

      // user/message 投影：真实人类输入产出 user-text 帧（切换会话后重建消息列表
      // 的唯一用户消息来源）；内核 system-reminder/runtime 注入无 user source，不进对话流。
      const userFrames = first.frames.filter((frame) => frame.kind === "user-text");
      expect(userFrames.map((frame) => frame.text)).toContain("hello from the panel test");
      for (const frame of userFrames) {
        expect(frame.text).not.toContain("<system-reminder>");
      }

      // 游标语义：afterSeq = 最新帧 seq 后不再返回旧帧。
      const maxSeq = Math.max(...first.frames.map((frame) => frame.seq));
      const drained = service.stream(session.sessionId, maxSeq, 50);
      expect(drained.frames).toEqual([]);

      // prompt 幂等路径 + cancel 不抛（prompt 已异步化——复活路径需要 await）。
      await service.prompt(session.sessionId, "second turn");
      expect(() => service.cancel(session.sessionId)).not.toThrow();
      expect(() => service.cancel(session.sessionId)).not.toThrow();

      // 未知会话 typed NOT_FOUND。
      await expect(service.prompt("agent-missing", "x")).rejects.toThrowError(/not found/);
      expect(() => service.stream("agent-missing", 0, 10)).toThrowError(/not found/);
    },
  );

  it(
    "keeps frames redacted: no credential-shaped values leak into stream payloads",
    { timeout: 180_000 },
    async () => {
      kernel = await bootDshKernel({ home: path.join(sandbox, "dsh-home") });
      service = makeService();
      service.attach(kernel);
      const session = await service.create({ cwd: sandbox, prompt: "reply with hi" });
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const { frames } = service.stream(session.sessionId, 0, 50);
      const serialized = JSON.stringify(frames);
      // 真实 API key 形状（"sk-" 是 "skill-" 的子串，不能作宽断言）。
      expect(serialized).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
      expect(serialized).not.toContain('"apiKey"');
    },
  );

  it(
    "survives a daemon restart: transcript replay plus kernel resume continuation",
    { timeout: 240_000 },
    async () => {
      const dshHome = path.join(sandbox, "dsh-home");
      const transcriptsRoot = path.join(sandbox, "transcripts");
      // 第一进程：创建 + prompt + 等帧落盘。
      kernel = await bootDshKernel({ home: dshHome });
      service = makeService(transcriptsRoot);
      service.attach(kernel);
      const session = await service.create({
        cwd: sandbox,
        prompt: "restart persistence probe: reply with one word",
      });
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // 转录目录按 YYYY/MM/DD/<sessionId> 归类落盘。
      const metaPath = fs
        .readdirSync(path.join(transcriptsRoot), { recursive: true })
        .filter((entry) => typeof entry === "string" && entry.endsWith("meta.json"))
        .map((entry) => path.join(transcriptsRoot, entry))
        .find((entry) => entry.includes(session.sessionId));
      expect(metaPath).toBeDefined();

      // 模拟重启：service + kernel 全部销毁后以同一持久层重建。
      await service.dispose();
      service = null;
      await kernel.dispose();
      kernel = null;
      kernel = await bootDshKernel({ home: dshHome });
      service = makeService(transcriptsRoot);
      service.attach(kernel);

      // list 包含持久会话（disposed），stream 从转录回放（user 消息在内）。
      const listed = service.list();
      expect(listed.find((item) => item.sessionId === session.sessionId)).toMatchObject({
        status: "disposed",
      });
      const replay = service.stream(session.sessionId, 0, 100);
      expect(replay.status).toBe("disposed");
      expect(replay.frames.map((frame) => frame.kind)).toContain("user-text");
      const maxSeq = Math.max(...replay.frames.map((frame) => frame.seq));

      // 续聊：prompt 触发内核 resume 复活，新帧 seq 从转录末尾继续。
      await service.prompt(session.sessionId, "continue after restart: one word again");
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const after = service.stream(session.sessionId, maxSeq, 100);
      expect(after.status).toMatch(/idle|running/);
      expect(after.frames.length).toBeGreaterThan(0);
      expect(after.frames[0]!.seq).toBe(maxSeq + 1);
      // 复活后的新 user 帧也写回同一转录。
      const reread = service.stream(session.sessionId, 0, 500);
      expect(
        reread.frames.some(
          (frame) =>
            frame.kind === "user-text" && frame.text === "continue after restart: one word again",
        ),
      ).toBe(true);
    },
  );
});
