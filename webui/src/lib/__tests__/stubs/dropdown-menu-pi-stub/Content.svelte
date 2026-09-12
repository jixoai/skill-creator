<script lang="ts">
  // @ts-expect-error -- svelte client 运行时直连（见 Root.svelte 同款说明）
  import { getContext } from "../../../../../node_modules/svelte/src/index-client.js";

  let { children, ...rest }: { children?: import("svelte").Snippet } & Record<string, unknown> =
    $props();

  const ctrl = getContext<{ isOpen: () => boolean }>("dropdown-menu-pi");
</script>

{#if ctrl?.isOpen()}
  <div data-slot="dropdown-menu-content" role="menu" {...rest}>{@render children?.()}</div>
{/if}
