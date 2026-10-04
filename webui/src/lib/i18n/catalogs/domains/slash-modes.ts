/**
 * 起步方向与 slash mode 命令词典。
 *
 * 正交意图：
 *   [1] 四条 slash action 的菜单描述；
 *   [2] Agent 空态与 Creator capture 引导卡共享的方向 chip 文案。
 */
export const slashModesEn = {
  "slashMenu.cmdGeneral": "Start a general session",
  "slashMenu.cmdCreate": "Start a skill authoring session",
  "slashMenu.cmdManage": "Start a skill library curation session",
  "slashMenu.cmdExplore": "Start a skill source exploration session",
  "agentStartDirections.title": "Start with a direction",
  "agentStartDirections.description":
    "Choose a direction to seed the composer. You can edit it before sending.",
  "agentStartDirections.general": "General",
  "agentStartDirections.create": "Create",
  "agentStartDirections.manage": "Manage",
  "agentStartDirections.explore": "Explore",
  "agentStartDirections.generalCommand": "/general",
  "agentStartDirections.createCommand": "/create",
  "agentStartDirections.manageCommand": "/manage",
  "agentStartDirections.exploreCommand": "/explore",
} as const;

export const slashModesZh: Record<keyof typeof slashModesEn, string> = {
  "slashMenu.cmdGeneral": "开始一个通用会话",
  "slashMenu.cmdCreate": "开始一个创作技能会话",
  "slashMenu.cmdManage": "开始一个整理技能库的会话",
  "slashMenu.cmdExplore": "开始一个探索技能来源的会话",
  "agentStartDirections.title": "从一个方向开始",
  "agentStartDirections.description": "选择一个方向预填 composer，发送前仍可编辑。",
  "agentStartDirections.general": "通用",
  "agentStartDirections.create": "创作",
  "agentStartDirections.manage": "管理",
  "agentStartDirections.explore": "探索",
  "agentStartDirections.generalCommand": "/general",
  "agentStartDirections.createCommand": "/create",
  "agentStartDirections.manageCommand": "/manage",
  "agentStartDirections.exploreCommand": "/explore",
};
