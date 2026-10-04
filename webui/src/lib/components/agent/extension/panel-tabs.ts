/**
 * 类型化右栏 panel registry 纯模型（skills-agent-page-zcode-parity task 3.1/3.2）。
 *
 * 用户原始需求 [2026-10-04]（design §3）：「复刻 ZCode 的单宿主、多 tab、单 active
 * content；补 tab close menu、reorder、overview/search/reopen。state 中每个 tab
 * 使用 server session/target 的 opaque identity，展示按 owner context 过滤。」
 *
 * ZCode 引用对照（/tmp/ia-redesign/zcode-src/packages/ui/src/，commit 29628c9）：
 *   - tab 状态/开/关/重排/可见性/结构化 id：lib/workspaceSidePane.ts
 *     （activateSidePaneTab:1012 / reorderSidePaneTab:2134 / closeSidePaneTab:2018 /
 *     closeVisibleOtherSidePaneTabs:1982 / closeVisibleSidePaneTabs:1998 /
 *     restoreSidePaneTab:1178 / getVisibleSidePaneTabsByScope:1105 /
 *     resolveActiveTabForOwner:1135 / normalizeWorkspaceSidePaneState:564）。
 *   - overview 搜索打分：app-shell/sidePaneTabSearch.ts:1（逐位移植：120/90/70/40/20/1）。
 *   - 最近关闭（bounded 8 + 去重 + newest-first）：hooks/useAppPanels.ts:100
 *     （RecentClosedSidePaneTab / RECENT_CLOSED_SIDE_PANE_TAB_LIMIT=8 /
 *     rememberClosedSidePaneTabs:1341 / handleReopenClosedSidePaneTab:1508）。
 *
 * 差异裁决（ZCode tab 类型 → 本产品映射，design §3 row 1）：
 *   - browser / browser-use：本产品无内嵌浏览器数据面 → 后置（不建类型）。
 *   - plan-detail / workflow-*：无对应数据面 → 后置（不建类型）。
 *   - git / whiteboard / model-trajectory / developer-tools / treemapping /
 *     selection-side-chat：无 Agent 数据源或已被产品其他面承载 → 不实现。
 *   - ZCode code-viewer → file-preview（经 agent.files.preview RPC）。
 *   - ZCode bash-output（per workId）→ bash-output（owner 会话聚合流：本产品
 *     transcript 无 workId 身份，owner session 即身份——聚合一个 tab，避免一次
 *     agent run 每条 bash 调用各开一 tab 淹没 tab 条）。
 *   - ZCode subagent-session/subagent-directory 双类型 → subagents 目录单类型
 *     （webui 只有 spawn 目录帧，无子会话 transcript 数据面，无法分档）。
 *   - approvals / cards：产品自有数据面（统一审批面 / ui:// 卡），无 ZCode 对应。
 *
 * 正交意图：
 *   [1] tab 联合类型 + 结构化 id（幂等开档：同 owner 同资源永远同一个 tab）。
 *   [2] 纯状态操作（activate/reorder/close/others/all/restore/normalize）。
 *   [3] owner 可见性 + active 解析 + 最近关闭记忆。
 *   [4] overview 搜索打分 + 标题/类型标签（en 硬编码——i18n 冻结边界）。
 * 妥协声明：无（本文件零 Svelte/依赖，纯函数可单测）。
 */

/** tab 类型判别键（ZCode WorkspaceSidePaneTab 联合的产品子集 + 产品自有类型）。 */
export type ExtensionPanelTabType =
  | "approvals"
  | "bash-output"
  | "subagents"
  | "cards"
  | "ui-card"
  | "file-preview";

/** 统一审批面 tab（owner 会话单例；数据 = agent.proposals.* 轮询投影）。 */
export interface ApprovalsPanelTab {
  id: string;
  type: "approvals";
  ownerSessionId: string;
  openedAt: number;
}

/** shell 工具输出流 tab（owner 会话单例；数据 = transcript tool_call bash 族行）。 */
export interface BashOutputPanelTab {
  id: string;
  type: "bash-output";
  ownerSessionId: string;
  openedAt: number;
}

/** 子代理目录 tab（owner 会话单例；数据 = transcript subagent spawn 帧）。 */
export interface SubagentsPanelTab {
  id: string;
  type: "subagents";
  ownerSessionId: string;
  openedAt: number;
}

