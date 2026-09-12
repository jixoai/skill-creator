<script lang="ts">
  import { ddState } from "../dropdown-menu-stub-state.svelte";
  let { children, ...rest }: { children?: import("svelte").Snippet } & Record<string, unknown> =
    $props();
</script>

{#if ddState.open}
  <div data-slot="dropdown-menu-content" role="menu" {...rest}>{@render children?.()}</div>
{/if}
