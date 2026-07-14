<script lang="ts">
  /**
   * 原始需求 [2026-07-14]：「导航栏、顶部栏，都参考 pnpm-pub 进行创作」。
   * 正交意图：
   * 1. 承载 Workspace、Creator 与 Repository 一级导航。
   * 2. 提供导入 workspace 的快速切换。
   * 3. 管理侧栏折叠与导入入口。
   */
  import { page } from "$app/state";
  import { workspaceState } from "$lib/store.svelte";
  import type { ImportedWorkspace } from "$lib/types";
  import { cn } from "$lib/utils";
  import { Button } from "$lib/components/ui/button";
  import { Separator } from "$lib/components/ui/separator";
  import IconBoxes from "@lucide/svelte/icons/boxes";
  import IconPlus from "@lucide/svelte/icons/plus";
  import IconPen from "@lucide/svelte/icons/pen-line";
  import IconGlobe from "@lucide/svelte/icons/globe";
  import IconFolder from "@lucide/svelte/icons/folder-open";
  import IconTrash from "@lucide/svelte/icons/trash-2";
  import IconChevron from "@lucide/svelte/icons/chevrons-right";
  import { MediaQuery } from "svelte/reactivity";

  const narrowViewport = new MediaQuery("(max-width: 720px)");
  let manuallyCollapsed = $state(false);
  let collapsed = $derived(manuallyCollapsed || narrowViewport.current);
  /** 侧栏触发 workspace 导入时调用。 */
  let {
    onImport,
    onRemove,
  }: {
    onImport?: () => void;
    onRemove?: (workspace: ImportedWorkspace) => void | Promise<void>;
  } = $props();

  const pathname = $derived(page.url.pathname);
  const importedWorkspaces = $derived(
    workspaceState.workspaces.filter(
      (workspace): workspace is ImportedWorkspace => workspace.kind === "directory",
    ),
  );
  const navItemClass =
    "group flex h-9 items-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  function isWorkspaceActive(id: string): boolean {
    return pathname === `/workspace/${id}` || pathname === `/workspace/${id}/`;
  }

  function requestRemove(event: MouseEvent, workspace: ImportedWorkspace): void {
    event.preventDefault();
    event.stopPropagation();
    void onRemove?.(workspace);
  }
</script>

<aside
  class={cn(
    "flex shrink-0 flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out",
    collapsed ? "w-14" : "w-56",
  )}
  data-collapsed={collapsed}
>
  <div class={cn("no-drag flex h-12 items-center gap-2 px-3", collapsed && "justify-center")}>
    {#if !collapsed}
      <div
        class="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground"
        aria-hidden="true"
      >
        <IconBoxes class="h-3.5 w-3.5" />
      </div>
      <span class="min-w-0 flex-1 truncate text-sm font-semibold">Skill Creator</span>
    {:else if narrowViewport.current}
      <div
        class="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground"
        aria-label="Skill Creator"
        title="Skill Creator"
      >
        <IconBoxes class="h-3.5 w-3.5" />
      </div>
    {/if}
    {#if !narrowViewport.current}
      <Button
        variant="ghost"
        size="icon"
        class="h-7 w-7 shrink-0"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        onclick={() => (manuallyCollapsed = !manuallyCollapsed)}
      >
        <IconChevron class={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} />
      </Button>
    {/if}
  </div>
  <Separator />

  <nav class="no-drag flex flex-col gap-1 p-2" aria-label="Primary navigation">
    <a
      href="/workspace"
      class={cn(
        navItemClass,
        collapsed ? "justify-center px-0" : "px-3",
        pathname.startsWith("/workspace")
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      )}
      aria-label="Workspaces"
      aria-current={pathname.startsWith("/workspace") ? "page" : undefined}
      title={collapsed ? "Workspaces" : undefined}
    >
      <IconBoxes class="h-4 w-4 shrink-0" />
      {#if !collapsed}<span>Workspaces</span>{/if}
    </a>
    <a
      href="/creator"
      class={cn(
        navItemClass,
        collapsed ? "justify-center px-0" : "px-3",
        pathname.startsWith("/creator")
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      )}
      aria-label="Creator"
      aria-current={pathname.startsWith("/creator") ? "page" : undefined}
      title={collapsed ? "Creator" : undefined}
    >
      <IconPen class="h-4 w-4 shrink-0" />
      {#if !collapsed}<span>Creator</span>{/if}
    </a>
    <a
      href="/repository"
      class={cn(
        navItemClass,
        collapsed ? "justify-center px-0" : "px-3",
        pathname.startsWith("/repository")
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      )}
      aria-label="Repository"
      aria-current={pathname.startsWith("/repository") ? "page" : undefined}
      title={collapsed ? "Repository" : undefined}
    >
      <IconGlobe class="h-4 w-4 shrink-0" />
      {#if !collapsed}<span>Repository</span>{/if}
    </a>
  </nav>

  <Separator />
  <nav
    class="no-drag flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2"
    aria-label="Imported workspaces"
  >
    {#if !collapsed}
      <div class="px-2 pb-1 pt-1 text-[10px] font-medium uppercase text-muted-foreground">
        Imported
      </div>
    {/if}

    {#if importedWorkspaces.length === 0}
      {#if !collapsed}
        <p class="px-2 py-2 text-xs leading-relaxed text-muted-foreground">
          Import a directory to manage its skills.
        </p>
      {/if}
    {:else}
      {#each importedWorkspaces as ws (ws.id)}
        {@const isActive = isWorkspaceActive(ws.id)}
        <div class="group flex min-w-0 items-center gap-1">
          <a
            href={`/workspace/${ws.id}`}
            class={cn(
              navItemClass,
              "min-w-0 flex-1",
              collapsed ? "justify-center px-0" : "px-3",
              !ws.available && "text-amber-700 dark:text-amber-300",
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )}
            aria-label={ws.label}
            aria-current={isActive ? "page" : undefined}
            title={collapsed ? ws.label : undefined}
          >
            <IconFolder class="h-4 w-4 shrink-0" />
            {#if !collapsed}
              <span class="min-w-0 flex-1 truncate">{ws.label}</span>
              {#if !ws.available}<span class="text-[10px]">Unavailable</span>{/if}
              {#if ws.skillCount !== undefined}
                <span class="text-[10px] tabular-nums text-muted-foreground">{ws.skillCount}</span>
              {/if}
            {/if}
          </a>
          {#if !collapsed}
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
              aria-label={`Remove ${ws.label}`}
              title={`Remove ${ws.label}`}
              onclick={(event) => requestRemove(event, ws)}
            >
              <IconTrash class="h-3.5 w-3.5" />
            </Button>
          {/if}
        </div>
      {/each}
    {/if}
  </nav>

  <div class={cn("no-drag border-t border-sidebar-border p-2", collapsed && "flex justify-center")}>
    <Button
      variant="ghost"
      size="sm"
      class={cn("w-full gap-2 text-xs", collapsed && "h-9 w-9 px-0")}
      onclick={onImport}
      aria-label="Import workspace"
      title={collapsed ? "Import workspace" : undefined}
    >
      <IconPlus class="h-4 w-4 shrink-0" />
      {#if !collapsed}Import workspace{/if}
    </Button>
  </div>
</aside>
