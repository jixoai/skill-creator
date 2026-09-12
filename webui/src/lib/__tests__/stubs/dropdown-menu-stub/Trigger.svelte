<script lang="ts">
  import { ddState } from "../dropdown-menu-stub-state.svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";
  let {
    children,
    disabled = false,
    ...rest
  }: HTMLButtonAttributes & { children?: import("svelte").Snippet } = $props();
</script>

<button
  type="button"
  data-slot="dropdown-menu-trigger"
  {disabled}
  aria-haspopup="menu"
  aria-expanded={ddState.open}
  onclick={() => {
    if (!disabled) ddState.open = !ddState.open;
  }}
  {...rest}>{@render children?.()}</button
>
