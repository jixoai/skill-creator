<!--
  终端容器（skills-agent-page 1.6 → skills-agent-page-zcode-parity 2.1/2.2/2.3）。
  用户原始需求 [2026-10-04]（design §2）：「让 Agent terminal session 明确绑定当前
  Workspace target；tab 展示真实 shell label 与 create 状态」「对齐初始关闭、约 30%
  展开与 140px–50% 约束；关闭时记忆本次展开尺寸；添加 separator 键盘 resize 与
  CmdOrCtrl+J」「每个 session 独立保活 xterm/pane；激活时执行 fit→focus」。
  ZCode 逐条对照：
    - Terminal.tsx:49 workspaceKey 分区（workspace prop → setTerminalWorkspace）
    - Terminal.tsx:294-356 头部：标题 + 活动 shell label + tab 条 + [+] + [X 关面板]
    - Terminal.tsx:358-382 全 session forceMount：所有 tab 的 pane 常驻，非活动
      hidden（切换/跨 workspace 不重造 xterm；PTY 亦不杀）
    - TerminalTabTrigger.tsx tab 外观（h-7 透明边、活动 selected、close 悬停/聚焦显现）
    - AnimatedTerminalPanel.tsx:103-109 minSize 140px / maxSize 50%
    - WorkspaceShellLayout.tsx:410 expandedSize 30%（0 哨兵 → 首开默认）
    - useAnimatedResizablePanel rememberExpandedSize：关闭记忆展开尺寸（本仓经
      DevicePrefs px 承载 + 比例跟随视口）
  正交意图：
    [1] tab 编排：当前 workspace 的 tab 条（切换/关闭/新建——并发 ≤4 客户端预判）
        + 全量 pane 保活（uiKey 键控）+ 空态。
    [2] 几何：拖柄 pointer + 键盘（↑↓ ±16px / Home / End，role=separator ARIA）；
        clamp [140, 50%×视口]；拖拽期本地预览、松手提交（onHeight 持久归宿主）；
        用户定寸后高度按比例跟随视口（ZCode % panel 语义）。
    [3] 首开提示（非 sandbox 如实声明）：!noticeAcknowledged 时展示权限声明条。
    [4] 连接意向：挂载即 setTerminalWanted(true)，卸载交还；close-panel 语义经
        bindTerminalPanelClose 接 onClose prop。
  妥协声明：（a）`CmdOrCtrl+J` 的匹配与注册由容器批的
    apps/agent/agent-layout.ts matchAgentShellShortcut（"toggle-terminal"）承载——
    dock 卸载态无法自持全局热键，本域不持第二份绑定真相；（b）本仓 4 并发上限
    徽章为 daemon 契约 affordance（ZCode 无上限，不删不增语义）。
