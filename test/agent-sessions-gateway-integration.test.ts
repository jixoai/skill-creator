/**
 * 真实内核 × 本地网关的六分支 schema 门集成测试（codex R3 阻塞 2）。
 *
 * 用户原始需求 [2026-09-12]：「涉及到 AI 相关的需求测试，使用 BASE_URL:
 * http://localhost:20002/anthropic MODEL_ID: glm-5.3-flash API_KEY: 任意值。
 * 不要污染到本地的 skills，你另外开一个临时文件夹给 AI 去做测试。」
 *
 * 正交意图：
 *   [1] 真实事件不误伤：R3 收紧的六类事件 schema（tool/call 必填 callId+name、
 *       tool/result 必填 message、message 必填非空 content、turn/start 与
 *       agent/status 的 record 门）必须放行 @deepseek-ai/dsh-session 的真实
 *       事件形状——fake kernel 证明不了这一点（codex：不能把 fake 测试升级为
 *       真实内核验收）。
 *   [2] 零丢弃断言：整个真实 turn 期间不得出现任何 dropped-malformed 诊断。
 * 妥协声明：网关是本机开发依赖——探活失败即 describe.skip（CI 无网关自动跳过）；
 * 全程沙箱 DSH home + transcripts 根，不触碰 ~/.skill-creator 与 ~/.dsh。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootDshKernel, type DshKernelHandle } from "../src/daemon/kernel/dsh-kernel.js";
import {
  createAgentSessionsService,
  type AgentSessionsService,
} from "../src/daemon/kernel/agent-sessions.js";
import { createSessionTranscripts } from "../src/daemon/kernel/session-transcripts.js";

const GATEWAY_BASE = "http://localhost:20002/anthropic";
const GATEWAY_MODEL = "glm-5.3-flash";
const GATEWAY_KEY_ENV = "SKILL_CREATOR_LLM_KEY";

/** 网关探活：POST /v1/messages 最小请求，5s 超时（不可达 → 整组 skip）。 */
async function gatewayUp(): Promise<boolean> {
  try {
    const res = await fetch(`${GATEWAY_BASE}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "probe" },
      body: JSON.stringify({
        model: GATEWAY_MODEL,
        max_tokens: 4,
        messages: [{ role: "user", content: "ping" }],
      }),
      signal: AbortSignal.timeout(5000),
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

let sandbox = "";
let kernel: DshKernelHandle | null = null;
let service: AgentSessionsService | null = null;
let warnSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(async () => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "agent-sessions-gateway-"));
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  // context: 沙箱 DSH home：llm-pi-ai 网关路由 + version-1 凭据（同产品桥写入形状）。
  const dshHome = path.join(sandbox, "dsh-home");
  fs.mkdirSync(dshHome, { recursive: true });
  fs.writeFileSync(
    path.join(dshHome, "settings.yaml"),
    [
      "llm-pi-ai:",
      "  providers:",
      "    local-gateway:",
      `      api: anthropic-messages`,
      `      apiKeyEnv: ${GATEWAY_KEY_ENV}`,
      `      baseURL: ${GATEWAY_BASE}`,
      "      models:",
      `        - id: ${GATEWAY_MODEL}`,
    ].join("\n"),
  );
  const credFile = path.join(dshHome, ".credentials.yaml");
  fs.writeFileSync(credFile, `version: 1\nrefs:\n  ${GATEWAY_KEY_ENV}: gateway-probe-key\n`);
  fs.chmodSync(credFile, 0o600);
  process.env[GATEWAY_KEY_ENV] = "gateway-probe-key";
});

afterEach(async () => {
  warnSpy?.mockRestore();
  warnSpy = null;
  await service?.dispose().catch(() => undefined);
  service = null;
  await kernel?.dispose().catch(() => undefined);
  kernel = null;
  delete process.env[GATEWAY_KEY_ENV];
  fs.rmSync(sandbox, { recursive: true, force: true });
});

const gatewayReachable = await gatewayUp();

describe.skipIf(!gatewayReachable)(
  "real kernel through the local gateway: schema gates accept real event shapes (codex R3 阻塞 2)",
  () => {
    it(
      "projects a full tool round with zero dropped-malformed diagnostics",
      { timeout: 180_000 },
      async () => {
        kernel = await bootDshKernel({ home: path.join(sandbox, "dsh-home") });
        const transcriptsRoot = path.join(sandbox, "transcripts");
        service = createAgentSessionsService({
          kernel: () => kernel,
          modelSelection: async () => ({ provider: "local-gateway", model: GATEWAY_MODEL }),
          defaultMode: async () => "free",
          retention: 50,
          transcripts: createSessionTranscripts(transcriptsRoot),
        });
        service.attach(kernel);

        const session = await service.create({
          cwd: sandbox,
          prompt: "placeholder",
        });

        // 有界轮次循环：LLM 是否选择工具是非确定的——逐轮加强指令，最多 3 轮，
        // 直到出现 tool-call（每轮 12s × 10 轮询；网关 flash 模型通常数秒）。
        const prompts = [
          "Use the bash tool to run exactly: echo schema-gate-check — then reply with the output.",
          "Run this bash command with the bash tool now (do not answer without running it): echo schema-gate-check",
          "Invoke the bash tool with command `echo schema-gate-check` and reply with its output.",
        ];
        let frames: ReturnType<AgentSessionsService["stream"]>["frames"] = [];
        for (const prompt of prompts) {
          await service.prompt(session.sessionId, prompt);
          for (let i = 0; i < 10; i++) {
            await new Promise((resolve) => setTimeout(resolve, 12_000));
            const stream = service.stream(session.sessionId, 0, 400);
            frames = stream.frames;
            if (
              frames.some((frame) => frame.kind === "tool-call") &&
              frames.some((frame) => frame.kind === "turn-end")
            ) {
              break;
            }
          }
          if (frames.some((frame) => frame.kind === "tool-call")) break;
        }

        const kinds = frames.map((frame) => frame.kind);
        // 六分支逐项：turn/start、user/message、tool/call、tool/result、
        // assistant/message、turn/end 全部经 schema 门投影为帧。
        for (const kind of [
          "turn-start",
          "user-text",
          "tool-call",
          "tool-result",
          "assistant-text",
          "turn-end",
        ] as const) {
          expect(kinds).toContain(kind);
        }

        const toolCall = frames.find((frame) => frame.kind === "tool-call");
        expect(toolCall).toMatchObject({ toolName: "bash" });
        expect(typeof toolCall?.toolCallId).toBe("string");
        // tool/result 契约化后 text part 恒存在：结果帧必须携带非空 text。
        const toolResult = frames.find((frame) => frame.kind === "tool-result");
        expect(typeof toolResult?.toolCallId).toBe("string");
        expect((toolResult?.text ?? "").length).toBeGreaterThan(0);
        const assistantTextFrames = frames.filter((frame) => frame.kind === "assistant-text");
        for (const frame of assistantTextFrames) {
          expect((frame.text ?? "").length).toBeGreaterThan(0);
        }
        // usage 投影：anthropic-messages 适配器报告 token 计数——至少一个
        // assistant-text（或 reasoning-only）帧携带数值 usage 快照。
        const usageFrames = frames.filter(
          (frame) =>
            (frame.kind === "assistant-text" || frame.kind === "assistant-reasoning") &&
            (frame.payload as { usage?: unknown } | undefined)?.usage !== undefined,
        );
        expect(usageFrames.length).toBeGreaterThan(0);
        // reasoning 帧为模型行为相关（非每轮必有）：出现时必须非空文本。
        for (const frame of frames.filter((f) => f.kind === "assistant-reasoning")) {
          expect((frame.text ?? "").length).toBeGreaterThan(0);
        }

        // 零丢弃：真实事件形状不得被收紧后的 schema 门误伤。
        const dropped =
          warnSpy?.mock.calls
            .map((call) => String(call[0]))
            .filter((line) => line.includes("dropped malformed")) ?? [];
        expect(dropped).toEqual([]);
      },
    );
  },
);
