/**
 * 用户原始需求 [2026-09-06]（openspec agent-steward）：「provider-neutral HarnessAdapter
 * 和 capability handshake。」「DSH/Codex 作为独立 backend；一次只启用一个，显式选择，
 * 不自动 fallback。」「Agent 只能在隔离 execution root 或 Manager-approved patch context
 * 中工作。」
 * 正交意图：
 *   [1] 声明 provider-neutral 的 adapter 接口：handshake、run、cancel、dispose。
 *   [2] 固定 agent 可见输入（HarnessPrompt）：只读快照 + 隔离 execution root，
 *       不暴露 Provider 真实根或任何 mutation 通道。
 *   [3] 固定 manager 中介的事件/授权回流（HarnessEventSink）。
 * 妥协声明：无——接口层不依赖具体 backend；backend 私有模型在各自 adapter 内折叠。
 */
import type {
  AgentItemKind,
  HarnessCapabilities,
  Recommendation,
  StewardRunId,
} from "../../shared/contracts/agent-steward.js";
import type { FindingId } from "../../shared/contracts/skill-intelligence.js";
import type { SkillId } from "../../shared/contracts/skills.js";
import type { WorkspaceProviderTarget } from "../../shared/contracts/workspaces.js";

/** 提供给 agent 的单技能只读快照。 */
export interface HarnessSkillSnapshot {
  skillId: SkillId;
  name: string;
  directoryName: string;
  revision: string;
  disabled: boolean;
  /** execution root 内的相对路径（daemon 已复制只读副本）。 */
  documentPath: string;
}

/** 提供给 agent 的 finding 摘要（含证据片段）。 */
export interface HarnessFindingSnapshot {
  findingId: FindingId;
  kind: string;
  severity: "info" | "warning" | "error";
  message: string;
  skillIds: SkillId[];
  evidence: string[];
}

/** 一次 run 的 agent 输入；executionRoot 是 agent 唯一可写范围。 */
export interface HarnessPrompt {
  runId: StewardRunId;
  /** run 绑定的 Workspace Provider（opaque ID；不含真实路径）。 */
  target: WorkspaceProviderTarget;
  objective: string;
  /** 隔离执行根（daemon 拥有生命周期；run 结束即回收）。 */
  executionRoot: string;
  skills: HarnessSkillSnapshot[];
  findings: HarnessFindingSnapshot[];
  /**
   * 期望 agent 输出推荐 JSON 的指令文本（backend 无关）。
   * fixture 直接返回结构化推荐；进程型 backend 把它作为 user turn。
   */
  outputContract: string;
}

/** 规范化 agent 事件（daemon 侧再折叠为 RunEvent）。 */
export type HarnessAgentEvent =
  | { kind: "message"; text: string }
  | { kind: "item"; itemKind: AgentItemKind; text?: string }
  | { kind: "recommendation"; recommendation: Recommendation };

/** manager 中介的事件回流；permission 由 Manager 裁决后 resolve。 */
export interface HarnessEventSink {
  emit(event: HarnessAgentEvent): void;
  /** 请求一次性授权；run 被取消时以 denied 收尾。 */
  permission(request: { summary: string; detail?: string }): Promise<"granted" | "denied">;
}

/** adapter run 的成功产出。 */
export interface HarnessRunResult {
  recommendations: Recommendation[];
  /** agent 最终文本（审计/展示；codex 为最后一条 agent message）。 */
  finalMessage: string;
}

/** adapter 主动报告的进程级异常（映射为 disconnected run）。 */
export class HarnessProcessLostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HarnessProcessLostError";
  }
}

/**
 * provider-neutral HarnessAdapter。
 * 安全边界：接口不暴露任何 Provider 根路径或 filesystem mutation；
 * apply 权力完全留在 Manager（steward-service → skillIntelligence）。
 */
export interface HarnessAdapter {
  readonly backendId: "fixture" | "dsh" | "codex";
  /** capability/version handshake；失败必须抛 typed DomainError（UNAVAILABLE）。 */
  handshake(): Promise<HarnessCapabilities>;
  /** 执行一次 agent run；signal abort 后必须停止并清理子进程。 */
  run(
    prompt: HarnessPrompt,
    sink: HarnessEventSink,
    signal: AbortSignal,
  ): Promise<HarnessRunResult>;
  /** daemon stop：有界终止全部由本 adapter 持有的子进程。 */
  dispose(): Promise<void>;
}
