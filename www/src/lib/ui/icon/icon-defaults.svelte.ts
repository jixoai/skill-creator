/**
 * jixoai icon family Defaults
 * (registry/files/ui/icon/icon-defaults.svelte.ts,
 * icon-component-pipeline E1, 2026-09-07).
 *
 * The A1 context contract for the named-glyph family: `size` is a
 * vocabulary word, and the family's single audited read point is
 * this Defaults (the chart precedent — the literal family's OPEN
 * form): a free CSS length, no closed union to enumerate and no
 * ambient axis (a glyph's square edge is call-site business —
 * wrapper zones that want ambient icon sizing scope it through
 * their OWN family contracts, not through the glyph's); explicit
 * ?? own 16 (the old string-bag's baked edge, carried verbatim).
 * `strokeWidth` stays a plain prop — not a vocabulary word, no
 * slot (the same ruling shape as press-button's `raised` physics:
 * outside this economy by not being in the enumeration).
 *
 * 惰性律: construction captures the own once; the consumer's
 * resolve runs inside its $derived window. Member of the
 * registry:ui item (installs with the family, byte mirrored,
 * zero kernel imports).
 */
import { defineComponentDefaults, defineOpenSlot } from '$lib/defaults.svelte';

/** the glyph's square edge — a free CSS length (px number or any
 *  valid CSS length string), own 16 the string-bag default */
export const iconSizeSlot = defineOpenSlot<number | string>(16);

export const IconDefaults = defineComponentDefaults({
  size: iconSizeSlot,
});
