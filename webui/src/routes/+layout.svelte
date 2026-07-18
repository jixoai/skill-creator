<script lang="ts">
  /**
   * 原始需求 [2026-07-14]：「导航栏、顶部栏，都参考 pnpm-pub 进行创作」。
   * 正交意图：
   * 1. 管理 daemon 连接生命周期。
   * 2. 按路由同步原生窗口尺寸。
   * 3. 组合工作台导航与全局浮层。
   */
  import "./layout.css";
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import {
    completeAutoClose,
    connect,
    connectionState,
    disconnect,
    ensureTraySubscription,
    loadWorkspaces,
    setTrayRoute,
    setWindowAutoCloseCountdown,
    trayState,
  } from "$lib/store.svelte";
  import { initWindowVisibility } from "$lib/window-visibility";
  import type { ImportedWorkspace } from "$lib/types";
  import { confirmRemoveWorkspace } from "$lib/workspace-removal";
  import { goto } from "$app/navigation";
  import WindowDragRegion from "$lib/components/window-drag-region.svelte";
  import AppSidebar from "$lib/components/app-sidebar.svelte";
  import ImportWorkspaceDialog from "$lib/components/import-workspace-dialog.svelte";
  import CommandPalette from "$lib/components/command-palette.svelte";
  import ToastContainer from "$lib/components/toast-container.svelte";
  import { resizeWindow, CREATOR_WINDOW_SIZE, HOME_WINDOW_SIZE } from "$lib/window-size";
  import { TooltipProvider } from "$lib/components/ui/tooltip";
  import IconCommand from "@lucide/svelte/icons/command";
  import IconRefresh from "@lucide/svelte/icons/refresh-cw";

  let { children } = $props();
  let importDialog: ImportWorkspaceDialog;

  async function handleRemoveWorkspace(workspace: ImportedWorkspace): Promise<void> {
    if (await confirmRemoveWorkspace(workspace)) {
      if (page.url.pathname.startsWith(`/workspace/${workspace.id}`)) await goto("/workspace/~");
    }
  }

  onMount(() => {
    // 页面拥有的退出/进入动画：镜像原生窗口 opacity，并在动画完成后回调 daemon 关窗。
    const stopWindowVisibility = initWindowVisibility({
      getState: () => ({
        visibility: trayState.windowVisibility,
        exitRequested: trayState.exitRequested,
      }),
      setCountdown: (countdown) => setWindowAutoCloseCountdown(countdown),
      completeAutoClose: () => void completeAutoClose(),
    });
    connect();
    return () => {
      stopWindowVisibility();
      disconnect();
    };
  });

  // 路由变化时调整窗口尺寸，并上报给 daemon（Creator 路由禁止 blur 自动隐藏）。
  let pathname = $derived(page.url.pathname);
  $effect(() => {
    if (pathname.startsWith("/creator")) {
      void resizeWindow(CREATOR_WINDOW_SIZE);
    } else {
      void resizeWindow(HOME_WINDOW_SIZE);
    }
  });
  $effect(() => {
    const connected = connectionState.status === "connected";
    const current = page.url.pathname;
    if (!connected) return;
    void setTrayRoute(current);
  });

  // WS 连接后加载 workspaces，并订阅 daemon→WebUI 投影流（重连时自动重建）。
  let connected = $derived(connectionState.status === "connected");
  $effect(() => {
    if (connected) {
      void loadWorkspaces();
      void ensureTraySubscription();
    }
  });
</script>

<!-- 品牌极小容器图标（resources/README.md §4 Monochrome Mini）：浏览器标签与原生窗口标题。 -->
<svelte:head>
  <link rel="icon" href="/icons/monochrome-mini.png" type="image/png" />
  <link rel="apple-touch-icon" href="/icons/monochrome-mini.png" />
</svelte:head>

<TooltipProvider>
  <div class="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
    <!-- 顶部栏（原生拖拽区域 + keep-open pin + 工具栏） -->
    <WindowDragRegion variant="main" showPin>
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

    <!-- 主体：稳定侧栏 + 无装饰工作区 -->
    <div class="flex min-h-0 flex-1">
      <AppSidebar onImport={() => importDialog.show()} onRemove={handleRemoveWorkspace} />
      <main
        id="main-content"
        class="min-w-0 flex-1 overflow-hidden border-l border-border bg-background"
      >
        {@render children()}
      </main>
    </div>
  </div>
</TooltipProvider>

<ImportWorkspaceDialog bind:this={importDialog} />
<CommandPalette />
<ToastContainer />
