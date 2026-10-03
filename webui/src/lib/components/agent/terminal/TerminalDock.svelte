<!--
  终端容器（skills-agent-page 1.6）：多 tab + xterm pane + 拖高分隔条 + 首开提示。
  用户原始需求 [2026-10-03]（design §1/§4）：「终端（人类 PTY，xterm.js；可多
  tab；可拖高）」「终端首开 MUST 展示非 sandbox 权限提示」。
  正交意图：
    [1] tab 编排：tab 条（活动切换/关闭/新建——并发 ≤4 客户端预判禁用）+
        活动 pane（TerminalPane 懒加载 chunk）+ 空态。
    [2] 拖高分隔条：上缘拖柄 pointer 序列（捕获 + body 禁选择），clamp 到
        AGENT_TERMINAL_MIN/MAX_HEIGHT 后逐帧回调 onHeight（持久由宿主页面
        落 DevicePrefs——dock 不持偏好真相）。
    [3] 首开提示（非 sandbox 如实声明）：!noticeAcknowledged 时展示权限声明
        条（human-terminal spec「首开提示」场景）；确认入 sessionStorage。
    [4] 连接意向：挂载即 setTerminalWanted(true)（触发协议客户端连接/重连），
        卸载交还（无 tab 时客户端停连）。
  妥协声明：无。
-->
<script lang="ts">
  import IconPlus from "@lucide/svelte/icons/plus";
  import IconX from "@lucide/svelte/icons/x";
  import IconTerminal from "@lucide/svelte/icons/terminal";
  import { t } from "$lib/i18n";
  import { AGENT_TERMINAL_MAX_HEIGHT, AGENT_TERMINAL_MIN_HEIGHT } from "$lib/shell/device-prefs.js";
  import {
    TERMINAL_MAX_LIVE,
    acknowledgeTerminalNotice,
    aliveTerminalCount,
    closeTerminalTab,
    createTerminalTab,
    setActiveTerminal,
    setTerminalWanted,
    terminalState,
  } from "./terminal-client.svelte";
  import TerminalPane from "./TerminalPane.svelte";

  let {
    height,
    onHeight,
  }: {
    /** 容器当前高度（px；拖拽回调逐帧上抛，持久归宿主）。 */
    height: number;
    onHeight: (next: number) => void;
  } = $props();

  setTerminalWanted(true);
  $effect(() => {
    return () => setTerminalWanted(false);
  });

  const activeTab = $derived(
    terminalState.tabs.find((tab) => tab.sessionId === terminalState.activeSessionId) ??
      terminalState.tabs[0] ??
      null,
  );

  let resizing = $state(false);
  let resizeStartY = 0;
  let resizeStartHeight = 0;

  function startResize(event: PointerEvent): void {
    if (event.button !== 0) return;
    resizing = true;
    resizeStartY = event.clientY;
    resizeStartHeight = height;
    const target = event.currentTarget;
    if (target instanceof HTMLElement) target.setPointerCapture(event.pointerId);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "row-resize";
  }

  function endResize(): void {
    if (!resizing) return;
    resizing = false;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  }

  function clampHeight(value: number): number {
    if (!Number.isFinite(value)) return height;
    return Math.min(
      AGENT_TERMINAL_MAX_HEIGHT,
      Math.max(AGENT_TERMINAL_MIN_HEIGHT, Math.round(value)),
    );
  }
</script>

<svelte:window
  onpointermove={(event) => {
    if (resizing) onHeight(clampHeight(resizeStartHeight + (resizeStartY - event.clientY)));
  }}
  onpointerup={endResize}
  onpointercancel={endResize}
/>

<section
  class="flex flex-col border-t border-border bg-background"
  style="height: {height}px"
  aria-label={t("terminal.dockAria")}
  data-terminal-dock="true"
>
  <!-- 上缘拖柄（拖高）：6px row-resize 命中区。 -->
  <div
    class="relative z-10 h-1.5 w-full shrink-0 cursor-row-resize touch-none select-none hover:bg-primary/30"
    role="separator"
    aria-orientation="horizontal"
    aria-label={t("terminal.resizeAria")}
    onpointerdown={startResize}
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

  <div class="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2">
    <IconTerminal class="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
    <div class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" role="tablist">
      {#each terminalState.tabs as tab (tab.sessionId)}
        <button
          type="button"
          role="tab"
          aria-selected={tab.sessionId === activeTab?.sessionId}
          class="flex h-6 shrink-0 items-center gap-1 rounded-md border px-2 text-[11px] transition-colors {tab.sessionId ===
          activeTab?.sessionId
            ? 'border-primary/40 bg-primary/10 text-primary'
            : 'border-border bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground'}"
          onclick={() => setActiveTerminal(tab.sessionId)}
        >
          <span class="max-w-32 truncate">{tab.title}</span>
          {#if tab.creating}
            <span class="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-muted-foreground/60"
            ></span>
          {:else if !tab.alive}
            <span class="shrink-0 text-[10px] text-muted-foreground"
              >exit {tab.exitCode ?? "?"}</span
            >
          {/if}
          <span
            class="relative flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground/70 after:absolute after:-inset-1 after:content-[''] hover:bg-accent hover:text-foreground"
            role="button"
            tabindex="-1"
            aria-label={t("terminal.closeTabAria", { title: tab.title })}
            onclick={(event) => {
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

  <div class="relative min-h-0 flex-1">
    {#if activeTab}
      {#key activeTab.sessionId}
        <TerminalPane sessionId={activeTab.sessionId} />
      {/key}
    {:else}
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
