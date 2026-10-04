/**
 * 用户原始需求 [2026-10-05]（Owner 裁决 4b，品味总纲「少即是多」）：「空面板
 * 折叠——ExtensionPanel 空态（无活动 tab）收敛为 ~48px 图标 rail，点击图标
 * 即展开全宽并打开对应 tab」——rail 图标 title/aria 双语（域文件规约见
 * catalogs/domains.ts）。
 * 正交意图：
 *   [1] agent-extension 域词典（en/zh 键成对，keyof 校验齐全）——空态 rail 的
 *       入口 title 与 rail 容器 aria。
 */
export const agentExtensionEn = {
  /** ---------- ExtensionPanel 空态图标 rail（Owner 裁决 4b） ---------- */
  "agentExtension.railAria": "Extension panel entry rail",
  "agentExtension.railOpenApprovals": "Open Approvals",
  "agentExtension.railOpenBashOutput": "Open Shell output",
  "agentExtension.railOpenSubagents": "Open Subagents",
  "agentExtension.railOpenCards": "Open Cards",
};

export const agentExtensionZh: Record<keyof typeof agentExtensionEn, string> = {
  "agentExtension.railAria": "扩展面板入口栏",
  "agentExtension.railOpenApprovals": "打开审批",
  "agentExtension.railOpenBashOutput": "打开 Shell 输出",
  "agentExtension.railOpenSubagents": "打开子代理",
  "agentExtension.railOpenCards": "打开卡片",
};