/** ui:// 卡目录 tab（owner 会话单例；数据 = tool result 的 uiCard 引用集合）。 */
export interface CardsPanelTab {
  id: string;
  type: "cards";
  ownerSessionId: string;
  openedAt: number;
}

/** 单张 ui:// 卡聚焦 tab（身份 = owner + resourceUri；重复点击幂等聚焦）。 */
export interface UiCardPanelTab {
  id: string;
  type: "ui-card";
  ownerSessionId: string;
  resourceUri: string;
  title: string;
  openedAt: number;
}

/** 单文件/媒体预览 tab（身份 = owner + 绝对路径；ZCode code-viewer 的映射）。 */
export interface FilePreviewPanelTab {
  id: string;
  type: "file-preview";
  ownerSessionId: string;
  path: string;
  openedAt: number;
}

export type ExtensionPanelTab =
  | ApprovalsPanelTab
  | BashOutputPanelTab
  | SubagentsPanelTab
  | CardsPanelTab
  | UiCardPanelTab
  | FilePreviewPanelTab;

/** registry 状态（ZCode WorkspaceSidePaneState 同构）。 */
export interface ExtensionPanelTabsState {
  tabs: ExtensionPanelTab[];
  activeTabId: string;
}

/** 最近关闭条目（ZCode RecentClosedSidePaneTab 同构）。 */
export interface RecentClosedPanelTab {
  tab: ExtensionPanelTab;
  closedAt: number;
}

/** 最近关闭上限（ZCode RECENT_CLOSED_SIDE_PANE_TAB_LIMIT = 8）。 */
export const RECENT_CLOSED_PANEL_TAB_LIMIT = 8;

/**
 * 后置/不实现的 ZCode 类型清单（差异裁决的常量回执——normalize 按类型白名单
 * 过滤未知类型，恢复/热更残片不进入 tab 条）。
 */
export const SUPPORTED_PANEL_TAB_TYPES: ReadonlySet<ExtensionPanelTabType> = new Set([
  "approvals",
  "bash-output",
  "subagents",
  "cards",
  "ui-card",
  "file-preview",
]);

function encodePanelTabIdPart(value: string): string {
  return encodeURIComponent(value);
}

function nowOrDefault(openedAt: number | undefined): number {
  return typeof openedAt === "number" && Number.isFinite(openedAt) ? openedAt : Date.now();
}

// ---- 工厂（结构化 id：同 owner 同资源永远同一个 tab——重复打开幂等聚焦） ----

export function createApprovalsPanelTab(
  ownerSessionId: string,
  openedAt?: number,
): ApprovalsPanelTab {
  return {
    id: `approvals:${encodePanelTabIdPart(ownerSessionId)}`,
    type: "approvals",
    ownerSessionId,
    openedAt: nowOrDefault(openedAt),
  };
}

export function createBashOutputPanelTab(
  ownerSessionId: string,
  openedAt?: number,
): BashOutputPanelTab {
  return {
    id: `bash-output:${encodePanelTabIdPart(ownerSessionId)}`,
    type: "bash-output",
    ownerSessionId,
    openedAt: nowOrDefault(openedAt),
  };
}

export function createSubagentsPanelTab(
  ownerSessionId: string,
  openedAt?: number,
): SubagentsPanelTab {
  return {
    id: `subagents:${encodePanelTabIdPart(ownerSessionId)}`,
    type: "subagents",
    ownerSessionId,
    openedAt: nowOrDefault(openedAt),
  };
}

export function createCardsPanelTab(ownerSessionId: string, openedAt?: number): CardsPanelTab {
  return {
    id: `cards:${encodePanelTabIdPart(ownerSessionId)}`,
    type: "cards",
    ownerSessionId,
    openedAt: nowOrDefault(openedAt),
  };
}

/** ui:// 卡 resourceUri 契约（src/shared/contracts/agent.ts AgentCardGetInputSchema）。 */
export const UI_CARD_RESOURCE_URI_PATTERN = /^ui:\/\/card\/[a-z-]+\/[a-z0-9-]+$/;

export function isUsableUiCardResourceUri(uri: string): boolean {
  return UI_CARD_RESOURCE_URI_PATTERN.test(uri);
}

