/*
  jixoai press-effect runtime (registry/files/ui/press-button/press-effect-runtime.ts).
  The attachment face of the effect family (effect-attachments,
  2026-09-09): the kernels stamp their layers/vars/classes imperatively
  so a plain element carries the same loop:

    {@attach pressEffect(shimmer({ speed: 4000 }))}

  THE CONTRACT (Svelte attachments, source+E2E proven on the resolved
  5.5x line): {@attach} invokes the expression's VALUE with (element)
  and honors a FUNCTION return as the teardown — there is no update /
  destroy-object channel. A REPLACED fx (the $derived path the docs
  teach) yields a fresh closure = identity remount, old teardown first;
  the deep-mutation boundary is two-sided and measured: no channel
  deep-reads the param (unlike use:), but the kernels' OWN property
  reads on a $state-held fx register fine-grained deps, so mutation
  re-runs the attachment — params flow, never mutate.

  SELF-LISTENING (Owner ruling): the factory owns its gesture surface —
  pointerdown/pointerup + keydown Enter/Space, zero coupling to the
  host's state machine. The documented price: the ripple ink fires on
  POINTERDOWN (the component's seam was click, where the loading lock
  suppressed it — a self-listening attachment cannot see the host's
  loading state; hosts that need that lock forward through their own
  record wrapper instead). No-op while the element matches
  :disabled / [aria-disabled="true"], re-checked PER EVENT (the
  loading pose flips aria-disabled live). Reduced motion rides the
  runtimes' own gates (ripple.svelte.ts's matchMedia check; the css
  law sheet freezes the other loops).

  THE r4→r5 RECIPE LAWS (Owner reviews 2026-09-10, design §12): pulse
  fades AS it expands (opacity and spread at matched percentages in
  ONE animation — r4, standing). The three r5 re-ruled recipes:
  shimmer and rainbow paint through ONE ring-masked span each — the
  RING-MASK law (press-button.css's law block): paint exists ONLY in
  the rim band, so a transparent host shows the effect and nothing
  else; the r4 backdrop-cut sniffing and rainbow host-face layering
  RESOLVED and painted the host's own background — the pollution
  class the Owner caught on the invite/subscribe demos, deleted with
  its resolution code. Shimmer's conic arc dwells around the ring on
  the sheet's registered --jx-shimmer-angle keyframes (no slide left
  to jam at the corners; the carrier law — measured through the mask —
  runs the keyframes on the masked span and consumes the inherited
  angle via rotate, the only path that repaints); rainbow's registered
  --jx-rainbow-shift pans a 200%-period stop train around the FULL
  ring. ripple keeps its viewBox-free svg seat (user units
  carries the host's inherited silhouette) and the ink runs on CSS
  keyframes (settle = animationend, the WAAPI call is gone), clipped
  to the host's silhouette by a per-layer clipPath and softened by an
  svg feGaussianBlur — the ink can never escape the button whatever
  the host's positioning. The kernels stay exported for direct use
  (the attachLiquidGlass precedent); the builders keep living in
  press-button.svelte's module script, unchanged.
*/
import type { Attachment } from 'svelte/attachments';
import type {
  PressEffect,
  PulseEffect,
  RainbowEffect,
  RippleEffect,
  ShimmerEffect,
} from './press-button.svelte';
import { createRipple } from './ripple.svelte';

/** corner-shape gates the bevel ink's support marker; where it's missing
 *  the flat fallback stamps the node — the path draws the same diamond
 *  either way (the component's own module-scope probe, mirrored) */
const bevelInk =
  typeof CSS !== 'undefined' &&
  typeof CSS.supports === 'function' &&
  CSS.supports('corner-shape', 'bevel');

/** THE BORDER-AREA GATE (Owner r11): Chrome 139+ can clip a background
 *  to the border band itself — the true cutout, no fill layer needed
 *  for a transparent face. Read PER MOUNT (a function, not a frozen
 *  const) so tests can stub CSS.supports and pin both branches */
function borderAreaSupported(): boolean {
  return (
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('background-clip', 'border-area')
  );
}

/* ── the fill channel (Owner r11): number = opaque, null = transparent ── */

