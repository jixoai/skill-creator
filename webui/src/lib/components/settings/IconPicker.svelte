<!--
  路由图标/头像选择器（redesign-model-tabs-and-agent-panel S1；R7 8.1/8.2/8.3 重写）。
  用户原始需求 [2026-09-12]：「目录 36+ 图标存在重复 dataURL——网格按 dataURL 去重，
  相同图标只显示一次，hover/aria 可标注共享者」；「重构为三个独立控制：图标（含无
  图标）、图标/头像颜色（预设色板 + hex 输入，写 route.iconColor）、Letter 文字
  （route.iconLetter，默认名称首字母，可直接编辑 1-2 字符）」；「svg 上传不工作
  （≤64KiB 约束下的读取/校验/回填链路有 bug）——支持 .svg（image/svg+xml
  dataURL）；沿用 64KiB 上限与清晰错误提示。」
  正交意图：
  1. 弹层结构：28px 触发（hover 铅笔角标）+ 280px 面板，click-outside / Esc 关闭；
     三段 = Icon（目录网格去重 + 无图标 + Upload ≤64KiB）/ Color（Auto + 预设
     色板 + hex）/ Letter（1-2 字符文本，blur/Enter 提交）。选中即写：编辑态 =
     modelRoutes 补丁，新建态 = 草稿字段。
  2. 目录去重：catalogIcons 按 dataURL 分组——相同图标只渲染一次，title/aria
     列出共享 provider（models.dev 别名共享 logo，如 qwen 系与 alibaba）。
  3. 上传守卫：扩展名解析期望 MIME（.svg/.png/.webp），readAsDataURL 结果按
     期望 MIME 重写前缀（File.type 缺失的 svg 常产出 octet-stream dataURL，
     <img> 拒绝渲染——R7 8.3 根因）；onerror/超限/未知类型全部 toast 明示。
