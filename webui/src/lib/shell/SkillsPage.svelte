<script lang="ts">
  import { useSearch } from "$lib/shell";
  import ProviderView from "$lib/apps/workspaces/ProviderView.svelte";
  import WorkspacesHome from "$lib/apps/workspaces/WorkspacesHome.svelte";

  const search = useSearch<{ provider?: string }>();
  const hasProvider = $derived(Boolean(search?.()?.provider));
</script>

{#if hasProvider}
  <ProviderView />
{:else}
  <WorkspacesHome />
{/if}
