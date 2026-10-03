<script lang="ts">
  import { page } from "$app/state";
  import AppShell from "./AppShell.svelte";
  import { resolveShellRoute, sanitizeShellLocation } from "./route-hygiene.js";
  import { navigateTab, tabSession } from "./tab-session.svelte.js";

  const pathname = $derived(page.url.pathname);
  const search = $derived(page.url.search);
  const match = $derived(resolveShellRoute(pathname, search));
  const app = $derived(match?.result.kind === "matched" ? match.app : null);
  const activity = $derived(match?.result.kind === "matched" ? match.activity : null);

  $effect.pre(() => {
    if (!tabSession.initialized) return;
    const decision = sanitizeShellLocation(pathname, search);
    if (decision.kind === "redirect") navigateTab(decision.path, "REPLACE");
  });
</script>

<div class="page-outlet-root">
  {#if app && activity}
    <AppShell {app} {activity} />
  {:else}
    <div class="page-outlet-empty" role="status">Opening page…</div>
  {/if}
</div>

<style>
  .page-outlet-root {
    position: relative;
    height: 100%;
    overflow: hidden;
  }
  .page-outlet-empty {
    display: flex;
    height: 100%;
    align-items: center;
    justify-content: center;
    color: var(--muted-foreground, gray);
    font-size: 0.875rem;
  }
</style>
