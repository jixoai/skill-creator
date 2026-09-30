/**
 * finding-propose 模板族（intelligence-proposal-parity C1/C′3；工作计划 Ch4）。
 *
 * 用户原始需求 [2026-09-30]：GOAL 105「edit/disable/split/merge 均从实际 DSH
 * tool calls 形成方案」——四动作统一「经 agent 发起」：面板 seed 携带 finding
 * 上下文与 propose 工具指令；proposal 由 agent tool call 产生。
 *
 * 正交意图：
 *   [1] 四模板正文逐字冻结（与 openspec change design C1 一致；占位符
 *       ${skillName}/${findingId}/${observedRevision} 纯文本替换；不自动发送）。
 */

export type FindingProposeAction = "edit" | "disable" | "split" | "merge";

/** 模板常量（渲染输出含 `$name` token——芯片配对前提，与 probe-recall 同法则）。 */
export const FINDING_PROPOSE_TEMPLATES: Record<
  FindingProposeAction,
  {
    id: string;
    version: 1;
    render: (ctx: { skillName: string; findingId: string; observedRevision: string }) => string;
  }
> = {
  edit: {
    id: "finding-propose-edit-v1",
    version: 1,
    render: ({ skillName, findingId, observedRevision }) =>
      `请针对引用的技能（$${skillName} 芯片）执行 intelligence_propose_edit 工具调用：finding ${findingId}（观察于 revision ${observedRevision}）。依据 finding 证据起草编辑提案（frontmatter 与正文的具体修改逐条列出）；先调用工具，再向我复述提案要点。`,
  },
  disable: {
    id: "finding-propose-disable-v1",
    version: 1,
    render: ({ skillName, findingId, observedRevision }) =>
      `请针对引用的技能（$${skillName} 芯片）执行 intelligence_propose_disable 工具调用：finding ${findingId}（观察于 revision ${observedRevision}）。起草禁用提案并说明恢复路径；先调用工具，再向我复述提案要点。`,
  },
  split: {
    id: "finding-propose-split-v1",
    version: 1,
    render: ({ skillName, findingId, observedRevision }) =>
      `请针对引用的技能（$${skillName} 芯片）执行 intelligence_propose_split 工具调用：finding ${findingId}（观察于 revision ${observedRevision}）。按 finding 指出的职责混同起草拆分提案（目标边界逐条列出）；先调用工具，再向我复述提案要点。`,
  },
  merge: {
    id: "finding-propose-merge-v1",
    version: 1,
    render: ({ skillName, findingId, observedRevision }) =>
      `请针对引用的技能（$${skillName} 芯片）执行 intelligence_propose_merge 工具调用：finding ${findingId}（观察于 revision ${observedRevision}）。按 finding 指出的重复职责起草合并提案（保留主体与吸收项逐条列出）；先调用工具，再向我复述提案要点。`,
  },
};