-->
<script lang="ts">
  import IconPlus from "@lucide/svelte/icons/plus";
  import IconX from "@lucide/svelte/icons/x";
  import IconTerminal from "@lucide/svelte/icons/terminal";
  import { t } from "$lib/i18n";
  import { readDevicePrefs } from "$lib/shell/device-prefs.js";
  import { TERMINAL_DEFAULT_WORKSPACE_KEY } from "./terminal-tabs.js";
  import {
    TERMINAL_KEYBOARD_STEP_PX,
    TERMINAL_MIN_HEIGHT_PX,
    clampTerminalHeightPx,
    defaultTerminalHeightPx,
    terminalMaxHeightPx,
  } from "./terminal-geometry.js";
  import {
    TERMINAL_MAX_LIVE,
    acknowledgeTerminalNotice,
    aliveTerminalCount,
    bindTerminalPanelClose,
    closeTerminalTab,
    createTerminalTab,
    setActiveTerminal,
    setTerminalWanted,
    setTerminalWorkspace,
    terminalState,
  } from "./terminal-client.svelte";
  import TerminalPane from "./TerminalPane.svelte";

  let {
    height,
    onHeight,
    workspace = null,
    onClose = undefined,
  }: {
    /** 容器当前高度（px；显式用户定寸提交时回调，持久归宿主）。 */
    height: number;
    onHeight: (next: number) => void;
    /** 当前 Workspace 分区上下文（ZCode workspaceIdentity/cwd；缺省 __default__）。 */
    workspace?: { key: string; cwd?: string } | null;
    /** 面板关闭（ZCode Terminal onClose：最后 tab 的 x、close-panel 语义出口）。 */
    onClose?: () => void;
  } = $props();

  setTerminalWanted(true);
  $effect(() => {
    return () => setTerminalWanted(false);
  });

  // ---- workspace 分区（ZCode Terminal.tsx:49/67-82：切换只换可见 tab，不杀 PTY）----
  $effect(() => {
    setTerminalWorkspace(workspace?.key ?? TERMINAL_DEFAULT_WORKSPACE_KEY, {
      ...(workspace?.cwd !== undefined ? { cwd: workspace.cwd } : {}),
    });
  });

  // close-panel 出口（无 onClose 时 client 走移除回退）。
  $effect(() => {
    if (onClose === undefined) return;
    return bindTerminalPanelClose(onClose);
  });

  const activeWorkspace = $derived(
    terminalState.workspaces.find((item) => item.key === terminalState.activeWorkspaceKey) ?? null,
  );
  const workspaceTabs = $derived(
    (activeWorkspace?.sessionIds ?? [])
      .map((sessionId) => terminalState.tabs.find((tab) => tab.sessionId === sessionId))
      .filter((tab): tab is (typeof terminalState.tabs)[number] => tab !== undefined),
  );
  const activeTab = $derived(
    workspaceTabs.find((tab) => tab.sessionId === activeWorkspace?.activeSessionId) ??
      workspaceTabs[0] ??
      null,
  );

  // ---- 几何（2.2）：basis = 视口高（全幅应用列 ≈ 分栏容器高）。----
  let basisHeight = $state(typeof window !== "undefined" ? window.innerHeight : 768);
  /** 拖拽期本地预览（未提交；松手一次性 onHeight——避免逐帧持久化）。 */
  let dragHeight = $state<number | null>(null);
  /** 用户显式定寸比例（拖/键盘后高度按比例跟随视口——ZCode % panel 语义）。 */
  let userRatio = $state<number | null>(null);
  /** 比例跟随视口的防抖提交（记忆展开尺寸≈ZCode rememberExpandedSize）。 */
  let ratioCommitTimer: ReturnType<typeof setTimeout> | null = null;
  let lastCommittedPx: number | null = null;

  const maxHeightPx = $derived(terminalMaxHeightPx(basisHeight));
  const displayHeight = $derived.by(() => {
    if (dragHeight !== null) return dragHeight;
    if (userRatio !== null) return clampTerminalHeightPx(userRatio * basisHeight, basisHeight);
    return clampTerminalHeightPx(height, basisHeight);
  });

  // 首开自动哨兵（DevicePrefs 高度 0 = 未定寸）：提交 ~30% 展开默认。
  $effect(() => {
    if (readDevicePrefs().agentTerminalHeight === 0) {
      const next = defaultTerminalHeightPx(basisHeight);
      lastCommittedPx = next;
      onHeight(next);
    }
  });

  // 用户定寸后：视口变化按比例跟随，防抖提交记忆值。
  $effect(() => {
    void basisHeight;
    if (userRatio === null) return;
    if (ratioCommitTimer !== null) clearTimeout(ratioCommitTimer);
    ratioCommitTimer = setTimeout(() => {
      ratioCommitTimer = null;
      const next = clampTerminalHeightPx((userRatio ?? 0) * basisHeight, basisHeight);
      if (next === lastCommittedPx) return;
      lastCommittedPx = next;
      onHeight(next);
    }, 400);
  });

  function commitHeight(px: number): void {
    const next = clampTerminalHeightPx(px, basisHeight);
    dragHeight = null;
    userRatio = next / basisHeight;
    lastCommittedPx = next;
    onHeight(next);
  }

  // ---- 分隔条：pointer 拖拽（2.2，既有行为保留）+ 键盘 resize（新增）。 ----
  let resizing = $state(false);
  let resizeStartY = 0;
  let resizeStartHeight = 0;

  function startResize(event: PointerEvent): void {
    if (event.button !== 0) return;
    resizing = true;
    resizeStartY = event.clientY;
    resizeStartHeight = displayHeight;
    const target = event.currentTarget;
    if (target instanceof HTMLElement) target.setPointerCapture(event.pointerId);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "row-resize";
  }

  function dragResize(clientY: number): void {
    if (!resizing) return;
    const next = clampTerminalHeightPx(resizeStartHeight + (resizeStartY - clientY), basisHeight);
    dragHeight = next;
    userRatio = next / basisHeight;
  }

  function endResize(): void {
    if (!resizing) return;
    resizing = false;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    if (userRatio !== null) {
      const next = clampTerminalHeightPx(userRatio * basisHeight, basisHeight);
      dragHeight = null;
      if (next !== lastCommittedPx) {
        lastCommittedPx = next;
        onHeight(next);
      }
    }
    dragHeight = null;
  }

  function handleSeparatorKeydown(event: KeyboardEvent): void {
    let next: number | null = null;
    if (event.key === "ArrowUp") next = displayHeight + TERMINAL_KEYBOARD_STEP_PX;
    else if (event.key === "ArrowDown") next = displayHeight - TERMINAL_KEYBOARD_STEP_PX;
    else if (event.key === "Home") next = TERMINAL_MIN_HEIGHT_PX;
    else if (event.key === "End") next = maxHeightPx;
    if (next === null) return;
    event.preventDefault();
    commitHeight(next);
  }
