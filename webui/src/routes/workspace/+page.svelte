<script lang="ts">
  /**
   * 原始需求 [2026-07-14]：「skills manager 只是路由的一部分(`/workspace/~/`)；我们还需要支持导入 workspace」。
   * 正交意图：
   * 1. 投影 workspace 加载状态。
   * 2. 呈现 home 与导入目录索引。
   * 3. 在任意视口提供 Remove Workspace 恢复入口。
   */
  import { workspaceState, loadWorkspaces } from "$lib/store.svelte";
  import { confirmRemoveWorkspace } from "$lib/workspace-removal";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import IconFolder from "@lucide/svelte/icons/folder-open";
  import IconBoxes from "@lucide/svelte/icons/boxes";
  import IconArrowRight from "@lucide/svelte/icons/arrow-right";
  import IconTrash from "@lucide/svelte/icons/trash-2";

  $effect(() => {
    void loadWorkspaces();
  });
</script>

<div class="flex h-full flex-col overflow-y-auto">
  <header class="shrink-0 border-b border-border px-5 py-4">
    <h1 class="text-lg font-semibold">Skill locations</h1>
    <p class="mt-0.5 text-xs text-muted-foreground">
      Browse default agent locations or work inside an imported directory.
    </p>
  </header>

  <div class="mx-auto w-full max-w-3xl p-5">
    {#if workspaceState.loading}
      <div class="divide-y divide-border border-y border-border" aria-label="Loading workspaces">
        {#each Array(4) as _}
          <div class="flex h-14 animate-pulse items-center gap-3 px-3">
            <div class="h-7 w-7 rounded bg-muted"></div>
            <div class="h-3 w-40 rounded bg-muted"></div>
          </div>
        {/each}
      </div>
    {:else if workspaceState.workspaces.length === 0}
      <div class="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
        <div
          class="flex h-10 w-10 items-center justify-center rounded-md bg-muted"
          aria-hidden="true"
        >
          <IconBoxes class="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <p class="text-sm font-medium">No imported workspaces</p>
          <p class="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
            Use Import workspace in the sidebar to add a directory containing skills.
          </p>
        </div>
      </div>
    {:else}
      <div class="divide-y divide-border border-y border-border">
        {#each workspaceState.workspaces as ws (ws.id)}
          <div class="group flex min-h-14 items-center">
            <a
              href={`/workspace/${ws.id}`}
              class="flex min-w-0 flex-1 items-center gap-3 self-stretch px-3 py-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              aria-current={ws.id === workspaceState.activeId ? "page" : undefined}
            >
              <div
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
                aria-hidden="true"
              >
                <IconFolder class="h-4 w-4" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="truncate text-sm font-medium">{ws.label}</span>
                  {#if ws.id === workspaceState.activeId}
                    <Badge variant="secondary" class="h-5 px-1.5 text-[10px]">Current</Badge>
                  {/if}
                  {#if !ws.available}
                    <Badge
                      variant="outline"
                      class="h-5 px-1.5 text-[10px] text-amber-700 dark:text-amber-300"
                      >Unavailable</Badge
                    >
                  {/if}
                </div>
                <p class="truncate font-mono text-[10px] text-muted-foreground">
                  {ws.path ?? "Default Claude, Codex, Gemini, and shared agent locations"}
                </p>
              </div>
              <span class="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:inline"
                >{ws.skillCount ?? 0} skills</span
              >
              <IconArrowRight
                class="hidden h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 sm:block"
                aria-hidden="true"
              />
            </a>
            {#if ws.kind === "directory"}
              <Button
                variant="ghost"
                size="icon"
                class="mr-2 h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                aria-label={`Remove ${ws.label}`}
                title={`Remove ${ws.label}`}
                onclick={() => void confirmRemoveWorkspace(ws)}
              >
                <IconTrash class="h-4 w-4" />
              </Button>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
