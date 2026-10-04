<!--
  用户原始需求 [2026-07-27]：「三个导航意味着三个 ChromeTabs」「参考 gaubee.com AppShell 标准」。
  正交意图：
  1. 注册三个 App + 管理 daemon 连接生命周期。
  2. 挂载 Shell（WindowDragRegion 顶部栏 + 左侧 AppSidebar + 右侧 TabOutlet）。
  3. 全局浮层（ImportWorkspaceDialog / CommandPalette / ToastContainer）。
  2026-09-30 shell-settings-ui：左侧导航抽为 AppSidebar 组件（展开/折叠双态
  + 标签，偏好持久化 DevicePrefs）。
-->
<script lang="ts">
  import "./layout.css";
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { beforeNavigate } from "$app/navigation";
  import { registerApps } from "$lib/apps";
  import "$lib/apps/agent/manifest.js";
  import "$lib/apps/evaluating/manifest.js";
  import { connect, connectionState, disconnect, loadWorkspaces } from "$lib/store.svelte";
  import { loadSelfSkillState } from "$lib/stores/self-skill.svelte";
  import { captureTokenFromHash } from "$lib/rpc-client";
  import { setNavControllerAdapter } from "$lib/shell";
  import PageOutlet from "$lib/shell/PageOutlet.svelte";
  import TabStrip from "$lib/shell/TabStrip.svelte";
  import Omnibox from "$lib/shell/Omnibox.svelte";
  import WorkspaceNavigation from "$lib/shell/WorkspaceNavigation.svelte";
  import { toggleWorkspaceNavigation } from "$lib/shell/workspace-navigation.svelte.js";
  import WindowDragRegion from "$lib/components/window-drag-region.svelte";
  import ImportWorkspaceDialog from "$lib/components/import-workspace-dialog.svelte";
  import CommandPalette from "$lib/components/command-palette.svelte";
  import ToastContainer from "$lib/components/toast-container.svelte";
  import { TooltipProvider } from "$lib/components/ui/tooltip";
  import {
    CREATOR_MINIMUM_WINDOW_SIZE,
    ensureMinimumWindowSize,
    HOME_MINIMUM_WINDOW_SIZE,
  } from "$lib/window-size";
  import IconCommand from "@lucide/svelte/icons/command";
  import IconRefresh from "@lucide/svelte/icons/refresh-cw";
  import AgentPanel from "$lib/components/agent/AgentPanel.svelte";
  import { agentPanel } from "$lib/stores/agent.svelte";
  import { resolveShellRoute, sanitizeShellLocation } from "$lib/shell/route-hygiene.js";
  import {
    consumeExpectedNavigation,
    initializeTabSession,
    navigateTab,
    openImportedWorkspaceTabs,
    reconcileAvailableWorkspaceTabs,
    syncExternalLocation,
  } from "$lib/shell/tab-session.svelte.js";
  import { workspaceState } from "$lib/stores/workspaces.svelte";
  import { t } from "$lib/i18n";

  // 顶层注册（在任何 $derived 之前执行，确保 appRegistry 在首次渲染时已填充）。
  registerApps();

  let { children } = $props();

  let sessionInitialized = false;
  let observedImportedWorkspaceIds: Set<string> | null = null;

  beforeNavigate((navigation) => {
    if (!navigation.to || navigation.willUnload) return;
    const path = `${navigation.to.url.pathname}${navigation.to.url.search}`;
    if (consumeExpectedNavigation(path)) return;
    navigation.cancel();
    navigateTab(path, "PUSH");
  });

  onMount(() => {
    // 在任何导航之前先 capture token 到 sessionStorage（防止 goto 清掉 hash）。
    captureTokenFromHash();
    setNavControllerAdapter({
      navigate(path, action = "PUSH") {
        navigateTab(path, action);
      },
    });
    const handlePopstate = () => {
      queueMicrotask(() =>
        syncExternalLocation(`${globalThis.location.pathname}${globalThis.location.search}`),
      );
    };
    globalThis.addEventListener("popstate", handlePopstate);
    connect();
    return () => {
      globalThis.removeEventListener("popstate", handlePopstate);
      disconnect();
    };
  });

  let pathname = $derived(page.url.pathname);
  $effect(() => {
    if (pathname.includes("/creator")) {
      void ensureMinimumWindowSize(CREATOR_MINIMUM_WINDOW_SIZE);
    } else {
      void ensureMinimumWindowSize(HOME_MINIMUM_WINDOW_SIZE);
    }
  });

  let connected = $derived(connectionState.status === "connected");
  $effect(() => {
    if (connected) {
      void loadWorkspaces();
      // self-skill 冲突提醒随连接重试（组件挂载时 rpc 可能尚未就绪）。
      void loadSelfSkillState();
    }
  });

  $effect(() => {
    if (sessionInitialized || !connected || workspaceState.loading) return;
    sessionInitialized = true;
    const importedIds = workspaceState.workspaces
      .filter((workspace) => workspace.kind === "directory")
      .map((workspace) => workspace.id);
    const redirect = initializeTabSession(importedIds, page.url.pathname, page.url.search);
    if (redirect) {
      // 走查 P2-7 / 修复批 F 诊断：effect 执行上下文内同步启航导航会毒化本
      // 组件对 page.url 的依赖传播（与 PageOutlet 同族修复）——宏任务推迟 +
      // 执行时按当前 URL 复核（期间并行守卫可能已修正；过期重定向不覆盖）。
      const target = redirect;
      setTimeout(() => {
        const current = `${page.url.pathname}${page.url.search}`;
        if (current === target) return;
        // HygieneDecision 是判别对象（非 nullable）——kind=ok 表示期间并行
        // 守卫已把 URL 修正合法，过期重定向跳过。
        const decision = sanitizeShellLocation(page.url.pathname, page.url.search);
        if (decision.kind === "ok") return;
        navigateTab(target, "REPLACE");
      }, 0);
    }
  });

  $effect(() => {
    if (!sessionInitialized) return;
    const importedWorkspaces = workspaceState.workspaces.filter(
      (workspace) => workspace.kind === "directory",
    );
    const importedIds = importedWorkspaces.map((workspace) => workspace.id);
    const previousIds = observedImportedWorkspaceIds;
    observedImportedWorkspaceIds = new Set(importedIds);
    if (previousIds !== null) {
      const addedIds = importedWorkspaces
        .filter((workspace) => !previousIds.has(workspace.id))
        .map((workspace) => workspace.id);
      if (addedIds.length > 0) openImportedWorkspaceTabs(addedIds);
    }
    reconcileAvailableWorkspaceTabs(importedIds);
  });

  const activePageKind = $derived(
    resolveShellRoute(page.url.pathname, page.url.search)?.app.pageKind ?? null,
  );

  // omnibox 每 tab 独立实例（Owner 2026-10-03 裁决）：workspace 页按 wsId、
  // 其余 Page 按 kind keyed 重建——切换即销毁重建，编辑草稿/焦点/补全面板
  // 不跨 tab 串扰；URL 显示仍从路由真相派生（本就对当前 tab）。
  const omniboxTabKey = $derived.by(() => {
    if (activePageKind !== "workspace") return `page:${activePageKind ?? "none"}`;
    // workspace 路由恒为 /w/:wsId/…——path 段直取（避免整棵 match 重算）。
    const wsId = /^\/w\/([^/]+)/.exec(page.url.pathname)?.[1] ?? "~";
    return `ws:${decodeURIComponent(wsId)}`;
  });
