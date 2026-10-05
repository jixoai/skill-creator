<!--
  SkillsAgentPage（skills-agent-page-zcode-parity 1.3/5.1/5.2）：Agent tab 页面壳。
  用户原始需求 [2026-10-03]（design §1，对标 ZCode）：
  「┌ omnibox 行 actions: [terminal][rightPanel] ┐
    │ workspaces └ sessions 树 │ Chat │ 扩展面板 panelTabs │
    ├ 终端（人类 PTY，xterm.js；可多 tab；可拖高）┤」
  修订 [2026-10-05]（Owner 裁决 4b，空面板折叠）：宽屏右栏空态（无活动 tab）
  收敛为 48px 图标 rail——空态由「有无 tab」事实派生，不新增 DevicePrefs 字段；
  窄屏 drawer 不受影响。
  修订 [2026-10-05]（Owner 裁决「absolute（包括 fixed）尽量别用，尽量用 grid」）：
  窄屏右扩展面板改与 Chat 列 grid 同格堆叠、终端改与列区同格堆叠（self-end 贴底）
  ——两者弃 absolute/z-30，覆盖 = 源序 + 小值 max-[1023px]:z-10（chat 内 composer
  relative z-10 会穿透 static 覆盖层）；树抽屉 absolute 保留（后续批）；
  ≥1024 flex 并列/常驻行零变化。
  正交意图：
    [1] 四区布局：左树（264px 默认/最小，可拖至 50%，折叠 36px）/ 中部 Chat /
        右扩展面板（45% 默认/65% 最大，Chat 保底 320px）/ 底部终端；几何入 DevicePrefs。
    [2] 窄屏降级（<1024）：树 rail 可开导航 drawer（absolute，后续批）、扩展面板
        与终端经 grid 同格堆叠转覆盖层（终端 self-end 贴底 + max-h 70%）。
    [3] 深链与会话上下文：/agent?session=<id> 激活会话（workspace 面板「在
        Agent 页打开」入口）；会话切换驱动扩展面板 rebind（1.5 手动记忆重置）；
        双开角标（agentPanel.open 且同会话 = 「也在 workspace 面板打开」）。
    [4] addressBarActions 位（1.8）：toolbar 的 [terminal][rightPanel] 切换钮
        ——Omnibox（shell/page-actions.ts，Codex 批）对 agent 页注册的同名动作
        经 aria-label 桥接到本工具位（页内可达 + omnibox 可达双入口）。
  妥协声明：树宽与右栏比例对齐 ZCode WorkspaceShellLayout/sidePaneLayout；低于
  1024px 时保留 drawer 降级，避免三栏挤压窄屏 Chat。
