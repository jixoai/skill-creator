/**
 * Skill Steward check/optimize/organize 任务模板。
 *
 * 用户原始需求 [2026-09-06]（openspec skill-steward-contracts task 1.4）：
 * 「编写版本化专属 system prompt 与 check/optimize/organize 模板。」
 * 设计约束：模板固定领域工具 allowlist、证据格式、审批边界与 no-direct-write 规则；
 * 模板与 system prompt 一起写入 run record（版本化追溯）。
 * DSH 边界：本阶段不依赖 DSH；模板为纯文本，后续由 DSH 阶段作为 user turn 注入。
 *
 * 正交意图：
 *   [1] 三类任务的确定性 user turn 文本（目标 + 允许的 action + 输出要求）。
 *   [2] 快照摘要投影：只传身份/revision/大小，不重发全文（全文在快照内）。
 */
import type {
  SkillStewardContextSnapshot,
  SkillStewardTask,
  TaskBindFailure,
} from "../../shared/contracts/skill-steward.js";
import {
  SKILL_STEWARD_CONTRACT_VERSION,
  bindTaskToSnapshot,
} from "../../shared/contracts/skill-steward.js";
import { STEWARD_PROMPT_VERSION, STEWARD_TOOL_VERSION } from "./prompts.js";

/** 模板渲染输入：任务 + 其绑定的不可变快照。 */
export interface StewardTaskTemplateInput {
  task: SkillStewardTask;
  snapshot: SkillStewardContextSnapshot;
}

/** 快照摘要（user turn 头部；正文内容 Agent 通过 skills.inspect 获取）。 */
function snapshotSummary(snapshot: SkillStewardContextSnapshot): string {
  const lines = snapshot.skills.map(
    (skill) =>
      `- ${skill.skillId} · ${skill.directoryName} · revision ${skill.revision} · ${skill.disabled ? "disabled" : "enabled"} · ${skill.byteSize}B`,
  );
  return [
    `Snapshot ${snapshot.id} (${snapshot.scopeKind} scope, target ${snapshot.target.workspaceId}/${snapshot.target.providerId})`,
    ...lines,
    snapshot.resources.length > 0
      ? `Resources manifest: ${snapshot.resources.length} entries`
      : "Resources manifest: empty",
  ].join("\n");
}

/** 每类任务允许的 proposal action（Global scope 的 disable-only 由 bind 层强制）。 */
const TASK_ALLOWED_ACTIONS: Record<SkillStewardTask["kind"], string> = {
  check: "disable (only with evidence of a concrete problem); findings preferred over proposals",
  optimize: "edit (full replacement documents for the selected skills)",
  organize: "split (one source, >=2 new targets) and merge (>=2 sources, one new target)",
};

/** 渲染 check 任务 user turn。 */
function renderCheck(input: StewardTaskTemplateInput): string {
  return [
    "## Task: check",
    "",
    "Inspect the snapshot skills for duplicate names or triggers, mutually exclusive rules,",
    "shared resource paths, missing descriptions, empty bodies, and wide trigger surfaces.",
    "Report every issue as a finding with evidence. Propose disable only when the evidence",
    "shows a concrete problem; when uncertain, emit a question or terminal needs-review.",
  ].join("\n");
}

/** 渲染 optimize 任务 user turn。 */
function renderOptimize(input: StewardTaskTemplateInput): string {
  return [
    "## Task: optimize",
    "",
    "Improve the selected skills' descriptions and bodies: keep behavior, remove ambiguity,",
    "tighten over-broad triggers. Emit edit proposals carrying the complete replacement",
    "frontmatter and body per skill, referencing exact snapshot revisions. Preserve unknown",
    "legal frontmatter fields; do not invent new file paths.",
  ].join("\n");
}

/** 渲染 organize 任务 user turn。 */
function renderOrganize(input: StewardTaskTemplateInput): string {
  return [
    "## Task: organize",
    "",
    "Restructure the selected skills: split one overloaded skill into focused targets, or",
    "merge fragmented skills covering one responsibility. Every target needs a safe lowercase",
    "directory name, complete frontmatter and body, and an explicit resource mapping for",
    "each copied/moved/referenced file. Sources keep their directories and are disabled only",
    "after validation. Name unresolved resource conflicts as findings instead of guessing.",
  ].join("\n");
}

/**
 * 组装完整 user turn：版本头 + 快照摘要 + 任务正文 + 输出约束。
 * Codex R2 P2-4：渲染入口强制 bindTaskToSnapshot——错配 task 不得渲染成 user turn
 * （返回类型化失败；调用方把失败投影为 run 失败，而不是吞掉身份漂移）。
 */
export function renderStewardTaskTurn(
  input: StewardTaskTemplateInput,
): { ok: true; text: string } | { ok: false; failure: TaskBindFailure } {
  const bound = bindTaskToSnapshot(input.task, input.snapshot);
  if (!bound.ok) return { ok: false, failure: bound.failure };
  const { task } = input;
  const body =
    task.kind === "check"
      ? renderCheck(input)
      : task.kind === "optimize"
        ? renderOptimize(input)
        : renderOrganize(input);
  const text = [
    `Contract ${SKILL_STEWARD_CONTRACT_VERSION} · prompt ${STEWARD_PROMPT_VERSION} · tools ${STEWARD_TOOL_VERSION}`,
    "",
    snapshotSummary(input.snapshot),
    "",
    `Selected skills: ${task.skillIds.join(", ")}`,
    task.instructions ? `Operator instructions: ${task.instructions}` : "",
    "",
    body,
    "",
    `Allowed proposal actions for this task: ${TASK_ALLOWED_ACTIONS[task.kind]}.`,
    "Output only SkillStewardResponse events. Every proposal must carry contractVersion,",
    "snapshotId, exact snapshot revisions, and at least one evidence locator. The Manager",
    "validates and a human approves; you never write files.",
  ]
    .filter((line) => line !== "")
    .join("\n");
  return { ok: true, text };
}
