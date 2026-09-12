<script lang="ts">
  // @ts-expect-error -- svelte client 运行时直连（见 Root.svelte 同款说明）
  import { getContext } from "../../../../../node_modules/svelte/src/index-client.js";
  import type { HTMLButtonAttributes } from "svelte/elements";

  let {
    children,
    disabled = false,
    ...rest
  }: HTMLButtonAttributes & { children?: import("svelte").Snippet } = $props();

  const ctrl = getContext<{ isOpen: () => boolean; toggle: () => void }>("dropdown-menu-pi");
</script>

<button
  type="button"
  data-slot="dropdown-menu-trigger"
  {disabled}
  aria-haspopup="menu"
  aria-expanded={ctrl ? ctrl.isOpen() : false}
  onclick={() => {
    if (!disabled) ctrl?.toggle();
  }}
  {...rest}>{@render children?.()}</button
>
