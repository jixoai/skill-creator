<!--
  占位组件：Workspaces home tab（Skill Locations 索引）。
  后续 change 2 填充真实的 workspace 列表 + 导入入口。
-->
<script lang="ts">
  import { workspaceState, loadWorkspaces } from "$lib/store.svelte";
  import { goto } from "$app/navigation";

  $effect(() => {
    void loadWorkspaces();
  });
</script>

<div class="flex h-full flex-col overflow-y-auto p-5">
  <header class="shrink-0 border-b border-border pb-4">
    <h1 class="text-lg font-semibold">Skill locations</h1>
    <p class="mt-0.5 text-xs text-muted-foreground">
      Browse default agent locations or work inside an imported directory.
    </p>
  </header>

  <div class="mx-auto mt-5 w-full max-w-3xl space-y-2">
    {#each workspaceState.workspaces as ws (ws.id)}
      <button
        class="flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted/50"
        onclick={() => {
          const firstProvider = ws.providers.find((p) => p.skillCount > 0);
          if (firstProvider) {
            // Global Workspace id "~" 在 URL path 中需编码为 %7E（SvelteKit 客户端路由不接受裸 ~）。
            const wsSegment = ws.id === "~" ? "%7E" : ws.id;
            void goto(`/workspaces/${wsSegment}/${firstProvider.id}`);
          }
        }}
      >
        <span class="text-sm font-medium">{ws.label}</span>
        <span class="text-xs text-muted-foreground">{ws.skillCount} skills</span>
      </button>
    {/each}
  </div>
</div>
