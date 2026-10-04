<!--
  右栏 tab 触发器（skills-agent-page-zcode-parity 3.1）。
  用户原始需求 [2026-10-04]（design §3）：「多 panel 以水平 tab 共存，单次只显示
  一个 active content；tab 可激活、拖拽排序、关闭当前/其他/全部」。
  正交意图：
    [1] 激活语义：左键/Enter/Space 激活；ArrowLeft/Right/Home/End roving focus +
        自动激活（Radix Tabs 自动激活语义）；middle-click 关闭不激活。
    [2] 关闭面：active 常显关闭钮；inactive hover/focus-within 显出。
    [3] 拖拽排序：HTML5 DnD（dragstart/drop→reorder；dragend 兜底清态）。
    [4] 上下文菜单入口：右键 → 父级 TabContextMenu（close current/others/all）。
  妥协声明：ZCode 用 dnd-kit（PointerSensor distance 4 + transform 动画）——本仓
  用原生 HTML5 DnD（无依赖；无拖拽跟手 transform，差异裁决记录于 change 报告）。
  ZCode 引用：app-shell/SidePaneTabTrigger.tsx:41（SortableSidePaneTabTrigger）。
-->
<script lang="ts">
  import IconX from "@lucide/svelte/icons/x";
  import { panelTabIcon } from "./panel-tab-icon.js";
  import { getPanelTabTitle, type ExtensionPanelTab } from "./panel-tabs.js";

  let {
    tab,
    isActive,
    badge = 0,
    closeTabLabel,
    isDragged = false,
    isDropTarget = false,
    onActivate,
    onClose,
    onContextMenuOpen,
    onDragStart,
    onDragEnd,
    onDragOverTab,
    onDrop,
  }: {
    tab: ExtensionPanelTab;
    isActive: boolean;
    /** approvals tab 角标（0 = 不显示）。 */
    badge?: number;
    /** 关闭钮 aria-label（含标题）。 */
    closeTabLabel: string;
    isDragged?: boolean;
    isDropTarget?: boolean;
    onActivate: (tabId: string) => void;
    onClose: (tabId: string) => void;
    onContextMenuOpen: (event: MouseEvent, tabId: string) => void;
    onDragStart: (tabId: string) => void;
    onDragEnd: () => void;
    onDragOverTab: (overTabId: string) => void;
    onDrop: (draggedTabId: string, overTabId: string) => void;
  } = $props();

  const title = $derived(getPanelTabTitle(tab));
  const Icon = $derived(panelTabIcon(tab.type));

  /** tab 条同级 tab 元素（roving focus / Home / End 用）。 */
  function siblingTabIds(current: HTMLElement): string[] {
    const strip = current.closest("[data-side-pane-tabs-content]");
    if (strip === null) return [];
    return Array.from(strip.querySelectorAll<HTMLElement>("[data-side-pane-tab-id]")).map(
      (element) => element.dataset.sidePaneTabId ?? "",
    );
  }

  function focusTabId(id: string): void {
    const stripRoot = document.querySelector("[data-side-pane-tabs-content]");
    const target = stripRoot?.querySelector<HTMLElement>(
      `[data-side-pane-tab-id="${CSS.escape(id)}"]`,
    );
    target?.focus();
  }

  /** Arrow/Home/End：移动焦点并自动激活（Radix automatic activation）；Enter/Space 激活。 */
  function handleKeydown(event: KeyboardEvent): void {
    const el = event.currentTarget;
    if (!(el instanceof HTMLElement)) return;
    const ids = siblingTabIds(el);
    const index = ids.indexOf(tab.id);
    if (index < 0) return;
    let targetIndex: number | null = null;
    switch (event.key) {
      case "ArrowRight":
        targetIndex = (index + 1) % ids.length;
        break;
      case "ArrowLeft":
        targetIndex = (index - 1 + ids.length) % ids.length;
        break;
      case "Home":
        targetIndex = 0;
        break;
      case "End":
        targetIndex = ids.length - 1;
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        onActivate(tab.id);
        return;
      default:
        return;
    }
    event.preventDefault();
    const targetId = ids[targetIndex];
    if (targetId === undefined || targetId === tab.id) return;
    focusTabId(targetId);
    onActivate(targetId);
  }

  function handleDrop(event: DragEvent): void {
    event.preventDefault();
    const draggedId = event.dataTransfer?.getData("text/plain") ?? "";
    if (draggedId.length > 0 && draggedId !== tab.id) onDrop(draggedId, tab.id);
  }
</script>

<div
  role="tab"
  tabindex={isActive ? 0 : -1}
  aria-selected={isActive}
  aria-label={title}
  data-side-pane-tab-id={tab.id}
  draggable="true"
  class="group relative flex h-7 min-w-15 max-w-39 flex-[1_1_9.75rem] items-center justify-start gap-1 overflow-hidden rounded-lg border border-transparent px-1.5 pr-2 text-[11px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 {isActive
    ? 'bg-muted text-foreground'
    : 'bg-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'} {isDragged
    ? 'cursor-grabbing opacity-60'
    : ''} {isDropTarget ? 'ring-1 ring-ring/60' : ''}"
  onkeydown={handleKeydown}
  onclick={(event) => {
    if (event.button === 1) return; // middle 由 auxclick 关闭
    onActivate(tab.id);
  }}
  onauxclick={(event) => {
    if (event.button !== 1) return;
    event.preventDefault();
    onClose(tab.id);
  }}
  oncontextmenu={(event) => onContextMenuOpen(event, tab.id)}
  ondragstart={(event) => {
    event.dataTransfer?.setData("text/plain", tab.id);
    if (event.dataTransfer !== null) event.dataTransfer.effectAllowed = "move";
    onDragStart(tab.id);
  }}
  ondragend={() => onDragEnd()}
  ondragover={(event) => {
    event.preventDefault();
    onDragOverTab(tab.id);
  }}
  ondrop={handleDrop}
>
  <span class="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
    <Icon class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    <span class="shrink-0 truncate">{title}</span>
    {#if badge > 0}
      <span
        class="ml-0.5 flex h-3.5 min-w-3.5 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground"
      >
        {badge}
      </span>
    {/if}
  </span>
  <button
    type="button"
    class="absolute top-1/2 right-1 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 {isActive
      ? ''
      : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100'}"
    aria-label={closeTabLabel}
    onpointerdown={(event) => event.stopPropagation()}
    onclick={(event) => {
      event.preventDefault();
      event.stopPropagation();
      onClose(tab.id);
    }}
  >
    <IconX class="h-3 w-3" aria-hidden="true" />
  </button>
</div>
