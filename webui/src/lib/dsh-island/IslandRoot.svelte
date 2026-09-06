<!--
  DSH island 根：按 island location 在全部 Manager App（Workspaces / Creator /
  Repository）的 activity 集合中选择匹配者，交给 IslandShell 渲染（task 3.1c
  把匹配面从单一 Workspaces App 扩到三 App）。
-->
<script lang="ts">
  import { creatorApp, repositoryApp, workspacesApp } from "$lib/apps";
  import { matchRouteTree } from "$lib/shell/match";
  // 3.1b：SPA layout 拥有的全局浮层在 island 内等价挂载（导入对话框/命令面板/
  // toast），Portal 锚定 island portal root，不逃逸到 DSH 宿主 DOM。
  import ImportWorkspaceDialog from "$lib/components/import-workspace-dialog.svelte";
  import CommandPalette from "$lib/components/command-palette.svelte";
  import ToastContainer from "$lib/components/toast-container.svelte";
  import IslandShell from "./IslandShell.svelte";
  import { islandNav } from "./island-nav.svelte";

  const apps = [workspacesApp.manifest, creatorApp.manifest, repositoryApp.manifest];
  const active = $derived.by(() => {
    for (const manifest of apps) {
      const activity = manifest.activities.find((candidate) => {
        const result = matchRouteTree(
          candidate.root,
          islandNav.pathname,
          islandNav.search,
          candidate.pattern,
        );
        return result.kind === "matched";
      });
      if (activity) return { app: manifest, activity };
    }
    return null;
  });
</script>

{#if active}
  <IslandShell app={active.app} activity={active.activity} />
{:else}
  <div style="padding:16px;opacity:0.7;font-size:13px;">
    未匹配的 island 路由：{islandNav.pathname}（可访问 /workspaces 索引）
  </div>
{/if}

<ImportWorkspaceDialog />
<CommandPalette />
<ToastContainer />
