<script lang="ts">
  let {
    height,
    workspace,
    onClose,
  }: {
    height: number;
    workspace: { key: string; cwd?: string } | null;
    onClose: () => void;
  } = $props();
</script>

<section
  data-terminal-dock-probe="true"
  data-workspace-key={workspace?.key ?? ""}
  data-workspace-cwd={workspace?.cwd ?? ""}
  data-height={height}
>
  <button type="button" aria-label="probe-close-terminal" onclick={onClose}>Close</button>
</section>
