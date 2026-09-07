<!--
  用户原始需求 [2026-07-27]：「三个导航意味着三个 ChromeTabs」「参考 gaubee.com AppShell 标准」。
  正交意图：
  1. 注册三个 App + 管理 daemon 连接生命周期。
  2. 挂载 Shell（WindowDragRegion 顶部栏 + 左侧 App 导航 + 右侧 TabOutlet）。
  3. 全局浮层（ImportWorkspaceDialog / CommandPalette / ToastContainer）。
  妥协声明：左侧导航是 ChromeTabShell 简化版（三 App 图标 + 导入入口），AppSidebar 的完整功能后续迭代。
-->
<script lang="ts">
  import "./layout.css";
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { registerApps } from "$lib/apps";
  import { connect, connectionState, disconnect, loadWorkspaces } from "$lib/store.svelte";
  import { requestImportWorkspace } from "$lib/stores/import-workspace.svelte";
  import { captureTokenFromHash } from "$lib/rpc-client";
  import { appRegistry, resolveTabIdentity, setNavControllerAdapter } from "$lib/shell";
  import TabOutlet from "$lib/shell/TabOutlet.svelte";
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
  import IconPlus from "@lucide/svelte/icons/folder-plus";
  import IconAgent from "@lucide/svelte/icons/message-square";
  import AgentPanel from "$lib/components/agent/AgentPanel.svelte";
  import { agentPanel, setAgentPanelOpen } from "$lib/stores/agent.svelte";

  // 顶层注册（在任何 $derived 之前执行，确保 appRegistry 在首次渲染时已填充）。
  registerApps();

  let { children } = $props();

  onMount(() => {
    // 在任何导航之前先 capture token 到 sessionStorage（防止 goto 清掉 hash）。
    captureTokenFromHash();
    if (page.url.pathname === "/") {
      void goto("/workspaces", { replaceState: true });
    }
    setNavControllerAdapter({
      navigate(path, action) {
        // REPLACE 必须走 goto({replaceState:true})：本版本 replaceState 浅路由
        // 不更新响应式 page.url，search 派生会失联；keepFocus 保住筛选输入焦点。
        if (action === "REPLACE") {
          void goto(path, { replaceState: true, keepFocus: true, noScroll: true });
        } else {
          void goto(path);
        }
      },
    });
    connect();
    return disconnect;
  });

  let pathname = $derived(page.url.pathname);
  $effect(() => {
    if (pathname.startsWith("/creator")) {
      void ensureMinimumWindowSize(CREATOR_MINIMUM_WINDOW_SIZE);
    } else {
      void ensureMinimumWindowSize(HOME_MINIMUM_WINDOW_SIZE);
    }
  });

  let connected = $derived(connectionState.status === "connected");
  $effect(() => {
    if (connected) void loadWorkspaces();
  });

  const apps = $derived(appRegistry.list());
  const activeAppId = $derived(resolveTabIdentity(page.url.pathname)?.app ?? null);

  function switchApp(appId: string): void {
    void goto(`/${appId}`);
  }
</script>

<svelte:head>
  <link rel="icon" href="/icons/monochrome-mini.png" type="image/png" />
  <link rel="apple-touch-icon" href="/icons/monochrome-mini.png" />
</svelte:head>

<TooltipProvider>
  <div class="relative flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
    <!-- 顶部栏（原生拖拽区域 + 工具栏） -->
    <WindowDragRegion variant="main">
      {#snippet left()}
        <span class="px-1 text-xs font-medium text-muted-foreground">Skill Creator</span>
      {/snippet}
      {#snippet right()}
        <button
          class="no-drag flex h-6 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground max-[720px]:h-11 max-[720px]:w-11"
          onpointerdown={(e) => e.stopPropagation()}
          aria-label="Open command palette"
          aria-keyshortcuts="Meta+K"
          title="Command palette (Cmd+K)"
          onclick={() =>
            globalThis.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
        >
          <IconCommand class="h-3.5 w-3.5" />
        </button>
        <button
          class="no-drag flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground max-[720px]:h-11 max-[720px]:w-11"
          onpointerdown={(e) => e.stopPropagation()}
          aria-label="Reload app"
          title="Reload"
          onclick={() => globalThis.location.reload()}
        >
          <IconRefresh class="h-3.5 w-3.5" />
        </button>
        <button
          class="no-drag flex h-6 w-6 items-center justify-center rounded transition-colors {agentPanel.open
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:text-foreground'} max-[720px]:h-11 max-[720px]:w-11"
          onpointerdown={(e) => e.stopPropagation()}
          aria-label="Toggle agent panel"
          title="Agent panel"
          aria-pressed={agentPanel.open}
          onclick={() => setAgentPanelOpen(!agentPanel.open)}
        >
          <IconAgent class="h-3.5 w-3.5" />
        </button>
      {/snippet}
    </WindowDragRegion>

    {#if connectionState.status === "disconnected"}
      <div
        class="flex min-h-8 items-center border-y border-destructive/30 bg-destructive/8 px-3 text-xs text-destructive"
        role="status"
      >
        {connectionState.error}
      </div>
    {/if}

    <!-- 主体：左侧 App 导航 + 右侧 TabOutlet -->
    <div class="flex min-h-0 flex-1">
      <nav
        class="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-border bg-muted/30 py-3"
      >
        {#each apps as app (app.id)}
          {@const Icon = app.icon}
          <button
            class="flex h-10 w-10 items-center justify-center rounded-lg transition-colors hover:bg-muted {activeAppId ===
            app.id
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground'}"
            title={app.name}
            aria-label={app.name}
            aria-current={activeAppId === app.id ? "page" : undefined}
            onclick={() => switchApp(app.id)}
          >
            <Icon class="h-5 w-5" />
          </button>
        {/each}

        <!-- 分隔线 + 导入 workspace 入口 -->
        <div class="my-1 h-px w-8 bg-border"></div>
        <button
          class="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Import workspace"
          aria-label="Import workspace"
          onclick={() => requestImportWorkspace()}
        >
          <IconPlus class="h-5 w-5" />
        </button>
      </nav>

      <!-- 右侧：Shell 内容区 + Agent 面板 drawer（shell 级、跨 tab 存活） -->
      <main class="min-w-0 flex-1 overflow-hidden">
        <TabOutlet />
        {@render children?.()}
      </main>
      {#if agentPanel.open}
        <div class="agent-panel-layer max-[720px]:absolute max-[720px]:inset-0 max-[720px]:z-40">
          <AgentPanel />
        </div>
      {/if}
    </div>
  </div>
</TooltipProvider>

<ImportWorkspaceDialog />
<CommandPalette />
<ToastContainer />
