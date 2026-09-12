<script lang="ts">
  let { children, ...rest }: { children?: import("svelte").Snippet } & Record<string, unknown> =
    $props();
</script>

<div data-slot="dropdown-menu-label" {...rest}>{@render children?.()}</div>
