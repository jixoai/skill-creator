<!--
  Agent 页右扩展面板：typed 单宿主 / 多 tab registry（skills-agent-page-zcode-parity 3.1/3.2/3.3）。
  用户原始需求 [2026-10-04]（design §3）：「复刻 ZCode 的单宿主、多 tab、单 active
  content；补 tab close menu、reorder、overview/search/reopen」。
  修订 [2026-10-05]（Owner 裁决 4b，空面板折叠）：宽屏空态（无活动 tab）收敛为
  ~48px 图标 rail——四入口竖排 + title 提示，点击即开 tab 并回全宽；窄屏 drawer
  是覆盖层，保持原 open-tab launcher 卡。
  正交意图：
    [1] 单宿主组合：tab 条（overview/scroll viewport/add 菜单）+ 单 active 面板体
        （inactive 保持挂载只隐藏——ZCode TabsContent forceMount 语义）+ 空 tab
        open-tab launcher。
    [2] tab 条物理：溢出判定（60px 预算 + add 按钮跟随/固定）+ 滚动 mask 边 + active
        tab 自动滚入可视区（rAF 量测 → scrollBy smooth）。
    [3] 内联面板体：approvals（统一审批面）/ bash-output（shell 工具流）/
        subagents（spawn 目录）/ cards（ui:// 卡列表）；ui-card/file-preview 体在
        components/agent/extension/。
    [4] watch 生命周期：审批轮询 start/stop（到达沿驱动 typed request，见 store）。
  妥协声明：4 个意图聚合于本文件——ExtensionPanel 是 registry 的唯一宿主边界
  （apps/agent 其余文件归并行批，拆分会把接线散进他人域）；子结构已物理拆分到
  components/agent/extension/。
  ZCode 引用：app-shell/AnimatedSidePanePanel.tsx:418-1101（visibleTabs 派生回退/
  溢出 mask/自动 reveal/add 菜单/tab 条/面板体分派/openTabLauncher）。
