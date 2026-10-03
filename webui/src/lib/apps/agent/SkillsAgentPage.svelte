<!--
  SkillsAgentPage（skills-agent-page 1.2/1.3/1.5/1.8）：固定 Agent tab 的页面壳。
  用户原始需求 [2026-10-03]（design §1，对标 ZCode）：
  「┌ omnibox 行 actions: [terminal][rightPanel] ┐
    │ workspaces └ sessions 树 │ Chat │ 扩展面板 panelTabs │
    ├ 终端（人类 PTY，xterm.js；可多 tab；可拖高）┤」
  正交意图：
    [1] 四区布局：左树（~240px，可折叠 ~36px）/ 中部 Chat（SessionFace——
        1.4 组件族）/ 右扩展面板（~320px，可关可拖）/ 底部终端容器（~200px
        起，可拖可关）；显隐与尺寸入 DevicePrefs（appearance 域）。
    [2] 三尺寸降级（<1024）：扩展面板转 overlay drawer、终端转底部 drawer、
        左树折叠（agent-surface spec「narrow viewport」场景——无水平溢出）。
    [3] 深链与会话上下文：/agent?session=<id> 激活会话（workspace 面板「在
        Agent 页打开」入口）；会话切换驱动扩展面板 rebind（1.5 手动记忆重置）；
        双开角标（agentPanel.open 且同会话 = 「也在 workspace 面板打开」）。
    [4] addressBarActions 位（1.8）：toolbar 的 [terminal][rightPanel] 切换钮
        ——Omnibox（shell/page-actions.ts，Codex 批）对 agent 页注册的同名动作
        经 aria-label 桥接到本工具位（页内可达 + omnibox 可达双入口）。
  妥协声明：无（各分区语义在子组件内自持）。
