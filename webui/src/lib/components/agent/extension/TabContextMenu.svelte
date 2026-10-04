<!--
  右栏 tab 上下文菜单（skills-agent-page-zcode-parity 3.1）。
  用户原始需求 [2026-10-04]（design §3）：「tab 可……关闭当前/其他/全部」。
  正交意图：
    [1] 右键菜单位置固定定位 + 视口钳制；外部 pointerdown/Escape/resize 关闭。
    [2] Close others 在可见 tab < 2 时禁用（ZCode canCloseOtherTabs = visibleTabs.length > 1）。
  妥协声明：无（ZCode 用 Radix ContextMenu；本仓无该原语，等价自绘——差异仅
  浮层动画，记录于 change 报告）。
  ZCode 引用：app-shell/SidePaneTabTrigger.tsx:185-197（ContextMenu 三项）。
-->
<script lang="ts">
  let {
    x,
    y,
    tabId,
    canCloseOthers,
    closeTabLabel,
    closeOtherTabsLabel,
    closeAllTabsLabel,
    onClose,
    onCloseOthers,
    onCloseAll,
    onDismiss,
  }: {
    x: number;
    y: number;
    tabId: string;
    canCloseOthers: boolean;
    closeTabLabel: string;
    closeOtherTabsLabel: string;
    closeAllTabsLabel: string;
    onClose: (tabId: string) => void;
    onCloseOthers: (tabId: string) => void;
    onCloseAll: () => void;
    onDismiss: () => void;
  } = $props();

  const MENU_WIDTH = 176;
  const MENU_HEIGHT = 108;

  const left = $derived(Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 8)));
  const top = $derived(Math.max(8, Math.min(y, window.innerHeight - MENU_HEIGHT - 8)));

  function dismissOnOutside(event: PointerEvent): void {
    const target = event.target;
    if (
      target instanceof Node &&
      document.querySelector("[data-side-pane-tab-menu]")?.contains(target)
    ) {
      return;
    }
    onDismiss();
  }

  function run(action: () => void): void {
    onDismiss();
    action();
  }
</script>

<svelte:window
  onpointerdown={dismissOnOutside}
  onkeydown={(event) => {
    if (event.key === "Escape") onDismiss();
  }}
  onresize={onDismiss}
/>

<div
  data-side-pane-tab-menu=""
  class="fixed z-50 flex w-44 flex-col gap-0.5 rounded-md border border-border bg-popover p-1 text-[11px] shadow-md"
  style="left: {left}px; top: {top}px"
  role="menu"
  aria-label={closeTabLabel}
>
  <button
    type="button"
    role="menuitem"
    class="flex h-7 items-center rounded px-2 text-left text-popover-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    onclick={() => run(() => onClose(tabId))}
  >
    {closeTabLabel}
  </button>
  <button
    type="button"
    role="menuitem"
    disabled={!canCloseOthers}
    class="flex h-7 items-center rounded px-2 text-left text-popover-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
    onclick={() => run(() => onCloseOthers(tabId))}
  >
    {closeOtherTabsLabel}
  </button>
  <button
    type="button"
    role="menuitem"
    class="flex h-7 items-center rounded px-2 text-left text-popover-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    onclick={() => run(() => onCloseAll())}
  >
    {closeAllTabsLabel}
  </button>
</div>
