<!--
  排队发件箱 dock（openspec composer-capability-parity W4）。

  用户指示 [2026-09-15]：「……100% 复刻官方 webui 输入框能力的实现。」官方
  QueueDock 语义的产品化首版：running 中以 queue 模式提交的消息在 composer
  上方以可折叠条展示，durable user-text 帧到达（该条开始自己的轮次）即退队。
  行级编辑/移除/插话需要内核 inbox 项级操作契约，留待后续（记录于 change）。

  正交意图：
    [1] 计数头 + 折叠（默认展开；点击头部切换）。
    [2] 行 = 排队文本预览（发送中态语义：FIFO 由内核 inbox 保证）。
  妥协声明：无行级操作面（契约未备）；Stop 后队列存活续跑（cancel keepInbox）。
-->
<script lang="ts">
  import IconChevronDown from "@lucide/svelte/icons/chevron-down";
  import IconListPlus from "@lucide/svelte/icons/list-plus";
  import { queuedOutbox } from "$lib/stores/agent-submission.svelte";

  let collapsed = $state(false);
</script>

{#if queuedOutbox.items.length > 0}
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
      <span class="rounded border border-border bg-background px-1 text-primary"
        >{queuedOutbox.items.length}</span
      >
      <span class="flex-1"></span>
      <IconChevronDown
        class="h-3 w-3 transition-transform {collapsed ? '' : 'rotate-180'}"
        aria-hidden="true"
      />
    </button>
    {#if !collapsed}
      <ul class="border-t border-border">
        {#each queuedOutbox.items as item (item.id)}
          <li class="truncate px-2.5 py-1.5 text-[11px] text-foreground/80" title={item.text}>
            {item.text}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}
