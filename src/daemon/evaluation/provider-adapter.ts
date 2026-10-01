/**
 * provider-model 会话适配器（evaluation-corpus B7；工作计划 Ch3）。
 *
 * codex r4 必修 #4 / r5 生命周期冻结：评估 runner 不依赖 webui store——daemon
 * 进程内经既有 AgentSessionsService（agent.session.* 契约面）驱动内核会话；
 * 与 Ch2 的 webui seed 入口是同一契约面的两个合法调用方。
 *
 * 正交意图：
 *   [1] B7 接口实现：create（含 seed 元数据）/prompt（skill 引用经 daemon 展开）/
 *       readTranscript（stream 轮询至 turn-end 终态 + 帧文本投影）/cancel/versions。
 */
import type { AgentSessionsService } from "../kernel/agent-sessions.js";
import type { ProviderSessionAdapter } from "./service.js";

/** 内核版本实证来源：锁定的 @deepseek-ai family（package.json dependencies）。 */
export const DSH_FAMILY_VERSION = "0.1.6-alpha.1";

/** 产品 prompt 模块版本（评估跑分的可复现性锚点）。 */
export const EVALUATION_PROMPT_VERSION = "evaluation-provider-run-v1";

/** 工具面版本（内核工具行投影的冻结标记）。 */
export const EVALUATION_TOOL_VERSION = "kernel-tools-v1";

export interface ProviderAdapterDeps {
  sessions: AgentSessionsService;
  cwd?: string;
  /** 轮询单步等待（缺省 500ms）；测试可注入快钟。 */
  stepDelayMs?: number;
  /** 轮询步数上限（缺省 240 步 ≈ 2 分钟 @500ms）。 */
  maxSteps?: number;
}

export function createProviderSessionAdapter(deps: ProviderAdapterDeps): ProviderSessionAdapter {
  const stepDelay = deps.stepDelayMs ?? 500;
  const maxSteps = deps.maxSteps ?? 240;
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  return {
    async create(input) {
      const session = await deps.sessions.create({
        ...(deps.cwd !== undefined ? { cwd: deps.cwd } : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata as never } : {}),
      });
      return { sessionId: session.sessionId };
    },
    async prompt(input) {
      await deps.sessions.prompt(
        input.sessionId,
        input.text,
        [],
        [],
        "queue",
        input.references.map((reference) => ({
          kind: "skill" as const,
          workspaceId: reference.workspaceId as never,
          providerId: reference.providerId as never,
          skillId: reference.skillId as never,
        })),
      );
    },
    async readTranscript(sessionId) {
      // B7 终止条件：读到 turn-end（或 status 稳定 idle 且本轮无新帧）。
      // cursor = 已见最大 seq + 1（stream 返回形状不带游标）。
      let cursor = 0;
      let terminal = false;
      for (let step = 0; step < maxSteps; step += 1) {
        const stream = deps.sessions.stream(sessionId, cursor, 400);
        for (const frame of stream.frames) {
          cursor = Math.max(cursor, frame.seq + 1);
        }
        if (stream.frames.some((frame) => frame.kind === "turn-end")) {
          terminal = true;
          break;
        }
        if (stream.status === "idle" && stream.frames.length === 0) {
          terminal = true;
          break;
        }
        await sleep(stepDelay);
      }
      // r6 P1-4：未见终态 = transcript 不完整——半截回复不得进入断言判定。
      // 抛 typed 超时（service 捕获 → error 态 RUNNER_ERROR）并回收会话。
      if (!terminal) {
        deps.sessions.cancel(sessionId);
        throw new Error(
          `provider transcript did not reach turn-end within ${maxSteps} steps (sessionId=${sessionId})`,
        );
      }
      // 投影：依序拼接 user-text/assistant-text/tool-result 的 text 字段。
      const full = deps.sessions.stream(sessionId, 0, 5000);
      return full.frames
        .map((frame) => {
          if (
            frame.kind === "user-text" ||
            frame.kind === "assistant-text" ||
            frame.kind === "tool-result"
          ) {
            return typeof frame.text === "string" ? frame.text : "";
          }
          return "";
        })
        .filter((part) => part.length > 0)
        .join("\n");
    },
    async cancel(sessionId) {
      deps.sessions.cancel(sessionId);
    },
    versions() {
      return {
        promptVersion: EVALUATION_PROMPT_VERSION,
        toolVersion: EVALUATION_TOOL_VERSION,
        dshVersion: DSH_FAMILY_VERSION,
      };
    },
  };
}
