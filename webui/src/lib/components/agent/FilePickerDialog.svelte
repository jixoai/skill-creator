<!--
  用户原始需求 [2026-09-13]（R17-B）：「文件选择器、图片选择器，不要基于 web，
  而是基于后端，这样能拿到真实的路径，前端也能更轻。」——OpenTray 无原生
  open-file dialog（0.24.0 双重实证），本弹层消费 agent.files.* RPC 在后端文件
  系统上浏览并选定真实路径；图片选中即拉 daemon 缩略（jSquash 管线），前端零
  解码负担。本地 File 通道（粘贴/drop）不经本弹层。
  正交意图：
  1. 目录浏览：面包屑 + 列表（目录进入 / 文件选择）+ 截断提示 + 错误条。
  2. 选择守卫与预览：mode 语义门（image 仅图片扩展名 ≤4MiB / file 全部
     ≤512KiB）+ 数量上限（沿用 composer 守卫文案）+ 图片缩略/文本头拉取缓存。
  妥协声明：图片类型按扩展名门控（daemon 发送时按 magic 字节终裁）；无缩略的
    webp/gif 以 chip 形态回显。
-->
<script lang="ts">
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import IconFolder from "@lucide/svelte/icons/folder";
  import IconFile from "@lucide/svelte/icons/file";
  import IconFileText from "@lucide/svelte/icons/file-text";
  import IconFileUp from "@lucide/svelte/icons/file-up";
  import IconImage from "@lucide/svelte/icons/image";
  import IconChevronRight from "@lucide/svelte/icons/chevron-right";
  import IconChevronUp from "@lucide/svelte/icons/chevron-up";
  import IconX from "@lucide/svelte/icons/x";
  import { getRpc } from "$lib/stores/connection.svelte";
  import { showToast } from "$lib/toast.svelte";
  import type { AgentFilesPreviewResult } from "$shared/contracts/agent.js";

  interface Selection {
    path: string;
    name: string;
    size: number;
  }

  interface Props {
    /** 选择器语义：image（图片附件通道）或 file（文档附件通道）。 */
    mode: "image" | "file";
    /** 起始目录（缺省由 daemon 决定：会话 cwd 或 home）。 */
    startDir?: string;
    /** 确认：真实路径交回 composer 流程（preview 为 daemon 缩略 dataURL，可缺省）。 */
    onConfirm: (picks: Array<{ path: string; name: string; preview?: string }>) => void;
    open?: boolean;
  }

  let { mode, startDir = undefined, onConfirm, open = $bindable(false) }: Props = $props();

  const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp)$/i;
  const IMAGE_MODE_LIMIT = 4;
  const FILE_MODE_LIMIT = 2;

  let dir = $state("");
  let parent = $state<string | null>(null);
  let entries = $state<Array<{ name: string; kind: "file" | "dir"; size?: number }>>([]);
  let truncated = $state(false);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let selected = $state<Selection[]>([]);
  /** path → daemon 缩略 dataURL（会话级缓存，取消选择不回收——同目录反复选择复用）。 */
  let thumbs = $state<Record<string, string>>({});
  /** file 模式单选预览（最后选定项的文本头）。 */
  let textPreview = $state<{ name: string; text: string; truncated: boolean } | null>(null);
  /** 导航代次：慢响应不覆盖新目录（latest-wins，语义与仓库代次门一致）。 */
  let navToken = 0;
  const previewCache = new Map<string, AgentFilesPreviewResult>();

  const selectLimit = $derived(mode === "image" ? IMAGE_MODE_LIMIT : FILE_MODE_LIMIT);
  const selectLabel = $derived(
    mode === "image"
      ? `Add ${selected.length} image${selected.length === 1 ? "" : "s"}`
      : `Add ${selected.length} file${selected.length === 1 ? "" : "s"}`,
  );

  $effect(() => {
    if (!open) return;
    // 每次 open（或 open 中变 mode）重置并导航到起始目录。
    void mode;
    selected = [];
    thumbs = {};
    textPreview = null;
    error = null;
    void navigate(startDir);
  });

  async function navigate(target: string | undefined): Promise<void> {
    const rpc = getRpc();
    if (!rpc) {
      error = "Not connected to the daemon.";
      return;
    }
    const token = ++navToken;
    loading = true;
    error = null;
    try {
      const result = await rpc.agent.files.list(target === undefined ? {} : { dir: target });
      if (token !== navToken) return;
      dir = result.dir;
      parent = result.parent;
      entries = result.entries;
      truncated = result.truncated === true;
    } catch (cause) {
      if (token !== navToken) return;
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (token === navToken) loading = false;
    }
  }

  /** 分隔符归一的面包屑（POSIX 绝对路径与 Windows 盘符都成立）。 */
  const crumbs = $derived.by(() => {
    const parts = dir
      .replace(/\\/g, "/")
      .split("/")
      .filter((part) => part.length > 0);
    const out: Array<{ label: string; path: string }> = [{ label: "/", path: "/" }];
    let acc = "";
    for (const part of parts) {
      acc = acc === "" ? (part.endsWith(":") ? `${part}/` : `/${part}`) : `${acc}/${part}`;
      out.push({ label: part, path: acc });
    }
    return out;
  });

  function isSelected(path: string): boolean {
    return selected.some((item) => item.path === path);
  }

  /** mode 语义 + 大小门（守卫文案与 composer 本地通道一致）。 */
  function selectionBlockReason(entry: {
    name: string;
    kind: string;
    size?: number;
  }): string | null {
    if (entry.kind !== "file") return null;
    if (mode === "image" && !IMAGE_EXTENSION.test(entry.name)) {
      return "Not an image file";
    }
    if (mode === "image" && (entry.size ?? 0) > 4 * 1024 * 1024) {
      return `"${entry.name}" exceeds the 4MiB limit.`;
    }
    if (mode === "file" && (entry.size ?? 0) > 512 * 1024) {
      return `"${entry.name}" exceeds the 512KiB limit.`;
    }
    return null;
  }

  function onRowClick(entry: { name: string; kind: "file" | "dir"; size?: number }): void {
    const absolute = `${dir.replace(/\/+$/, "")}/${entry.name}`;
    if (entry.kind === "dir") {
      void navigate(absolute);
      return;
    }
    const blocked = selectionBlockReason(entry);
    if (blocked !== null) {
      showToast(blocked);
      return;
    }
    if (isSelected(absolute)) {
      selected = selected.filter((item) => item.path !== absolute);
      return;
    }
    if (selected.length >= selectLimit) {
      showToast(
        mode === "image"
          ? "At most 4 images per message."
          : "At most 2 file attachments per message.",
      );
      return;
    }
    selected = [...selected, { path: absolute, name: entry.name, size: entry.size ?? 0 }];
    void loadPreview(absolute);
  }

  /** 选中即拉预览：image 模式取缩略 dataURL；file 模式取文本头投影。 */
  async function loadPreview(path: string): Promise<void> {
    const rpc = getRpc();
    if (!rpc) return;
    try {
      let result = previewCache.get(path);
      if (result === undefined) {
        result = await rpc.agent.files.preview({ path });
        previewCache.set(path, result);
      }
      if (!isSelected(path)) return;
      if (result.kind === "image") {
        thumbs = { ...thumbs, [path]: result.dataUrl };
      } else if (result.kind === "text") {
        if (mode === "file") {
          textPreview = { name: result.name, text: result.text, truncated: result.truncated };
        }
      }
    } catch {
      // 预览是加成能力：失败不阻断选择（发送时 daemon 读盘给出 typed 错误）。
    }
  }

  function confirmSelection(): void {
    if (selected.length === 0) return;
    onConfirm(
      selected.map((item) => ({
        path: item.path,
        name: item.name,
        ...(thumbs[item.path] !== undefined ? { preview: thumbs[item.path] } : {}),
      })),
    );
    open = false;
  }

  function formatSize(size: number | undefined): string {
    if (size === undefined) return "";
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MiB`;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="flex max-h-[80vh] flex-col gap-0 sm:max-w-[560px]">
    <Dialog.Header>
      <Dialog.Title class="flex items-center gap-2">
        {#if mode === "image"}
          <IconImage class="h-4 w-4" aria-hidden="true" />
        {:else}
          <IconFileUp class="h-4 w-4" aria-hidden="true" />
        {/if}
        {mode === "image" ? "Pick images from this machine" : "Pick files from this machine"}
      </Dialog.Title>
      <Dialog.Description>
        Browse the daemon-side file system and attach real paths
        {mode === "image" ? "（≤4 images，4MiB each）" : "（≤2 files，512KiB each）"}.
      </Dialog.Description>
    </Dialog.Header>

    {#if error}
      <div
        class="mx-4 mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive"
        role="alert"
      >
        {error}
      </div>
    {/if}

    <!-- 面包屑 + 上级 -->
    <div
      class="mx-4 mt-3 flex items-center gap-1 overflow-x-auto rounded-md border border-border bg-muted/30 px-2 py-1.5 text-xs"
      aria-label="Directory breadcrumbs"
    >
      {#if parent !== null}
        <button
          type="button"
          class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Up one level"
          aria-label="Up one level"
          onclick={() => void navigate(parent ?? undefined)}
        >
          <IconChevronUp class="h-3.5 w-3.5" />
        </button>
      {/if}
      {#each crumbs as crumb, index (crumb.path)}
        {#if index > 0}
          <IconChevronRight class="h-3 w-3 shrink-0 text-muted-foreground/60" aria-hidden="true" />
        {/if}
        <button
          type="button"
          class="shrink-0 rounded px-1 py-0.5 font-mono text-muted-foreground hover:bg-muted hover:text-foreground {crumb.path ===
          dir
            ? 'text-foreground'
            : ''}"
          onclick={() => void navigate(crumb.path)}
        >
          {crumb.label}
        </button>
      {/each}
    </div>

    <!-- 目录列表 -->
    <div
      class="mx-4 mt-2 min-h-[200px] flex-1 overflow-y-auto rounded-md border border-border"
      aria-label="Directory entries"
      aria-busy={loading}
    >
      {#if loading && entries.length === 0}
        <div class="flex h-[200px] items-center justify-center text-xs text-muted-foreground">
          Loading…
        </div>
      {:else if entries.length === 0}
        <div class="flex h-[200px] items-center justify-center text-xs text-muted-foreground">
          Empty directory
        </div>
      {:else}
        {#each entries as entry (entry.name)}
          {@const blocked = selectionBlockReason(entry)}
          {@const selectedRow =
            entry.kind === "file" && isSelected(`${dir.replace(/\/+$/, "")}/${entry.name}`)}
          <button
            type="button"
            class="flex w-full items-center gap-2 border-b border-border/50 px-2.5 py-1.5 text-left text-xs transition-colors last:border-b-0 {entry.kind ===
            'dir'
              ? 'hover:bg-muted'
              : blocked !== null
                ? 'cursor-not-allowed opacity-40'
                : 'hover:bg-muted'} {selectedRow ? 'bg-primary/10' : ''}"
            aria-pressed={entry.kind === "file" ? selectedRow : undefined}
            aria-disabled={blocked !== null ? "true" : undefined}
            title={blocked ??
              (entry.kind === "dir" ? `Open ${entry.name}` : `Select ${entry.name}`)}
            data-entry-kind={entry.kind}
            data-entry-name={entry.name}
            onclick={() => onRowClick(entry)}
          >
            {#if entry.kind === "dir"}
              <IconFolder class="h-3.5 w-3.5 shrink-0 text-sky-500" aria-hidden="true" />
            {:else if entry.name.match(IMAGE_EXTENSION)}
              <IconImage class="h-3.5 w-3.5 shrink-0 text-violet-500" aria-hidden="true" />
            {:else if entry.name.match(/\.(txt|md|markdown|json|ya?ml|toml|csv|tsv|log|patch|diff|ts|tsx|js|jsx|py|rs|go|java|c|h|cpp|sh|css|html|xml|ini|env)$/i)}
              <IconFileText class="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
            {:else}
              <IconFile class="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            {/if}
            <span class="min-w-0 flex-1 truncate font-mono">{entry.name}</span>
            {#if entry.kind === "file" && entry.size !== undefined}
              <span class="shrink-0 text-[10px] text-muted-foreground"
                >{formatSize(entry.size)}</span
              >
            {/if}
          </button>
        {/each}
      {/if}
    </div>

    {#if truncated}
      <p class="mx-4 mt-1.5 text-[10px] text-muted-foreground">
        List truncated at 2000 entries — open a subfolder to narrow down.
      </p>
    {/if}

    <!-- 文本头预览（file 模式加成） -->
    {#if textPreview !== null}
      <div class="mx-4 mt-2 rounded-md border border-border bg-muted/30 p-2">
        <p class="mb-1 truncate font-mono text-[10px] text-muted-foreground">
          {textPreview.name}
        </p>
        <pre
          class="max-h-24 overflow-y-auto text-[11px] leading-relaxed whitespace-pre-wrap">{textPreview.text}{textPreview.truncated
            ? "…"
            : ""}</pre>
      </div>
    {/if}

    <!-- 选择托盘 -->
    {#if selected.length > 0}
      <div class="mx-4 mt-3 flex flex-wrap gap-1.5" aria-label="Selected files">
        {#each selected as item (item.path)}
          <span
            class="flex items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[10px]"
          >
            {#if thumbs[item.path]}
              <img src={thumbs[item.path]} alt={item.name} class="h-6 w-6 rounded object-cover" />
            {/if}
            <span class="max-w-[180px] truncate font-mono">{item.name}</span>
            <button
              type="button"
              class="text-muted-foreground hover:text-destructive"
              aria-label="Deselect {item.name}"
              onclick={() => {
                selected = selected.filter((candidate) => candidate.path !== item.path);
                if (textPreview?.name === item.name) textPreview = null;
              }}
            >
              <IconX class="h-2.5 w-2.5" />
            </button>
          </span>
        {/each}
      </div>
    {/if}

    <Dialog.Footer class="mt-4 flex items-center justify-between">
      <span class="text-[11px] text-muted-foreground">
        {selected.length} / {selectLimit} selected
      </span>
      <div class="flex gap-2">
        <Button variant="outline" size="sm" onclick={() => (open = false)}>Cancel</Button>
        <Button size="sm" disabled={selected.length === 0} onclick={confirmSelection}>
          {selectLabel}
        </Button>
      </div>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
