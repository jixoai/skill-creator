<!--
  用户原始需求 [2026-09-12]（redesign §3.2 TodoDock）：「移出转录流：todo-snapshot
  不再进 items，改投影 agentSession.todos（latest-wins）。dock 卡在 composer 上方
  （mx-3 mb-1.5），默认折叠，头部 28px：[check-circle] Tasks  done N · active M ·
  pending K [chevron]；展开体 max-h-40 内滚，行 = 12px + 状态点」。
  正交意图：
  1. Todo 折叠卡：Tasks 头部（三态计数）+ 展开清单（completed 划线灰 /
     in_progress primary 空心 / pending 灰空心——沿用既有三态样式）。
  妥协声明：无。
-->
<script lang="ts">
  import IconCheckCircle from "@lucide/svelte/icons/circle-check";
  import IconChevron from "@lucide/svelte/icons/chevron-right";

  let {
    todos,
  }: {
    todos: Array<{ content: string; status: string }>;
  } = $props();

  let expanded = $state(false);

  const counts = $derived.by(() => {
    let done = 0;
    let active = 0;
    let pending = 0;
    for (const todo of todos) {
      if (todo.status === "completed") done += 1;
      else if (todo.status === "in_progress") active += 1;
      else pending += 1;
    }
    return { done, active, pending };
  });
</script>

<div class="mx-3 mb-1.5 shrink-0">
  <button
    type="button"
    class="disclosure-row disclosure-row-tall w-full rounded-lg border border-border bg-card px-2 shadow-sm"
    data-open={expanded}
    aria-expanded={expanded}
    aria-label="Tasks"
    onclick={() => (expanded = !expanded)}
  >
    <span class="flex items-center justify-center text-muted-foreground" aria-hidden="true">
      <IconCheckCircle class="h-3.5 w-3.5" />
    </span>
    <span class="truncate text-left font-medium text-foreground">Tasks</span>
    <span class="text-center text-muted-foreground/70" aria-hidden="true">·</span>
    <span class="disclosure-summary tabular-nums">
      done {counts.done} · active {counts.active} · pending {counts.pending}
    </span>
    <IconChevron class="disclosure-chevron h-3.5 w-3.5 shrink-0 text-muted-foreground" />
  </button>
  {#if expanded}
    <ul
      class="mt-1 max-h-40 space-y-0.5 overflow-y-auto rounded-lg border border-border bg-card px-2 py-1.5 shadow-sm"
    >
      {#each todos as todo, index (index)}
        <li
          class="flex items-start gap-1.5 text-xs {todo.status === 'completed'
            ? 'text-muted-foreground line-through'
            : ''}"
        >
          <span
            class="mt-[3px] h-3 w-3 shrink-0 rounded-full border-2 {todo.status === 'completed'
              ? 'border-primary bg-primary/20'
              : todo.status === 'in_progress'
                ? 'border-primary'
                : 'border-muted-foreground/50'}"
            aria-hidden="true"
          ></span>
          <span class="min-w-0 break-words">{todo.content}</span>
        </li>
      {/each}
    </ul>
  {/if}
</div>
