<script lang="ts">
  /**
   * 原始需求 [2026-07-14]：「skills manager 只是路由的一部分(`/workspace/~/`)；我们还需要支持导入 workspace」。
   * 正交意图：
   * 1. 收集并校验 workspace 目录与显示名称。
   * 2. 导入成功后进入新 workspace。
   * 修订 [2026-09-19]（ext-dialog 集成）：路径输入旁的原生目录选择器
   *（workspace.pickDirectory RPC；平台不支持/未挂载时静默隐藏 Browse）。
   */
  import * as Dialog from "$lib/components/ui/dialog";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Button } from "$lib/components/ui/button";
  import { addWorkspace, pickWorkspaceDirectory, workspaceEntryPath } from "$lib/store.svelte";
  import { importWorkspaceUi } from "$lib/stores/import-workspace.svelte";
  import { goto } from "$app/navigation";
  import IconFolder from "@lucide/svelte/icons/folder-open";
  import IconLoader from "@lucide/svelte/icons/loader-circle";

  // 打开状态由全局 store 拥有（sidebar 与 Workspaces home 共享同一实例）。
  let open = $state(false);
  $effect(() => {
    importWorkspaceUi.open = open;
  });
  $effect(() => {
    if (importWorkspaceUi.open) open = true;
  });
  // 每次打开都重置表单，避免上次输入残留。
  $effect(() => {
    if (open) {
      dirPath = "";
      label = "";
      error = null;
    }
  });
  let dirPath = $state("");
  let label = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);
  // 原生选择器可用性（daemon tray 挂载 + 平台支持）；一次探测不支持即隐藏。
  let browseSupported = $state(true);
  let browsing = $state(false);

  async function browse(): Promise<void> {
    browsing = true;
    try {
      const result = await pickWorkspaceDirectory();
      if (!result.supported) {
        browseSupported = false;
        return;
      }
      if (result.path !== null) {
        dirPath = result.path;
        // label 留空时用目录名做默认值，减少一次输入。
        if (!label.trim()) label = result.path.split("/").filter(Boolean).pop() ?? "";
      }
    } finally {
      browsing = false;
    }
  }

  async function submit(): Promise<void> {
    if (!dirPath.trim()) {
      error = "A directory path is required.";
      return;
    }
    busy = true;
    error = null;
    try {
      const workspace = await addWorkspace(dirPath.trim(), label.trim() || undefined);
      if (!workspace) return;
      open = false;
      await goto(workspaceEntryPath(workspace));
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-[460px]">
    <Dialog.Header>
      <Dialog.Title class="flex items-center gap-2">
        <IconFolder class="h-4 w-4" /> Import workspace
      </Dialog.Title>
      <Dialog.Description>
        Import a directory as a skill workspace. Its skills will be discovered and managed here.
      </Dialog.Description>
    </Dialog.Header>

    {#if error}
      <div
        class="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive"
      >
        {error}
      </div>
    {/if}

    <div class="space-y-3">
      <div class="space-y-1.5">
        <Label for="ws-path">Directory path</Label>
        <div class="flex gap-2">
          <Input
            id="ws-path"
            bind:value={dirPath}
            placeholder="/Users/me/.claude/skills"
            class="font-mono text-xs"
          />
          {#if browseSupported}
            <Button
              variant="outline"
              size="sm"
              class="h-8 shrink-0 gap-1.5"
              disabled={browsing || busy}
              onclick={() => void browse()}
            >
              {#if browsing}<IconLoader class="h-3.5 w-3.5 animate-spin" />{/if}
              Browse…
            </Button>
          {/if}
        </div>
        <p class="text-xs text-muted-foreground">
          Absolute path to a directory containing skill folders.
        </p>
      </div>
      <div class="space-y-1.5">
        <Label for="ws-label"
          >Display name <span class="text-muted-foreground">(optional)</span></Label
        >
        <Input id="ws-label" bind:value={label} placeholder="My Skills" />
      </div>
      <div class="flex justify-end gap-2 pt-1">
        <Button variant="outline" size="sm" onclick={() => (open = false)}>Cancel</Button>
        <Button size="sm" disabled={busy} onclick={submit}>
          {#if busy}<IconLoader class="h-3.5 w-3.5 animate-spin" />{/if}
          Import
        </Button>
      </div>
    </div>
  </Dialog.Content>
</Dialog.Root>
