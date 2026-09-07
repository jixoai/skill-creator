/**
 * 用户原始需求 [2026-09-06]（openspec agent-steward tasks 1.3/1.8）：「实现 fixture
 * HarnessAdapter；覆盖 prompt、ordered events、cancel、disconnect、early exit、handshake
 * failure 和 daemon stop。」
 * 正交意图：
 *   [1] 提供确定性的进程内 backend：默认按输入 findings 派生一条 disable 推荐 + 一条
 *       message + 一次授权请求，走完整 Manager 管线。
 *   [2] 用可注入 behaviors 脚本化异常路径：handshake 失败、run 失败、进程级断连、
 *       取消敏感性等待。
 *   [3] 与真实 backend 相同的安全边界：不触碰 Provider 文件系统。
 * 妥协声明：fixture 是 backend 的一种（Manager 管线全真实），不是 RPC mock；
 *   生产 daemon 仅在显式 env 开关下注册它。
 */
import { randomBytes } from "node:crypto";
import type { AgentItemKind, Recommendation } from "../../shared/contracts/agent-steward.js";
import { RecommendationSchema } from "../../shared/contracts/agent-steward.js";
import { DomainError } from "../domain-error.js";
import {
  HarnessProcessLostError,
  type HarnessAdapter,
  type HarnessAgentEvent,
  type HarnessEventSink,
  type HarnessPrompt,
  type HarnessRunResult,
} from "./harness-adapter.js";

/** 脚本化行为步骤。 */
export type FixtureBehavior =
  | { type: "message"; text: string }
  | { type: "item"; itemKind: AgentItemKind; text?: string }
  | { type: "permission"; summary: string; detail?: string; decision: "granted" | "denied" }
  | { type: "wait"; ms: number }
  | { type: "recommendations" }
  | { type: "fail"; message: string }
  | { type: "process-lost"; message: string };

/** fixture adapter 可注入配置。 */
export interface FixtureAdapterOptions {
  /** handshake 直接抛 typed unavailable（覆盖 handshake failure 路径）。 */
  handshakeError?: string;
  /** 覆盖能力矩阵版本。 */
  version?: string;
  /** 脚本行为；省略时执行默认推荐流程。 */
  behaviors?: FixtureBehavior[];
}

/** abort 感知的固定等待；取消时抛出。 */
function waitAbortable(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DomainError("INVALID_OPERATION", "Fixture run cancelled."));
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    timer.unref?.();
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DomainError("INVALID_OPERATION", "Fixture run cancelled."));
    };
    const cleanup = (): void => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** 内部可信推荐 id 直接 parse 建立 brand 通道。 */
function brandRecommendationId(id: string): Recommendation["id"] {
  return RecommendationSchema.shape.id.parse(id);
}

/** 从 prompt findings 派生一条 disable 推荐（首个 warning/error finding 的全部技能）。 */
function deriveDefaultRecommendations(prompt: HarnessPrompt): HarnessRunResult["recommendations"] {
  const byId = new Map(prompt.skills.map((skill) => [skill.skillId, skill]));
  const finding = prompt.findings.find((candidate) => candidate.severity !== "info");
  if (!finding) return [];
  const affected = finding.skillIds
    .map((skillId) => byId.get(skillId))
    .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill));
  if (affected.length === 0) return [];
  return [
    {
      id: brandRecommendationId(`rcmd_${randomBytes(8).toString("hex")}`),
      kind: "disable",
      skillIds: affected.map((skill) => skill.skillId),
      rationale: `Fixture backend recommends disabling skills linked to finding ${finding.findingId} (${finding.kind}).`,
      findingIds: [finding.findingId],
      payload: {
        kind: "disable",
        selections: affected.map((skill) => ({
          workspaceId: prompt.target.workspaceId,
          providerId: prompt.target.providerId,
          skillId: skill.skillId,
        })),
        reason: `Agent recommendation from finding ${finding.findingId}.`,
      },
    },
  ];
}

/** 确定性 fixture backend。 */
export function createFixtureHarnessAdapter(options: FixtureAdapterOptions = {}): HarnessAdapter {
  const version = options.version ?? "fixture-1";
  let disposed = false;
  return {
    backendId: "fixture",
    async handshake() {
      if (disposed) {
        throw new DomainError("UNAVAILABLE", "Fixture backend is disposed.");
      }
      if (options.handshakeError) {
        throw new DomainError("UNAVAILABLE", options.handshakeError);
      }
      return {
        backendId: "fixture",
        version,
        streamingEvents: true,
        cancellation: true,
        // 由实际 handler 决定（4.9）：run 的 permission behavior 走
        // sink.permission 等待人类裁决——capability 如实为 true。
        permissionRequests: true,
        executionRoot: "isolated",
      };
    },
    async run(prompt, sink: HarnessEventSink, signal): Promise<HarnessRunResult> {
      if (options.handshakeError) {
        throw new DomainError("UNAVAILABLE", options.handshakeError);
      }
      const behaviors: FixtureBehavior[] = options.behaviors ?? [
        { type: "message", text: `Fixture steward run for ${prompt.skills.length} skills.` },
        {
          type: "permission",
          summary: "Fixture asks to proceed with drafting recommendations.",
          decision: "granted",
        },
        { type: "recommendations" },
      ];
      const result: HarnessRunResult = { recommendations: [], finalMessage: "" };
      for (const behavior of behaviors) {
        if (signal.aborted) {
          throw new DomainError("INVALID_OPERATION", "Fixture run cancelled.");
        }
        switch (behavior.type) {
          case "message":
            sink.emit({ kind: "message", text: behavior.text });
            result.finalMessage = behavior.text;
            break;
          case "item":
            sink.emit({ kind: "item", itemKind: behavior.itemKind, text: behavior.text });
            break;
          case "permission": {
            sink.emit({ kind: "message", text: `Permission requested: ${behavior.summary}` });
            const decision = await sink.permission({
              summary: behavior.summary,
              detail: behavior.detail,
            });
            sink.emit({ kind: "message", text: `Permission ${decision}.` });
            break;
          }
          case "wait":
            await waitAbortable(behavior.ms, signal);
            break;
          case "recommendations": {
            const recommendations = deriveDefaultRecommendations(prompt);
            for (const recommendation of recommendations) {
              sink.emit({ kind: "recommendation", recommendation });
            }
            result.recommendations = recommendations;
            break;
          }
          case "fail":
            throw new DomainError("UNAVAILABLE", behavior.message);
          case "process-lost":
            throw new HarnessProcessLostError(behavior.message);
        }
      }
      return result;
    },
    async dispose() {
      disposed = true;
    },
  };
}

/** 供测试断言 agent 事件顺序的辅助类型。 */
export type { HarnessAgentEvent };
