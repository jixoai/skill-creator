<script lang="ts">
  import { ddReset } from "../dropdown-menu-stub-state.svelte";
  let { children }: { children?: import("svelte").Snippet } = $props();
  ddReset();
</script>

<div data-stub="dropdown-root">{@render children?.()}</div>
