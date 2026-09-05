<!--
  用户原始需求 [2026-07-27]：「右侧『日志』子视图：revision 历史与 diff」。
  正交意图：
  1. 调用 creator.revisions 拉取 revision 历史（reverse-chronological）。
  2. 每条展示时间戳 + unified diff；点击展开显示完整正文快照（若 daemon 持久化）。
  视图状态：展开条目 → 组件 $state（瞬时 UI）。
  妥协声明：历史由 daemon 持有，浏览器只在子视图激活时拉取一次，不缓存跨渲染周期。
-->
<script lang="ts">
  import { useCreatorEditor } from "$lib/stores/creator-editor.svelte";
  import { requireRpc } from "$lib/store.svelte";
  import { createRequestGenerationGate } from "$lib/stores/request-generation";
  import { getConnectionGeneration } from "$lib/store.svelte";
  import { Button } from "$lib/components/ui/button";
  import IconLoader from "@lucide/svelte/icons/loader-circle";
  import IconRotate from "@lucide/svelte/icons/rotate-cw";
  import IconChevron from "@lucide/svelte/icons/chevron-right";
  import type { CreatorRevisionEntry } from "$shared/contracts/creator.js";

  const editor = useCreatorEditor();
  const draft = editor.draft;

  const loadRequests = createRequestGenerationGate(getConnectionGeneration);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let entries = $state<CreatorRevisionEntry[]>([]);
  let expanded = $state<Record<string, boolean>>({});

  // skillId 变化时重新拉取（edit 模式）。
  $effect(() => {
    if (draft.mode !== "edit" || draft.skillId === null) return;
    void loadRevisions(draft.skillId);
  });

  async function loadRevisions(skillId: NonNullable<typeof draft.skillId>): Promise<void> {
    const request = loadRequests.issue();
    loading = true;
    error = null;
    try {
      const result = await requireRpc().creator.revisions({
        workspaceId: draft.target.workspaceId,
        providerId: draft.target.providerId,
        skillId,
      });
      if (!request.isCurrent()) return;
      // 倒序：最新在最前。
      entries = [...result.revisions].sort((a, b) => b.timestamp - a.timestamp);
    } catch (err) {
      if (!request.isCurrent()) return;
      error = err instanceof Error ? err.message : String(err);
    } finally {
      if (request.isLatest()) loading = false;
    }
  }

  function toggle(revision: string): void {
    expanded[revision] = !expanded[revision];
  }

  /** 刷新当前 edit 模式技能的 revision 历史（null-safe 包装）。 */
  function refreshCurrent(): void {
    if (draft.mode === "edit" && draft.skillId) {
      void loadRevisions(draft.skillId);
    }
  }

  function formatTime(timestamp: number): string {
    try {
      return new Date(timestamp).toLocaleString();
    } catch {
      return String(timestamp);
    }
  }
</script>

<div class="flex h-full flex-col">
  <div class="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
    <span class="text-xs font-medium">Change history</span>
    {#if draft.mode === "edit" && draft.skillId}
      <Button
        variant="outline"
        size="sm"
        class="h-7 gap-1.5"
        onclick={refreshCurrent}
        disabled={loading}
      >
        <IconRotate class="h-3.5 w-3.5" />
        Refresh
      </Button>
    {/if}
  </div>

  {#if draft.mode === "new"}
    <div
      class="flex flex-1 items-center justify-center px-8 text-center text-xs text-muted-foreground"
    >
      Save the skill first to see its change history.
    </div>
  {:else if loading}
    <div class="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
      <IconLoader class="h-4 w-4 animate-spin" /> Loading history…
    </div>
  {:else if error}
    <div class="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
      <p class="text-xs text-destructive">{error}</p>
      {#if draft.skillId}
        <Button variant="outline" size="sm" onclick={refreshCurrent}>Retry</Button>
      {/if}
    </div>
  {:else if entries.length === 0}
    <div
      class="flex flex-1 items-center justify-center px-8 text-center text-xs text-muted-foreground"
    >
      No revisions recorded yet.
    </div>
  {:else}
    <ol class="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
      {#each entries as entry, i (entry.revision)}
        <li class="px-4 py-3">
          <button
            type="button"
            class="flex w-full items-start gap-2 text-left"
            onclick={() => toggle(entry.revision)}
          >
            <IconChevron
              class="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform {expanded[
                entry.revision
              ]
                ? 'rotate-90'
                : ''}"
            />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="text-xs font-medium">{formatTime(entry.timestamp)}</span>
                {#if i === 0}
                  <span
                    class="rounded-sm bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300"
                  >
                    latest
                  </span>
                {/if}
                {#if entry.content === null}
                  <span class="text-[10px] text-muted-foreground/70">snapshot pruned</span>
                {/if}
              </div>
              <p class="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                {entry.revision.slice(0, 16)}…
              </p>
            </div>
          </button>

          {#if expanded[entry.revision]}
            <div class="mt-2 space-y-2 pl-5">
              {#if entry.diff}
                <div>
                  <p
                    class="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    Diff vs previous
                  </p>
                  <pre
                    class="overflow-x-auto rounded-md border border-border bg-muted/30 p-2 font-mono text-[10px] leading-4">{entry.diff}</pre>
                </div>
              {/if}
              {#if entry.content !== null}
                <div>
                  <p
                    class="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    Full snapshot
                  </p>
                  <pre
                    class="max-h-72 overflow-auto rounded-md border border-border bg-muted/30 p-2 font-mono text-[10px] leading-4">{entry.content}</pre>
                </div>
              {/if}
              {#if entry.diff === null && entry.content === null}
                <p class="text-[10px] text-muted-foreground/70">
                  Initial revision — no diff and no persisted snapshot.
                </p>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ol>
  {/if}
</div>
