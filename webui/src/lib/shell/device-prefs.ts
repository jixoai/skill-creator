/**
 * 用户原始需求 [2026-07-27]：「前端 Storage 只能用来存储和设备有关的一些偏好，比如 Theme」。
 * 修订 [2026-10-03]（webui-i18n-bilingual）：新增 language 偏好（UI 语言，i18n locale store 消费）。
 * 修订 [2026-10-03]（skills-agent-page 1.2/1.7）：新增 Agent 页布局显隐偏好
 * （左树折叠/右面板开关与宽度/终端开关与高度）与 workspace attach 面板开关
 * 与宽度——全部 appearance 域（设备偏好，非 tab session；design §1）。
 * 修订 [2026-10-04]（skills-agent-page-zcode-parity 2.2）：终端高度界对齐 ZCode
 * （140px 下限/50% 动态上界/0 = 自动 ~30% 展开哨兵）。
 * 修订 [2026-10-04]（skills-agent-page-zcode-parity 3.3）：新增右面板展开比例
 * agentRightPanelExpandedRatio（默认 45%/上限 65%，ZCode sidePaneLayout 记忆语义）。
 * 修订 [2026-10-04]（skills-agent-page-zcode-parity 1.3/5.1）：新增 Agent 树
 * 宽度记忆（默认/最小 264px，上限为可用宽度 50%，ZCode WorkspaceShellLayout）。
 * 正交意图：
 *   [1] 定义设备偏好 schema（versioned + zod）。
 *   [2] 统一 localStorage 读写入口（safeParse 降级，incompatible → 默认值）。
 */

import { z } from "zod";

const STORAGE_KEY = "skill-creator:device-prefs";

/** UI 语言（webui-i18n-bilingual）：en 为默认；词典消费见 lib/i18n。 */
export const PREF_LANGUAGE_VALUES = ["en", "zh"] as const;
export type PrefLanguage = (typeof PREF_LANGUAGE_VALUES)[number];

/** Agent 页右扩展面板宽度界（design §1：~320px 可关，可拖）。 */
export const AGENT_RIGHT_PANEL_MIN_WIDTH = 260;
export const AGENT_RIGHT_PANEL_MAX_WIDTH = 560;
/**
 * Agent 页右扩展面板展开比例（skills-agent-page-zcode-parity 3.3；ZCode
 * sidePaneLayout.ts:1 默认 45% / 上限 65%）：关闭保留展开尺寸，重开按比例恢复。
 * 钳制/换算纯函数见 components/agent/extension/side-pane-layout.ts；容器
 * （SkillsAgentPage separator）消费——px 字段并存兼容（接线切换比例制前不
 * 破坏既有持久化）。
 */
export const AGENT_RIGHT_PANEL_DEFAULT_EXPANDED_RATIO = 0.45;
/**
 * Agent 页终端高度界（skills-agent-page-zcode-parity 2.2，对齐 ZCode
 * AnimatedTerminalPanel：minSize 140px / maxSize 50%）。存储上界取宽容静态值；
 * 生效上界 = 分栏容器高的 50%（TerminalDock 动态执行）。高度 0 = 自动哨兵
 * （首开 ~30% 展开默认；用户首次拖拽/键盘定寸后恒 > 0）。
 */
export const AGENT_TERMINAL_MIN_HEIGHT = 140;
export const AGENT_TERMINAL_MAX_HEIGHT = 4096;

/** 设备偏好 schema（当前 v1；均为带默认值加法，旧存量直接通过）。 */
export const DevicePrefsSchema = z.object({
  version: z.literal(1),
  theme: z.enum(["light", "dark", "system"]).default("system"),
  sidebarCollapsed: z.boolean().default(false),
  language: z.enum(PREF_LANGUAGE_VALUES).default("en"),
  /** SkillsAgentPage 左树折叠（<1024 降级时同样生效）。 */
  agentTreeCollapsed: z.boolean().default(false),
  /** SkillsAgentPage 左树展开宽度；运行时按当前主区宽度钳制到 50%。 */
  agentTreeWidth: z.number().int().min(264).max(4096).default(264),
  /** SkillsAgentPage 右扩展面板开关 + 宽度（<1024 转 overlay drawer 时开关语义不变）。 */
  agentRightPanelOpen: z.boolean().default(true),
  agentRightPanelWidth: z
    .number()
    .int()
    .min(AGENT_RIGHT_PANEL_MIN_WIDTH)
    .max(AGENT_RIGHT_PANEL_MAX_WIDTH)
    .default(320),
  /**
   * 右扩展面板展开比例记忆（skills-agent-page-zcode-parity 3.3）：默认 45%、
   * 运行时上限 65%、240px 像素下限（ZCode sidePaneLayout/animatedSidePaneModel；
   * 钳制见 components/agent/extension/side-pane-layout.ts——窄容器下限可超 65%，
   * 像素下限优先）。schema 层静态界 0.15–1 仅防持久化损坏。
   */
  agentRightPanelExpandedRatio: z
    .number()
    .min(0.15)
    .max(1)
    .default(AGENT_RIGHT_PANEL_DEFAULT_EXPANDED_RATIO),
  /** SkillsAgentPage 底部终端容器开关 + 高度（<1024 转 bottom drawer）。高度 0 = 自动哨兵（~30% 展开默认）。 */
  agentTerminalOpen: z.boolean().default(false),
  agentTerminalHeight: z.number().int().min(0).max(AGENT_TERMINAL_MAX_HEIGHT).default(0),
  /** workspace 页右侧 attach 面板（原 shell drawer 迁移面）开关 + 宽度。 */
  workspaceAgentPanelOpen: z.boolean().default(false),
  workspaceAgentPanelWidth: z.number().int().min(320).max(720).default(440),
});
/** 设备偏好。 */
export type DevicePrefs = z.infer<typeof DevicePrefsSchema>;

/** 默认设备偏好。 */
export const DEFAULT_DEVICE_PREFS: DevicePrefs = {
  version: 1,
  theme: "system",
  sidebarCollapsed: false,
  language: "en",
  agentTreeCollapsed: false,
  agentTreeWidth: 264,
  agentRightPanelOpen: true,
  agentRightPanelWidth: 320,
  agentRightPanelExpandedRatio: AGENT_RIGHT_PANEL_DEFAULT_EXPANDED_RATIO,
  agentTerminalOpen: false,
  agentTerminalHeight: 0,
  workspaceAgentPanelOpen: false,
  workspaceAgentPanelWidth: 440,
};

/** 读取设备偏好。incompatible 旧数据 → 默认值（不迁移不报错）。 */
export function readDevicePrefs(): DevicePrefs {
  if (typeof localStorage === "undefined") return { ...DEFAULT_DEVICE_PREFS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_DEVICE_PREFS };
    const parsed = DevicePrefsSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return { ...DEFAULT_DEVICE_PREFS };
    return parsed.data;
  } catch {
    return { ...DEFAULT_DEVICE_PREFS };
  }
}

/** 写入设备偏好（完整覆盖）。 */
export function writeDevicePrefs(prefs: DevicePrefs): void {
  if (typeof localStorage === "undefined") return;
  try {
    const validated = DevicePrefsSchema.parse(prefs);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(validated));
  } catch {
    // safeParse 失败不写入，避免污染存储
  }
}

/** 局部更新设备偏好。 */
export function updateDevicePrefs(patch: Partial<Omit<DevicePrefs, "version">>): DevicePrefs {
  const current = readDevicePrefs();
  const next = { ...current, ...patch, version: 1 as const };
  writeDevicePrefs(next);
  return next;
}
