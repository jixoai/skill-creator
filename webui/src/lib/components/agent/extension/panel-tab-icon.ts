/**
 * panel tab 类型 → 图标映射（skills-agent-page-zcode-parity 3.1/3.2）。
 *
 * ZCode 引用对照：app-shell/SidePaneTabTrigger.tsx:266（SidePaneTabIcon——tab 条、
 * overview、拖拽浮层同源图标；来源卡片与 tab 必须同形，点开不跳变）。
 *
 * 差异裁决：ZCode code-viewer 按文件扩展名解析 FileDisplayIcon——本产品统一
 * file-code 兜底形（per-extension 文件图标后置）；approvals/cards 沿用产品既有
 * 图标（badge-check / id-card）。subagents 用 list-tree（ZCode subagent-directory
 * 同形——本产品只有目录级数据面）。
 *
 * 正交意图：[1] 单一图标映射源（strip/overview/launcher 共用）。
 * 妥协声明：无。
 */
import IconBadgeCheck from "@lucide/svelte/icons/badge-check";
import IconSquareTerminal from "@lucide/svelte/icons/square-terminal";
import IconListTree from "@lucide/svelte/icons/list-tree";
import IconIdCard from "@lucide/svelte/icons/id-card";
import IconFileCode from "@lucide/svelte/icons/file-code";
import type { ExtensionPanelTabType } from "./panel-tabs.js";

export type PanelTabIcon = typeof IconFileCode;

export function panelTabIcon(type: ExtensionPanelTabType): PanelTabIcon {
  switch (type) {
    case "approvals":
      return IconBadgeCheck;
    case "bash-output":
      return IconSquareTerminal;
    case "subagents":
      return IconListTree;
    case "cards":
    case "ui-card":
      return IconIdCard;
    case "file-preview":
      return IconFileCode;
  }
}
