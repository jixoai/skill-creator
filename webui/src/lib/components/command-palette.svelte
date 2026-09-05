<script lang="ts">
  /**
   * 原始需求 [2026-07-14]：「这需要你的导航功能足够清晰简单」。
   * 正交意图：
   * 1. 管理 Cmd/Ctrl+K 命令面板生命周期。
   * 2. 提供一级路由导航。
   * 3. 提供 workspace 快速切换。
   */
  import * as Command from "$lib/components/ui/command";
  import { goto } from "$app/navigation";
  import { workspaceEntryPath, workspaceState } from "$lib/store.svelte";
  import IconFolder from "@lucide/svelte/icons/folder-open";
  import IconPen from "@lucide/svelte/icons/file-plus-2";
  import IconGlobe from "@lucide/svelte/icons/globe";
  import IconGrid from "@lucide/svelte/icons/layout-grid";

  let open = $state(false);

  $effect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        open = !open;
      }
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  });

  function run(action: () => void): void {
    open = false;
    action();
  }
</script>

<Command.Dialog bind:open>
  <Command.Input placeholder="Search navigation and workspaces…" />
  <Command.List>
    <Command.Empty>No matching destination.</Command.Empty>

    <Command.Group heading="Navigate">
      <Command.Item
        onSelect={() => run(() => goto("/workspaces"))}
        value="go workspaces manage locations"
      >
        <IconGrid class="h-4 w-4" />
        Workspaces
      </Command.Item>
      <Command.Item onSelect={() => run(() => goto("/creator"))} value="go creator new skill">
        <IconPen class="h-4 w-4" />
        Creator
      </Command.Item>
      <Command.Item
        onSelect={() => run(() => goto("/repository"))}
        value="go repository browse remote"
      >
        <IconGlobe class="h-4 w-4" />
        Repository
      </Command.Item>
    </Command.Group>

    {#if workspaceState.workspaces.length > 0}
      <Command.Group heading="Workspaces">
        {#each workspaceState.workspaces as ws (ws.id)}
          <Command.Item
            value={`workspace ${ws.label} ${ws.path}`}
            onSelect={() => run(() => goto(workspaceEntryPath(ws)))}
          >
            <IconFolder class="h-4 w-4" />
            <span class="flex-1 truncate">{ws.label}</span>
            <span class="text-[10px] tabular-nums text-muted-foreground">{ws.skillCount ?? 0}</span>
          </Command.Item>
        {/each}
      </Command.Group>
    {/if}
  </Command.List>
</Command.Dialog>
