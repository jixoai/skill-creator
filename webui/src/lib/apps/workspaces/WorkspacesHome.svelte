<!--
  用户原始需求 [2026-09-05]：「用户可以导入 Workspace，浏览 Provider 和 Skill……Remove 只删除 registry entry，不删除目录。」
  正交意图：
  1. Skill locations 索引：Global（~）与 Imported Workspace 分组、availability、skill count、Provider 入口。
  2. 导入（共享全局对话框）与移除（仅 registry entry，confirm + busy 锁 + toast 终态）。
  3. 加载 / 空 / 更新中 / 失败四态可区分。
-->
<script lang="ts">
  import {
    loadWorkspaces,
    removeWorkspace,
    workspaceEntryPath,
    workspaceState,
  } from "$lib/store.svelte";
  import { requestImportWorkspace } from "$lib/stores/import-workspace.svelte";
  import { showToast } from "$lib/toast.svelte";
  import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { goto } from "$app/navigation";
  import IconGlobe from "@lucide/svelte/icons/globe";
  import IconFolder from "@lucide/svelte/icons/folder";
  import IconRefresh from "@lucide/svelte/icons/refresh-cw";
  import IconPlus from "@lucide/svelte/icons/folder-plus";
  import IconTrash from "@lucide/svelte/icons/trash-2";
  import IconAlert from "@lucide/svelte/icons/triangle-alert";
  import IconLoader from "@lucide/svelte/icons/loader-circle";
  import type { ImportedWorkspace, Workspace, WorkspaceProvider } from "$lib/types";

  const globalWorkspaces = $derived(workspaceState.workspaces.filter((ws) => ws.kind === "global"));
  const importedWorkspaces = $derived(
    workspaceState.workspaces.filter((ws) => ws.kind === "directory"),
  );
  const hasContent = $derived(workspaceState.workspaces.length > 0);
  // 「更新中」= 已有数据时的再加载；初次加载（无数据）显示骨架屏。
  const updating = $derived(workspaceState.loading && hasContent);

  let removing = $state<ImportedWorkspace | null>(null);
  let removeOpen = $state(false);
  let removeBusy = $state(false);

  $effect(() => {
    void loadWorkspaces();
  });

  /** 请求移除一个导入 workspace（confirm 对话框打开；Cancel 关闭即取消）。 */
  function requestRemove(ws: ImportedWorkspace): void {
    removing = ws;
    removeOpen = true;
  }

  $effect(() => {
    if (!removeOpen) removing = null;
  });

  async function refresh(): Promise<void> {
    await loadWorkspaces();
  }

  function providerPath(ws: Workspace, provider: WorkspaceProvider): string {
    // Global Workspace id "~" 在 URL path 中编码为 %7E（SvelteKit 客户端路由不接受裸 ~）。
    const wsSegment = ws.id === "~" ? "%7E" : ws.id;
    return `/workspaces/${wsSegment}/${provider.id}`;
  }

  async function confirmRemove(): Promise<void> {
    const workspace = removing;
    if (!workspace) return;
    removeBusy = true;
    try {
      const removed = await removeWorkspace(workspace.id);
      if (removed) {
        removeOpen = false;
        showToast(`Removed ${workspace.label}. Files remain on disk.`);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    } finally {
      removeBusy = false;
    }
  }
</script>

<div class="flex h-full flex-col overflow-y-auto p-5">
  <header class="flex shrink-0 items-start justify-between gap-3 border-b border-border pb-4">
    <div>
      <h1 class="text-lg font-semibold">Skill locations</h1>
      <p class="mt-0.5 text-xs text-muted-foreground">
        Browse default agent locations or work inside an imported directory.
      </p>
    </div>
    <div class="flex shrink-0 items-center gap-1.5">
      <Button
        variant="ghost"
        size="icon"
        class="h-9 w-9"
        title="Refresh workspaces"
        aria-label="Refresh workspaces"
        disabled={workspaceState.loading}
        onclick={() => void refresh()}
      >
        {#if workspaceState.loading}
          <IconLoader class="h-4 w-4 animate-spin" />
        {:else}
          <IconRefresh class="h-4 w-4" />
        {/if}
      </Button>
      <Button size="sm" onclick={() => requestImportWorkspace()}>
        <IconPlus class="h-4 w-4" />
        Import
      </Button>
    </div>
  </header>

  <div class="mx-auto mt-5 w-full max-w-3xl space-y-6">
    {#if workspaceState.error}
      <div
        class="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4"
        role="alert"
      >
        <IconAlert class="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-destructive">Couldn't load workspaces</p>
          <p class="mt-1 break-words text-xs text-destructive/90">{workspaceState.error}</p>
        </div>
        <Button variant="outline" size="sm" onclick={() => void refresh()}>Retry</Button>
      </div>
    {:else if workspaceState.loading && !hasContent}
      <div class="space-y-3" aria-label="Loading workspaces">
        <div class="h-24 animate-pulse rounded-lg border border-border bg-muted/50"></div>
        <div class="h-24 animate-pulse rounded-lg border border-border bg-muted/50"></div>
      </div>
    {:else if !hasContent}
      <div class="rounded-lg border border-dashed border-border p-8 text-center">
        <IconFolder class="mx-auto h-8 w-8 text-muted-foreground" />
        <p class="mt-3 text-sm font-medium">No skill locations yet</p>
        <p class="mt-1 text-xs text-muted-foreground">
          Import a directory to manage its skills, or browse the global agent locations.
        </p>
        <Button class="mt-4" size="sm" onclick={() => requestImportWorkspace()}>
          <IconPlus class="h-4 w-4" />
          Import workspace
        </Button>
      </div>
    {:else}
      {#if updating}
        <p class="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <IconLoader class="h-3.5 w-3.5 animate-spin" /> Updating…
        </p>
      {/if}

      {#each globalWorkspaces as ws (ws.id)}
        {@const target = ws.available ? ws : null}
        <section class="rounded-lg border border-border">
          <div class="flex items-center gap-2.5 border-b border-border px-4 py-3">
            <IconGlobe class="h-4 w-4 shrink-0 text-primary" />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <h2 class="truncate text-sm font-medium">{ws.label}</h2>
                <Badge variant="secondary" class="text-[10px]">~ global</Badge>
              </div>
              <p class="mt-0.5 text-xs text-muted-foreground">
                {ws.skillCount} skill{ws.skillCount === 1 ? "" : "s"} across {ws.providers.length}
                agent location{ws.providers.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>
          <ul class="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2">
            {#each ws.providers as provider (provider.id)}
              <li>
                <button
                  class="flex min-h-11 w-full items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-2 text-left transition-colors hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-50"
                  disabled={!target || !provider.available}
                  title={provider.path ?? provider.label}
                  onclick={() => target && void goto(providerPath(ws, provider))}
                >
                  <span class="min-w-0">
                    <span class="block truncate text-xs font-medium">{provider.label}</span>
                    {#if !provider.available}
                      <span class="text-[11px] text-muted-foreground">Not found on disk</span>
                    {:else if provider.path}
                      <span class="block truncate font-mono text-[10px] text-muted-foreground">
                        {provider.path}
                      </span>
                    {/if}
                  </span>
                  <Badge variant="secondary" class="shrink-0 tabular-nums">
                    {provider.skillCount}
                  </Badge>
                </button>
              </li>
            {/each}
          </ul>
        </section>
      {/each}

      {#if importedWorkspaces.length > 0}
        <section>
          <h2 class="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Imported workspaces
          </h2>
          <ul class="space-y-2">
            {#each importedWorkspaces as ws (ws.id)}
              {@const removable = ws.kind === "directory" ? ws : null}
              <li
                class="rounded-lg border border-border transition-colors {ws.available
                  ? 'hover:border-foreground/20'
                  : 'border-destructive/40'}"
              >
                <div class="flex items-center gap-2.5 px-4 py-3">
                  <button
                    class="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 text-left"
                    disabled={!ws.available}
                    onclick={() => ws.available && void goto(workspaceEntryPath(ws))}
                  >
                    <IconFolder
                      class="h-4 w-4 shrink-0 {ws.available ? 'text-primary' : 'text-destructive'}"
                    />
                    <span class="min-w-0 flex-1">
                      <span class="flex items-center gap-2">
                        <span class="truncate text-sm font-medium">{ws.label}</span>
                        {#if !ws.available}
                          <Badge variant="destructive" class="text-[10px]">
                            <IconAlert class="h-3 w-3" /> Missing
                          </Badge>
                        {/if}
                      </span>
                      <span
                        class="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground"
                      >
                        {ws.path}
                      </span>
                    </span>
                    <Badge variant="secondary" class="shrink-0 tabular-nums">
                      {ws.skillCount}
                    </Badge>
                  </button>
                  {#if removable}
                    <Button
                      variant="ghost"
                      size="icon"
                      class="h-11 w-11 shrink-0 text-muted-foreground hover:text-destructive"
                      title={`Remove ${ws.label} registration`}
                      aria-label={`Remove ${ws.label}`}
                      onclick={() => requestRemove(removable)}
                    >
                      <IconTrash class="h-4 w-4" />
                    </Button>
                  {/if}
                </div>
                {#if ws.providers.length > 0}
                  <ul
                    class="flex flex-wrap gap-1.5 border-t border-border/60 px-4 py-2.5"
                    aria-label="Providers in {ws.label}"
                  >
                    {#each ws.providers as provider (provider.id)}
                      <li>
                        <button
                          class="flex min-h-9 items-center gap-1.5 rounded-full border border-border/60 px-2.5 py-1 text-xs transition-colors hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-50"
                          disabled={!ws.available || !provider.available}
                          onclick={() => ws.available && void goto(providerPath(ws, provider))}
                        >
                          {provider.label}
                          <span class="tabular-nums text-muted-foreground">
                            {provider.skillCount}
                          </span>
                        </button>
                      </li>
                    {/each}
                  </ul>
                {/if}
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    {/if}
  </div>
</div>

<ConfirmDialog
  bind:open={removeOpen}
  title="Remove workspace registration"
  description={removing
    ? `Remove ${removing.label} from Skill Creator? Its files stay on disk; only the registration is deleted.`
    : ""}
  confirmLabel="Remove"
  busy={removeBusy}
  onConfirm={() => void confirmRemove()}
/>