export function createUiCardPanelTab(options: {
  ownerSessionId: string;
  resourceUri: string;
  title?: string;
  openedAt?: number;
}): UiCardPanelTab {
  return {
    id: [
      "ui-card",
      encodePanelTabIdPart(options.ownerSessionId),
      encodePanelTabIdPart(options.resourceUri),
    ].join(":"),
    type: "ui-card",
    ownerSessionId: options.ownerSessionId,
    resourceUri: options.resourceUri,
    title: options.title?.trim() || options.resourceUri,
    openedAt: nowOrDefault(options.openedAt),
  };
}

/** 文件预览身份键 = 绝对路径（agent.files.preview 契约：相对路径 typed 拒绝）。 */
export function isUsableFilePreviewPath(path: string): boolean {
  return path.length > 0 && path.startsWith("/");
}

export function createFilePreviewPanelTab(options: {
  ownerSessionId: string;
  path: string;
  openedAt?: number;
}): FilePreviewPanelTab {
  return {
    id: [
      "file-preview",
      encodePanelTabIdPart(options.ownerSessionId),
      encodePanelTabIdPart(options.path),
    ].join(":"),
    type: "file-preview",
    ownerSessionId: options.ownerSessionId,
    path: options.path,
    openedAt: nowOrDefault(options.openedAt),
  };
}

// ---- 状态操作（ZCode workspaceSidePane.ts 逐条移植） ----

function findTabIndexById(tabs: ExtensionPanelTab[], tabId: string): number {
  return tabs.findIndex((tab) => tab.id === tabId);
}

/** 开或聚焦：已存在则原位刷新并激活，否则追加并激活（ZCode activateSidePaneTab:1012）。 */
export function activatePanelTab(
  current: ExtensionPanelTabsState | null,
  tab: ExtensionPanelTab,
): ExtensionPanelTabsState {
  if (!current) {
    return { tabs: [tab], activeTabId: tab.id };
  }
  const existingIndex = findTabIndexById(current.tabs, tab.id);
  if (existingIndex >= 0) {
    const nextTabs = [...current.tabs];
    nextTabs[existingIndex] = tab;
    return { tabs: nextTabs, activeTabId: tab.id };
  }
  return { tabs: [...current.tabs, tab], activeTabId: tab.id };
}

/** 显式设置 active（未知 id 原样返回——ZCode setActiveSidePaneTab:2050）。 */
export function setActivePanelTab(
  current: ExtensionPanelTabsState | null,
  tabId: string,
): ExtensionPanelTabsState | null {
  if (!current || !current.tabs.some((tab) => tab.id === tabId)) return current;
  return { ...current, activeTabId: tabId };
}

export function getActivePanelTab(
  current: ExtensionPanelTabsState | null,
): ExtensionPanelTab | null {
  if (!current) return null;
  return current.tabs.find((tab) => tab.id === current.activeTabId) ?? null;
}

/** owner 可见性（ZCode getVisibleSidePaneTabsByScope:1105——本产品所有类型均 owner 收窄）。 */
export function getVisiblePanelTabs(
  tabs: readonly ExtensionPanelTab[],
  ownerSessionId: string | null,
): ExtensionPanelTab[] {
  if (ownerSessionId === null) return [];
  return tabs.filter((tab) => tab.ownerSessionId === ownerSessionId);
}

/**
 * owner 切换时解析 active：preferred 可见优先 → 原 active 可见 → 最后一个可见
 * （ZCode resolveActiveTabForOwner:1135；空集 → null = 显示 open-tab launcher）。
 */
export function resolveActivePanelTabId(
  state: ExtensionPanelTabsState | null,
  ownerSessionId: string | null,
  preferredTabId?: string | null,
): string | null {
  if (!state) return null;
  const visible = getVisiblePanelTabs(state.tabs, ownerSessionId);
  if (visible.length === 0) return null;
  if (preferredTabId && visible.some((tab) => tab.id === preferredTabId)) return preferredTabId;
  if (visible.some((tab) => tab.id === state.activeTabId)) return state.activeTabId;
  return visible[visible.length - 1]?.id ?? null;
}

/**
 * 拖拽重排：activeId 移到 overId 位置（splice 语义；ZCode reorderSidePaneTab:2134）。
 */
export function reorderPanelTab(
  current: ExtensionPanelTabsState | null,
  activeTabId: string,
  overTabId: string,
): ExtensionPanelTabsState | null {
  if (!current || activeTabId === overTabId) return current;
  const activeIndex = findTabIndexById(current.tabs, activeTabId);
  const overIndex = findTabIndexById(current.tabs, overTabId);
  if (activeIndex < 0 || overIndex < 0) return current;
  const nextTabs = [...current.tabs];
  const [moved] = nextTabs.splice(activeIndex, 1);
  if (!moved) return current;
  nextTabs.splice(overIndex, 0, moved);
  return { ...current, tabs: nextTabs };
}

