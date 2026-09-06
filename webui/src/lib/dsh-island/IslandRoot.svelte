<!--
  DSH island 根：按 island location 在 Workspaces App 的 activity 集合中选择
  匹配者（home / provider / intelligence / steward），交给 IslandShell 渲染。
-->
<script lang="ts">
  import { workspacesApp } from "$lib/apps";
  import { matchRouteTree } from "$lib/shell/match";
  // 3.1b：SPA layout 拥有的全局浮层在 island 内等价挂载（导入对话框/命令面板/
  // toast），Portal 锚定 island portal root，不逃逸到 DSH 宿主 DOM。
  import ImportWorkspaceDialog from "$lib/components/import-workspace-dialog.svelte";
  import CommandPalette from "$lib/components/command-palette.svelte";
  import ToastContainer from "$lib/components/toast-container.svelte";
  import IslandShell from "./IslandShell.svelte";
  import { islandNav } from "./island-nav.svelte";

  const manifest = workspacesApp.manifest;
  const activeActivity = $derived(
    manifest.activities.find((activity) => {
      const result = matchRouteTree(
        activity.root,
        islandNav.pathname,
        islandNav.search,
        activity.pattern,
      );
      return result.kind === "matched";
    }),
  );
</script>

{#if activeActivity}
  <IslandShell app={manifest} activity={activeActivity} />
{:else}
  <div style="padding:16px;opacity:0.7;font-size:13px;">
    未匹配的 island 路由：{islandNav.pathname}（可访问 /workspaces 索引）
  </div>
{/if}

<ImportWorkspaceDialog />
<CommandPalette />
<ToastContainer />
