<!--
  排队队列 dock（W4 → composer-references-queue-actions C2）。
  W4 首版是只读乐观投影；C2 起队列真相迁内核 inbox（agent.queue.list）：
  内核行携带行级操作（编辑/移除/插话，messageId 寻址），乐观 outbox 仅作为
  prompt 在途的过渡行（无操作面）；文本全等去重，内核行优先。
  正交意图：
    [1] 合并投影：内核 items（next-step 先）+ 未落内核的乐观项。
    [2] 行操作：编辑（行内输入，Enter 保存/Esc 取消）、移除、插话（仅
        running 的 next-turn 项）；typed 失败 toast + 投影自愈刷新。
  妥协声明：编辑仅文本（附件块由 daemon 原样保留，行尾 chip 只读展示）。
-->
<script lang="ts">
  import IconChevronDown from "@lucide/svelte/icons/chevron-down";
  import IconListPlus from "@lucide/svelte/icons/list-plus";
  import IconPencil from "@lucide/svelte/icons/pencil";
  import IconSplit from "@lucide/svelte/icons/split";
  import IconX from "@lucide/svelte/icons/x";
  import { queuedOutbox } from "$lib/stores/agent-submission.svelte";
  import { agentQueue, agentSession, updateAgentQueueItem } from "$lib/stores/agent.svelte";
  import { showToast } from "$lib/toast.svelte";

  let collapsed = $state(false);

  /** 合并行视图：内核项（带操作）+ 乐观项（prompt 在途，无操作；文本去重）。 */
  const rows = $derived.by(() => {
    const kernelTexts = new Set(agentQueue.items.map((item) => item.text));
    const optimistic = queuedOutbox.items
      .filter((item) => !kernelTexts.has(item.text))
      .map((item) => ({ kind: "optimistic" as const, text: item.text }));
    return [...agentQueue.items.map((item) => ({ kind: "kernel" as const, item })), ...optimistic];
  });

  /** 行内编辑态（C2）：messageId + 草稿文本；Esc 取消、Enter 保存。 */
  let editingId = $state<string | null>(null);
  let editingText = $state("");

  const running = $derived(agentSession.status === "running");

  function beginEdit(messageId: string, text: string): void {
    editingId = messageId;
    editingText = text;
  }

  async function saveEdit(messageId: string): Promise<void> {
    const text = editingText.trim();
    editingId = null;
    if (text.length === 0) return;
    const result = await updateAgentQueueItem({ messageId, action: "edit", text });
    if (result && "error" in result) showToast(`Queue edit failed: ${result.error}`);
  }

  async function removeItem(messageId: string): Promise<void> {
    const result = await updateAgentQueueItem({ messageId, action: "remove" });
    if (result && "error" in result) showToast(`Queue remove failed: ${result.error}`);
  }

  async function steerItem(messageId: string): Promise<void> {
    const result = await updateAgentQueueItem({ messageId, action: "steer" });
    if (result && "error" in result) showToast(`Queue steer failed: ${result.error}`);
  }

  /** 编辑输入的键盘面：Enter 保存、Esc 取消（都不冒泡——面板 Esc 收起不抢）。 */
  function onEditKeydown(event: KeyboardEvent, messageId: string): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      editingId = null;
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      void saveEdit(messageId);
    }
  }
</script>

{#if rows.length > 0}
  <div
    class="mx-2.5 mt-2.5 shrink-0 rounded-lg border border-border bg-muted/30"
    aria-label="Queued messages"
  >
    <button
      type="button"
      class="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground"
      aria-expanded={!collapsed}
      onclick={() => (collapsed = !collapsed)}
    >
      <IconListPlus class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span class="font-medium">Queued</span>
      <span class="rounded border border-border bg-background px-1 text-primary">{rows.length}</span
      >
      <span class="flex-1"></span>
      <IconChevronDown
        class="h-3 w-3 transition-transform {collapsed ? '' : 'rotate-180'}"
        aria-hidden="true"
      />
    </button>
    {#if !collapsed}
      <ul class="border-t border-border">
        {#each rows as row, index (row.kind === "kernel" ? row.item.messageId : `optimistic-${index}`)}
          {#if row.kind === "kernel"}
            <li
              class="flex items-center gap-1 px-2.5 py-1 text-[11px]"
              data-queue-target={row.item.target}
            >
              {#if editingId === row.item.messageId}
                <input
                  class="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-[11px] outline-none focus:border-primary"
                  aria-label="Edit queued message"
                  bind:value={editingText}
                  onkeydown={(event) => onEditKeydown(event, row.item.messageId)}
                  onblur={() => void saveEdit(row.item.messageId)}
                />
              {:else}
                <span class="truncate text-foreground/80" title={row.item.text}>
                  {row.item.text}
                </span>
              {/if}
              {#if row.item.attachments > 0}
                <span
                  class="shrink-0 rounded border border-border bg-background px-1 text-[10px] text-muted-foreground"
                  title="{row.item.attachments} attachment(s)"
                >
                  +{row.item.attachments}
                </span>
              {/if}
              {#if row.item.target === "next-step"}
                <span
                  class="shrink-0 rounded border border-border bg-background px-1 text-[10px] text-primary"
                  title="Steers the running turn at the next step boundary"
                >
                  steer
                </span>
              {/if}
              <span class="flex-1"></span>
              {#if editingId !== row.item.messageId}
                <button
                  type="button"
                  class="shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label="Edit queued message"
                  title="Edit this queued message"
                  onclick={() => beginEdit(row.item.messageId, row.item.text)}
                >
                  <IconPencil class="h-3 w-3" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  class="shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label="Steer with this message"
                  title="Steer the current turn with this message"
                  disabled={!running || row.item.target !== "next-turn"}
                  onclick={() => void steerItem(row.item.messageId)}
                >
                  <IconSplit class="h-3 w-3" aria-hidden="true" />
                </button>
              {/if}
              <button
                type="button"
                class="shrink-0 text-muted-foreground hover:text-destructive"
                aria-label="Remove queued message"
                title="Remove from queue"
                onclick={() => void removeItem(row.item.messageId)}
              >
                <IconX class="h-3 w-3" aria-hidden="true" />
              </button>
            </li>
          {:else}
            <li class="flex items-center gap-1 px-2.5 py-1 text-[11px]">
              <span class="truncate text-muted-foreground/70" title={row.text}>
                {row.text}
              </span>
              <span class="flex-1"></span>
              <span class="shrink-0 text-[10px] text-muted-foreground/60">sending…</span>
            </li>
          {/if}
        {/each}
      </ul>
    {/if}
  </div>
{/if}
