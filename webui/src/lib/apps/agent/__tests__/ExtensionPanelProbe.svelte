<script lang="ts">
  let { onCloseSidePane }: { onCloseSidePane: () => void } = $props();
</script>

<div data-extension-panel-probe="true">
  <button type="button" aria-label="probe-close-extension" onclick={onCloseSidePane}>Close</button>
</div>