-->
<script lang="ts">
  import IconPencil from "@lucide/svelte/icons/pencil";
  import IconUpload from "@lucide/svelte/icons/upload";
  import { showToast } from "$lib/toast.svelte";
  import {
    ICON_EXTENSION_MIME,
    hueAvatarColor,
    isLetterAvatar,
    withDataUrlMime,
  } from "./route-icon.js";

  interface Props {
    /** 当前生效图标（route.icon ?? 目录图标；null = 字母头像）。 */
    icon?: string | null;
    /** 字母头像文字（route.iconLetter ?? 展示名首字母——调用方派生后传入）。 */
    letter: string;
    /** 字母头像底色（route.iconColor ?? 确定性色相——调用方派生后传入）。 */
    color: string;
    provider: string;
    label?: string;
    /** 目录图标全集（弹层网格数据源；调用方从 catalog 投影）。 */
    catalogIcons?: Array<{ provider: string; icon: string }>;
    disabled?: boolean;
    /** 图标选中即写；undefined = 清除覆盖（回退目录/字母头像）。 */
    onPick: (icon: string | undefined) => void;
    /** 显式无图标（iconSuppressed = true：抑制目录回退，走 Letter 头像；
     * codex R7 B3——目录 provider 也能选「无图标」）。 */
    onSuppress?: () => void;
    /** 颜色提交（hex）；undefined = 清除覆盖（回退确定性色相）。 */
    onColor?: (color: string | undefined) => void;
    /** Letter 提交（1-2 字符）；undefined = 清除覆盖（回退首字母）。 */
    onLetter?: (letter: string | undefined) => void;
  }

  let {
    icon = null,
    letter,
    color,
    provider,
    label = "",
    catalogIcons = [],
    disabled = false,
    onPick,
    onSuppress,
    onColor,
    onLetter,
  }: Props = $props();

  const MAX_ICON_CHARS = 64 * 1024;
  /** 预设色板（字母头像/图标底色；Auto = 清除 iconColor 回退确定性色相）。 */
  const PALETTE: readonly string[] = [
    "#ef4444",
    "#f59e0b",
    "#10b981",
    "#06b6d4",
    "#3b82f6",
    "#8b5cf6",
    "#f43f5e",
    "#64748b",
  ];
  const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

  let open = $state(false);
  let rootEl = $state<HTMLElement | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);
  // Letter 编辑草稿：由 effect 从 prop 同步（popover 打开前已就绪），避免
  // 初始化捕获初值的 svelte 警告。
  let letterDraft = $state("");
  let hexDraft = $state("");
  let hexInvalid = $state(false);

  // 外部 letter 变化同步进草稿（未聚焦编辑时）。
  $effect(() => {
    letterDraft = letter;
  });

  /**
   * 目录网格（dataURL 去重）：同一 dataURL 的多个 provider 合并为一格，
   * title/aria 标注共享者；本 provider 的图标置顶高亮。
   */
  const gridIcons = $derived.by(() => {
    const byIcon = new Map<string, { icon: string; providers: string[] }>();
    for (const entry of catalogIcons) {
      const existing = byIcon.get(entry.icon);
      if (existing) existing.providers.push(entry.provider);
      else byIcon.set(entry.icon, { icon: entry.icon, providers: [entry.provider] });
    }
    const groups = [...byIcon.values()];
    groups.sort((a, b) => {
      const aOwn = a.providers.includes(provider) ? 0 : 1;
      const bOwn = b.providers.includes(provider) ? 0 : 1;
      return aOwn - bOwn || a.providers[0]!.localeCompare(b.providers[0]!);
    });
    return groups;
  });
  const hasOwnIcon = $derived(catalogIcons.some((entry) => entry.provider === provider));

  function pickIcon(next: string | undefined): void {
    if (disabled) return;
    onPick(next);
    open = false;
  }

  function commitLetter(): void {
    if (onLetter === undefined || disabled) return;
    const trimmed = letterDraft.trim();
    if (trimmed.length === 0 || trimmed === letter) {
      letterDraft = letter;
      return;
    }
    onLetter(trimmed.slice(0, 2));
  }

  function resetLetter(): void {
    if (onLetter === undefined || disabled) return;
    onLetter(undefined);
    letterDraft = letter;
  }

  function commitHex(): void {
    if (onColor === undefined || disabled) return;
    const trimmed = hexDraft.trim();
    if (trimmed.length === 0) {
      hexInvalid = false;
      return;
    }
    if (!HEX_COLOR.test(trimmed)) {
      hexInvalid = true;
      return;
    }
    hexInvalid = false;
    hexDraft = "";
    onColor(trimmed.toLowerCase());
  }

  function onUploadChange(event: Event): void {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) return;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    // 白名单严格按 accept 集（.svg/.png/.webp）：File.type 可能缺失或漂移
    // （Figma 拖出的 svg type=""），不作为放行依据。
    const expectedMime = ICON_EXTENSION_MIME[extension] ?? "";
    if (expectedMime.length === 0) {
      showToast(
        `Unsupported icon type “${file.type || extension || file.name}” — use .svg, .png or .webp.`,
      );
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => {
      showToast(`Could not read “${file.name}” — try another file.`);
    };
    reader.onload = () => {
      const raw = typeof reader.result === "string" ? reader.result : "";
      if (raw.length === 0) {
        showToast(`Could not read “${file.name}” — try another file.`);
        return;
      }
      // MIME 重写：File.type 缺失（Figma/下载来源的 svg 常见）时 readAsDataURL 产出
      // 非 image MIME 的 dataURL，<img> 拒绝渲染——按扩展名解析的期望 MIME 重建前缀。
      const dataUrl = raw.startsWith(`data:${expectedMime}`)
        ? raw
        : withDataUrlMime(raw, expectedMime);
      if (dataUrl === null) {
        showToast(`Could not read “${file.name}” as an image.`);
        return;
      }
      if (dataUrl.length > MAX_ICON_CHARS) {
        showToast("Icon too large — pick an image under 64 KiB.");
        return;
      }
      pickIcon(dataUrl);
    };
    reader.readAsDataURL(file);
  }
</script>

<svelte:window
  onkeydown={(event) => {
    if (open && event.key === "Escape") open = false;
  }}
  onpointerdown={(event) => {
    if (open && rootEl && !rootEl.contains(event.target as Node)) open = false;
  }}
/>

