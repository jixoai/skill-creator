<script lang="ts">
  import { page } from "$app/state";
  import IconBoxes from "@lucide/svelte/icons/boxes";
  import IconPen from "@lucide/svelte/icons/file-pen-line";
  import IconBook from "@lucide/svelte/icons/book-open";
  import IconChart from "@lucide/svelte/icons/chart-no-axes-column-increasing";
  import { tabIdForPath } from "./tab-session.js";
  import { navigateTab } from "./tab-session.svelte.js";

  const workspaceId = $derived(tabIdForPath(page.url.pathname) ?? "~");
  const section = $derived(page.url.pathname.split("/")[3] ?? "skills");
  const items = [
    { id: "skills", label: "Skills", icon: IconBoxes },
    { id: "creator", label: "Creator", icon: IconPen },
    { id: "wiki", label: "Wiki", icon: IconBook },
    { id: "evaluating", label: "Evaluating", icon: IconChart },
  ];
</script>

<nav
  class="flex w-44 shrink-0 flex-col gap-1 border-r border-border bg-muted/20 p-2"
  aria-label="Workspace pages"
>
  {#each items as item (item.id)}
    {@const Icon = item.icon}
    <button
      class="flex h-9 items-center gap-2 rounded px-2 text-left text-xs transition-colors {section ===
      item.id
        ? 'bg-primary/10 text-primary'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
      aria-current={section === item.id ? "page" : undefined}
      onclick={() => navigateTab(`/w/${encodeURIComponent(workspaceId)}/${item.id}`)}
    >
      <Icon class="h-4 w-4" />
      <span>{item.label}</span>
    </button>
  {/each}
</nav>