-->
<script lang="ts">
  import IconPanelLeftClose from "@lucide/svelte/icons/panel-left-close";
  import IconPanelRight from "@lucide/svelte/icons/panel-right";
  import IconTerminalSquare from "@lucide/svelte/icons/terminal-square";
  import IconPlus from "@lucide/svelte/icons/plus";
  import IconPanelsTopLeft from "@lucide/svelte/icons/panels-top-left";
  import IconPanelLeftOpen from "@lucide/svelte/icons/panel-left-open";
  import { t } from "$lib/i18n";
  import { useSearch } from "$lib/shell";
  import { readDevicePrefs, updateDevicePrefs } from "$lib/shell/device-prefs.js";
  import {
    agentPagePanels,
    revealAgentRightPanel,
    syncAgentPagePanelsFromPrefs,
    toggleAgentRightPanel,
    toggleAgentTerminal,
  } from "$lib/stores/agent-page-panels.svelte";
  import {
    agentPageActiveSession,
    agentPanel,
    agentSession,
    agentSessionsList,
    beginNewAgentSession,
    loadAgentSessions,
    registerAgentSurface,
    selectAgentSession,
    setAgentPageSessionId,
  } from "$lib/stores/agent.svelte";
  import { connectionState } from "$lib/stores/connection.svelte";
  import SessionFace from "$lib/components/agent/SessionFace.svelte";
  import TerminalDock from "$lib/components/agent/terminal/TerminalDock.svelte";
  import {
    SIDE_PANE_KEYBOARD_STEP_PX,
    SIDE_PANE_MAX_RATIO,
    SIDE_PANE_MIN_WIDTH_PX,
    SIDE_PANE_RAIL_WIDTH_PX,
    nudgeSidePaneRatio,
    sidePaneRatioFromWidth,
    sidePaneWidthFromRatio,
  } from "$lib/components/agent/extension/side-pane-layout.js";
  import {
    openExtensionBashOutput,
    openExtensionFilePreview,
    rebindExtensionPanel,
    visibleExtensionTabs,
  } from "./extension-panel.svelte.js";
  import {
    groupSessionsByCreatedAt,
    sessionDisplayName,
    sessionIsUnassigned,
  } from "./session-tree.js";
  import {
    AGENT_CHAT_MIN_WIDTH,
    AGENT_TREE_COLLAPSED_WIDTH,
    AGENT_TREE_DEFAULT_WIDTH,
    clampAgentTreeWidth,
    matchAgentShellShortcut,
    maxAgentTreeWidth,
    resizeAgentTreeWidth,
  } from "./agent-layout.js";
  import {
    clampTerminalHeightPx,
    defaultTerminalHeightPx,
  } from "$lib/components/agent/terminal/terminal-geometry.js";
  import SessionTree from "./SessionTree.svelte";
  import ExtensionPanel from "./ExtensionPanel.svelte";
  import { workspaceState } from "$lib/stores/workspaces.svelte";

  const unregister = registerAgentSurface("page");
  $effect(() => {
    return () => unregister();
  });

  // ---- 布局偏好（DevicePrefs appearance 域；design §1「全部显隐状态入
  // DevicePrefs」）----
  // 面板开合态（terminal/rightPanel/narrow）迁 shell 级共享 store
  // （agent-page-panels，2026-10-05 toggleButton 落地）：页面真钮与顶栏
  // 开关同源；挂载时重读持久化真值（组件级初始化语义保持）。
  syncAgentPagePanelsFromPrefs();
  const panels = agentPagePanels;
  let treeCollapsed = $state(readDevicePrefs().agentTreeCollapsed);
  let treeWidth = $state(readDevicePrefs().agentTreeWidth);
  let rightPanelRatio = $state(readDevicePrefs().agentRightPanelExpandedRatio);
  let terminalHeight = $state(readDevicePrefs().agentTerminalHeight);
  let treeToggleButton: HTMLButtonElement | null = $state(null);
  let terminalToggleButton: HTMLButtonElement | null = $state(null);
  let pageElement: HTMLElement | null = $state(null);
  let columnsElement: HTMLElement | null = $state(null);
  let pageHeight = $state(0);
  let columnsWidth = $state(0);

  let narrowTreeOpen = $state(false);

  function toggleTree(): void {
    if (panels.narrow) {
      narrowTreeOpen = !narrowTreeOpen;
      return;
    }
    treeCollapsed = !treeCollapsed;
    updateDevicePrefs({ agentTreeCollapsed: treeCollapsed });
  }

  function setTreeWidth(next: number, persist = false): void {
    treeWidth = clampAgentTreeWidth(next, columnsWidth);
    if (persist) updateDevicePrefs({ agentTreeWidth: treeWidth });
  }

  // 关闭时焦点归还可见控件（关闭语义留在页面包装——focus 目标是页面内按钮
  // ref；开合真值翻转与持久化归 store）。
  function toggleRightPanel(): void {
    const closing = panels.narrow ? panels.narrowRightPanelOpen : panels.rightPanelOpen;
    toggleAgentRightPanel();
    if (closing) focusVisibleAgentControl();
  }

  function toggleTerminal(): void {
    const closing = panels.terminalOpen;
    toggleAgentTerminal();
    if (closing) focusVisibleAgentControl(terminalToggleButton);
  }

  function setRightPanelWidth(next: number, persist = false): void {
    const bounded = Math.min(rightPanelMaxWidth, Math.max(rightPanelMinWidth, next));
    rightPanelRatio = sidePaneRatioFromWidth(bounded, rightPanelAvailableWidth);
    if (persist) {
      updateDevicePrefs({ agentRightPanelExpandedRatio: rightPanelRatio });
    }
  }

  function revealRightPanel(): void {
    revealAgentRightPanel();
  }

  function openFilePreview(path: string): void {
    if (openExtensionFilePreview({ path }).opened) revealRightPanel();
  }

  function openBashOutput(): void {
    if (openExtensionBashOutput().opened) revealRightPanel();
  }

  function setTerminalHeight(next: number): void {
    terminalHeight = clampTerminalHeightPx(next, terminalBasisHeight);
    updateDevicePrefs({ agentTerminalHeight: terminalHeight });
  }

  const treeStripMode = $derived(panels.narrow ? !narrowTreeOpen : treeCollapsed);
  const treeDrawerMode = $derived(panels.narrow && narrowTreeOpen);
  const treePanelWidth = $derived(
    treeStripMode
      ? AGENT_TREE_COLLAPSED_WIDTH
      : clampAgentTreeWidth(treeWidth, columnsWidth || AGENT_TREE_DEFAULT_WIDTH * 2),
  );
  const rightPanelAvailableWidth = $derived(Math.max(0, columnsWidth - treePanelWidth));
  const rightPanelMaxWidth = $derived(
    Math.max(
      Math.min(SIDE_PANE_MIN_WIDTH_PX, rightPanelAvailableWidth),
      Math.min(
        rightPanelAvailableWidth * SIDE_PANE_MAX_RATIO,
        rightPanelAvailableWidth - AGENT_CHAT_MIN_WIDTH,
      ),
    ),
  );
  const rightPanelMinWidth = $derived(Math.min(SIDE_PANE_MIN_WIDTH_PX, rightPanelMaxWidth));
  const rightPanelWidth = $derived(
    Math.min(rightPanelMaxWidth, sidePaneWidthFromRatio(rightPanelRatio, rightPanelAvailableWidth)),
  );
  // 空面板折叠（Owner 裁决 4b）：宽屏无活动 tab 时侧栏收敛为图标 rail（旁路
  // 240px 下限与比例记忆）；空态由「有无 tab」事实派生——点击 rail 图标开 tab
  // 即回全宽，最后一个 tab 关闭即回 rail。DevicePrefs 不新增字段（记的是比例）。
  const rightPanelRail = $derived(!panels.narrow && visibleExtensionTabs().length === 0);
  const rightPanelRenderWidth = $derived(
    rightPanelRail ? SIDE_PANE_RAIL_WIDTH_PX : rightPanelWidth,
  );
  const terminalBasisHeight = $derived(
    pageHeight > 0 ? pageHeight : typeof window === "undefined" ? 0 : window.innerHeight,
  );
  const resolvedTerminalHeight = $derived(
    terminalHeight === 0
      ? defaultTerminalHeightPx(terminalBasisHeight)
      : clampTerminalHeightPx(terminalHeight, terminalBasisHeight),
  );
  const treeButtonOpen = $derived(panels.narrow ? narrowTreeOpen : !treeCollapsed);
  const rightPanelVisible = $derived(
    panels.narrow ? panels.narrowRightPanelOpen : panels.rightPanelOpen,
  );

  function focusVisibleAgentControl(preferred: HTMLButtonElement | null = null): void {
    const candidate = preferred ?? treeToggleButton;
    if (candidate !== null && candidate.isConnected && candidate.getClientRects().length > 0) {
      candidate.focus();
      return;
    }
    if (treeToggleButton !== null && treeToggleButton.isConnected) treeToggleButton.focus();
  }

  $effect(() => {
    const page = pageElement;
    const columns = columnsElement;
    if (!page || !columns || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      pageHeight = page.clientHeight;
      columnsWidth = columns.clientWidth;
      treeWidth = clampAgentTreeWidth(treeWidth, columnsWidth);
    });
    observer.observe(page);
    observer.observe(columns);
    pageHeight = page.clientHeight;
    columnsWidth = columns.clientWidth;
    return () => observer.disconnect();
  });

  // ---- 深链（agent-surface spec「deep link opens the agent page」）：?session= 激活会话。 ----
  const search = useSearch<{ session?: string }>();
  $effect(() => {
    const sessionId = search?.()?.session;
    if (sessionId === undefined || sessionId.length === 0) return;
    if (agentSession.sessionId === sessionId) return;
    selectAgentSession(sessionId);
  });

  // 会话列表（深链会话可能尚未入列——连接后拉取；树内刷新由树组件自理）。
  // 每连接一次性自动拉取：失败不重试（树内刷新钮/重连重新武装）。
  let autoLoadedList = false;
  $effect(() => {
    if (connectionState.status !== "connected") {
      autoLoadedList = false;
      return;
    }
    if (autoLoadedList || agentSessionsList.loaded || agentSessionsList.loading) return;
    autoLoadedList = true;
    void loadAgentSessions();
  });

  // 会话上下文投影：Agent 页会话 id（双开角标数据面）+ 扩展面板 rebind。
  // 写入走 store 唯一 setter（可赋值 runes 状态不直接导出）；本面读取用 getter。
  $effect(() => {
    setAgentPageSessionId(agentSession.sessionId);
  });
  $effect(() => {
    rebindExtensionPanel(agentSession.sessionId);
  });

  const currentSummary = $derived(
    agentSessionsList.sessions.find((item) => item.sessionId === agentSession.sessionId) ?? null,
  );
  const currentTitle = $derived(
    currentSummary !== null ? sessionDisplayName(currentSummary) : t("agentPage.newSessionTitle"),
  );
  const terminalWorkspace = $derived.by(() => {
    if (currentSummary === null) return null;
    const workspaceId = currentSummary.target?.workspaceId;
    const workspace = workspaceId
      ? workspaceState.workspaces.find((item) => item.id === workspaceId)
      : undefined;
    const cwd =
      currentSummary.cwd || (workspace?.kind === "directory" ? workspace.path : undefined);
    const key = workspaceId ?? cwd;
    return key === undefined || key.length === 0 ? null : { key, ...(cwd ? { cwd } : {}) };
  });

  /** 双开角标（agent-surface spec「dual open projects one truth」）。 */
  const dualOpenInPanel = $derived(
    agentPanel.open &&
      agentSession.sessionId !== null &&
      agentPageActiveSession() === agentSession.sessionId,
  );

  // ---- 窄屏态（<1024：树 drawer/右面板 overlay/终端底部 overlay 的判定基准）。
  // narrow 真值迁 agent-page-panels store（matchMedia listener 常驻）；页面只
  // 保留树抽屉的局部复位（进窄屏收起树 drawer）。 ----
  $effect(() => {
    if (panels.narrow) narrowTreeOpen = false;
  });

  // ---- 左树与右面板拖宽（DevicePrefs 只持设备几何，不改 URL/session）。 ----
  let resizing = $state<"tree" | "right" | null>(null);
  let resizeStartX = 0;
  let resizeStartTreeWidth = 0;
  let resizeStartRightWidth = 0;

  function startResize(event: PointerEvent, pane: "tree" | "right"): void {
    if (event.button !== 0) return;
    resizing = pane;
    resizeStartX = event.clientX;
    resizeStartTreeWidth = treeWidth;
    resizeStartRightWidth = rightPanelWidth;
    const target = event.currentTarget;
    if (target instanceof HTMLElement) target.setPointerCapture(event.pointerId);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }

  function endResize(cancelled = false): void {
    const activeResize = resizing;
    if (activeResize === null) return;
    if (cancelled) {
      if (activeResize === "tree") treeWidth = resizeStartTreeWidth;
      else
        rightPanelRatio = sidePaneRatioFromWidth(resizeStartRightWidth, rightPanelAvailableWidth);
    } else if (activeResize === "tree") {
      updateDevicePrefs({ agentTreeWidth: treeWidth });
    } else {
      updateDevicePrefs({ agentRightPanelExpandedRatio: rightPanelRatio });
    }
    resizing = null;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  }

  function handleTreeResizeKeydown(event: KeyboardEvent): void {
    const nextWidth = resizeAgentTreeWidth(treeWidth, event.key, columnsWidth);
    if (nextWidth === null) return;
    event.preventDefault();
    setTreeWidth(nextWidth, true);
  }

  function handleRightResizeKeydown(event: KeyboardEvent): void {
    let nextWidth: number | null = null;
    if (event.key === "ArrowLeft") {
      const ratio = nudgeSidePaneRatio(
        sidePaneRatioFromWidth(rightPanelWidth, rightPanelAvailableWidth),
        SIDE_PANE_KEYBOARD_STEP_PX,
        rightPanelAvailableWidth,
      );
      nextWidth = Math.min(
        rightPanelMaxWidth,
        sidePaneWidthFromRatio(ratio, rightPanelAvailableWidth),
      );
    } else if (event.key === "ArrowRight") {
      const ratio = nudgeSidePaneRatio(
        sidePaneRatioFromWidth(rightPanelWidth, rightPanelAvailableWidth),
        -SIDE_PANE_KEYBOARD_STEP_PX,
        rightPanelAvailableWidth,
      );
      nextWidth = Math.min(
        rightPanelMaxWidth,
        sidePaneWidthFromRatio(ratio, rightPanelAvailableWidth),
      );
    } else if (event.key === "Home") nextWidth = rightPanelMinWidth;
    else if (event.key === "End") nextWidth = rightPanelMaxWidth;
    if (nextWidth === null) return;
    event.preventDefault();
    setRightPanelWidth(nextWidth, true);
  }

  function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    if (target.closest("[data-terminal-region]")) return false;
    return (
      target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]') !== null
    );
  }

  function navigateSession(direction: -1 | 1): void {
    const sessions = groupSessionsByCreatedAt(agentSessionsList.sessions).flatMap(
      (group) => group.sessions,
    );
    if (sessions.length === 0) return;
    const currentIndex = sessions.findIndex(
      (session) => session.sessionId === agentSession.sessionId,
    );
    const nextIndex = currentIndex < 0 ? 0 : currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= sessions.length) return;
    const nextSession = sessions[nextIndex];
    if (nextSession) selectAgentSession(nextSession.sessionId);
  }

  $effect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.repeat || isEditableTarget(event.target)) return;
      const platform = /mac/i.test(navigator.platform ?? "") ? "mac" : "other";
      const shortcut = matchAgentShellShortcut(event, platform);
      if (shortcut === null) return;
      event.preventDefault();
      if (shortcut === "toggle-sidebar") toggleTree();
      else if (shortcut === "toggle-terminal") toggleTerminal();
      else if (shortcut === "toggle-side-pane") toggleRightPanel();
      else if (shortcut === "new-session") beginNewAgentSession();
      else if (shortcut === "previous-session") navigateSession(-1);
      else navigateSession(1);
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  });
</script>

