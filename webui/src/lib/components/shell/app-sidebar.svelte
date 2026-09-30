<!--
  用户原始需求 [2026-07-27]：「参考 gaubee.com 的 AppShell 标准」（左侧导航简化
  版 → 2026-09-30 shell-settings-ui Ch6 组件化：展开/折叠双态 + 标签）。
  正交意图：
  1. App 导航轨：registry 列表（含 settings 页）+ 导入 workspace 入口；
     active 态按当前 tab 身份投影。
  2. 双态：折叠（图标 w-14，title 提示）/展开（标签 w-44）；偏好持久化
     DevicePrefs.sidebarCollapsed（appearance store）。
  妥协声明：无。
-->
<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { appRegistry, resolveTabIdentity } from "$lib/shell";
  import {
    appearanceSidebarCollapsed,
    toggleAppearanceSidebar,
  } from "$lib/shell/appearance.svelte";
  import { requestImportWorkspace } from "$lib/stores/import-workspace.svelte";
  import IconPlus from "@lucide/svelte/icons/folder-plus";
  import IconChevronsLeft from "@lucide/svelte/icons/chevrons-left";
  import IconChevronsRight from "@lucide/svelte/icons/chevrons-right";

  const apps = $derived(appRegistry.list());
  const activeAppId = $derived(resolveTabIdentity(page.url.pathname)?.app ?? null);
  const collapsed = $derived(appearanceSidebarCollapsed());

  function switchApp(appId: string): void {
    void goto(`/${appId}`);
  }
</script>

<nav
  class="flex shrink-0 flex-col border-r border-border bg-muted/30 py-3 {collapsed
    ? 'w-14 items-center'
    : 'w-44'}"
  aria-label="Apps"
>
  {#each apps as app (app.id)}
    {@const Icon = app.icon}
    <button
      class="flex h-10 items-center rounded-lg transition-colors hover:bg-muted {collapsed
        ? 'w-10 justify-center'
        : 'w-[10.5rem] gap-2.5 px-3'} {activeAppId === app.id
        ? 'bg-accent text-primary ring-1 ring-inset ring-primary/25'
        : 'text-muted-foreground'}"
      title={app.name}
      aria-label={app.name}
      aria-current={activeAppId === app.id ? "page" : undefined}
      onclick={() => switchApp(app.id)}
    >
      <Icon class="h-5 w-5 shrink-0" />
      {#if !collapsed}
        <span class="truncate text-xs font-medium">{app.name}</span>
      {/if}
    </button>
  {/each}

  <!-- 分隔线 + 导入 workspace 入口 -->
  <div class="my-1 h-px bg-border {collapsed ? 'w-8' : 'w-[10.5rem] mx-auto'}"></div>
  <button
    class="flex h-10 items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground {collapsed
      ? 'w-10 justify-center'
      : 'w-[10.5rem] gap-2.5 px-3'}"
    title="Import workspace"
    aria-label="Import workspace"
    onclick={() => requestImportWorkspace()}
  >
    <IconPlus class="h-5 w-5 shrink-0" />
    {#if !collapsed}
      <span class="truncate text-xs font-medium">Import workspace</span>
    {/if}
  </button>

  <!-- 底部：折叠/展开开关（偏好持久化） -->
  <div class="mt-auto flex {collapsed ? 'w-10 justify-center' : 'w-[10.5rem] justify-end'}">
    <button
      class="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-pressed={collapsed}
      onclick={toggleAppearanceSidebar}
    >
      {#if collapsed}
        <IconChevronsRight class="h-4 w-4" />
      {:else}
        <IconChevronsLeft class="h-4 w-4" />
      {/if}
    </button>
  </div>
</nav>
