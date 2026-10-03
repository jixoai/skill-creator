<script lang="ts">
  import { page } from "$app/state";
  import IconBoxes from "@lucide/svelte/icons/boxes";
  import IconPen from "@lucide/svelte/icons/file-pen-line";
  import IconBook from "@lucide/svelte/icons/book-open";
  import IconChart from "@lucide/svelte/icons/chart-no-axes-column-increasing";
  import { tabIdForPath } from "./tab-session.js";
  import { navigateTab } from "./tab-session.svelte.js";
  import { closeWorkspaceNavigation, workspaceNavigation } from "./workspace-navigation.svelte.js";

  const workspaceId = $derived(tabIdForPath(page.url.pathname) ?? "~");
  const section = $derived(page.url.pathname.split("/")[3] ?? "skills");
  const items = [
    { id: "skills", label: "Skills", icon: IconBoxes },
    { id: "creator", label: "Creator", icon: IconPen },
    { id: "wiki", label: "Wiki", icon: IconBook },
    { id: "evaluating", label: "Evaluating", icon: IconChart },
  ];
</script>

{#if workspaceNavigation.open}
  <button
    type="button"
    class="absolute inset-0 z-40 hidden bg-foreground/15 max-[720px]:block"
    aria-label="Close workspace navigation"
    onclick={closeWorkspaceNavigation}
  ></button>
{/if}
<nav
  class="z-50 flex w-44 shrink-0 flex-col gap-1 border-r border-border bg-muted/20 p-2 max-[1023px]:w-11 max-[1023px]:items-center max-[1023px]:px-1 max-[719px]:absolute max-[719px]:inset-y-0 max-[719px]:left-0 max-[719px]:w-56 max-[719px]:items-stretch max-[719px]:border-r max-[719px]:bg-background max-[719px]:p-2 {workspaceNavigation.open
    ? 'max-[719px]:flex'
    : 'max-[719px]:hidden'}"
  aria-label="Workspace pages"
>
  {#each items as item (item.id)}
    {@const Icon = item.icon}
    <button
      class="flex h-9 items-center gap-2 rounded px-2 text-left text-xs transition-colors max-[1023px]:w-9 max-[1023px]:justify-center max-[1023px]:px-0 max-[719px]:w-auto max-[719px]:justify-start max-[719px]:px-2 {section ===
      item.id
        ? 'bg-primary/10 text-primary'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
      aria-current={section === item.id ? "page" : undefined}
      title={item.label}
      onclick={() => {
        closeWorkspaceNavigation();
        navigateTab(`/w/${encodeURIComponent(workspaceId)}/${item.id}`);
      }}
    >
      <Icon class="h-4 w-4" />
      <span class="max-[1023px]:sr-only max-[719px]:not-sr-only">{item.label}</span>
    </button>
  {/each}
</nav>