<div class="relative shrink-0" bind:this={rootEl}>
  <button
    type="button"
    class="group relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-md border border-border bg-background transition-colors hover:border-primary/50 {disabled
      ? 'pointer-events-none opacity-50'
      : ''}"
    aria-label="Change route icon"
    aria-expanded={open}
    {disabled}
    onclick={() => (open = !open)}
  >
    {#if icon}
      <img
        src={icon}
        alt=""
        class="h-5 w-5 object-contain {isLetterAvatar(icon) ? '' : 'dark:invert'}"
      />
    {:else}
      <span
        class="flex h-5 w-5 items-center justify-center rounded text-[10px] font-semibold text-white"
        style="background: {color}"
        aria-hidden="true"
      >
        {letter}
      </span>
    {/if}
    <span
      class="absolute bottom-0 right-0 hidden bg-background p-px text-foreground group-hover:block"
      aria-hidden="true"
    >
      <IconPencil class="h-2.5 w-2.5" />
    </span>
  </button>

  {#if open}
    <div
      class="absolute left-0 top-[calc(100%+4px)] z-30 w-[280px] space-y-2 rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-md"
      role="dialog"
      aria-label="Route icon and avatar choices"
    >
      <div class="flex items-center gap-2">
        {#if icon}
          <img
            src={icon}
            alt=""
            class="h-12 w-12 shrink-0 object-contain {isLetterAvatar(icon) ? '' : 'dark:invert'}"
          />
        {:else}
          <span
            class="flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-base font-semibold text-white"
            style="background: {color}"
            aria-hidden="true"
          >
            {letter}
          </span>
        {/if}
        <div class="min-w-0">
          <p class="truncate text-xs font-medium">{label || provider}</p>
          <p class="text-[10px] text-muted-foreground">
            {icon
              ? isLetterAvatar(icon)
                ? "Legacy letter avatar"
                : "Icon override"
              : "Letter avatar"}
          </p>
        </div>
      </div>

      {#if gridIcons.length > 0}
        <div class="space-y-1">
          <span class="text-[10px] font-medium text-muted-foreground">Icon</span>
          <div class="grid grid-cols-7 place-items-center gap-1">
            <button
              type="button"
              class="flex h-6 w-6 items-center justify-center rounded border {icon === null
                ? 'border-primary/50 bg-primary/5'
                : 'border-border hover:bg-muted'}"
              title="No icon — letter avatar with the color below (suppresses the catalog icon)"
              aria-label="No icon (letter avatar)"
              onclick={() => {
                // codex R7 B3：No icon = 显式抑制（目录 provider 也走 Letter 头像），
                // 不再是「清除覆盖后回退目录图标」的隐式语义。
                if (onSuppress !== undefined) {
                  onSuppress();
                  open = false;
                  return;
                }
                pickIcon(undefined);
              }}
            >
              <span
                class="flex h-4 w-4 items-center justify-center rounded text-[8px] font-semibold text-white"
                style="background: {color}"
                aria-hidden="true"
              >
                {letter.slice(0, 1)}
              </span>
            </button>
            {#each gridIcons as group (group.icon)}
              <button
                type="button"
                class="flex h-6 w-6 items-center justify-center rounded {icon === group.icon
                  ? 'border border-primary/60 bg-primary/5'
                  : 'hover:bg-muted'}"
                title={group.providers.join(", ")}
                aria-label="Use icon shared by {group.providers.length > 1
                  ? group.providers.join(', ')
                  : group.providers[0]}"
                onclick={() => pickIcon(group.icon)}
              >
                <!-- 图标着色（codex R7 B3）：iconColor 同时作用于图片图标——
                     图标以 color 为底渲染在圆角瓦片上（/15 透明度柔化）。 -->
                <span
                  class="flex h-4 w-4 items-center justify-center rounded"
                  style="background: color-mix(in srgb, {color} 18%, transparent)"
                  aria-hidden="true"
                >
                  <img src={group.icon} alt="" class="h-3.5 w-3.5 object-contain dark:invert" />
                </span>
              </button>
            {/each}
          </div>
          {#if hasOwnIcon}
            <p class="text-[9px] text-muted-foreground">
              Duplicate catalog icons are merged; hover shows sharing providers.
            </p>
          {/if}
        </div>
      {:else}
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded px-1 py-0.5 text-[10px] transition-colors hover:bg-muted {icon ===
          null
            ? 'text-primary'
            : 'text-muted-foreground'}"
          title="No icon — letter avatar with the color below"
          aria-label="No icon (letter avatar)"
          onclick={() => pickIcon(undefined)}
        >
          <span
            class="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[8px] font-semibold text-white"
            style="background: {color}"
            aria-hidden="true"
          >
            {letter.slice(0, 1)}
          </span>
          No icon — use the letter avatar
        </button>
      {/if}

      <div class="flex items-center justify-between gap-2 border-t border-border pt-1.5">
        <span class="text-[10px] text-muted-foreground">Custom image · ≤64 KiB</span>
        <button
          type="button"
          class="flex h-6 items-center gap-1 rounded px-1.5 text-[10px] hover:bg-muted"
          onclick={() => fileInput?.click()}
        >
          <IconUpload class="h-3 w-3" />
          Upload
        </button>
      </div>
      <input
        type="file"
        accept=".svg,.png,.webp"
        class="hidden"
        bind:this={fileInput}
        onchange={onUploadChange}
        aria-label="Upload custom icon"
      />

      {#if onColor !== undefined}
        <div class="space-y-1 border-t border-border pt-1.5">
          <span class="text-[10px] font-medium text-muted-foreground">Avatar color</span>
          <div class="flex flex-wrap items-center gap-1">
            <button
              type="button"
              class="flex h-6 w-6 items-center justify-center rounded border {color ===
              hueAvatarColor(provider)
                ? 'border-primary/50 bg-primary/5'
                : 'border-border hover:bg-muted'}"
              title="Auto — deterministic hue from the route name"
              aria-label="Auto avatar color"
              onclick={() => onColor?.(undefined)}
            >
              <span
                class="flex h-4 w-4 items-center justify-center rounded text-[8px] font-semibold text-white"
                style="background: {hueAvatarColor(provider)}"
                aria-hidden="true"
              >
                {letter.slice(0, 1)}
              </span>
            </button>
            {#each PALETTE as hex (hex)}
              <button
                type="button"
                class="flex h-6 w-6 items-center justify-center rounded border {color.toLowerCase() ===
                hex
                  ? 'border-primary/60 bg-primary/5'
                  : 'border-border hover:bg-muted'}"
                title={hex}
                aria-label="Avatar color {hex}"
                onclick={() => onColor?.(hex)}
              >
                <span class="h-4 w-4 rounded" style="background: {hex}" aria-hidden="true"></span>
              </button>
            {/each}
          </div>
          <div class="flex items-center gap-1">
            <input
              class="h-6 w-24 rounded border bg-background px-1.5 font-mono text-[10px] outline-none focus:border-primary/60 {hexInvalid
                ? 'border-destructive'
                : 'border-border'}"
              aria-label="Avatar color hex"
              placeholder="#3b82f6"
              bind:value={hexDraft}
              {disabled}
              onblur={() => commitHex()}
              onkeydown={(event) => {
                if (event.key === "Enter") commitHex();
              }}
            />
            {#if hexInvalid}
              <span class="text-[9px] text-destructive" role="alert">invalid hex</span>
            {/if}
          </div>
        </div>
      {/if}

      {#if onLetter !== undefined}
        <div class="space-y-1 border-t border-border pt-1.5">
          <span class="text-[10px] font-medium text-muted-foreground">Letter</span>
          <div class="flex items-center gap-1.5">
            <input
              class="h-6 w-12 rounded border border-border bg-background px-1.5 text-center text-[11px] font-semibold uppercase outline-none focus:border-primary/60"
              aria-label="Avatar letter"
              maxlength="2"
              bind:value={letterDraft}
              {disabled}
              onblur={() => commitLetter()}
              onkeydown={(event) => {
                if (event.key === "Enter") commitLetter();
              }}
            />
            <button
              type="button"
              class="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Reset to the first letter of the display name"
              onclick={resetLetter}
            >
              Reset
            </button>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>