</script>

<svelte:head>
  <link rel="icon" href="/icons/monochrome-mini.png" type="image/png" />
  <link rel="apple-touch-icon" href="/icons/monochrome-mini.png" />
</svelte:head>

<TooltipProvider>
  <div
    class="relative flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground"
  >
    <!-- 顶部栏（原生拖拽区域 + 工具栏） -->
    <WindowDragRegion variant="main">
      {#snippet left()}
        <span class="px-1 text-xs font-medium text-muted-foreground">{t("shell.brandName")}</span>
      {/snippet}
      {#snippet right()}
        <button
          class="no-drag flex h-6 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground max-[720px]:h-11 max-[720px]:w-11"
          aria-label={t("shell.openCommandPalette")}
          aria-keyshortcuts="Meta+K"
          title={t("shell.commandPaletteTitle")}
          onclick={() =>
            globalThis.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
        >
          <IconCommand class="h-3.5 w-3.5" />
        </button>
        <button
          class="no-drag flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground max-[720px]:h-11 max-[720px]:w-11"
          aria-label={t("shell.reloadApp")}
          title={t("shell.reload")}
          onclick={() => globalThis.location.reload()}
        >
          <IconRefresh class="h-3.5 w-3.5" />
        </button>
      {/snippet}
    </WindowDragRegion>

    <TabStrip />
    {#key omniboxTabKey}
      <Omnibox onToggleNavigation={toggleWorkspaceNavigation} />
    {/key}

    {#if connectionState.status === "disconnected"}
      <div
        class="flex min-h-8 items-center border-y border-destructive/30 bg-destructive/8 px-3 text-xs text-destructive"
        role="status"
      >
        {connectionState.error}
      </div>
    {/if}

    <!-- 主体：Workspace Page 使用左导航；其他 Page 占满内容区。 -->
    <div class="relative flex min-h-0 flex-1">
      {#if activePageKind === "workspace"}
        <WorkspaceNavigation />
      {/if}

      <!-- 右侧：Shell 内容区 + Agent 面板层。R17-C：常驻挂载——开关只是收起。
           skills-agent-page 1.7：shell 级 drawer 退役——面板 attach 到 workspace
           页（activePageKind 闸；非 workspace 页不挂载）。 -->
      <main class="min-w-0 flex-1 overflow-hidden">
        <PageOutlet />
        {@render children?.()}
      </main>
      {#if activePageKind === "workspace"}
        <div
          class="agent-panel-layer shrink-0 max-[720px]:absolute max-[720px]:inset-0 max-[720px]:z-40 {agentPanel.open
            ? ''
            : 'pointer-events-none'}"
        >
          <AgentPanel />
        </div>
      {/if}
    </div>
  </div>
</TooltipProvider>

<ImportWorkspaceDialog />
<CommandPalette />
<ToastContainer />
