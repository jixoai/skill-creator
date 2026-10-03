<!--
  用户原始需求 [2026-09-08]：「我们可以简单理解成，我们在 skill creator 的右侧
  嵌入了一个聊天对话框。」——2026-09-12 redesign §3.3：面板拆分为 AgentHeader /
  TranscriptView / ComposerCard 后，AgentPanel 收敛为容器（编排 + 数据接线）。
  ——2026-09-13 R17-C：面板常驻挂载（开关=收起不销毁，开合不清草稿）；≥720px
  宽度可拖拽（320–720px，左缘拖柄）；<720px 抽屉全屏覆盖。
  ——2026-10-03（skills-agent-page 1.7）：shell 级 drawer 退役——面板迁为
  workspace 页右侧 attach（+layout 挂载层按 activePageKind === "workspace" 闸）；
  内容 = 本 ws 会话列表（target.workspaceId 过滤，零新 RPC）+ 会话面
  （SessionFace，1.4 组件族——与 Agent 页双消费同一份）；「在 Agent 页打开」
  深链（/agent?session=）+ 同 session 双开角标（agentPageSessionId 数据面）。
  正交意图：
  1. attach 容器：≥720px 常驻侧栏（宽度 = agentPanel.width，DevicePrefs 持久），
     <720px 单屏覆盖；Esc 收起（模态打开时让位）；resize 拖拽（pointer 捕获）。
     R17-A：草稿按 sessionId 分轨，挂载/开合不重置。
  2. 面板纵向编排：ws 会话列表（compact）→ SessionFace（transcript/composer
     编排收敛在 1.4 组件族内）。
  妥协声明：无（各分片语义在子组件内自持）。
-->
<script lang="ts">
  import IconX from "@lucide/svelte/icons/x";
  import IconPlus from "@lucide/svelte/icons/plus";
  import IconExternalLink from "@lucide/svelte/icons/external-link";
  import IconPanelsTopLeft from "@lucide/svelte/icons/panels-top-left";
  import { page } from "$app/state";
  import {
    agentPageActiveSession,
    agentPanel,
    agentSession,
    agentSessionsList,
    beginNewAgentSession,
    loadAgentSessions,
    registerAgentSurface,
    selectAgentSession,
    setAgentPanelOpen,
    setAgentPanelWidth,
  } from "$lib/stores/agent.svelte";
  import { connectionState } from "$lib/stores/connection.svelte";
  import { t } from "$lib/i18n";
  import { tabIdForPath } from "$lib/shell/tab-session.js";
  import { navigateTab } from "$lib/shell/tab-session.svelte.js";
  import SessionFace from "./SessionFace.svelte";
  import { sessionDisplayName, sessionsForWorkspace } from "$lib/apps/agent/session-tree.js";
  import type { WorkspaceId } from "$shared/contracts/workspaces.js";

  // 双开在场注册（agentSurfaces.panel 计数——Agent 页角标的数据面之一）。
  const unregister = registerAgentSurface("panel");
  $effect(() => {
    return () => unregister();
  });

  // 本面板 attach 的 workspace（/w/:wsId/* 路径解析；非 ws 路径回退 Global）。
  const workspaceId = $derived((tabIdForPath(page.url.pathname) ?? "~") as WorkspaceId);

  // 会话列表：连接建立后拉取（面板在 ws 页常驻挂载；requireRpc 同步 throw 不入
  // effect）。每连接一次性自动拉取：失败不重试（刷新钮/重连重新武装）——无此
  // 闸时 loaded/loading 双 false 态会在失败后无限重触发。
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

  /** 本 ws 会话（target.workspaceId 过滤；createdAt 降序）。 */
  const workspaceSessions = $derived(sessionsForWorkspace(agentSessionsList.sessions, workspaceId));

  /** 双开角标：Agent 页正在显示同一会话（agent-surface spec「dual open」）。 */
  const dualOpenInAgentPage = $derived(
    agentSession.sessionId !== null && agentPageActiveSession() === agentSession.sessionId,
  );

  /** 深链到 Agent 页（激活同一会话）。 */
  function openInAgentPage(): void {
    const sessionId = agentSession.sessionId;
    if (sessionId === null) return;
    navigateTab(`/agent?session=${encodeURIComponent(sessionId)}`);
  }

  // R17-C 宽屏 resize：左缘拖柄 pointer 序列。宽度经 setAgentPanelWidth clamp
  // + 持久（DevicePrefs）；拖拽中 body 禁选择 + col-resize 光标；resizing 态
  // 摘除 width 过渡（否则拖柄滞后跟手）。
  let resizing = $state(false);
  let resizeStartX = 0;
  let resizeStartWidth = 0;

  function startResize(event: PointerEvent): void {
    if (event.button !== 0) return;
    resizing = true;
    resizeStartX = event.clientX;
    resizeStartWidth = agentPanel.width;
    // 指针捕获：移出面板/窗口后 move/up 仍送达本元素（instanceof 兼作 null 收窄）。
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
  onkeydown={(event) => {
    // 有模态（设置面/ContextMeter popover 等）打开时 Esc 归模态所有，不连带收起面板。
    if (event.key === "Escape" && agentPanel.open && !document.querySelector("[role='dialog']")) {
      setAgentPanelOpen(false);
    }
  }}
  onpointermove={(event) => {
    if (resizing) setAgentPanelWidth(resizeStartWidth + (resizeStartX - event.clientX));
  }}
  onpointerup={endResize}
  onpointercancel={endResize}
/>

<aside
  class="relative flex h-full w-full flex-col bg-background min-[720px]:w-(--agent-panel-width) min-[720px]:overflow-hidden duration-150 ease-in-out {resizing
    ? ''
    : 'min-[720px]:transition-[width,border-color] max-[720px]:transition-[transform,visibility]'} {agentPanel.open
    ? 'border-l border-border'
    : 'border-l-0 max-[720px]:translate-x-full max-[720px]:invisible'}"
  style="--agent-panel-width: {agentPanel.open ? agentPanel.width : 0}px"
  aria-label={t("agentPanel.panelAria")}
  data-agent-panel="true"