/**
 * 关闭单个 tab：关的是 active 时 fallback = min(closingIndex, len-1)（ZCode
 * closeSidePaneTab:2018）；最后一个 tab 关掉 → null（registry 空态）。
 */
export function closePanelTab(
  current: ExtensionPanelTabsState | null,
  tabId: string,
): ExtensionPanelTabsState | null {
  if (!current) return null;
  const closingIndex = findTabIndexById(current.tabs, tabId);
  if (closingIndex < 0) return current;
  const nextTabs = current.tabs.filter((tab) => tab.id !== tabId);
  if (nextTabs.length === 0) return null;
  if (current.activeTabId !== tabId) return { tabs: nextTabs, activeTabId: current.activeTabId };
  const fallbackIndex = Math.min(closingIndex, nextTabs.length - 1);
  return { tabs: nextTabs, activeTabId: nextTabs[fallbackIndex]?.id ?? "" };
}

/**
 * 关闭其它（owner 可见面）：保留目标并激活之；其它 owner 的 tab 不动
 * （ZCode closeVisibleOtherSidePaneTabs:1982）。
 */
export function closeOtherPanelTabs(
  current: ExtensionPanelTabsState | null,
  tabId: string,
  ownerSessionId: string | null,
): ExtensionPanelTabsState | null {
  if (!current) return null;
  const visible = getVisiblePanelTabs(current.tabs, ownerSessionId);
  const target = visible.find((tab) => tab.id === tabId);
  if (!target) return current;
  const closingIds = new Set(visible.filter((tab) => tab.id !== tabId).map((tab) => tab.id));
  return {
    tabs: current.tabs.filter((tab) => !closingIds.has(tab.id)),
    activeTabId: target.id,
  };
}

/**
 * 关闭全部（owner 可见面）：registry 清空 → null；其它 owner 的 tab 保留
 * （ZCode closeVisibleSidePaneTabs:1998——activeTabId 归 ""）。
 */
export function closeAllPanelTabs(
  current: ExtensionPanelTabsState | null,
  ownerSessionId: string | null,
): ExtensionPanelTabsState | null {
  if (!current) return null;
  const closingIds = new Set(
    getVisiblePanelTabs(current.tabs, ownerSessionId).map((tab) => tab.id),
  );
  const tabs = current.tabs.filter((tab) => !closingIds.has(tab.id));
  return tabs.length === 0 ? null : { tabs, activeTabId: "" };
}

/** 最近重开：恢复 tab 并激活（openedAt 保留原值——ZCode restoreSidePaneTab:1178）。 */
export function restorePanelTab(
  current: ExtensionPanelTabsState | null,
  tab: ExtensionPanelTab,
): ExtensionPanelTabsState {
  return activatePanelTab(current, { ...tab, openedAt: nowOrDefault(tab.openedAt) });
}

/**
 * 状态边界归一（ZCode normalizeWorkspaceSidePaneState:564 的产品版）：
 * 未知/后置类型过滤 + activeTabId 回落到可见 tab（缺省最后一张）。结果与输入
 * 等价时原对象返回（引用稳定，避免等值触发渲染）。
 */
export function normalizePanelTabsState(
  current: ExtensionPanelTabsState | null,
  ownerSessionId: string | null,
): ExtensionPanelTabsState {
  const empty: ExtensionPanelTabsState = { tabs: [], activeTabId: "" };
  if (!current) return empty;
  const tabs = current.tabs.filter((tab) => SUPPORTED_PANEL_TAB_TYPES.has(tab.type));
  const activeTabId = resolveActivePanelTabId(
    { tabs, activeTabId: current.activeTabId },
    ownerSessionId,
  );
  const nextActive = activeTabId ?? "";
  if (tabs.length === current.tabs.length && nextActive === current.activeTabId) return current;
  return { tabs, activeTabId: nextActive };
}