/** parse a CSS color to [r, g, b, a] — hex and rgb()/rgba() by regex
 *  (jsdom-safe), anything exotic through the canvas normalizer */
function parseColor(color: string): [number, number, number, number] | null {
  const s = color.trim();
  let m = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) {
      const [r, g, b, a = 'f'] = h.split('');
      return [parseInt(r + r, 16), parseInt(g + g, 16), parseInt(b + b, 16), parseInt(a + a, 16) / 255];
    }
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
      h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    ];
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) {
    const parts = m[1].replace(/\//g, ' ').replace(/,/g, ' ').trim().split(/\s+/);
    if (parts.length >= 3) {
      const n = (v: string): number => parseFloat(v);
      return [
        Math.round(n(parts[0])),
        Math.round(n(parts[1])),
        Math.round(n(parts[2])),
        parts[3] === undefined ? 1 : n(parts[3]),
      ];
    }
  }
  if (typeof document === 'undefined') return null;
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#000';
  ctx.fillStyle = s;
  const norm = String(ctx.fillStyle);
  if (norm.startsWith('#') || norm.startsWith('rgba')) return parseColor(norm);
  return null;
}

/** the Context's theme state (the Owner's r12 ruling: the fill default
 *  FOLLOWS the context's dark/light): the site's own toggle first
 *  (html.dark), then the scheme */
export function contextIsDark(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) {
    return true;
  }
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

/** the Context's base color — the page root's own background when it
 *  is opaque (the visible page base), else the scheme's white/black
 *  (never the --background TOKEN: measured dark even under this
 *  site's light theme — tokens lie, the rendered root does not) */
export function contextBaseCss(): string {
  if (typeof document !== 'undefined') {
    const bg = getComputedStyle(document.documentElement).backgroundColor;
    const parsed = parseColor(bg);
    if (parsed && parsed[3] === 1) return bg;
  }
  return contextIsDark() ? '#000000' : '#ffffff';
}

/** the base as the fill channel's own unit — a 0xRRGGBB number */
export function contextBase(): number {
  const [r, g, b] = parseColor(contextBaseCss()) ?? [255, 255, 255];
  return (r << 16) | (g << 8) | b;
}

/**
 * solidFill — the fill channel's minter (Owner r11): take ANY CSS
 * color, composite it over the context's base color (light/dark true
 * by construction), and return the guaranteed-OPAQUE 0xRRGGBB number
 * shimmer's `fill` accepts. An explicit base overrides the context's
 * (deterministic minting for tests and design tokens):
 *
 *   shimmer({ fill: solidFill('rgba(255, 255, 255, 0.35)') })
 */
export function solidFill(color: string, base?: string): number {
  const src = parseColor(color) ?? [255, 255, 255, 1];
  const dst = parseColor(base ?? contextBaseCss()) ?? [255, 255, 255, 1];
  const a = Math.min(Math.max(src[3], 0), 1);
  const over = (s: number, d: number): number => Math.round(s * a + d * (1 - a));
  return (over(src[0], dst[0]) << 16) | (over(src[1], dst[1]) << 8) | over(src[2], dst[2]);
}

/** number → the rgb() the sheet paints */
function fillToCss(fill: number): string {
  return `rgb(${(fill >> 16) & 255} ${(fill >> 8) & 255} ${fill & 255})`;
}

/** the fill channel's resolution, shared by the rim kernels (r11/r13):
 *  number → opaque rgb(); null → the TRUE cutout where the engine
 *  clips border-area, else the blend emulation (white + darken in
 *  light contexts, black + lighten in dark); undefined → Canvas, the
 *  color-scheme system color (the face follows the Context's
 *  dark/light live) */
function resolveFill(fill: number | null | undefined): { fillCss: string; blend: 'darken' | 'lighten' | null } {
  if (fill === null && !borderAreaSupported()) {
    const dark = contextIsDark();
    return { fillCss: fillToCss(dark ? 0x000000 : 0xffffff), blend: dark ? 'lighten' : 'darken' };
  }
  if (fill === null) return { fillCss: 'transparent', blend: null };
  if (fill === undefined) return { fillCss: 'Canvas', blend: null };
  return { fillCss: fillToCss(fill), blend: null };
}

