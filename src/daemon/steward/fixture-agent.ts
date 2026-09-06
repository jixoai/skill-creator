/**
 * Skill Steward fixture agent（openspec skill-steward-runtime task 2.2）。
 *
 * 用户原始需求 [2026-09-06]（spec）：「Fixture runtime is deterministic … valid,
 * malformed, disconnect, cancel and late-event scripts replay identically twice.」
 * fixture 不是 demo backend：它按生产协议真实调用 Manager 域工具（经 tool registry），
 * 只把「模型」换成确定性脚本，用于验证协议与事务本身。
 *
 * 正交意图：
 *   [1] 确定性场景脚本：valid(check/optimize/organize)/malformed/stale/disconnect/
 *       cancel/late-event/approval-replay，同一 snapshot + scenario 产出逐字节相同的
 *       transcript。
 *   [2] 真实工具面：所有数据获取与 proposal 提交都走 registry.call（principal=agent），
 *       fixture 自身不接触文件系统。
 *   [3] 结构化输出：只 emit SkillStewardResponse；malformed 场景展示被拒路径。
 */
import {
  SKILL_STEWARD_CONTRACT_VERSION,
  type SkillProposal,
  type SkillStewardContextSnapshot,
  type SkillStewardResponse,
  type SkillToolCallResult,
} from "../../shared/contracts/skill-steward.js";
import type { SkillId } from "../../shared/contracts/skills.js";

/** 可注入的确定性场景。 */
export type FixtureScenario =
  | "valid-check"
  | "valid-optimize"
  | "valid-organize"
  | "malformed"
  | "stale"
  | "disconnect"
  | "cancel"
  | "late-event"
  | "approval-replay";

/** fixture agent 与 Manager 的全部交互面（runtime 注入；测试可替换）。 */
export interface FixtureAgentHost {
  /** 调用域工具（principal 固定为 agent）。 */
  callTool(tool: string, input: unknown): Promise<SkillToolCallResult>;
  /** emit 一条结构化响应；terminal 之后的 emit 会被 runtime 丢弃（late-event 场景验证）。 */
  emit(response: SkillStewardResponse): void;
  /** 取消信号；cancel 场景等待其触发。 */
  signal: AbortSignal;
}

/** transcript 条目：emit 的响应或工具调用结果，按发生顺序。 */
export type FixtureTranscriptEntry =
  | { type: "response"; response: SkillStewardResponse }
  | { type: "tool"; tool: string; result: SkillToolCallResult };

/** fixture run 结果。 */
export interface FixtureAgentResult {
  transcript: FixtureTranscriptEntry[];
  terminalReason:
    | "completed"
    | "needs-review"
    | "scope-limit"
    | "failed"
    | "cancelled"
    | "disconnected";
}

/** abort 感知等待。 */
function waitAbortable(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("cancelled"));
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error("cancelled"));
    };
    const cleanup = (): void => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** 从快照确定性构造一个 edit proposal（optimize 场景；stale 场景用 overrideRevision 单点篡改）。 */
function buildDeterministicEditProposal(
  snapshot: SkillStewardContextSnapshot,
  options: { overrideRevision?: string } = {},
): { proposal: SkillProposal } {
  const skill = snapshot.skills[0]!;
  const revision = options.overrideRevision ?? skill.revision;
  const improved = `${skill.content.trim()}\n<!-- steward-optimized ${snapshot.id} -->\n`;
  const frontmatter = {
    name: skill.name,
    description: `${skill.name} maintenance optimized by the skill steward.`,
  };
  return {
    proposal: {
      contractVersion: SKILL_STEWARD_CONTRACT_VERSION,
      action: "edit",
      patch: {
        kind: "edit",
        snapshotId: snapshot.id,
        edits: [
          {
            skillId: skill.skillId,
            expectedRevision: revision,
            frontmatter,
            body: improved.replace(/^---\n[\s\S]*?---\n/, ""),
          },
        ],
      },
      rationale: "Deterministic optimize: description restated with explicit scope.",
      findingIds: [],
      evidence: [{ skillId: skill.skillId, path: "SKILL.md", snippet: skill.content.slice(0, 60) }],
      skillIds: [skill.skillId],
      observedRevisions: [{ skillId: skill.skillId, revision }],
    },
  };
}

