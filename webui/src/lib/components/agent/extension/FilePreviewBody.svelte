<!--
  右栏 file-preview 面板体（skills-agent-page-zcode-parity 3.2）。
  用户原始需求 [2026-10-04]（design §3）：第一批 panel 覆盖「file/media preview」——
  ZCode code-viewer 的产品映射，数据面 = agent.files.preview RPC。
  正交意图：
    [1] 预览加载：连接闸 + 路径代次守卫（断线 getRpc null 早退不清已渲染内容；
        迟到回调不提交——AgentCard 741eb3d 同族防线）。
    [2] 判别渲染：image（dataUrl 缩略图 + 原始尺寸）/ text（首 4KiB + 截断注记）/
        binary（名字 + 大小，不伪装成功预览）。
  妥协声明：ZCode PreviewPane 的 diff/pdf/pptx/媒体播放器面后置（本 RPC 契约只
  提供 image/text/binary 三态）；差异裁决记录于 change 报告。
-->
<script lang="ts">
  import { connectionState, getRpc } from "$lib/stores/connection.svelte";
  import type { AgentFilesPreviewResult } from "$shared/contracts/agent.js";

  let { path }: { path: string } = $props();

  let preview = $state<AgentFilesPreviewResult | null>(null);
  let error = $state<string | null>(null);

  $effect(() => {
    const target = path;
    void connectionState.status;
    const rpc = getRpc();
    if (rpc === null) return;
    preview = null;
    error = null;
    rpc.agent.files
      .preview({ path: target })
      .then((result) => {
        if (path !== target) return;
        preview = result;
      })
      .catch((cause: unknown) => {
        if (path !== target) return;
        error = cause instanceof Error ? cause.message : String(cause);
      });
  });

  function formatBytes(size: number): string {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
</script>

<div class="flex h-full min-h-0 flex-col gap-2 p-2" data-file-preview-body={path}>
  <p class="shrink-0 select-text break-all px-1 text-[10px] text-muted-foreground" title={path}>
    {path}
  </p>
  {#if error !== null}
    <div class="px-1 text-xs text-destructive" role="alert">{error}</div>
  {:else if preview === null}
    <div class="px-1 py-3 text-xs text-muted-foreground" role="status">Loading preview…</div>
  {:else if preview.kind === "image"}
    <div class="flex min-h-0 flex-1 flex-col items-center justify-start gap-1 overflow-auto p-1">
      <img
        src={preview.dataUrl}
        alt={preview.name}
        class="max-h-full max-w-full rounded border border-border object-contain"
      />
      <p class="shrink-0 text-[10px] text-muted-foreground">
        {preview.name} · {preview.width}×{preview.height} · {formatBytes(preview.size)}
      </p>
    </div>
  {:else if preview.kind === "text"}
    <div class="flex min-h-0 flex-1 flex-col gap-1">
      <pre
        class="min-h-0 flex-1 select-text overflow-auto rounded border border-border bg-muted/30 p-2 text-left font-mono text-[11px] leading-relaxed whitespace-pre-wrap">{preview.text}</pre>
      <p class="shrink-0 text-[10px] text-muted-foreground">
        {preview.name} · {formatBytes(preview.size)}{preview.truncated ? " · truncated" : ""}
      </p>
    </div>
  {:else}
    <div
      class="flex flex-col items-center justify-center gap-1 px-1 py-6 text-xs text-muted-foreground"
    >
      <p>{preview.name}</p>
      <p>Binary file · {formatBytes(preview.size)}</p>
    </div>
  {/if}
</div>