/** 最近关闭记忆：newest-first 前插、按 id 去重、截 8 条（ZCode rememberClosedSidePaneTabs:1341）。 */
export function rememberClosedPanelTabs(
  recent: readonly RecentClosedPanelTab[],
  closed: readonly ExtensionPanelTab[],
  closedAt: number,
): RecentClosedPanelTab[] {
  if (closed.length === 0) return [...recent];
  const closingIds = new Set(closed.map((tab) => tab.id));
  return [
    ...closed.map((tab) => ({ tab, closedAt })),
    ...recent.filter((item) => !closingIds.has(item.tab.id)),
  ].slice(0, RECENT_CLOSED_PANEL_TAB_LIMIT);
}

/** 最近关闭列表的 owner 过滤（ZCode recentClosedSidePaneTabs 投影同构）。 */
export function getVisibleRecentClosedPanelTabs(
  recent: readonly RecentClosedPanelTab[],
  ownerSessionId: string | null,
): RecentClosedPanelTab[] {
  if (ownerSessionId === null) return [];
  return recent.filter((item) => item.tab.ownerSessionId === ownerSessionId);
}

// ---- overview 搜索（ZCode sidePaneTabSearch.ts 逐位移植） ----

interface PanelTabSearchFields {
  title: string;
  hint: string;
  typeLabel: string;
  all: string;
}

export function buildPanelTabSearchFields(
  title: string,
  hint: string,
  typeLabel: string,
): PanelTabSearchFields {
  return {
    title: normalizePanelTabSearchText(title),
    hint: normalizePanelTabSearchText(hint),
    typeLabel: normalizePanelTabSearchText(typeLabel),
    all: normalizePanelTabSearchText(`${title} ${hint} ${typeLabel}`),
  };
}

export function normalizePanelTabSearchQuery(query: string): string[] {
  return normalizePanelTabSearchText(query).split(/\s+/).filter(Boolean);
}

export function filterAndRankPanelTabSearchItems<T extends { searchFields: PanelTabSearchFields }>(
  items: T[],
  queryParts: string[],
): T[] {
  if (queryParts.length === 0) return items;
  return items
    .map((item, index) => ({
      item,
      index,
      score: getPanelTabSearchScore(item.searchFields, queryParts),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.item);
}

function normalizePanelTabSearchText(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function getPanelTabSearchScore(fields: PanelTabSearchFields, queryParts: string[]): number {
  if (!queryParts.every((part) => fields.all.includes(part))) return 0;
  return queryParts.reduce((score, part) => {
    if (fields.title.startsWith(part)) return score + 120;
    if (hasPanelTabWordPrefix(fields.title, part)) return score + 90;
    if (fields.title.includes(part)) return score + 70;
    if (fields.hint.includes(part)) return score + 40;
    if (fields.typeLabel.includes(part)) return score + 20;
    return score + 1;
  }, 0);
}

function hasPanelTabWordPrefix(value: string, part: string): boolean {
  return value.split(/[\s/_.:-]+/).some((word) => word.startsWith(part));
}

// ---- 标题/类型标签/hint（en 硬编码——本 change i18n 冻结边界） ----

export function getPanelTabTitle(tab: ExtensionPanelTab): string {
  switch (tab.type) {
    case "approvals":
      return "Approvals";
    case "bash-output":
      return "Shell output";
    case "subagents":
      return "Subagents";
    case "cards":
      return "Cards";
    case "ui-card":
      return tab.title.trim() || "Card";
    case "file-preview": {
      const leaf = tab.path.split("/").filter(Boolean).at(-1);
      return leaf && leaf.length > 0 ? leaf : tab.path;
    }
  }
}

export function getPanelTabTypeLabel(tab: ExtensionPanelTab): string {
  switch (tab.type) {
    case "approvals":
      return "Approvals";
    case "bash-output":
      return "Shell output";
    case "subagents":
      return "Subagents";
    case "cards":
      return "Cards";
    case "ui-card":
      return "Card";
    case "file-preview":
      return "File preview";
  }
}

/** 搜索 hint：可定位资源键（ZCode getSidePaneTabSearchHint 的资源键面）。 */
export function getPanelTabSearchHint(tab: ExtensionPanelTab): string {
  switch (tab.type) {
    case "ui-card":
      return tab.resourceUri;
    case "file-preview":
      return tab.path;
    default:
      return "";
  }
}

/** 相对时间（ZCode taskListItemPresentation.formatTaskRelativeTime:33 的 en 版）。 */
export function formatPanelTabRelativeTime(timestamp: number, now: number = Date.now()): string {
  const minutes = Math.floor((now - timestamp) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