/** 从快照确定性构造一个 split proposal（organize 场景）。 */
function buildDeterministicSplitProposal(snapshot: SkillStewardContextSnapshot): {
  proposal: SkillProposal;
} {
  const skill = snapshot.skills[0]!;
  const base = skill.directoryName;
  return {
    proposal: {
      contractVersion: SKILL_STEWARD_CONTRACT_VERSION,
      action: "split",
      patch: {
        kind: "split",
        snapshotId: snapshot.id,
        source: { skillId: skill.skillId, expectedRevision: skill.revision },
        targets: [
          {
            directoryName: `${base}-plan`,
            frontmatter: { name: `${base}-plan`, description: `Plan ${skill.name} work.` },
            body: `# ${base}-plan\n\nPlanning half of ${skill.name}.\n`,
            resources: [],
          },
          {
            directoryName: `${base}-exec`,
            frontmatter: { name: `${base}-exec`, description: `Execute ${skill.name} work.` },
            body: `# ${base}-exec\n\nExecution half of ${skill.name}.\n`,
            resources: [],
          },
        ],
      },
      rationale: "Deterministic organize: split planning from execution.",
      findingIds: [],
      evidence: [{ skillId: skill.skillId, path: "SKILL.md", snippet: skill.content.slice(0, 60) }],
      skillIds: [skill.skillId],
      observedRevisions: [{ skillId: skill.skillId, revision: skill.revision }],
    },
  };
}

/**
 * 执行一个确定性 fixture 场景。任何场景都不会直接写盘：proposal 只经
 * propose 工具进入 draft，apply 永远留给人类审批。
 */
