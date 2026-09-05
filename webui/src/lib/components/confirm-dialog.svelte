<!--
  用户原始需求 [2026-09-05]：「每个 mutation 都有 loading lock、成功/跳过/冲突/失败终态。」
  正交意图：
  1. 可复用的破坏性操作确认对话框（Dialog 原语组合，不使用阻塞式 window.confirm）。
  2. 确认期间 busy 锁 + 取消永远可达。
-->
<script lang="ts">
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import IconLoader from "@lucide/svelte/icons/loader-circle";
  import IconTriangle from "@lucide/svelte/icons/triangle-alert";

  let {
    open = $bindable(false),
    title,
    description,
    confirmLabel = "Remove",
    busy = false,
    onConfirm,
  }: {
    open?: boolean;
    title: string;
    description: string;
    confirmLabel?: string;
    busy?: boolean;
    onConfirm: () => void;
  } = $props();
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-[420px]">
    <Dialog.Header>
      <Dialog.Title class="flex items-center gap-2">
        <IconTriangle class="h-4 w-4 text-destructive" />
        {title}
      </Dialog.Title>
      <Dialog.Description>{description}</Dialog.Description>
    </Dialog.Header>
    <Dialog.Footer>
      <Button variant="outline" disabled={busy} onclick={() => (open = false)}>Cancel</Button>
      <Button variant="destructive" disabled={busy} onclick={() => onConfirm()}>
        {#if busy}
          <IconLoader class="h-4 w-4 animate-spin" />
        {/if}
        {confirmLabel}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
