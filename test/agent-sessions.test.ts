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

function makeService(): AgentSessionsService {
  return createAgentSessionsService({
    kernel: () => kernel,
    modelSelection: async () => ({
      provider: "deepseek-official",
      model: "deepseek-v4-flash",
    }),
    retention: 50,
  });
}

describe("agent sessions over the headless kernel (task 2.2)", () => {
  it("returns typed UNAVAILABLE before the kernel is attached", () => {
    service = makeService();
    expect(() => service!.list()).toThrowError(/kernel is not mounted/);
    expect(() => service!.prompt("agent-x", "hi")).toThrowError(/not found/);
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

      // 游标语义：afterSeq = 最新帧 seq 后不再返回旧帧。
      const maxSeq = Math.max(...first.frames.map((frame) => frame.seq));
      const drained = service.stream(session.sessionId, maxSeq, 50);
      expect(drained.frames).toEqual([]);

      // prompt 幂等路径 + cancel 不抛。
      service.prompt(session.sessionId, "second turn");
      expect(() => service.cancel(session.sessionId)).not.toThrow();
      expect(() => service.cancel(session.sessionId)).not.toThrow();

      // 未知会话 typed NOT_FOUND。
      expect(() => service.prompt("agent-missing", "x")).toThrowError(/not found/);
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
});
