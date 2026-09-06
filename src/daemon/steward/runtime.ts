/**
 * Skill Steward runtime 宿主（openspec skill-steward-runtime tasks 2.1/2.2/2.4a）。
 *
 * 用户原始需求 [2026-09-06]（spec）：「Run context and history survive restart」
 * 「terminal bounded lifecycle」。runtime 把 fixture（后续 DSH/Codex）agent 的
 * 结构化输出与工具调用装配到 Manager 域工具面之上：
 *   - 只接受 SkillStewardResponse；terminal 之后的迟到事件一律丢弃（不建 draft）。
 *   - disconnect/cancel 映射为显式终态；run 始终有界。
 *   - 每次工具调用经 registry 审计；fixture/adapter 永不接触文件系统。
 *
 * 正交意图：
 *   [1] 确定性 run 执行：scenario + snapshot + registry → transcript + 终态。
 *   [2] 迟到事件与终态边界（late-event 场景的生产语义）。
 *   [3] 后续 DSH/Codex adapter 复用的 host 协议（callTool/emit/signal）。
 */
import type {
  SkillStewardContextSnapshot,
  SkillStewardResponse,
  SkillToolCallResult,
} from "../../shared/contracts/skill-steward.js";
import { createStewardToolRegistry, type StewardProposalSink } from "./tool-registry.js";
import {
  runFixtureAgent,
  type FixtureAgentResult,
  type FixtureScenario,
  type FixtureTranscriptEntry,
} from "./fixture-agent.js";
import type { StewardRunId2 } from "../../shared/contracts/skill-steward.js";

/** runtime run 的输入。 */
export interface FixtureRunInput {
  runId: StewardRunId2;
  scenario: FixtureScenario;
  snapshot: SkillStewardContextSnapshot;
  proposals: StewardProposalSink;
  validate: (proposalId: Parameters<FixtureRunInput["proposals"]["get"]>[0]) => {
    overall: "valid" | "invalid" | "stale";
    checks: Array<{ name: string; status: "passed" | "failed" | "skipped"; detail?: string }>;
  };
  signal?: AbortSignal;
}

/** runtime run 的输出。 */
export interface FixtureRunOutput {
  result: FixtureAgentResult;
  /** 被 runtime 接受的结构化响应（迟到事件不计）。 */
  acceptedResponses: SkillStewardResponse[];
  /** terminal 之后被丢弃的迟到事件（late-event 审计证据）。 */
  droppedLateResponses: SkillStewardResponse[];
  /** 全部工具调用审计记录。 */
  toolCalls: import("../../shared/contracts/skill-steward.js").SkillToolCall[];
}

/** 执行一次确定性 fixture run。 */
export async function runFixtureStewardScenario(input: FixtureRunInput): Promise<FixtureRunOutput> {
  const acceptedResponses: SkillStewardResponse[] = [];
  const droppedLateResponses: SkillStewardResponse[] = [];
  const toolCalls: import("../../shared/contracts/skill-steward.js").SkillToolCall[] = [];
  let terminalReached = false;

  const registry = createStewardToolRegistry({
    runId: input.runId,
    snapshot: input.snapshot,
    proposals: input.proposals,
    validate: input.validate,
    onCall: (call) => toolCalls.push(call),
  });

  const result = await runFixtureAgent(input.scenario, input.snapshot, {
    callTool: (tool, callInput) => registry.call(tool, callInput, "agent"),
    emit: (response) => {
      if (terminalReached) {
        droppedLateResponses.push(response);
        return;
      }
      acceptedResponses.push(response);
      if (response.kind === "terminal") terminalReached = true;
    },
    signal: input.signal ?? new AbortController().signal,
  });

  return {
    result,
    acceptedResponses,
    droppedLateResponses,
    toolCalls,
  };
}

/** 供外部消费的 transcript 视图（确定性：scenario + snapshot 决定全部内容）。 */
export function transcriptOf(output: FixtureRunOutput): FixtureTranscriptEntry[] {
  return output.result.transcript;
}