/** the rim kernels' clip pair — border-area where the engine answers,
 *  the Afif border-box pair elsewhere */
function rimClipCss(): string {
  return borderAreaSupported() ? 'padding-box, border-area' : 'padding-box, border-box';
}

/** the stacking pose the effect hosts carry as utilities (relative z-0
 *  keeps the negative-z layers under the in-flow label); the runtime
 *  stamps the same classes itself */
const HOST_CLASSES = ['relative', 'z-0'];

/** each kernel's own custom properties — the stamp/strip pairs that
 *  keep the runtime coexisting with consumer styles (the liquid-glass
 *  stampVars precedent: rewrite ONLY what you own) */
const VAR_SHIMMER = /--shimmer-[a-z-]+:\s*[^;]*;?/g;
const VAR_PULSE = /--pulse-[a-z]+:\s*[^;]*;?/g;

/** rainbow owns the pace + the ring/fill/clip channels + the color
 *  stops inline — the paint itself rides the host-channel rule + the
 *  glow span's own law-sheet rule */
const VAR_RAINBOW = /--rainbow-[a-z-]+:\s*[^;]*;?|--c\d+:\s*[^;]*;?/g;

function stampVars(element: HTMLElement, vars: string, own: RegExp): void {
  const style = element.getAttribute('style') ?? '';
  const kept = style.replace(own, '').trim().replace(/;$/, '');
  element.setAttribute('style', kept ? `${kept}; ${vars}` : vars);
}
function stripVars(element: HTMLElement, own: RegExp): void {
  const style = element.getAttribute('style') ?? '';
  const kept = style.replace(own, '').trim().replace(/;$/, '');
  if (kept) element.setAttribute('style', kept);
  else element.removeAttribute('style');
}

/** add classes the element does not carry yet; return exactly the ones
 *  added — the cleanup must never strip a consumer's own utilities */
function addClasses(element: HTMLElement, classes: readonly string[]): string[] {
  const added: string[] = [];
  for (const cls of classes) {
    if (!element.classList.contains(cls)) {
      element.classList.add(cls);
      added.push(cls);
    }
  }
  return added;
}

/** the static layer spans the kernels render — aria-hidden scenery */
function span(cls: string): HTMLSpanElement {
  const node = document.createElement('span');
  node.className = cls;
  node.setAttribute('aria-hidden', 'true');
  return node;
}

/** svg ink nodes (the r4 ripple engine; r5 adds the defs pair — the
 *  silhouette clip + the soft-edge filter — and the group that carries
 *  their references) */
const SVG_NS = 'http://www.w3.org/2000/svg';
function svgNode(tag: 'svg'): SVGSVGElement;
function svgNode(
  tag:
    | 'circle'
    | 'path'
    | 'g'
    | 'defs'
    | 'clipPath'
    | 'filter'
    | 'feGaussianBlur'
    | 'rect'
): SVGElement;
function svgNode(tag: string): SVGElement {
  return document.createElementNS(SVG_NS, tag) as SVGElement;
}

/** shimmer — THE HOST CHANNEL, r11 final (the Owner's core ruling
 *  2026-09-11: 「你目前是通过在宿主元素里面加元素来实现这个效果，
 *  还要加 inset，现在不要了。直接改成在宿主元素上去做」): NO child
 *  layer, NO inset — the HOST itself carries the ring, exactly like
 *  the Owner's reference css (border + the double background + the
 *  spin, all one element). The runtime stamps the class + vars and
 *  resolves the FACE per the fill channel:
 *    • fill = number  → the opaque rgb() rides --shimmer-fill; the
 *      sheet's fill layer provides the background (the extra layer
 *      the border-area mode requires for a solid face)
 *    • fill = null    → TRANSPARENT. Where Chrome 139+ answers, the
 *      conic clips to border-area and the face is the host's own —
 *      the TRUE cutout at last. Where it does not, the blend
 *      emulation (the Owner's ruling): light context → white fill +
 *      mix-blend-mode: darken on the host; dark context → black
 *      fill + lighten — the face reads as glass over whatever sits
 *      behind, which is why the demo band exists
 *    • fill undefined → the context's own base color, opaque
 *  Teardown strips the class, the vars, and restores the host's
 *  prior mix-blend-mode untouched */
