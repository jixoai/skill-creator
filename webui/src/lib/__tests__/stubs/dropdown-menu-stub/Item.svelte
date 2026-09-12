<script lang="ts">
  let {
    children,
    onclick,
    disabled = false,
    ...rest
  }: {
    children?: import("svelte").Snippet;
    onclick?: (event: MouseEvent) => void;
    disabled?: boolean;
  } & Record<string, unknown> = $props();
</script>

<div
  data-slot="dropdown-menu-item"
  role="menuitem"
  aria-disabled={disabled || undefined}
  tabindex={-1}
  {...rest}
  onclick={(event) => {
    if (!disabled) onclick?.(event);
  }}
>
  {@render children?.()}
</div>
