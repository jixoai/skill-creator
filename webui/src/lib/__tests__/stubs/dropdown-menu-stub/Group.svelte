<script lang="ts">
  let { children }: { children?: import("svelte").Snippet } = $props();
</script>

<div data-slot="dropdown-menu-group" role="group">{@render children?.()}</div>