-->
<script lang="ts">
  import IconPanelLeft from "@lucide/svelte/icons/panel-left";
  import IconPanelLeftClose from "@lucide/svelte/icons/panel-left-close";
  import IconPanelRight from "@lucide/svelte/icons/panel-right";
  import IconTerminalSquare from "@lucide/svelte/icons/terminal-square";
  import IconPlus from "@lucide/svelte/icons/plus";
  import IconPanelsTopLeft from "@lucide/svelte/icons/panels-top-left";
  import { t } from "$lib/i18n";
  import { useSearch } from "$lib/shell";
  import {
    AGENT_RIGHT_PANEL_MAX_WIDTH,
    AGENT_RIGHT_PANEL_MIN_WIDTH,
    AGENT_TERMINAL_MAX_HEIGHT,
    AGENT_TERMINAL_MIN_HEIGHT,
    readDevicePrefs,
    updateDevicePrefs,
  } from "$lib/shell/device-prefs.js";
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
  import { rebindExtensionPanel } from "./extension-panel.svelte.js";
  import { sessionDisplayName, sessionIsUnassigned } from "./session-tree.js";
  import SessionTree from "./SessionTree.svelte";
  import ExtensionPanel from "./ExtensionPanel.svelte";

  const unregister = registerAgentSurface("page");
  $effect(() => {
    return () => unregister();
  });

  // ---- 布局偏好（DevicePrefs appearance 域；design §1「全部显隐状态入
  // DevicePrefs」）----
  let treeCollapsed = $state(readDevicePrefs().agentTreeCollapsed);
  let rightPanelOpen = $state(readDevicePrefs().agentRightPanelOpen);
  let rightPanelWidth = $state(clampRightWidth(readDevicePrefs().agentRightPanelWidth));
  let terminalOpen = $state(readDevicePrefs().agentTerminalOpen);
  let terminalHeight = $state(clampTerminalHeight(readDevicePrefs().agentTerminalHeight));

  function clampRightWidth(value: number): number {
    if (!Number.isFinite(value)) return 320;
    return Math.min(
      AGENT_RIGHT_PANEL_MAX_WIDTH,
      Math.max(AGENT_RIGHT_PANEL_MIN_WIDTH, Math.round(value)),
    );
  }

  function clampTerminalHeight(value: number): number {
    if (!Number.isFinite(value)) return 200;
    return Math.min(
      AGENT_TERMINAL_MAX_HEIGHT,
      Math.max(AGENT_TERMINAL_MIN_HEIGHT, Math.round(value)),
    );
  }

  function toggleTree(): void {
    treeCollapsed = !treeCollapsed;
    updateDevicePrefs({ agentTreeCollapsed: treeCollapsed });
  }

  function toggleRightPanel(): void {
    rightPanelOpen = !rightPanelOpen;
    updateDevicePrefs({ agentRightPanelOpen: rightPanelOpen });
  }

  function toggleTerminal(): void {
    terminalOpen = !terminalOpen;
    updateDevicePrefs({ agentTerminalOpen: terminalOpen });
  }

  function setRightPanelWidth(next: number): void {
    rightPanelWidth = clampRightWidth(next);
    updateDevicePrefs({ agentRightPanelWidth: rightPanelWidth });
  }

  function setTerminalHeight(next: number): void {
    terminalHeight = clampTerminalHeight(next);
    updateDevicePrefs({ agentTerminalHeight: terminalHeight });
  }

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

  /** 双开角标（agent-surface spec「dual open projects one truth」）。 */
  const dualOpenInPanel = $derived(
    agentPanel.open &&
      agentSession.sessionId !== null &&
      agentPageActiveSession() === agentSession.sessionId,
  );

  // ---- 窄屏态（<1024：树折叠/右面板 overlay/终端底部 overlay 的判定基准）。 ----
  let narrow = $state(false);
  $effect(() => {
    if (typeof matchMedia === "undefined") return;
    const query = matchMedia("(max-width: 1023px)");
    const update = (): void => {
      narrow = query.matches;
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  });

  /** 树的有效折叠态：偏好折叠 或 窄屏强制折叠（spec「narrow viewport」）。 */
  const treeStripMode = $derived(treeCollapsed || narrow);

  // ---- 右面板拖宽（左缘拖柄；<1024 overlay drawer 无侧栏宽度语义）。 ----
  let resizing = $state(false);
  let resizeStartX = 0;
  let resizeStartWidth = 0;

  function startResize(event: PointerEvent): void {
    if (event.button !== 0) return;
    resizing = true;
    resizeStartX = event.clientX;
    resizeStartWidth = rightPanelWidth;
    const target = event.currentTarget;
    if (target instanceof HTMLElement) target.setPointerCapture(event.pointerId);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }

  function endResize(): void {
    if (!resizing) return;
    resizing = false;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  }
</script>

<svelte:window
  onpointermove={(event) => {
    if (resizing) setRightPanelWidth(resizeStartWidth + (resizeStartX - event.clientX));
  }}
  onpointerup={endResize}
  onpointercancel={endResize}
/>

<section class="flex h-full min-h-0 flex-col overflow-hidden bg-background" data-agent-page="true">
  <!-- actionsToolbar（1.8 addressBarActions）：[terminal][rightPanel] 切换钮。
       已接线：Codex 批的 Omnibox（shell/page-actions.ts）对 agent 页注册
       terminal/right-panel 动作，runAction 经 aria-label 定位本工具位按钮
       （t("agentPage.toggleTerminal")/t("agentPage.toggleRightPanel")——
       aria-label 即协议，改动须两处同步）；窄屏溢出菜单同源。 -->
  <div class="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
    <button
      type="button"
      class="relative flex h-6 w-7 items-center justify-center rounded text-muted-foreground transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-muted hover:text-foreground"
      title={treeCollapsed ? t("agentPage.showTree") : t("agentPage.hideTree")}
      aria-label={treeCollapsed ? t("agentPage.showTree") : t("agentPage.hideTree")}
      aria-pressed={!treeCollapsed}
      onclick={toggleTree}
    >
      {#if treeCollapsed}
        <IconPanelLeft class="h-3.5 w-3.5" />
      {:else}
        <IconPanelLeftClose class="h-3.5 w-3.5" />
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
      type="button"
      class="relative flex h-6 w-7 items-center justify-center rounded transition-colors after:absolute after:-inset-1 after:content-[''] {terminalOpen
        ? 'bg-primary/10 text-primary'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
      title={t("agentPage.toggleTerminal")}
      aria-label={t("agentPage.toggleTerminal")}
      aria-pressed={terminalOpen}
      onclick={toggleTerminal}
    >
      <IconTerminalSquare class="h-3.5 w-3.5" />
    </button>
    <button
      type="button"
      class="relative flex h-6 w-7 items-center justify-center rounded transition-colors after:absolute after:-inset-1 after:content-[''] {rightPanelOpen
        ? 'bg-primary/10 text-primary'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
      title={t("agentPage.toggleRightPanel")}
      aria-label={t("agentPage.toggleRightPanel")}
      aria-pressed={rightPanelOpen}
      onclick={toggleRightPanel}
    >
      <IconPanelRight class="h-3.5 w-3.5" />
    </button>
  </div>

  <!-- 主行：左树 | Chat | 右扩展面板。<1024：树折叠为窄条、右面板转 overlay drawer。 -->
  <div class="relative flex min-h-0 flex-1">
    <div
      class="relative shrink-0 overflow-hidden border-r border-border transition-[width] {treeStripMode
        ? 'w-9'
        : 'w-60'}"
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
            <IconPanelLeft class="h-3.5 w-3.5" />
          </button>
          <span class="mt-1 text-[10px] text-muted-foreground">
            {agentSessionsList.sessions.length}
          </span>
        </div>
      {:else}
        <div class="h-full w-60">
          <SessionTree />
        </div>
      {/if}
    </div>

    <main class="flex min-w-0 flex-1 flex-col">
      <SessionFace />
    </main>

    {#if rightPanelOpen}
      <!-- ≥1024：常驻侧栏（左缘拖宽）；<1024：overlay drawer（含关闭钮 + 背景幕）。 -->
      <div
        class="absolute inset-y-0 right-0 z-30 flex w-full max-[1023px]:bg-background/95 max-[1023px]:shadow-xl min-[1024px]:static min-[1024px]:z-auto min-[1024px]:w-(--agent-right-width) min-[1024px]:shrink-0 min-[1024px]:border-l min-[1024px]:border-border max-[1023px]:backdrop-blur-sm"
        style="--agent-right-width: {rightPanelWidth}px"
        data-right-panel-region="true"
      >
        <div
          class="absolute inset-y-0 left-0 z-10 hidden w-1.5 cursor-col-resize touch-none select-none hover:bg-primary/30 min-[1024px]:block"
          role="separator"
          aria-orientation="vertical"
          aria-label={t("agentPage.resizeRightPanel")}
          onpointerdown={startResize}
        ></div>
        <div class="min-w-0 flex-1">
          <ExtensionPanel />
        </div>
        <button
          type="button"
          class="absolute top-1 right-1 z-20 flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground min-[1024px]:hidden"
          title={t("agentPage.toggleRightPanel")}
          aria-label={t("agentPage.toggleRightPanel")}
          onclick={toggleRightPanel}
        >
          <IconPanelRight class="h-3.5 w-3.5" />
        </button>
      </div>
    {/if}
  </div>

  {#if terminalOpen}
    <!-- ≥1024：常驻底部容器（TerminalDock 自带拖高分隔条）；<1024：底部 overlay
         drawer（inset-x-0 bottom-0 悬浮，不产生水平溢出）。 -->
    <div
      class="absolute inset-x-0 bottom-0 z-30 max-h-[70%] shadow-xl min-[1024px]:static min-[1024px]:z-auto min-[1024px]:max-h-none min-[1024px]:shadow-none"
      data-terminal-region="true"
    >
      <TerminalDock height={terminalHeight} onHeight={setTerminalHeight} />
    </div>
  {/if}
</section>
