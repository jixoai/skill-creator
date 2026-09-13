<!--
  ConfirmDialog 的测试 stub（R14-C）：真组件走 bits-ui Dialog（node_modules 内
  .svelte 被 vitest 外置化）；本 stub 保持同 props 契约 + open 门控渲染，
  确认/取消按钮行为一致，供删除流测试断言。
-->
<script lang="ts">
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

{#if open}
  <div data-stub="confirm-dialog" role="alertdialog">
    <p data-stub="confirm-title">{title}</p>
    <p data-stub="confirm-description">{description}</p>
    <button type="button" data-stub="confirm-cancel" disabled={busy} onclick={() => (open = false)}>
      Cancel
    </button>
    <button type="button" data-stub="confirm-accept" disabled={busy} onclick={() => onConfirm()}>
      {confirmLabel}
    </button>
  </div>
{/if}