export function applyShimmer(element: HTMLElement, fx: ShimmerEffect): () => void {
  element.setAttribute('data-jx-shimmer-host', '');
  const added = addClasses(element, ['jx-shimmer-host']);
  const { fillCss, blend } = resolveFill(fx.fill);
  stampVars(
    element,
    `--shimmer-shine: ${fx.shine}; --shimmer-base: ${fx.ringColor}; --shimmer-shine-width: ${fx.shineWidth}; --shimmer-speed: ${fx.speed}ms; --shimmer-ring-w: ${fx.ringW}; --shimmer-fill: ${fillCss}; --shimmer-clip: ${rimClipCss()}`,
    VAR_SHIMMER
  );
  const priorBlend = element.style.mixBlendMode;
  if (blend) element.style.mixBlendMode = blend;
  return () => {
    element.style.mixBlendMode = priorBlend;
    element.removeAttribute('data-jx-shimmer-host');
    for (const cls of added) element.classList.remove(cls);
    stripVars(element, VAR_SHIMMER);
  };
}

/** pulse — sonar rings from a silhouette copy of the body. The DOM is
 *  the pre-r4 shape (one layer span, the variant rides its own class);
 *  the r4 ruling lives in the sheet: opacity fades DURING the spread —
 *  both channels at matched percentages in ONE keyframe set, no
 *  sequential fade phase */
export function applyPulse(element: HTMLElement, fx: PulseEffect): () => void {
  element.setAttribute('data-jx-pulse-host', '');
  const added = addClasses(element, HOST_CLASSES);
  stampVars(
    element,
    `--pulse-color: ${fx.color}; --pulse-duration: ${fx.duration}ms; --pulse-distance: ${fx.distance}`,
    VAR_PULSE
  );
  const layer = span(`jx-pulse-layer jx-pulse-${fx.variant}`);
  element.prepend(layer);
  return () => {
    layer.remove();
    element.removeAttribute('data-jx-pulse-host');
    for (const cls of added) element.classList.remove(cls);
    stripVars(element, VAR_PULSE);
  };
}

/** rainbow — THE HOST CHANNEL, r13 (the Owner's ruling: rainbow is
 *  shimmer's sibling — same technique, same params): the host's own
 *  border IS the flowing ring (width = ringW, forced transparent +
 *  image hidden; the wrap-stop train rides background layer 2 through
 *  the SAME border-area gate and fill channel as shimmer — number =
 *  opaque face, null = the true cutout / blend emulation, undefined =
 *  Canvas, theme-live). The ONE span that remains is the under-glow
 *  bar (the Owner's ruling: 「blur 的彩虹光影不用改」) — it keeps its
 *  own paint and now INHERITS the registered shift from the animating
 *  host (one animation drives both carriers) */
export function applyRainbow(element: HTMLElement, fx: RainbowEffect): () => void {
  element.setAttribute('data-jx-rainbow-host', '');
  const added = addClasses(element, ['jx-rainbow-host', ...HOST_CLASSES]); // the glow span still needs the stacking pose
  const { fillCss, blend } = resolveFill(fx.fill);
  stampVars(
    element,
    `--rainbow-speed: ${fx.speed}ms; --rainbow-ring-w: ${fx.ringW}; --rainbow-fill: ${fillCss}; --rainbow-clip: ${rimClipCss()}; ${fx.colors
      .map((c, i2) => `--c${i2 + 1}: ${c}`)
      .join('; ')}`,
    VAR_RAINBOW
  );
  const priorBlend = element.style.mixBlendMode;
  if (blend) element.style.mixBlendMode = blend;
  const glow = span('jx-rainbow-glow');
  element.prepend(glow);
  return () => {
    element.style.mixBlendMode = priorBlend;
    glow.remove();
    element.removeAttribute('data-jx-rainbow-host');
    for (const cls of added) element.classList.remove(cls);
    stripVars(element, VAR_RAINBOW);
  };
}

