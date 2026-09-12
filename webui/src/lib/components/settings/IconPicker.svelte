<!--
  路由图标选择器（redesign-model-tabs-and-agent-panel S1，design §2.4）。
  用户原始需求 [2026-09-12]：「IconPicker（两处复用）：触发 28px 图标按钮；
  Popover：当前图标大图 48px + Catalog 网格 + Upload 文件按钮 + Letter 回退项。
  选中即写：编辑态 = modelRoutes 补丁（route.icon）；新建态 = 草稿字段。」
  正交意图：
  1. 触发与弹层：28px 触发（hover 铅笔角标）+ 绝对定位 280px 面板，click-outside
     / Esc 关闭。不落 DropdownMenu 体系：菜单根不可控开合且其自动关闭语义与
     文件上传（异步 change）冲突（护栏「不引入新的菜单原语」同精神）。
  2. 选项三源：目录图标网格（本 provider 图标高亮置顶）、字母头像（Auto = 清除
     覆盖回退确定性色相；色相选择生成 SVG dataURL 持久化为 route.icon）、
     上传（.svg/.png/.webp → dataURL ≤64KiB，超限 toast 拒绝）。
-->
<script lang="ts">
  import IconPencil from "@lucide/svelte/icons/pencil";
  import IconUpload from "@lucide/svelte/icons/upload";
  import { showToast } from "$lib/toast.svelte";
  import { avatarHue, isLetterAvatar, letterAvatarDataUrl } from "./route-icon.js";

  interface Props {
    /** 当前生效图标（route.icon ?? 目录图标；null = 字母回退）。 */
    icon?: string | null;
    provider: string;
    label?: string;
    /** 目录图标全集（弹层网格数据源；调用方从 catalog 投影）。 */
    catalogIcons?: Array<{ provider: string; icon: string }>;
    disabled?: boolean;
    /** 选中即写；undefined = 清除覆盖（回退目录/字母）。 */
    onPick: (icon: string | undefined) => void;
  }

  let {
    icon = null,
    provider,
    label = "",
    catalogIcons = [],
    disabled = false,
    onPick,
  }: Props = $props();

  const MAX_ICON_CHARS = 64 * 1024;
  const LETTER_HUES = [0, 25, 145, 210, 265, 320] as const;

  let open = $state(false);
  let rootEl = $state<HTMLElement | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);

  const letter = $derived((label || provider).slice(0, 1).toUpperCase());
  const directoryIcon = $derived(
    catalogIcons.find((entry) => entry.provider === provider)?.icon ?? null,
  );
  const gridIcons = $derived(catalogIcons.filter((entry) => entry.provider !== provider));

  function pick(next: string | undefined): void {
    if (disabled) return;
    onPick(next);
    open = false;
  }

  function onUploadChange(event: Event): void {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) return;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (dataUrl.length === 0 || dataUrl.length > MAX_ICON_CHARS) {
        showToast("Icon too large — pick an image under 64 KiB.");
        return;
      }
      pick(dataUrl);
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
        style="background: hsl({avatarHue(provider)} 55% 45%)"
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
      aria-label="Route icon choices"
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
            style="background: hsl({avatarHue(provider)} 55% 45%)"
            aria-hidden="true"
          >
            {letter}
          </span>
        {/if}
        <div class="min-w-0">
          <p class="truncate text-xs font-medium">{label || provider}</p>
          <p class="text-[10px] text-muted-foreground">
            {icon ? (isLetterAvatar(icon) ? "Letter avatar" : "Custom icon") : "Letter fallback"}
          </p>
        </div>
      </div>

      {#if directoryIcon !== null || gridIcons.length > 0}
        <div class="space-y-1">
          <span class="text-[10px] font-medium text-muted-foreground">Catalog</span>
          <div class="grid grid-cols-7 place-items-center gap-1">
            {#if directoryIcon !== null}
              <button
                type="button"
                class="flex h-6 w-6 items-center justify-center rounded border border-primary/50 bg-primary/5"
                title="{provider} (directory default)"
                aria-label="Use {provider} directory icon"
                onclick={() => pick(directoryIcon)}
              >
                <img src={directoryIcon} alt="" class="h-4 w-4 object-contain dark:invert" />
              </button>
            {/if}
            {#each gridIcons as entry (entry.provider)}
              <button
                type="button"
                class="flex h-6 w-6 items-center justify-center rounded hover:bg-muted"
                title={entry.provider}
                aria-label="Use {entry.provider} icon"
                onclick={() => pick(entry.icon)}
              >
                <img src={entry.icon} alt="" class="h-4 w-4 object-contain dark:invert" />
              </button>
            {/each}
          </div>
        </div>
      {/if}

      <div class="space-y-1">
        <span class="text-[10px] font-medium text-muted-foreground">Letter</span>
        <div class="flex items-center gap-1">
          <button
            type="button"
            class="flex h-6 w-6 items-center justify-center rounded border {icon
              ? 'border-border hover:bg-muted'
              : 'border-primary/50 bg-primary/5'}"
            title="Auto — deterministic hue from the route name"
            aria-label="Auto letter avatar"
            onclick={() => pick(undefined)}
          >
            <span
              class="flex h-4 w-4 items-center justify-center rounded text-[8px] font-semibold text-white"
              style="background: hsl({avatarHue(provider)} 55% 45%)"
              aria-hidden="true"
            >
              {letter}
            </span>
          </button>
          {#each LETTER_HUES as hue (hue)}
            <button
              type="button"
              class="flex h-6 w-6 items-center justify-center rounded border {icon ===
              letterAvatarDataUrl(letter, hue)
                ? 'border-primary/60 bg-primary/5'
                : 'border-border hover:bg-muted'}"
              title="Letter · hue {hue}"
              aria-label="Letter avatar hue {hue}"
              onclick={() => pick(letterAvatarDataUrl(letter, hue))}
            >
              <span
                class="flex h-4 w-4 items-center justify-center rounded text-[8px] font-semibold text-white"
                style="background: hsl({hue} 55% 45%)"
                aria-hidden="true"
              >
                {letter}
              </span>
            </button>
          {/each}
        </div>
      </div>

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
    </div>
  {/if}
</div>
