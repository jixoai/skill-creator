// press-button — pure barrel (tw4-css-modularization D3): default =
// the canonical main; sub-components as named defaults; export *
// carries module-level named exports/types. No logic lives here.
export { default } from './press-button.svelte';
export * from './press-button.svelte';
export { PressButtonDefaults, type PressButtonPaintVariant } from './press-button-defaults.svelte';
// the attachment face (effect-attachments): the self-listening factory
// + the imperative kernels; the builders stay in the component's module
// script (export * above carries them). solidFill/contextBase mint the
// shimmer fill channel's opaque numbers (r11)
export {
  pressEffect,
  applyShimmer,
  applyPulse,
  applyRainbow,
  solidFill,
  contextBase,
  contextBaseCss,
} from './press-effect-runtime';