/** per-layer id suffix (the glass filter's stamp-suffix precedent):
 *  the clipPath/filter ids must be unique per MOUNTED layer — two
 *  ripple hosts on one page would otherwise cross-reference each
 *  other's defs */
let rippleLayerSeq = 0;


/** ripple — the SVG ink engine (r4 ruling 6; r5: css-timeline ink +
 *  the silhouette clip + the soft edge): the layer is ONE viewBox-
 *  free <svg> seat filling the host (inset-0 = the padding box), so
 *  user units are CSS px in the seat's own rect frame (clientX/Y minus
 *  frame — spawn never touches per-dot top/left math again (the
 *  border-box-vs-padding-box misalignment class is dead by
 *  construction). Size reads clientWidth/clientHeight (the padding
 *  box, what the svg fills) — never getBoundingClientRect. ONE defs
 *  pair per layer: the clipPath rect (the host's padding box + its
 *  computed corner radius — the ink can never escape the rounded
 *  silhouette whatever the host's positioning, the Owner's overflow
 *  finding) and the feGaussianBlur soft edge; the ink <g>roup carries
 *  both references. The ink node animates via the sheet's
 *  jx-ripple-ink keyframes (--ripple-duration on the layer) and the
 *  settle engine removes it on animationend — no WAAPI anywhere */
function rippleRuntime(element: HTMLElement, fx: RippleEffect): {
  spawn(clientX: number, clientY: number, fromPointer: boolean): void;
  destroy(): void;
} {
  const runtime = createRipple();
  // the host stamp the template branch carried (data-jx-ripple-host) —
  // DOM/classname equivalence with the retired declarative path
  element.setAttribute('data-jx-ripple-host', '');
  // THE ANCHOR LAW: the svg seat is position:absolute — without a
  // positioned host it anchors to the nearest transform/filter ancestor
  // and the ink rides a foreign box (the IAB catch, 2026-09-10: the
  // showcase's plain hosts are static, the page wrapper carries a
  // transform — every other kernel stamps this pose; ripple had lost it)
  const pose = addClasses(element, HOST_CLASSES);
  const layer = svgNode('svg');
  layer.setAttribute('class', 'jx-ripple-layer');
  layer.setAttribute('aria-hidden', 'true');
  layer.setAttribute(
    'style',
    `--ripple-color: ${fx.color}; --ripple-duration: ${fx.duration}ms`
  );
  // The clipping is GEOMETRY-FREE by ruling (Owner 2026-09-10): the
  // sheet rides the host's own silhouette — `.jx-ripple-layer` carries
  // `border-radius: inherit; overflow: hidden` — the corners track the
  // host for free (a clipPath's rx/ry never matched inherited radii as
  // cleanly and fought the resize). The ONE def this layer may carry is
  // the soft-edge filter, and ONLY when soft > 0 (the default 0 keeps
  // the ink crisp — soft is a choice, never a default)
  const id = `jx-ripple-${(rippleLayerSeq += 1)}`;
  const inkGroup = svgNode('g');
  if (fx.soft > 0) {
    const blur = svgNode('feGaussianBlur');
    blur.setAttribute('stdDeviation', String(fx.soft));
    const filter = svgNode('filter');
    filter.setAttribute('id', `${id}-soft`);
    filter.append(blur);
    const defs = svgNode('defs');
    defs.append(filter);
    layer.append(defs);
    inkGroup.setAttribute('filter', `url(#${id}-soft)`);
  }
  layer.append(inkGroup);
  element.prepend(layer);
  const inks: { destroy(): void }[] = [];
  let seq = 0;
  // THE TARGET LAW (Owner 2026-09-10, the ⌘-glyph catch): the pointer
  // may land on ANY descendant — event.offsetX/Y would be relative to
  // THAT node's box. The only honest frame is the seat's own: client
  // coordinates minus the layer's rect (the padding box, borders
  // included in the arithmetic for free), read at event time so a
  // resize or scroll can never desync it.
  const seatPoint = (clientX: number, clientY: number): { x: number; y: number } => {
    const seat = layer.getBoundingClientRect();
    return { x: clientX - seat.left, y: clientY - seat.top };
  };
  const spawn = (clientX: number, clientY: number, fromPointer: boolean): void => {
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
      return;
    const width = element.clientWidth;
    const height = element.clientHeight;
    const size = Math.max(width, height);
    const point = fromPointer ? seatPoint(clientX, clientY) : { x: width / 2, y: height / 2 };
    const cx = point.x;
    const cy = point.y;
    const ink = svgNode(fx.shape === 'bevel' ? 'path' : 'circle');
    ink.setAttribute('class', `jx-ripple-ink${fx.shape === 'bevel' && !bevelInk ? ' jx-ripple-flat' : ''}`);
    ink.setAttribute('data-shape', fx.shape);
    if (fx.shape === 'bevel') {
      // the shape law's 50% corner cut: a square of side=size with the
      // corners chamfered to the midpoints — the diamond both DOM
      // branches of the retired engine drew (bevel cut / 45° square)
      const half = size / 2;
      ink.setAttribute(
        'd',
        `M ${cx - half} ${cy} L ${cx} ${cy - half} L ${cx + half} ${cy} L ${cx} ${cy + half} Z`
      );
    } else {
      ink.setAttribute('cx', String(cx));
      ink.setAttribute('cy', String(cy));
      ink.setAttribute('r', String(size / 2));
    }
    inkGroup.append(ink);
    // the node's DOM removal rides the SAME settle the template path
    // got from its reactive each-loop (onSettled hands the imperative
    // layer the animationend/cancel hook)
    inks.push(
      runtime.ink(ink, {
        key: ++seq,
        onSettled: () => ink.remove(),
      })
    );
  };
  return {
    spawn,
    destroy() {
      for (const ink of inks.splice(0)) ink.destroy(); // unlisten + remove the ink nodes
      layer.remove(); // the defs go with the svg — no id leaks
      element.removeAttribute('data-jx-ripple-host');
      for (const cls of pose) element.classList.remove(cls); // the anchor pose was ours
    },
  };
}

