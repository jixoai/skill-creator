/*
  jixoai ripple runtime (registry/files/ui/press-button/ripple.svelte.ts).
  The settle contract of the svg ink engine (r4, Owner ruling
  2026-09-10 — effect-attachments design §12.6; r5 the same day: the
  animation itself moved to CSS): the ink node is a <circle>/<path>
  inside the host's viewBox-free <svg> seat, and the law sheet's
  jx-ripple-ink keyframes drive scale (transform-box: fill-box) and
  opacity off the SAME progress — the ink is fading from the first
  frame of its expansion, svg-animation in the Owner's sense: CSS on
  the svg node, zero script-side animate() calls (the battery pins
  that zero at the source). The node leaves the DOM when the
  animation ends.

  The settle is the platform's own event pair: animationend (the
  timeline finished) and animationcancel (the sheet changed under the
  node — display:none under reduced motion — or it left the document)
  BOTH settle, so no ink can outlive its layer. destroy unlistens and
  removes the node directly — the teardown path; a destroyed layer
  never plays another frame.

  The spawn geometry + the per-layer defs pair (the silhouette
  clipPath and the feGaussianBlur soft edge) live in
  press-effect-runtime.ts (the attachment's own gesture surface:
  pointer offsetX/Y or the keyboard center, both already in the svg's
  coordinate space, no rect math); the reduced-motion gate rides the
  same spawn seam.

  Extracted from press-button.svelte (2026-08-26) when Chip needed the
  same loop; reworked to the svg node form 2026-09-10 (the retired DOM
  dots and their per-node top/left math are gone by construction), then
  to the css-timeline settle the same day (r5 — the WAAPI engine is
  retired). The visual halves (.jx-ripple-layer/-ink/-flat) stay in
  press-button.css; every host imports that sheet.
*/
export interface RippleRuntime {
  /** the event-driven lifecycle for one ink node: `onSettled` rides the
   *  animationend/animationcancel settle for callers that own the
   *  node's DOM (the effect runtime's imperative layer removes the
   *  node there) */
  ink: (
    node: SVGElement,
    params: { key: number; onSettled?: () => void }
  ) => { destroy: () => void };
}

export function createRipple(): RippleRuntime {
  const ink = (
    node: SVGElement,
    params: { key: number; onSettled?: () => void }
  ) => {
    const settle = (): void => {
      unlisten();
      params.onSettled?.();
    };
    const unlisten = (): void => {
      node.removeEventListener('animationend', settle);
      node.removeEventListener('animationcancel', settle);
    };
    node.addEventListener('animationend', settle);
    node.addEventListener('animationcancel', settle);
    return {
      destroy() {
        unlisten();
        node.remove();
      },
    };
  };

  return { ink };
}