export async function runFixtureAgent(
  scenario: FixtureScenario,
  snapshot: SkillStewardContextSnapshot,
  host: FixtureAgentHost,
): Promise<FixtureAgentResult> {
  const transcript: FixtureTranscriptEntry[] = [];
  const callTool = async (tool: string, input: unknown): Promise<SkillToolCallResult> => {
    const result = await host.callTool(tool, input);
    transcript.push({ type: "tool", tool, result });
    return result;
  };
  const emit = (response: SkillStewardResponse): void => {
    transcript.push({ type: "response", response });
    host.emit(response);
  };
  const done = (
    terminalReason: FixtureAgentResult["terminalReason"],
    message?: string,
  ): FixtureAgentResult => {
    if (
      terminalReason === "completed" ||
      terminalReason === "needs-review" ||
      terminalReason === "scope-limit" ||
      terminalReason === "failed"
    ) {
      emit({ kind: "terminal", reason: terminalReason, ...(message ? { message } : {}) });
    }
    return { transcript, terminalReason };
  };

  emit({ kind: "stage", stage: "started" });

  switch (scenario) {
    case "valid-check": {
      emit({ kind: "stage", stage: "collecting" });
      const context = await callTool("skills.list_context", {});
      if (context.kind !== "ok") return done("failed", "list_context failed");
      const relations = await callTool("skills.relations", {});
      if (relations.kind !== "ok") return done("failed", "relations failed");
      const report = relations.value as {
        findings: Array<{
          kind: string;
          severity: "info" | "warning" | "error";
          message: string;
          skillIds: SkillId[];
          evidence: Array<{ label: string; snippet: string }>;
        }>;
      };
      emit({ kind: "stage", stage: "analyzing" });
      for (const finding of report.findings) {
        const snapshotSkill = snapshot.skills.find((skill) =>
          finding.skillIds.includes(skill.skillId),
        );
        if (!snapshotSkill) continue;
        emit({
          kind: "finding",
          finding: {
            contractVersion: SKILL_STEWARD_CONTRACT_VERSION,
            origin: "deterministic",
            severity: finding.severity,
            category: finding.kind,
            message: finding.message,
            skillIds: finding.skillIds.filter((skillId) =>
              snapshot.skills.some((skill) => skill.skillId === skillId),
            ),
            observedRevisions: snapshot.skills
              .filter((skill) => finding.skillIds.includes(skill.skillId))
              .map((skill) => ({ skillId: skill.skillId, revision: skill.revision })),
            evidence: finding.evidence.map((item, index) => ({
              skillId: snapshot.skills.find((skill) => finding.skillIds.includes(skill.skillId))!
                .skillId,
              path: index === 0 ? "SKILL.md" : undefined,
              snippet: item.snippet,
            })),
          },
        });
      }
      return done("completed");
    }
    case "valid-optimize": {
      const inspect = await callTool("skills.inspect", { skillId: snapshot.skills[0]!.skillId });
      if (inspect.kind !== "ok") return done("failed", "inspect failed");
      emit({ kind: "stage", stage: "proposing" });
      const { proposal } = buildDeterministicEditProposal(snapshot);
      const proposed = await callTool("skills.propose", { proposal });
      if (proposed.kind !== "ok") return done("failed", "propose rejected");
      const proposalId = (proposed.value as { proposalId: string }).proposalId;
      const validation = await callTool("skills.validate_proposal", { proposalId });
      if (validation.kind !== "ok") return done("failed", "validate failed");
      emit({ kind: "proposal", proposal });
      return done("completed", "proposal awaits human approval");
    }
    case "valid-organize": {
      emit({ kind: "stage", stage: "proposing" });
      const { proposal } = buildDeterministicSplitProposal(snapshot);
      const proposed = await callTool("skills.propose", { proposal });
      if (proposed.kind !== "ok") return done("failed", "propose rejected");
      emit({ kind: "proposal", proposal });
      return done("completed", "proposal awaits human approval");
    }
    case "malformed": {
      // 结构不符的 proposal：registry 必须拒绝且不留 draft。
      const proposed = await callTool("skills.propose", {
        proposal: { action: "edit", patch: { kind: "edit" } },
      });
      if (proposed.kind === "ok") return done("failed", "malformed proposal was accepted");
      return done("failed", "malformed proposal rejected as expected");
    }
    case "stale": {
      const { proposal } = buildDeterministicEditProposal(snapshot, {
        overrideRevision: `sha256:${"f".repeat(64)}`,
      });
      const proposed = await callTool("skills.propose", { proposal });
      if (proposed.kind === "ok") return done("failed", "stale proposal was accepted");
      return done("failed", "stale revision rejected as expected");
    }
    case "disconnect": {
      emit({ kind: "stage", stage: "analyzing", note: "connection lost mid-analysis" });
      // 进程级断连：runtime 负责映射为 disconnected 终态（非 done()）。
      return { transcript, terminalReason: "disconnected" };
    }
    case "cancel": {
      emit({ kind: "stage", stage: "analyzing", note: "long analysis" });
      try {
        await waitAbortable(10_000, host.signal);
      } catch {
        return { transcript, terminalReason: "cancelled" };
      }
      return done("completed", "analysis finished");
    }
    case "late-event": {
      const { proposal } = buildDeterministicEditProposal(snapshot);
      const proposed = await callTool("skills.propose", { proposal });
      if (proposed.kind !== "ok") return done("failed", "propose rejected");
      emit({ kind: "proposal", proposal });
      const first = done("completed", "terminal before late events");
      // terminal 之后的 emit：runtime 必须丢弃，不得创建新 draft。
      host.emit({ kind: "stage", stage: "done", note: "late event after terminal" });
      return first;
    }
    case "approval-replay": {
      // agent 试图直接 apply：必须被 principal 边界拒绝（两次都拒）。
      const first = await callTool("skills.apply_proposal", {
        proposalId: "spp_0000000000000001",
      });
      const second = await callTool("skills.apply_proposal", {
        proposalId: "spp_0000000000000001",
      });
      if (first.kind !== "denied" || second.kind !== "denied") {
        return done("failed", "agent apply was not denied");
      }
      return done("completed", "agent apply denied twice as expected");
    }
  }
}
