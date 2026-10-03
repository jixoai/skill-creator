<script lang="ts">
  import { onMount } from "svelte";
  import IconGlobe from "@lucide/svelte/icons/globe";
  import IconMessage from "@lucide/svelte/icons/message-square";
  import IconPlus from "@lucide/svelte/icons/plus";
  import IconX from "@lucide/svelte/icons/x";
  import IconArrowLeft from "@lucide/svelte/icons/arrow-left";
  import IconArrowRight from "@lucide/svelte/icons/arrow-right";
  import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
  import { requestImportWorkspace } from "$lib/stores/import-workspace.svelte";
  import {
    removeWorkspace as removeWorkspaceEntry,
    workspaceEntryPath,
    workspaceState,
  } from "$lib/stores/workspaces.svelte";
  import type { ImportedWorkspace } from "$lib/types";
  import { showToast } from "$lib/toast.svelte";
  import {
    activateTabAndNavigate,
    canNavigateTabHistory,
    closeImportedTab,
    navigateTabHistory,
    removeWorkspaceTab,
    tabSession,
  } from "./tab-session.svelte.js";

  let addOpen = $state(false);
  let contextWorkspace = $state<ImportedWorkspace | null>(null);
  let contextPosition = $state({ x: 0, y: 0 });
  let removingWorkspace = $state<ImportedWorkspace | null>(null);
  let removeOpen = $state(false);
  let removeBusy = $state(false);

  const openWorkspaceIds = $derived(new Set(tabSession.navigation.order));
  const unopenedWorkspaces = $derived(
    workspaceState.workspaces.filter(
      (workspace): workspace is ImportedWorkspace =>
        workspace.kind === "directory" && !openWorkspaceIds.has(workspace.id),
    ),
  );
  const importedTabs = $derived(
    tabSession.navigation.order.slice(1).map((id) => ({
      id,
      workspace: workspaceState.workspaces.find((item) => item.id === id),
    })),
  );
  const canBack = $derived(canNavigateTabHistory(-1));
  const canForward = $derived(canNavigateTabHistory(1));

  onMount(() => {
    const closeMenus = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest("[data-shell-menu]")) {
        addOpen = false;
        contextWorkspace = null;
      }
    };
    globalThis.addEventListener("pointerdown", closeMenus);
    return () => globalThis.removeEventListener("pointerdown", closeMenus);
  });

  function openWorkspace(workspaceId: string): void {
    addOpen = false;
    const workspace = workspaceState.workspaces.find((item) => item.id === workspaceId);
    const initialPath = workspace?.kind === "directory" ? workspaceEntryPath(workspace) : undefined;
    activateTabAndNavigate(workspaceId, initialPath);
  }

  function closeTab(workspaceId: string): void {
    closeImportedTab(workspaceId);
  }

  function showContextMenu(event: MouseEvent, workspace: ImportedWorkspace): void {
    event.preventDefault();
    contextWorkspace = workspace;
    contextPosition = { x: event.clientX, y: event.clientY };
  }

  async function copyWorkspacePath(workspace: ImportedWorkspace): Promise<void> {
    contextWorkspace = null;
    try {
      await navigator.clipboard.writeText(workspace.path);
      showToast("Workspace path copied.");
    } catch {
      showToast("Could not copy workspace path.");
    }
  }

  function requestRemove(workspace: ImportedWorkspace): void {
    contextWorkspace = null;
    removingWorkspace = workspace;
    removeOpen = true;
  }

  async function confirmRemove(): Promise<void> {
    const workspace = removingWorkspace;
    if (!workspace || removeBusy) return;
    removeBusy = true;
    try {
      const removed = await removeWorkspaceEntry(workspace.id);
      if (!removed) return;
      removeWorkspaceTab(workspace.id);
      removeOpen = false;
    } catch (error) {
      showToast(
        `Could not remove workspace: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      removeBusy = false;
    }
  }
</script>

<div class="shrink-0 border-b border-border bg-background">
  <div class="flex h-9 items-center gap-1 overflow-x-auto px-2" aria-label="Open pages">
    <button
      class="flex h-7 shrink-0 items-center gap-1.5 rounded px-2 text-xs transition-colors {tabSession
        .navigation.activeId === '~'
        ? 'bg-primary/10 text-primary'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
      aria-label="Global workspace tab"
      aria-current={tabSession.navigation.activeId === "~" ? "page" : undefined}
      onclick={() => openWorkspace("~")}
    >
      <IconGlobe class="h-3.5 w-3.5" />
      <span>Global</span>
    </button>
    <button
      class="flex h-7 shrink-0 items-center gap-1.5 rounded px-2 text-xs transition-colors {tabSession
        .navigation.activeId === 'agent'
        ? 'bg-primary/10 text-primary'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
      aria-label="Agent tab"
      aria-current={tabSession.navigation.activeId === "agent" ? "page" : undefined}
      onclick={() => openWorkspace("agent")}
    >
      <IconMessage class="h-3.5 w-3.5" />
      <span>Agent</span>
    </button>
    {#each importedTabs as tab (tab.id)}
      <div
        class="group flex h-7 shrink-0 items-center rounded {tabSession.navigation.activeId ===
        tab.id
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
        role="group"
        aria-label={tab.workspace?.label ?? tab.id}
        oncontextmenu={(event) =>
          tab.workspace?.kind === "directory" && showContextMenu(event, tab.workspace)}
      >
        <button
          class="h-full max-w-44 truncate rounded-l px-2 text-xs"
          title={tab.workspace?.label ?? tab.id}
          aria-current={tabSession.navigation.activeId === tab.id ? "page" : undefined}
          onclick={() => openWorkspace(tab.id)}
        >
          {tab.workspace?.label ?? tab.id}
        </button>
        <button
          class="flex h-full w-6 items-center justify-center rounded-r opacity-65 hover:bg-background/70 hover:opacity-100"
          aria-label={`Close ${tab.workspace?.label ?? tab.id} tab`}
          title="Close tab"
          onclick={() => closeTab(tab.id)}
        >
          <IconX class="h-3 w-3" />
        </button>
      </div>
    {/each}
    {#if tabSession.navigation.activeId === "settings"}
      <div class="flex h-7 shrink-0 items-center rounded bg-primary/10 text-xs text-primary">
        <button class="px-2" aria-current="page" onclick={() => openWorkspace("settings")}
          >Settings</button
        >
        <button
          class="flex h-full w-6 items-center justify-center"
          aria-label="Close Settings tab"
          onclick={() => openWorkspace("~")}
        >
          <IconX class="h-3 w-3" />
        </button>
      </div>
    {/if}
    <div class="relative shrink-0" data-shell-menu>
      <button
        class="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Open workspace tab menu"
        aria-expanded={addOpen}
        title="Open workspace tab"
        onclick={() => (addOpen = !addOpen)}
      >
        <IconPlus class="h-4 w-4" />
      </button>
      {#if addOpen}
        <div
          class="absolute left-0 top-8 z-50 w-64 rounded border border-border bg-popover p-1 shadow-lg"
        >
          {#each unopenedWorkspaces as workspace (workspace.id)}
            <button
              class="block w-full truncate rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
              onclick={() => openWorkspace(workspace.id)}
            >
              {workspace.label}
            </button>
          {/each}
          {#if unopenedWorkspaces.length > 0}
            <div class="my-1 h-px bg-border"></div>
          {/if}
          <button
            class="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
            onclick={() => {
              addOpen = false;
              requestImportWorkspace();
            }}
          >
            Import directory…
          </button>
        </div>
      {/if}
    </div>
  </div>

  <div class="flex h-9 items-center gap-1 border-t border-border/60 px-2">
    <button
      class="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-35"
      aria-label="Back in this tab"
      aria-keyshortcuts="Meta+["
      title="Back in this tab (⌘[)"
      disabled={!canBack}
      onclick={() => navigateTabHistory(-1)}><IconArrowLeft class="h-3.5 w-3.5" /></button
    >
    <button
      class="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-35"
      aria-label="Forward in this tab"
      aria-keyshortcuts="Meta+]"
      title="Forward in this tab (⌘])"
      disabled={!canForward}
      onclick={() => navigateTabHistory(1)}><IconArrowRight class="h-3.5 w-3.5" /></button
    >
    <div class="min-w-0 flex-1"></div>
  </div>
</div>

{#if contextWorkspace}
  <div
    class="fixed z-[100] w-48 rounded border border-border bg-popover p-1 shadow-lg"
    style:left="{contextPosition.x}px"
    style:top="{contextPosition.y}px"
    role="menu"
    data-shell-menu
  >
    <button
      class="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
      role="menuitem"
      onclick={() => copyWorkspacePath(contextWorkspace!)}
    >
      Copy workspace path
    </button>
    <button
      class="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
      role="menuitem"
      onclick={() => closeTab(contextWorkspace!.id)}
    >
      Close tab
    </button>
    <button
      class="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
      role="menuitem"
      onclick={() => requestRemove(contextWorkspace!)}
    >
      Remove workspace…
    </button>
  </div>
{/if}

<ConfirmDialog
  bind:open={removeOpen}
  title="Remove workspace?"
  description="This removes the workspace from Skill Creator. Files in the directory remain untouched."
  busy={removeBusy}
  onConfirm={() => void confirmRemove()}
/>