>
  <!-- 左缘拖柄（仅 ≥720px；窄屏抽屉无侧栏宽度语义）：6px col-resize 命中区。 -->
  <div
    class="absolute inset-y-0 left-0 z-10 hidden w-1.5 cursor-col-resize touch-none select-none hover:bg-primary/30 min-[720px]:block"
    role="separator"
    aria-orientation="vertical"
    aria-label={t("agentPanel.resizeAria")}
    onpointerdown={startResize}
  ></div>

  <!-- 面板头：Agent 标签 + 双开角标 + 深链 + 关闭。 -->
  <header class="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
    <span class="px-1 text-xs font-medium text-muted-foreground">{t("agentHeader.agentLabel")}</span
    >
    {#if dualOpenInAgentPage}
      <span
        class="flex shrink-0 items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"
        role="status"
        title={t("agentPanel.dualOpenHint")}
      >
        <IconPanelsTopLeft class="h-3 w-3" aria-hidden="true" />
        {t("agentPanel.dualOpenBadge")}
      </span>
    {/if}
    <span class="min-w-0 flex-1"></span>
    {#if agentSession.sessionId}
      <!-- New Session 入口（R12-B 7/8 语义平移）：仅 session 态显示；点击 = 回到
           New Session 空态（不建会话——首条消息才建）。 -->
      <button
        type="button"
        class="relative flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors after:absolute after:-inset-1.5 after:content-[''] hover:bg-muted hover:text-foreground"
        title={t("agentHeader.newSession")}
        aria-label={t("agentHeader.newSession")}
        onclick={() => beginNewAgentSession()}
      >
        <IconPlus class="h-4 w-4" />
      </button>
    {/if}
    <button
      type="button"
      class="relative flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors after:absolute after:-inset-1.5 after:content-[''] hover:bg-muted hover:text-foreground {agentSession.sessionId ===
      null
        ? 'pointer-events-none opacity-40'
        : ''}"
      title={t("agentPanel.openInAgentPage")}
      aria-label={t("agentPanel.openInAgentPage")}
      disabled={agentSession.sessionId === null}
      onclick={openInAgentPage}
    >
      <IconExternalLink class="h-4 w-4" />
    </button>
    <button
      type="button"
      class="relative flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors after:absolute after:-inset-1.5 after:content-[''] hover:bg-muted hover:text-foreground"
      title={t("agentHeader.closePanel")}
      aria-label={t("agentHeader.closePanel")}
      onclick={() => setAgentPanelOpen(false)}
    >
      <IconX class="h-4 w-4" />
    </button>
  </header>

  <!-- 本 ws 会话列表（target.workspaceId 过滤；compact 行——续聊入口）。 -->
  <div
    class="max-h-40 shrink-0 overflow-y-auto border-b border-border py-1"
    data-workspace-sessions="true"
  >
    {#if workspaceSessions.length === 0}
      <p class="px-3 py-1 text-[11px] text-muted-foreground">{t("agentPanel.noWsSessions")}</p>
    {:else}
      {#each workspaceSessions as session (session.sessionId)}
        <button
          type="button"
          class="flex h-7 w-full items-center gap-1.5 rounded px-3 text-left text-xs transition-colors {agentSession.sessionId ===
          session.sessionId
            ? 'bg-primary/10 text-primary'
            : 'text-foreground/80 hover:bg-muted'}"
          aria-current={agentSession.sessionId === session.sessionId ? "true" : undefined}
          title="{sessionDisplayName(session)} ({session.status})"
          onclick={() => selectAgentSession(session.sessionId)}
        >
          <span
            class="h-1.5 w-1.5 shrink-0 rounded-full {session.status === 'running'
              ? 'bg-primary'
              : session.status === 'disposed'
                ? 'bg-muted-foreground/40'
                : 'bg-muted-foreground'}"
            aria-hidden="true"
          ></span>
          <span class="min-w-0 flex-1 truncate">{sessionDisplayName(session)}</span>
        </button>
      {/each}
    {/if}
  </div>

  <SessionFace />
</aside>
