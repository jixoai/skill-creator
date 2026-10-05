<script lang="ts">
  import { onMount } from "svelte";
  import IconGlobe from "@lucide/svelte/icons/globe";
  import IconMessage from "@lucide/svelte/icons/message-square";
  import IconPlus from "@lucide/svelte/icons/plus";
  import IconX from "@lucide/svelte/icons/x";
  import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
  import { requestImportWorkspace } from "$lib/stores/import-workspace.svelte";
  import {
    removeWorkspace as removeWorkspaceEntry,
    workspaceEntryPath,
    workspaceState,
  } from "$lib/stores/workspaces.svelte";
  import type { ImportedWorkspace } from "$lib/types";
  import { showToast } from "$lib/toast.svelte";
  import { t } from "$lib/i18n";
  import {
    activateTabAndNavigate,
    closeImportedTab,
    removeWorkspaceTab,
    tabSession,
  } from "./tab-session.svelte.js";

  let addOpen = $state(false);
  // ＋菜单 fixed 坐标（走查 P1-2：absolute 版被后继兄弟层叠覆盖）。
  let addPosition = $state({ x: 0, y: 0 });
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
    tabSession.navigation.order.slice(1).map((id) => {
      const workspace = workspaceState.workspaces.find((item) => item.id === id);
      return {
        id,
        workspace,
        // η 线 task 3：subtitle = 该 workspace 的真实 path（Global tab 语义
        // 自足不加次行；workspace 尚未落载的异步窗口期为 null——次行保留
        // min-h-3 占位，数据落载不引起行高跳动）。
        path: workspace?.kind === "directory" ? workspace.path : null,
      };
    }),
  );

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
      showToast(t("shell.pathCopiedToast"));
    } catch {
      showToast(t("shell.pathCopyFailedToast"));
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
        t("shell.removeFailedToast", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      removeBusy = false;
    }
  }
</script>