</script>

<svelte:window
  bind:innerHeight={basisHeight}
  onpointermove={(event) => dragResize(event.clientY)}
  onpointerup={endResize}
  onpointercancel={endResize}
/>

<section
  class="flex flex-col border-t border-border bg-background"
  style="height: {displayHeight}px"
  aria-label={t("terminal.dockAria")}
  data-terminal-dock="true"
>
  <!-- 上缘拖柄（拖高 + 键盘 resize）：role=separator ARIA（valuemin/max/now）。
       可聚焦分隔条是 ARIA authoring practices 认可的交互控件（键盘 resize）；
       svelte 编译器的 noninteractive-tabindex 规则不识别此变体，显式豁免。 -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="relative z-10 h-1.5 w-full shrink-0 cursor-row-resize touch-none select-none hover:bg-primary/30 focus-visible:bg-primary/30 focus-visible:outline-none"
    role="separator"
    aria-orientation="horizontal"
    aria-label={t("terminal.resizeAria")}
    aria-valuemin={TERMINAL_MIN_HEIGHT_PX}
    aria-valuemax={maxHeightPx}
    aria-valuenow={displayHeight}
    tabindex="0"
    onpointerdown={startResize}
    onkeydown={handleSeparatorKeydown}
  ></div>

  {#if !terminalState.noticeAcknowledged}
    <!-- 非 sandbox 权限如实声明（human-terminal spec 首开提示场景）。 -->
    <div
      class="flex shrink-0 items-center justify-between gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-700 dark:text-amber-400"
      role="note"
    >
      <span>{t("terminal.notice")}</span>
      <button
        type="button"
        class="relative shrink-0 rounded px-2 py-0.5 font-medium after:absolute after:-inset-1 after:content-[''] hover:bg-amber-500/20"
        onclick={acknowledgeTerminalNotice}
      >
        {t("terminal.noticeAck")}
      </button>
    </div>
  {/if}

  <!-- 头部（ZCode Terminal.tsx:294-356）：标题 + 活动 shell label + tab 条 + 动作位。 -->
  <div class="flex h-8 shrink-0 items-center gap-1.5 border-b border-border px-2">
    <div class="flex min-w-0 shrink-0 items-center gap-1.5">
      <IconTerminal class="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span class="truncate text-[11px] font-medium text-foreground">{t("terminal.tabTitle")}</span>
      {#if activeTab?.shellLabel}
        <span class="shrink-0 text-[11px] text-muted-foreground" data-terminal-shell-label="true"
          >{activeTab.shellLabel}</span
        >
      {/if}
    </div>

    <div class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" role="tablist">
      {#each workspaceTabs as tab (tab.uiKey)}
        <button
          type="button"
          role="tab"
          aria-selected={tab.sessionId === activeTab?.sessionId}
          class="group relative flex h-7 shrink-0 items-center gap-1 rounded-lg border border-transparent pl-2 pr-1 text-[11px] font-medium transition-colors {tab.sessionId ===
          activeTab?.sessionId
            ? 'bg-primary/10 text-primary'
            : 'bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground'} focus-visible:outline-1 focus-visible:outline-ring"
          onclick={() => setActiveTerminal(tab.sessionId)}
        >
          <span class="max-w-36 truncate">{tab.title}</span>
          {#if tab.creating}
            <span class="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-muted-foreground/60"
            ></span>
          {/if}
          <span
            class="relative flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground/70 after:absolute after:-inset-1 after:content-[''] hover:bg-accent hover:text-foreground {tab.sessionId ===
            activeTab?.sessionId
              ? ''
              : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100'}"
            role="button"
            tabindex="-1"
            aria-label={t("terminal.closeTabAria", { title: tab.title })}
            onclick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              closeTerminalTab(tab.sessionId);
            }}
            onkeydown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                closeTerminalTab(tab.sessionId);
              }
            }}
          >
            <IconX class="h-3 w-3" />
          </span>
        </button>
      {/each}
    </div>
    <div class="flex shrink-0 items-center gap-1">
      <button
        type="button"
        class="relative flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-muted hover:text-foreground disabled:opacity-40"
        title={t("terminal.newTab")}
        aria-label={t("terminal.newTab")}
        disabled={aliveTerminalCount() >= TERMINAL_MAX_LIVE}
        onclick={() => createTerminalTab()}
      >
        <IconPlus class="h-3.5 w-3.5" />
      </button>
      {#if onClose !== undefined}
        <!-- 关闭面板（ZCode TID_TERMINAL_CLOSE_BUTTON：只收起 UI，session 保活）。 -->
        <button
          type="button"
          class="relative flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-muted hover:text-foreground"
          title="Close terminal"
          aria-label="Close terminal"
          data-terminal-close-panel="true"
          onclick={onClose}
        >
          <IconX class="h-3.5 w-3.5" />
        </button>
      {/if}
      <span
        class="shrink-0 text-[10px] text-muted-foreground"
        title={t("terminal.statusTitle", {
          status: terminalState.status,
          count: aliveTerminalCount(),
          max: TERMINAL_MAX_LIVE,
        })}
      >
        {t("terminal.statusBadge", { count: aliveTerminalCount(), max: TERMINAL_MAX_LIVE })}
      </span>
    </div>
  </div>

  <!-- pane 层（2.3，ZCode Terminal.tsx:358-382 forceMount）：全部 workspace 的所有
       tab 常驻 pane（uiKey 键控），非活动 display:none；切换/跨 workspace 不重造。 -->
  <div class="relative min-h-0 flex-1">
    {#each terminalState.tabs as tab (tab.uiKey)}
      <TerminalPane
        sessionId={tab.sessionId}
        active={tab.sessionId === activeTab?.sessionId}
        {resizing}
      />
    {/each}
    {#if workspaceTabs.length === 0}
      <div class="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
        <p>{t("terminal.empty")}</p>
        <button
          type="button"
          class="relative rounded border border-border px-2 py-0.5 text-[11px] transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-muted disabled:opacity-40"
          disabled={aliveTerminalCount() >= TERMINAL_MAX_LIVE}
          onclick={() => createTerminalTab()}
        >
          {t("terminal.newTab")}
        </button>
      </div>
    {/if}
  </div>
</section>
