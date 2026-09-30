/**
 * 用户原始需求 [2026-09-30]：「webui 里面还有一些残留的未完成的工作，比如 skill
 * 测试与评估」（creator-test-session A3：探针模板协议）。
 *
 * 正交意图：
 *   [1] probe-recall-v1 模板常量：ID/版本/正文逐字冻结（openspec change design
 *       A3）；占位符 ${skillName} 纯文本替换。用户编辑的是最终 prompt；模板
 *       版本随 seed 元数据落档——正文可改，协议不可变。
 */

/** 探针模板（可复现协议体；与 openspec/changes/creator-test-session/design.md 逐字一致）。 */
export const PROBE_RECALL_V1 = {
  id: "probe-recall-v1",
  version: 1,
  /** 渲染最终 prompt（占位符纯文本替换；无模板引擎；渲染输出含 `$name` token——
   * 芯片出现配对按 token 在文中匹配，正文必须携带 `$` 前缀）。 */
  render(skillName: string): string {
    return `请阅读引用的技能文档（$${skillName} 芯片）。然后：
1. 复述该技能的触发条件与适用场景；
2. 列出它声明提供的工具与参考文件；
3. 给出一个你会使用它的典型任务示例。`;
  },
} as const;

/** seedAgentTestRun 的输入形状（codex r5 P1：模板 ID/version 与 seed 输入同源
 * 冻结——webui 内部面；跨 wire 的部分由 AgentSessionSeedMetadata 契约承载）。 */
export interface CreatorTestSeedInput {
  text: string;
  skill: { workspaceId: string; providerId: string; skillId: string };
  skillName: string;
  revision: string;
  templateId: typeof PROBE_RECALL_V1.id;
  templateVersion: typeof PROBE_RECALL_V1.version;
}
