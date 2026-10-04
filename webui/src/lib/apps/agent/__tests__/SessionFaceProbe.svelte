<script lang="ts">
  let {
    onOpenFilePreview,
    onOpenBashOutput,
  }: {
    onOpenFilePreview: (path: string) => void;
    onOpenBashOutput: () => void;
  } = $props();
</script>

<div data-session-face-probe="true">
  <button
    type="button"
    aria-label="probe-open-file-preview"
    onclick={() => onOpenFilePreview("/tmp/tool-output.md")}
  >
    Open file preview
  </button>
  <button type="button" aria-label="probe-open-bash-output" onclick={onOpenBashOutput}>
    Open shell output
  </button>
</div>