<svelte:window
  onpointermove={(event) => {
    if (resizing === "tree") setTreeWidth(resizeStartTreeWidth + event.clientX - resizeStartX);
    else if (resizing === "right") {
      setRightPanelWidth(resizeStartRightWidth + (resizeStartX - event.clientX));
    }
  }}
  onpointerup={() => endResize()}
  onpointercancel={() => endResize(true)}
/>

<section
  bind:this={pageElement}
  class="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background min-[1024px]:flex min-[1024px]:flex-col"
  data-agent-page="true"
>
  <!-- actionsToolbar（1.8 addressBarActions）：[terminal][rightPanel] 切换钮。
       Omnibox（shell/page-actions.ts）的 terminal/right-panel 动作与本地真钮
       同读 agent-page-panels 共享 store（2026-10-05 起 proxy-click aria-label
       协议退役——开合真值/按下态单一真相源）；窄屏溢出菜单同源。 -->
  <div
    class="col-start-1 row-start-1 flex h-9 shrink-0 items-center gap-1 border-b border-border px-2"
  >
    <button
      bind:this={treeToggleButton}
      type="button"
      class="relative flex h-6 w-7 items-center justify-center rounded transition-colors after:absolute after:-inset-1 after:content-[''] {treeButtonOpen
        ? 'bg-primary/10 text-primary'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
      title={treeButtonOpen ? t("agentPage.hideTree") : t("agentPage.showTree")}
      aria-label={treeButtonOpen ? t("agentPage.hideTree") : t("agentPage.showTree")}
      aria-pressed={treeButtonOpen}
      onclick={toggleTree}
    >
      {#if treeButtonOpen}
        <IconPanelLeftClose class="h-3.5 w-3.5" />
      {:else}
        <IconPanelLeftOpen class="h-3.5 w-3.5" />
      {/if}
    </button>
    <button
      type="button"
      class="relative flex h-6 w-7 items-center justify-center rounded text-muted-foreground transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-muted hover:text-foreground"
      title={t("agentTree.newSession")}
      aria-label={t("agentTree.newSession")}
      onclick={() => beginNewAgentSession()}
    >
      <IconPlus class="h-3.5 w-3.5" />
    </button>
    <span class="ml-1 min-w-0 flex-1 truncate text-xs font-medium text-foreground/80">
      {currentTitle}
      {#if currentSummary && sessionIsUnassigned(currentSummary)}
        <span
          class="ml-1 rounded bg-muted px-1 text-[9px] uppercase text-muted-foreground"
          title={t("agentTree.unassignedHint")}
        >
          {t("agentTree.readOnlyTag")}
        </span>
      {/if}
      {#if currentSummary}
        <span class="ml-1.5 text-[10px] text-muted-foreground">· {currentSummary.status}</span>
      {/if}
    </span>
    {#if dualOpenInPanel}
      <span
        class="flex shrink-0 items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"
        role="status"
        title={t("agentPage.dualOpenPanelHint")}
      >
        <IconPanelsTopLeft class="h-3 w-3" aria-hidden="true" />
        {t("agentPage.dualOpenPanel")}
      </span>
    {/if}
    <button
      bind:this={terminalToggleButton}
      type="button"
      class="relative flex h-6 w-7 items-center justify-center rounded transition-colors after:absolute after:-inset-1 after:content-[''] {panels.terminalOpen
        ? 'bg-primary/10 text-primary'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
      title={t("agentPage.toggleTerminal")}
      aria-label={t("agentPage.toggleTerminal")}
      aria-pressed={panels.terminalOpen}
      onclick={toggleTerminal}
    >
      <IconTerminalSquare class="h-3.5 w-3.5" />
    </button>
    <button
      type="button"
      class="relative flex h-6 w-7 items-center justify-center rounded transition-colors after:absolute after:-inset-1 after:content-[''] {rightPanelVisible
        ? 'bg-primary/10 text-primary'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
      title={t("agentPage.toggleRightPanel")}
      aria-label={t("agentPage.toggleRightPanel")}
      aria-pressed={rightPanelVisible}
      onclick={toggleRightPanel}
    >
      <IconPanelRight class="h-3.5 w-3.5" />
    </button>
  </div>

  <!-- 主行：左树 | Chat | 右扩展面板。<1024：树折叠为窄条；右面板与 Chat 经 grid
       同格堆叠为覆盖层（同格 1/2，后声明者在上，免 absolute/z）；≥1024 flex 并列。 -->
  <div
    bind:this={columnsElement}
    class="relative col-start-1 row-start-2 grid min-h-0 flex-1 grid-cols-[auto_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] min-[1024px]:flex"
    data-agent-columns="true"
  >
    {#if treeDrawerMode}
      <button
        type="button"
        class="absolute inset-y-0 right-0 z-20 bg-foreground/15"
        style="left: {treePanelWidth}px"
        aria-label={t("agentPage.closeTreeDrawer")}
        onclick={() => {
          narrowTreeOpen = false;
          focusVisibleAgentControl();
        }}
      ></button>
    {/if}
    <div
      id="agent-session-sidebar"
      class="relative shrink-0 overflow-hidden border-r border-border bg-background transition-[width] {treeDrawerMode
        ? 'absolute inset-y-0 left-0 z-30 shadow-xl'
        : ''}"
      style="width: {treePanelWidth}px"
      data-tree-region="true"
    >
      {#if treeStripMode}
        <div class="flex h-full w-9 flex-col items-center gap-1 py-2">
          <button
            type="button"
            class="relative flex h-6 w-6 items-center justify-center rounded text-muted-foreground after:absolute after:-inset-1 after:content-[''] hover:bg-muted hover:text-foreground"
            title={t("agentPage.showTree")}
            aria-label={t("agentPage.showTree")}
            onclick={toggleTree}
          >
            <IconPanelLeftOpen class="h-3.5 w-3.5" />
          </button>
          <span class="mt-1 text-[10px] text-muted-foreground">
            {agentSessionsList.sessions.length}
          </span>
        </div>
      {:else}
        <div class="h-full w-full">
          <SessionTree />
        </div>
      {/if}
    </div>

    {#if !panels.narrow && !treeCollapsed}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        class="relative z-10 h-full w-1 shrink-0 cursor-col-resize touch-none select-none hover:bg-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        role="separator"
        tabindex="0"
        aria-controls="agent-session-sidebar"
        aria-orientation="vertical"
        aria-label={t("agentPage.resizeTree")}
        aria-valuemin={264}
        aria-valuemax={maxAgentTreeWidth(columnsWidth)}
        aria-valuenow={treePanelWidth}
        data-agent-tree-resizer="true"
        onpointerdown={(event) => startResize(event, "tree")}
        onkeydown={handleTreeResizeKeydown}
      ></div>
    {/if}

    <main
      class="col-start-2 row-start-1 flex min-w-0 flex-1 flex-col"
      data-agent-chat-region="true"
    >
      <SessionFace
        showStartDirections
        onOpenFilePreview={openFilePreview}
        onOpenBashOutput={openBashOutput}
      />
    </main>

    {#if rightPanelVisible}
      <!-- ≥1024：常驻侧栏（左缘拖宽）；<1024：与 Chat 同格堆叠的覆盖层（含关闭钮
           + 背景幕；2026-10-05 grid 化——弃 absolute/z-30；同格源序在后 + 小值
           max-[1023px]:z-10 盖过 chat 内 composer 的 relative z-10，仍让位树抽屉
           scrim(z-20)/drawer(z-30)）。
           空态 rail（Owner 裁决 4b）：宽屏无 tab 时宽度压到 SIDE_PANE_RAIL_WIDTH_PX
           且不渲染拖宽分隔条；窄屏覆盖层不受影响（空态卡保持）。 -->
      <div
        class="col-start-2 row-start-1 flex w-full max-[1023px]:z-10 max-[1023px]:bg-background/95 max-[1023px]:shadow-xl min-[1024px]:w-(--agent-right-width) min-[1024px]:shrink-0 min-[1024px]:border-l min-[1024px]:border-border max-[1023px]:backdrop-blur-sm"
        style="--agent-right-width: {rightPanelRenderWidth}px"
        data-right-panel-region="true"
        data-right-panel-rail={rightPanelRail ? "true" : undefined}
      >
        {#if !rightPanelRail}
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <div
            class="absolute inset-y-0 left-0 z-10 hidden w-1.5 cursor-col-resize touch-none select-none hover:bg-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-[1024px]:block"
            role="separator"
            tabindex="0"
            aria-controls="agent-right-panel-content"
            aria-orientation="vertical"
            aria-label={t("agentPage.resizeRightPanel")}
            aria-valuemin={rightPanelMinWidth}
            aria-valuemax={rightPanelMaxWidth}
            aria-valuenow={rightPanelWidth}
            data-agent-right-resizer="true"
            onpointerdown={(event) => startResize(event, "right")}
            onkeydown={handleRightResizeKeydown}
          ></div>
        {/if}
        <div id="agent-right-panel-content" class="min-w-0 flex-1">
          <ExtensionPanel onCloseSidePane={toggleRightPanel} railWhenEmpty={!panels.narrow} />
        </div>
      </div>
    {/if}
  </div>

  {#if panels.terminalMounted}
    <!-- ≥1024：常驻底部容器（TerminalDock 自带拖高分隔条）；<1024：与列区同格
         堆叠的底部覆盖层（self-end 贴底 + max-h 70%；2026-10-05 grid 化——弃
         absolute/z-30；同格源序在后 + 小值 max-[1023px]:z-10 压过列区内 positioned
         后代）。首次打开后关闭只 display:none，TerminalDock/xterm/PTY 不卸载。 -->
    <div
      class="col-start-1 row-start-2 max-h-[70%] max-[1023px]:z-10 max-[1023px]:self-end shadow-xl min-[1024px]:max-h-none min-[1024px]:shadow-none {panels.terminalOpen
        ? ''
        : 'hidden'}"
      data-terminal-region="true"
    >
      <TerminalDock
        height={resolvedTerminalHeight}
        onHeight={setTerminalHeight}
        workspace={terminalWorkspace}
        onClose={toggleTerminal}
      />
    </div>
  {/if}
</section>