/**
 * The attachment FACTORY — `pressEffect(fx)` is the whole {@attach}
 * expression; param in, attachment out (the liquidGlass shape).
 * Mounts the fx's kernel, owns the gesture surface, and returns the
 * teardown: listeners off, ink settle unlistened + nodes removed,
 * stamped layers/vars/classes gone. `fx` is captured — a replaced fx
 * re-runs the FACTORY (identity remount), never this closure (params
 * flow).
 */
export function pressEffect(fx: PressEffect): Attachment<HTMLElement> {
  return (element) => {
    let cleanup: (() => void) | undefined;
    let spawn: ((clientX: number, clientY: number, fromPointer: boolean) => void) | undefined;
    switch (fx.type) {
      case 'shimmer':
        cleanup = applyShimmer(element, fx);
        break;
      case 'pulse':
        cleanup = applyPulse(element, fx);
        break;
      case 'rainbow':
        cleanup = applyRainbow(element, fx);
        break;
      case 'ripple': {
        const ripple = rippleRuntime(element, fx);
        spawn = ripple.spawn;
        cleanup = ripple.destroy;
        break;
      }
    }

    // the loading/disabled poses flip live — the gate reads PER EVENT,
    // never once at mount
    const inactive = (): boolean => element.matches(':disabled, [aria-disabled="true"]');

    const onPointerDown = (event: PointerEvent): void => {
      if (inactive()) return;
      // client coords ONLY — offsetX/Y is relative to whichever CHILD
      // caught the pointer (the ⌘-glyph catch); the seat's rect does the
      // frame math inside spawn
      spawn?.(event.clientX, event.clientY, true);
    };
    // pointerup completes the gesture surface (the Owner ruling names
    // the whole pointer pair); no kernel answers it today — the ink
    // fires at pointerdown by design — the seam stays armed so the
    // gesture contract is one surface, not a per-kernel rebuild
    const onPointerUp = (): void => {
      if (inactive()) return;
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (inactive()) return;
      spawn?.(0, 0, false); // keyboard: centered on the padding box
    };

    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointerup', onPointerUp);
    element.addEventListener('keydown', onKeyDown);

    return () => {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('keydown', onKeyDown);
      cleanup?.();
    };
  };
}
