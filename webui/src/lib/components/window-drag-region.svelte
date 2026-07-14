<script lang="ts">
  /**
   * 原始需求 [2026-07-14]：「opentray 的一些适配没做好，好好学习 pnpm-pub」。
   * 正交意图：
   * 1. 将 pointer 事件转发为原生窗口拖拽。
   * 2. 根据系统窗口控件几何计算标题栏安全区。
   * 3. 在普通浏览器中提供无副作用降级。
   */
  import { onMount, type Snippet } from "svelte";

  type Variant = "main" | "bare";

  /** 拖拽条变体及左右两侧可选内容。 */
  let {
    variant = "main",
    left = null as Snippet | null,
    right = null as Snippet | null,
  }: { variant?: Variant; left?: Snippet | null; right?: Snippet | null } = $props();

  let safeLeft = $state(8);
  let safeRight = $state(8);

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
</style>
