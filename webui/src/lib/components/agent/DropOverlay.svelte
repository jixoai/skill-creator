<!--
  全窗拖放覆盖层（openspec composer-capability-parity W2）。

  用户指示 [2026-09-15]：「我们的 Agent Chat 输入框的能力，最好 100% 复刻官方
  webui 输入框能力的实现。」官方 ui-attachment drop-events 语义：document 级
  dragenter/over/leave/drop + 嵌套深度计数（dragleave 不因子元素误触发）+
  全窗覆盖层（dropEffect 光标语义）——文件拖动活跃期间整个窗口都是合法落点。

  正交意图：
    [1] document 级拖放监听（深度计数；仅含文件的拖动才激活）。
    [2] 全窗覆盖层视觉（copy 光标语义 + 指引文案；键盘可达性不适用——纯指针面）。
  挂载点：AgentPanel（随面板生命周期装卸；面板常驻挂载 R17-C 同语义）。
-->
<script lang="ts">
  import { onMount } from "svelte";
  import IconFileUp from "@lucide/svelte/icons/file-up";
  import { handleComposerDrop } from "$lib/stores/agent-composer.svelte";

  let dragging = $state(false);
  let depth = 0;

  /** 仅文件拖动激活（文本选区拖动/内部拖柄不触发）。 */
  function carriesFiles(event: DragEvent): boolean {
    return [...(event.dataTransfer?.types ?? [])].includes("Files");
  }

  onMount(() => {
    const onDragEnter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth += 1;
      dragging = true;
    };
    const onDragOver = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      // copy 光标语义（官方 dropEffect 同法）：落点为复制附件，非移动。
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) dragging = false;
    };
    const onDrop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth = 0;
      dragging = false;
      handleComposerDrop(event);
    };
    document.addEventListener("dragenter", onDragEnter);
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("dragleave", onDragLeave);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragenter", onDragEnter);
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("dragleave", onDragLeave);
      document.removeEventListener("drop", onDrop);
    };
  });
</script>

{#if dragging}
  <div
    class="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-primary/5 backdrop-blur-[1px]"
    role="status"
    aria-label="Drop files to attach"
  >
    <div
      class="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-primary/50 bg-background/90 px-8 py-6 shadow-lg"
    >
      <IconFileUp class="h-7 w-7 text-primary" aria-hidden="true" />
      <p class="text-sm font-medium text-foreground">Drop to attach</p>
      <p class="text-xs text-muted-foreground">Images and files go to this message</p>
    </div>
  </div>
{/if}
