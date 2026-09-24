<!--
  用户原始需求 [2026-09-22]（wiki-directory-standard Owner 裁决）：「skill-creator
  GUI 新增第四个一级面板 Wiki（home=scope 索引：Global 卡 + 各 registry workspace
  的 wiki 卡）」。
  正交意图：
  1. scope 索引卡片（label、pattern 计数、未初始化空态「Not initialized」而非隐藏）。
  2. 返回恢复焦点：detail 返回本页时恢复触发卡焦点（窄屏单屏列表/详情切换法则）。
  3. 加载 / 失败 / 刷新四态可区分（latest-request-wins 由 store scopes 门承担）。
-->
<script module>
  // 跨路由返回恢复：最近经卡片进入 detail 的 scope id（模块级，App 内单实例）。
  let lastOpenedScopeId: string | null = null;
</script>

<script lang="ts">
  import { goto } from "$app/navigation";
  import { loadWikiScopes, resetWikiScopes, wikiScopesState } from "$lib/stores/wiki.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import IconGlobe from "@lucide/svelte/icons/globe";
  import IconFolder from "@lucide/svelte/icons/folder";
  import IconBookOpen from "@lucide/svelte/icons/book-open";
  import IconRefresh from "@lucide/svelte/icons/refresh-cw";
  import IconLoader from "@lucide/svelte/icons/loader-circle";
  import IconAlert from "@lucide/svelte/icons/triangle-alert";
  import type { WikiScope } from "$lib/types";

  /** scope detail 路径（Global id "~" 在 URL path 段编码为 %7E，providerPath 先例）。 */
  function scopePath(scope: WikiScope): string {
    return `/wiki/${scope.id === "~" ? "%7E" : scope.id}`;
  }

  function openScope(scope: WikiScope): void {
    lastOpenedScopeId = scope.id;
    void goto(scopePath(scope));
  }

  async function refresh(): Promise<void> {
    await loadWikiScopes();
  }

  $effect(() => {
    void loadWikiScopes();
  });

  // 离开视图时复位（下次进入不携带旧投影）；返回恢复在挂载时先于复位语义执行。
  $effect(() => {
    return () => resetWikiScopes();
  });

  // detail 返回：恢复触发卡焦点（无记录时不夺焦——首屏/跨 App 进入交给浏览器）。
  $effect(() => {
    const restoreId = lastOpenedScopeId;
    if (!restoreId) return;
    lastOpenedScopeId = null;
    const card = document.querySelector<HTMLButtonElement>(
      `button[data-scope-id="${CSS.escape(restoreId)}"]`,
    );
    card?.focus();
  });
</script>

<div class="flex h-full flex-col overflow-y-auto p-5">
  <header class="flex shrink-0 items-start justify-between gap-3 border-b border-border pb-4">
    <div>
      <h1 class="text-lg font-semibold">Wiki</h1>
      <p class="mt-0.5 text-xs text-muted-foreground">
        Fragment insights collected per wiki — global notes and workspace-local knowledge.
      </p>
    </div>
    <div class="flex shrink-0 items-center gap-1.5">
      <Button
        variant="ghost"
        size="icon"
        class="h-9 w-9"
        title="Refresh wiki scopes"
        aria-label="Refresh wiki scopes"
        disabled={wikiScopesState.loading}
        onclick={() => void refresh()}
      >
        {#if wikiScopesState.loading}
          <IconLoader class="h-4 w-4 animate-spin" />
        {:else}
          <IconRefresh class="h-4 w-4" />
        {/if}
      </Button>
    </div>
  </header>

  <div class="mx-auto mt-5 w-full max-w-3xl space-y-4">
    {#if wikiScopesState.error}
      <div
        class="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4"
        role="alert"
      >
        <IconAlert class="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-destructive">Couldn't load wiki scopes</p>
          <p class="mt-1 break-words text-xs text-destructive/90">{wikiScopesState.error}</p>
        </div>
        <Button variant="outline" size="sm" onclick={() => void refresh()}>Retry</Button>
      </div>
    {:else if wikiScopesState.loading && wikiScopesState.scopes.length === 0}
      <div class="space-y-3" aria-label="Loading wiki scopes">
        <div class="h-16 animate-pulse rounded-lg border border-border bg-muted/50"></div>
        <div class="h-16 animate-pulse rounded-lg border border-border bg-muted/50"></div>
      </div>
    {:else if wikiScopesState.scopes.length === 0}
      <div class="rounded-lg border border-dashed border-border p-8 text-center">
        <IconBookOpen class="mx-auto h-8 w-8 text-muted-foreground" />
        <p class="mt-3 text-sm font-medium">No wiki scopes yet</p>
        <p class="mt-1 text-xs text-muted-foreground">
          The global wiki appears once the daemon is reachable.
        </p>
      </div>
    {:else}
      {#if wikiScopesState.loading}
        <p class="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <IconLoader class="h-3.5 w-3.5 animate-spin" /> Updating…
        </p>
      {/if}
      <ul class="divide-y divide-border rounded-lg border border-border">
        {#each wikiScopesState.scopes as scope (scope.id)}
          <li>
            <button
              data-scope-id={scope.id}
              class="flex min-h-11 w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
              onclick={() => openScope(scope)}
            >
              {#if scope.id === "~"}
                <IconGlobe class="h-4 w-4 shrink-0 text-primary" />
              {:else}
                <IconFolder class="h-4 w-4 shrink-0 text-muted-foreground" />
              {/if}
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-2">
                  <span class="truncate text-sm font-medium">{scope.label}</span>
                  {#if scope.id === "~"}
                    <Badge variant="secondary" class="shrink-0 text-xs">~ global</Badge>
                  {/if}
                </span>
                {#if scope.exists}
                  <span class="block truncate text-xs text-muted-foreground">
                    {scope.patternCount}
                    {scope.patternCount === 1 ? "fragment" : "fragments"} captured{#if scope.lastUpdated}
                      · updated {scope.lastUpdated.slice(0, 10)}{/if}
                  </span>
                {:else}
                  <span class="block truncate text-xs text-muted-foreground/80">
                    Not initialized — opens empty, first fragment creates it
                  </span>
                {/if}
              </span>
              <Badge variant={scope.exists ? "secondary" : "outline"} class="shrink-0 tabular-nums">
                {scope.patternCount}
              </Badge>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>
