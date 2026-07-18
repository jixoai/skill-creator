<script lang="ts">
  /**
   * 原始需求 [2026-07-14]：「opentray 的一些适配没不好，好好学习 pnpm-pub」。
   * 正交意图：
   * 1. 将 pointer 事件转发为原生窗口拖拽。
   * 2. 根据系统窗口控件几何计算标题栏安全区。
   * 3. 在普通浏览器中提供无副作用降级。
   * 4. 渲染 keep-open pin 与退出倒计时（blur 自动隐藏的单一开关）。
   */
  import { onMount, type Snippet } from "svelte";
  import IconPin from "@lucide/svelte/icons/pin";
  import IconPinOff from "@lucide/svelte/icons/pin-off";
  import { togglePin, trayState } from "$lib/store.svelte";

  type Variant = "main" | "bare";

  /** 拖拽条变体及左右两侧可选内容。 */
  let {
    variant = "main",
    showPin = false,
    left = null as Snippet | null,
    right = null as Snippet | null,
  }: {
    variant?: Variant;
    showPin?: boolean;
    left?: Snippet | null;
    right?: Snippet | null;
  } = $props();

  let safeLeft = $state(8);
  let safeRight = $state(8);

  const pinned = $derived(trayState.pinned);
  const pinCountdown = $derived(trayState.pinCountdown);
  const counting = $derived(pinCountdown !== null);
  const pinLabel = $derived(
    pinned ? "Keep window open on blur (pinned)" : "Allow blur to auto-hide window (unpinned)",
  );

  const CONTROL_MARGIN = 4;

  const ot = () => navigator.opentrayWindow ?? navigator.opentray?.window ?? undefined;

  function onPointerDown(e: PointerEvent) {
    const win = ot();
    try {
      win
        ?.startAppRegionDrag?.({ x: e.clientX, y: e.clientY, pointerId: e.pointerId })
        ?.catch?.(() => {});
    } catch {
      /* drag is a nicety — never throw */
    }
  }

  function applyRect(rect: OpentrayRect): void {
    const inner = globalThis.innerWidth;
    const left = Math.max(0, Math.round(rect.x));
    const right = Math.max(0, Math.round(inner - rect.x - rect.width));
    safeLeft = left + (left > 0 ? CONTROL_MARGIN : 0);
    safeRight = right + (right > 0 ? CONTROL_MARGIN : 0);
  }

  onMount(() => {
    const overlay = ot()?.overlay;
    if (!overlay) return;
    let unsub: (() => void) | null = null;
    void (async () => {
      try {
        applyRect(await overlay.getTitlebarAreaRect());
        if (overlay.listen) {
          unsub = await overlay.listen("geometrychange", (e) => applyRect(e.titlebarAreaRect));
        } else if (overlay.addEventListener) {
          const handler = (e: OpentrayGeometryChangeEvent) => applyRect(e.titlebarAreaRect);
          overlay.addEventListener("geometrychange", handler);
          unsub = () => overlay.removeEventListener?.("geometrychange", handler);
        }
      } catch {
        /* geometry is a nicety */
      }
    })();
    return () => {
      unsub?.();
    };
  });
</script>

<div
  class="drag-strip no-drag shrink-0"
  style="padding-left: {safeLeft}px; padding-right: {safeRight}px"
  onpointerdown={onPointerDown}
  role="banner"
  aria-label="window titlebar"
>
  {#if variant === "main" && left}
    {@render left()}
  {/if}
  <div class="flex-1"></div>
  {#if variant === "main" && showPin}
    <button
      class="pin-toggle no-drag flex h-6 items-center gap-1 rounded px-1.5 text-muted-foreground transition-colors hover:text-foreground {counting
        ? 'counting'
        : ''}"
      onpointerdown={(e) => e.stopPropagation()}
      onclick={() => togglePin()}
      aria-label={pinLabel}
      aria-pressed={pinned}
      title={pinLabel}
    >
      {#if pinned}
        <IconPin class="h-3.5 w-3.5 text-primary" />
      {:else}
        <IconPinOff class="h-3.5 w-3.5" />
      {/if}
      {#if counting}
        <span class="pin-countdown tabular-nums" aria-hidden="true">{pinCountdown}</span>
      {/if}
    </button>
  {/if}
  {#if variant === "main" && right}
    {@render right()}
  {/if}
</div>

<style>
  .drag-strip {
    display: flex;
    align-items: center;
    height: 2rem;
    width: 100%;
    gap: 0.25rem;
    background: transparent;
    cursor: default;
    user-select: none;
  }

  @media (max-width: 720px) {
    .drag-strip {
      height: 2.75rem;
    }
  }
</style>
