<script lang="ts">
  /**
   * 原始需求 [2026-07-14]：「opentray 的一些适配没不好，好好学习 pnpm-pub」。
   * 用户原始需求 [2026-10-01]：「双击最大化……属于 js 的工作」（后裁决：JS 属平台
   * 注入层，经 bindWindowRegion 声明式提供；本组件只声明区域）。
   * 正交意图：
   * 1. 把顶栏声明为窗口区域（bindWindowRegion 'auto'：拖拽 + 双击缩放）。
   * 2. 根据系统窗口控件几何计算标题栏安全区。
   * 3. 在普通浏览器中提供无副作用降级。
   */
  import { onMount, type Snippet } from "svelte";
  import { t } from "$lib/i18n";

  type Variant = "main" | "bare";

  /** 拖拽条变体及左右两侧可选内容。 */
  let {
    variant = "main",
    left = null as Snippet | null,
    right = null as Snippet | null,
  }: {
    variant?: Variant;
    left?: Snippet | null;
    right?: Snippet | null;
  } = $props();

  let safeLeft = $state(8);
  let safeRight = $state(8);
  let strip: HTMLDivElement | undefined = $state();

  const CONTROL_MARGIN = 4;

  onMount(() => {
    // 原生宿主：声明式窗口区域（拖拽/双击最大化由平台注入 JS 承载）。
    // 普通浏览器：API 缺失则无操作，保持既有降级语义。
    const region = strip;
    if (!region) return;
    const handle = navigator.opentrayWindow?.bindWindowRegion?.(region, "auto");
    return () => handle?.unbind?.();
  });

  function applyRect(rect: OpentrayRect): void {
    const inner = globalThis.innerWidth;
    const left = Math.max(0, Math.round(rect.x));
    const right = Math.max(0, Math.round(inner - rect.x - rect.width));
    safeLeft = left + (left > 0 ? CONTROL_MARGIN : 0);
    safeRight = right + (right > 0 ? CONTROL_MARGIN : 0);
  }

  onMount(() => {
    const overlay = navigator.opentrayWindow?.overlay ?? navigator.opentray?.window?.overlay;
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
  bind:this={strip}
  class="drag-strip no-drag shrink-0"
  style="padding-left: {safeLeft}px; padding-right: {safeRight}px"
  role="banner"
  aria-label={t("shell.titlebarAria")}
>
  {#if variant === "main" && left}
    {@render left()}
  {/if}
  <div class="flex-1"></div>
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