<div class="shrink-0 border-b border-border bg-background">
  <!-- tab 高度 h-7→h-8 / 栏高 h-9→h-10（η 线 task 3）：workspace tab 增设
       subtitle 次行显示真实 path，两行内容（label 16px + path 12px）需要
       32px 内容盒；单行 tab 同步 h-8 保持行内基线一致。 -->
  <div
    class="flex h-10 items-center gap-1 overflow-x-auto px-2"
    role="tablist"
    aria-label={t("shell.openPagesAria")}
  >
    <!-- APG tabs 语义（toggleButton 普查落地，2026-10-05）：激活钮 = role=tab +
         aria-selected（替代 aria-current——tabs 模式下二者并存是双重标记），
         aria-controls ↔ +layout 的 #shell-tab-panel；关闭钮在 tab 元素外侧
         （嵌套交互控件不进 role=tab）。键盘：Tab 遍历 + Enter/Space 激活
         （原生 button）；方向键轮巡留待后续（roving tabindex 与右键菜单/
         拖拽冲突需单独设计）。 -->
    <button
      class="flex h-8 shrink-0 items-center gap-1.5 rounded px-2 text-xs transition-colors {tabSession
        .navigation.activeId === '~'
        ? 'bg-primary/10 text-primary'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
      aria-label={t("shell.globalTabAria")}
      role="tab"
      id="shell-tab-~"
      aria-selected={tabSession.navigation.activeId === "~"}
      aria-controls="shell-tab-panel"
      onclick={() => openWorkspace("~")}
    >
      <IconGlobe class="h-3.5 w-3.5" />
      <span>{t("shell.tabGlobal")}</span>
    </button>
    <button
      class="flex h-8 shrink-0 items-center gap-1.5 rounded px-2 text-xs transition-colors {tabSession
        .navigation.activeId === 'agent'
        ? 'bg-primary/10 text-primary'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
      aria-label={t("shell.agentTabAria")}
      role="tab"
      id="shell-tab-agent"
      aria-selected={tabSession.navigation.activeId === "agent"}
      aria-controls="shell-tab-panel"
      onclick={() => openWorkspace("agent")}
    >
      <IconMessage class="h-3.5 w-3.5" />
      <span>{t("shell.tabAgent")}</span>
    </button>
    {#each importedTabs as tab (tab.id)}
      <div
        class="group flex h-8 shrink-0 items-center rounded {tabSession.navigation.activeId ===
        tab.id
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
        data-tab-id={tab.id}
      >
        <button
          class="flex h-full min-w-0 max-w-44 flex-col items-start justify-center rounded-l px-2 text-left"
          title={tab.workspace?.label ?? tab.id}
          role="tab"
          id="shell-tab-{tab.id}"
          aria-selected={tabSession.navigation.activeId === tab.id}
          aria-controls="shell-tab-panel"
          onclick={() => openWorkspace(tab.id)}
          oncontextmenu={(event) =>
            tab.workspace?.kind === "directory" && showContextMenu(event, tab.workspace)}
        >
          <span class="max-w-full truncate text-xs leading-4">{tab.workspace?.label ?? tab.id}</span
          >
          <span
            class="max-w-full min-h-3 truncate text-[10px] leading-3 text-muted-foreground/75"
            data-tab-path={tab.path ?? undefined}
            title={tab.path ?? undefined}>{tab.path ?? ""}</span
          >
        </button>
        <button
          class="flex h-full w-6 items-center justify-center rounded-r opacity-65 hover:bg-background/70 hover:opacity-100"
          aria-label={t("shell.closeTabAria", { label: tab.workspace?.label ?? tab.id })}
          title={t("shell.closeTab")}
          onclick={() => closeTab(tab.id)}
        >
          <IconX class="h-3 w-3" />
        </button>
      </div>
    {/each}
    {#if tabSession.navigation.activeId === "settings"}
      <div class="flex h-8 shrink-0 items-center rounded bg-primary/10 text-xs text-primary">
        <button
          class="px-2"
          role="tab"
          id="shell-tab-settings"
          aria-selected={true}
          aria-controls="shell-tab-panel"
          onclick={() => openWorkspace("settings")}>{t("shell.tabSettings")}</button
        >
        <button
          class="flex h-full w-6 items-center justify-center"
          aria-label={t("shell.closeSettingsTabAria")}
          onclick={() => openWorkspace("~")}
        >
          <IconX class="h-3 w-3" />
        </button>
      </div>
    {/if}
    <div class="shrink-0" data-shell-menu>
      <button
        class="flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={t("shell.openTabMenuAria")}
        aria-expanded={addOpen}
        title={t("shell.openTabTitle")}
        onclick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          addPosition = { x: rect.left, y: rect.bottom + 4 };
          addOpen = !addOpen;
        }}
      >
        <IconPlus class="h-4 w-4" />
      </button>
      {#if addOpen}
        <!-- fixed 定位复用下方右键菜单模式：absolute 在 tab strip 的层叠
             上下文内会被 omnibox 行与 dashboard 覆盖（走查 P1-2）。 -->
        <div
          class="fixed z-[100] w-64 rounded border border-border bg-popover p-1 shadow-lg"
          style:left="{addPosition.x}px"
          style:top="{addPosition.y}px"
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
            {t("shell.importDirectory")}
          </button>
        </div>
      {/if}
    </div>
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
      {t("shell.copyWorkspacePath")}
    </button>
    <button
      class="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
      role="menuitem"
      onclick={() => closeTab(contextWorkspace!.id)}
    >
      {t("shell.closeTab")}
    </button>
    <button
      class="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
      role="menuitem"
      onclick={() => requestRemove(contextWorkspace!)}
    >
      {t("shell.removeWorkspace")}
    </button>
  </div>
{/if}

<ConfirmDialog
  bind:open={removeOpen}
  title={t("shell.removeConfirmTitle")}
  description={t("shell.removeConfirmBody")}
  busy={removeBusy}
  onConfirm={() => void confirmRemove()}
/>