-->
<script lang="ts">
  import IconPlus from "@lucide/svelte/icons/plus";
  import IconPanelRight from "@lucide/svelte/icons/panel-right";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { t, type MessageKey } from "$lib/i18n";
  import { agentSession } from "$lib/stores/agent.svelte";
  import AgentToolRow, { toolUiCardRefOf } from "$lib/components/agent/AgentToolRow.svelte";
  import AgentProposalCard from "$lib/components/agent/AgentProposalCard.svelte";
  import AgentCard from "$lib/components/agent/AgentCard.svelte";
  import FilePreviewBody from "$lib/components/agent/extension/FilePreviewBody.svelte";
  import PanelTabButton from "$lib/components/agent/extension/PanelTabButton.svelte";
  import TabContextMenu from "$lib/components/agent/extension/TabContextMenu.svelte";
  import TabOverview from "$lib/components/agent/extension/TabOverview.svelte";
  import { panelTabIcon } from "$lib/components/agent/extension/panel-tab-icon.js";
  import {
    resolvePanelTabRevealScroll,
    resolveSidePaneTabsOverflow,
  } from "$lib/components/agent/extension/side-pane-layout.js";
  import {
    getPanelTabTitle,
    type ExtensionPanelTabType,
  } from "$lib/components/agent/extension/panel-tabs.js";
  import {
    activateExtensionTab,
    closeAllExtensionTabs,
    closeExtensionTab,
    closeOtherExtensionTabs,
    extensionPanel,
    openExtensionApprovals,
    openExtensionBashOutput,
    openExtensionCards,
    openExtensionSubagents,
    reorderExtensionTab,
    reopenRecentExtensionTab,
    setExtensionDraggingTabId,
    startExtensionPanelWatch,
    stopExtensionPanelWatch,
    visibleActiveExtensionTabId,
    visibleExtensionTabs,
    visibleRecentClosedExtensionTabs,
  } from "./extension-panel.svelte.js";

  /**
   * 容器接线位（编排者转 Codex）：onCloseSidePane 提供时渲染面板关闭钮（ZCode
   * closeSidePaneButton :803）；separator 键盘 resize/比例宽度接线需求见 change 报告。
   * railWhenEmpty（Owner 裁决 4b）：宽屏空态（无活动 tab）收敛为图标 rail——容器
   * 同步把侧栏宽度压到 SIDE_PANE_RAIL_WIDTH_PX；窄屏 drawer 是覆盖层，保持原空态卡。
   */
  let {
    onCloseSidePane,
    railWhenEmpty = false,
  }: { onCloseSidePane?: () => void; railWhenEmpty?: boolean } = $props();

  startExtensionPanelWatch();
  $effect(() => {
    return () => stopExtensionPanelWatch();
  });

  const visibleTabs = $derived(visibleExtensionTabs());
  const activeTabId = $derived(visibleActiveExtensionTabId());
  const recentClosedTabs = $derived(visibleRecentClosedExtensionTabs());

  // ---- Add 菜单 / open-tab launcher 项（ZCode :763-802 launcher items——已开类型
  // 收起，等价 ZCode review 项的 hasReviewTab 行为；file-preview/ui-card 不入菜单：
  // ZCode code-viewer 同样只经输出链接打开）。rail 态复用同一 open 面（点击图标
  // = 开对应 tab → 空态事实翻转 → 容器宽度自然回全宽）；railTitle 存 key，
  // 模板内 t() 解析（locale 切换细粒度更新）。 ----
  const launcherItems: Array<{
    id: ExtensionPanelTabType;
    label: string;
    railTitleKey: MessageKey;
    open: () => void;
  }> = [
    {
      id: "approvals",
      label: "Approvals",
      railTitleKey: "agentExtension.railOpenApprovals",
      open: openExtensionApprovals,
    },
    {
      id: "bash-output",
      label: "Shell output",
      railTitleKey: "agentExtension.railOpenBashOutput",
      open: openExtensionBashOutput,
    },
    {
      id: "subagents",
      label: "Subagents",
      railTitleKey: "agentExtension.railOpenSubagents",
      open: openExtensionSubagents,
    },
    {
      id: "cards",
      label: "Cards",
      railTitleKey: "agentExtension.railOpenCards",
      open: openExtensionCards,
    },
  ];

  const openTypeSet = $derived(new Set(visibleTabs.map((tab) => tab.type)));
  const addMenuItems = $derived(launcherItems.filter((item) => !openTypeSet.has(item.id)));

  // ---- 数据面（沿用 skills-agent-page 1.5 既有投影，零新 RPC）。 ----
  /** 内核工具行的 bash 族判定（bash/pwsh 覆盖模式矩阵）。 */
  function isShellTool(toolName: string): boolean {
    const normalized = toolName.toLowerCase();
    return normalized.includes("bash") || normalized.includes("shell");
  }

  const shellToolItems = $derived(
    agentSession.items.filter((item) => item.kind === "tool" && isShellTool(item.toolName)),
  );

  const subagentItems = $derived(agentSession.items.filter((item) => item.kind === "subagent"));

  const cardEntries = $derived.by(() => {
    const entries: Array<{ seq: number; resourceUri: string; title: string }> = [];
    for (const item of agentSession.items) {
      if (item.kind !== "tool" || item.result === undefined) continue;
      const card = toolUiCardRefOf(item.result);
      if (card !== null) {
        entries.push({ seq: item.seq, resourceUri: card.resourceUri, title: card.title });
      }
    }
    return entries;
  });

  const pendingProposals = $derived(
    (extensionPanel.proposals ?? []).filter((proposal) => proposal.status === "pending"),
  );
  const decidedProposals = $derived(
    (extensionPanel.proposals ?? []).filter((proposal) => proposal.status !== "pending"),
  );

  // ---- tab 条溢出 / 滚动 mask（ZCode :550-636：add 按钮预算还原假想布局，避免
  // ResizeObserver 反馈环；mask 边绑定真实 scrollLeft）。 ----
  let viewportEl = $state<HTMLDivElement | null>(null);
  let overflow = $state({ overflowing: false, maskLeft: false, maskRight: false });
  let rafId: number | null = null;

  function computeOverflow(): void {
    rafId = null;
    const viewport = viewportEl;
    if (viewport === null) {
      overflow = { overflowing: false, maskLeft: false, maskRight: false };
      return;
    }
    const content = viewport.querySelector<HTMLElement>("[data-side-pane-tabs-content]");
    if (content === null) {
      overflow = { overflowing: false, maskLeft: false, maskRight: false };
      return;
    }
    const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const addButton = viewport.parentElement?.querySelector<HTMLElement>(
      "[data-side-pane-add-tab-trigger]",
    );
    const addButtonWidth = addButton?.getBoundingClientRect().width ?? 0;
    const isOverflowing = resolveSidePaneTabsOverflow({
      addButtonInside: Boolean(addButton && content.contains(addButton)),
      addButtonWidth,
      tabCount: visibleTabs.length,
      viewportWidth: viewport.clientWidth,
    });
    overflow = {
      overflowing: isOverflowing,
      maskLeft: isOverflowing && viewport.scrollLeft > 1,
      maskRight: isOverflowing && viewport.scrollLeft < maxScrollLeft - 1,
    };
  }

  function scheduleOverflowCompute(): void {
    if (rafId !== null) return;
    if (typeof requestAnimationFrame !== "function") {
      computeOverflow();
      return;
    }
    rafId = requestAnimationFrame(() => computeOverflow());
  }

  $effect(() => {
    void visibleTabs.length;
    scheduleOverflowCompute();
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  });

  function bindTabsViewport(element: HTMLDivElement): { destroy(): void } {
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => scheduleOverflowCompute());
    resizeObserver?.observe(element);
    const content = element.querySelector<HTMLElement>("[data-side-pane-tabs-content]");
    if (content !== null) resizeObserver?.observe(content);
    window.addEventListener("resize", scheduleOverflowCompute);
    return {
      destroy() {
        resizeObserver?.disconnect();
        window.removeEventListener("resize", scheduleOverflowCompute);
        if (rafId !== null) cancelAnimationFrame(rafId);
      },
    };
  }

  const viewportMaskStyle = $derived.by(() => {
    if (!overflow.maskLeft && !overflow.maskRight) return undefined;
    const leftEdge = overflow.maskLeft ? "transparent 0%, black 16px" : "black 0%";
    const rightEdge = overflow.maskRight
      ? "black calc(100% - 16px), transparent 100%"
      : "black 100%";
    const value = `linear-gradient(to right, ${leftEdge}, ${rightEdge})`;
    return `mask-image: ${value}; -webkit-mask-image: ${value};`;
  });

  // ---- active tab 自动滚入可视区（ZCode :638-679：外部激活的 tab 可能被横向
  // 滚动区遮住；rAF 后按真实 DOM 宽度滚回，不用固定宽度估算）。 ----
  $effect(() => {
    const id = activeTabId;
    void visibleTabs.length;
    if (id.length === 0) return;
    const frame = requestAnimationFrame(() => {
      const viewport = viewportEl;
      if (viewport === null) return;
      const tabEl = viewport.querySelector<HTMLElement>(
        `[data-side-pane-tab-id="${CSS.escape(id)}"]`,
      );
      if (tabEl === null) return;
      const viewportRect = viewport.getBoundingClientRect();
      const tabRect = tabEl.getBoundingClientRect();
      const delta = resolvePanelTabRevealScroll(
        viewportRect.left,
        viewportRect.right,
        tabRect.left,
        tabRect.right,
      );
      if (delta !== null) viewport.scrollBy({ left: delta, behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  });

  // ---- 拖拽排序 / 上下文菜单（ZCode :462-478 DnD 回调族 + :189-196 菜单）。 ----
  let dropTargetTabId = $state<string | null>(null);
  let contextMenu = $state<{ tabId: string; x: number; y: number } | null>(null);

  function handleDragStart(tabId: string): void {
    setExtensionDraggingTabId(tabId);
  }

  function handleDragEnd(): void {
    setExtensionDraggingTabId(null);
    dropTargetTabId = null;
  }

  function handleDrop(draggedTabId: string, overTabId: string): void {
    reorderExtensionTab(draggedTabId, overTabId);
    setExtensionDraggingTabId(null);
    dropTargetTabId = null;
  }

  function openContextMenu(event: MouseEvent, tabId: string): void {
    event.preventDefault();
    contextMenu = { tabId, x: event.clientX, y: event.clientY };
  }
</script>

<aside
  class="flex h-full min-h-0 flex-col bg-background"
  aria-label="Extension panel"
  data-extension-panel="true"
>
  {#if railWhenEmpty && visibleTabs.length === 0}
    <!-- 空态收敛为图标 rail（Owner 裁决 4b，「少即是多」）：~48px 竖排四入口
         （title 提示 + focus-visible 与 tab 条同式）；点击 = 开对应 tab →
         空态事实翻转 → 容器宽度自然回全宽。无动画（右栏无过渡先例）。 -->
    <nav
      class="flex h-full w-full flex-col items-center gap-1 py-2"
      aria-label={t("agentExtension.railAria")}
      data-side-pane-rail="true"
    >
      {#each launcherItems as item (item.id)}
        {@const Icon = panelTabIcon(item.id)}
        <button
          type="button"
          data-side-pane-rail-item={item.id}
          class="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors after:absolute after:-inset-1.5 after:content-[''] hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          title={t(item.railTitleKey)}
          aria-label={t(item.railTitleKey)}
          onclick={item.open}
        >
          <Icon class="h-4 w-4" aria-hidden="true" />
        </button>
      {/each}
    </nav>
  {:else if visibleTabs.length === 0}
    <!-- 空 tab：open-tab launcher（ZCode :814-859——标题/描述/可开面板清单）。 -->
    <div class="flex h-full min-h-0 flex-col">
      <div class="flex h-12 shrink-0 items-center justify-end px-2">
        {#if onCloseSidePane}
          <button
            type="button"
            class="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close panel"
            title="Close panel"
            onclick={onCloseSidePane}
          >
            <IconPanelRight class="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        {/if}
      </div>
      <div class="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-5 py-10">
        <div class="flex w-full max-w-80 flex-col gap-5">
          <div class="flex flex-col gap-2 text-center">
            <h2 class="text-base leading-6 font-semibold text-foreground">Open a tab</h2>
            <p class="text-xs leading-5 text-muted-foreground">
              Pick a panel to inspect this session's agent output.
            </p>
          </div>
          <div class="flex w-full flex-col gap-2">
            {#each launcherItems as item (item.id)}
              {@const Icon = panelTabIcon(item.id)}
              <button
                type="button"
                data-side-pane-open-tab-item={item.id}
                class="flex h-12 min-w-0 items-center gap-3 rounded-xl bg-muted/40 px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                onclick={item.open}
              >
                <Icon class="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span class="min-w-0 flex-1 truncate text-left">{item.label}</span>
              </button>
            {/each}
          </div>
        </div>
      </div>
    </div>
  {:else}
    <!-- tab 条：[overview] [scroll viewport + tabs + add] [add(溢出) + close]。 -->
    <div class="flex h-12 shrink-0 items-stretch border-b border-border">
      <div class="flex h-full shrink-0 items-center p-2">
        <TabOverview
          tabs={visibleTabs}
          {activeTabId}
          {recentClosedTabs}
          onActivateTab={activateExtensionTab}
          onCloseTab={closeExtensionTab}
          onReopenClosedTab={reopenRecentExtensionTab}
        />
      </div>
      <div
        bind:this={viewportEl}
        use:bindTabsViewport
        class="side-pane-tabs-viewport min-w-0 flex-1 overflow-x-auto"
        style={viewportMaskStyle}
        data-side-pane-tabs-viewport=""
        onscroll={() => scheduleOverflowCompute()}
      >
        <div
          class="flex h-12 w-full items-center gap-1 py-2.5"
          data-side-pane-tabs-content=""
          role="tablist"
          aria-label="Extension panel tabs"
        >
          {#each visibleTabs as tab (tab.id)}
            <PanelTabButton
              {tab}
              isActive={tab.id === activeTabId}
              badge={tab.type === "approvals" ? extensionPanel.approvalsBadge : 0}
              closeTabLabel={`Close ${getPanelTabTitle(tab)}`}
              isDragged={extensionPanel.draggingTabId === tab.id}
              isDropTarget={dropTargetTabId === tab.id &&
                extensionPanel.draggingTabId !== null &&
                extensionPanel.draggingTabId !== tab.id}
              onActivate={activateExtensionTab}
              onClose={closeExtensionTab}
              onContextMenuOpen={openContextMenu}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragOverTab={(overTabId) => (dropTargetTabId = overTabId)}
              onDrop={handleDrop}
            />
          {/each}
          {#if !overflow.overflowing && addMenuItems.length > 0}
            <DropdownMenu.DropdownMenu>
              <DropdownMenu.Trigger
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                aria-label="Open a tab"
                data-side-pane-add-tab-trigger=""
              >
                <IconPlus class="h-3.5 w-3.5" aria-hidden="true" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end" class="w-48">
                {#each addMenuItems as item (item.id)}
                  {@const Icon = panelTabIcon(item.id)}
                  <DropdownMenu.Item onclick={item.open} class="gap-2">
                    <Icon class="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{item.label}</span>
                  </DropdownMenu.Item>
                {/each}
              </DropdownMenu.Content>
            </DropdownMenu.DropdownMenu>
          {/if}
        </div>
      </div>
      <div class="ml-auto flex h-full shrink-0 items-center gap-1 px-2">
        {#if overflow.overflowing && addMenuItems.length > 0}
          <DropdownMenu.DropdownMenu>
            <DropdownMenu.Trigger
              class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              aria-label="Open a tab"
              data-side-pane-add-tab-trigger=""
            >
              <IconPlus class="h-3.5 w-3.5" aria-hidden="true" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end" class="w-48">
              {#each addMenuItems as item (item.id)}
                {@const Icon = panelTabIcon(item.id)}
                <DropdownMenu.Item onclick={item.open} class="gap-2">
                  <Icon class="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{item.label}</span>
                </DropdownMenu.Item>
              {/each}
            </DropdownMenu.Content>
          </DropdownMenu.DropdownMenu>
        {/if}
        {#if onCloseSidePane}
          <button
            type="button"
            class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close panel"
            title="Close panel"
            onclick={onCloseSidePane}
          >
            <IconPanelRight class="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        {/if}
      </div>
    </div>

    <!-- 面板体：全部挂载、inactive 隐藏（ZCode TabsContent forceMount——iframe/
         滚动状态跨 tab 切换保留）。 -->
    <div class="relative min-h-0 flex-1">
      {#each visibleTabs as tab (tab.id)}
        <div
          class="absolute inset-0 min-h-0 overflow-y-auto {tab.id === activeTabId ? '' : 'hidden'}"
          role="tabpanel"
          aria-label={getPanelTabTitle(tab)}
        >
          {#if tab.type === "approvals"}
            <div class="flex flex-col gap-2 p-2">
              {#if extensionPanel.error}
                <div class="px-1 text-xs text-destructive" role="alert">
                  {extensionPanel.error}
                </div>
              {/if}
              {#if pendingProposals.length === 0 && decidedProposals.length === 0}
                <p class="px-1 py-3 text-xs text-muted-foreground">No proposals</p>
              {/if}
              {#each pendingProposals as proposal (proposal.id)}
                <AgentProposalCard
                  proposalId={proposal.id}
                  capability={proposal.capability ?? proposal.kind}
                  input={proposal.payload}
                  status={proposal.status}
                />
              {/each}
              {#if decidedProposals.length > 0}
                <div class="px-1 pt-1 text-[10px] tracking-wide text-muted-foreground uppercase">
                  Decided
                </div>
                {#each decidedProposals.slice(0, 10) as proposal (proposal.id)}
                  <AgentProposalCard
                    proposalId={proposal.id}
                    capability={proposal.capability ?? proposal.kind}
                    input={proposal.payload}
                    status={proposal.status}
                  />
                {/each}
              {/if}
            </div>
          {:else if tab.type === "bash-output"}
            <div class="flex flex-col gap-1 p-2">
              {#if shellToolItems.length === 0}
                <p class="px-1 py-3 text-xs text-muted-foreground">
                  No shell tool activity in this session yet
                </p>
              {:else}
                {#each shellToolItems as item (item.seq)}
                  {#if item.kind === "tool"}
                    <AgentToolRow
                      toolName={item.toolName}
                      argsText={item.argsText}
                      result={item.result}
                      phase={item.phase}
                      running={item.phase === "calling" && agentSession.status === "running"}
                      startedAt={item.startedAt}
                      endedAt={item.endedAt}
                    />
                  {/if}
                {/each}
              {/if}
            </div>
          {:else if tab.type === "subagents"}
            <div class="flex flex-col gap-1 p-2">
              {#if subagentItems.length === 0}
                <p class="px-1 py-3 text-xs text-muted-foreground">
                  No subagent activity in this session yet
                </p>
              {:else}
                {#each subagentItems as item (item.seq)}
                  {#if item.kind === "subagent"}
                    <div
                      class="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-[11px]"
                    >
                      <span class="min-w-0 flex-1 truncate text-foreground">{item.label}</span>
                      <span class="shrink-0 rounded bg-muted px-1 text-[9px] text-muted-foreground">
                        {item.mode}
                      </span>
                    </div>
                  {/if}
                {/each}
              {/if}
            </div>
          {:else if tab.type === "cards"}
            <div class="flex flex-col gap-2 p-2">
              {#if cardEntries.length === 0}
                <p class="px-1 py-3 text-xs text-muted-foreground">No cards in this session yet</p>
              {:else}
                {#each cardEntries as entry (entry.seq)}
                  <AgentCard resourceUri={entry.resourceUri} title={entry.title} />
                {/each}
              {/if}
            </div>
          {:else if tab.type === "ui-card"}
            <div class="p-2">
              <AgentCard resourceUri={tab.resourceUri} title={tab.title} />
            </div>
          {:else if tab.type === "file-preview"}
            <FilePreviewBody path={tab.path} />
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</aside>

{#if contextMenu !== null}
  <TabContextMenu
    x={contextMenu.x}
    y={contextMenu.y}
    tabId={contextMenu.tabId}
    canCloseOthers={visibleTabs.length > 1}
    closeTabLabel="Close tab"
    closeOtherTabsLabel="Close other tabs"
    closeAllTabsLabel="Close all tabs"
    onClose={closeExtensionTab}
    onCloseOthers={closeOtherExtensionTabs}
    onCloseAll={closeAllExtensionTabs}
    onDismiss={() => (contextMenu = null)}
  />
{/if}

<style>
  /* tab 条横向滚动不显示滚动条（ZCode scrollbar-hide 等价；溢出态由 mask 边提示）。 */
  .side-pane-tabs-viewport {
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  .side-pane-tabs-viewport::-webkit-scrollbar {
    display: none;
  }
</style>
