<script lang="ts">
  /**
   * 原始需求 [2026-07-14]：「skills manager 只是路由的一部分(`/workspace/~/`)；我们还需要支持导入 workspace」。
   * 正交意图：
   * 1. 收集并校验 workspace 目录与显示名称。
   * 2. 导入成功后进入新 workspace。
   */
  import * as Dialog from "$lib/components/ui/dialog";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Button } from "$lib/components/ui/button";
  import { addWorkspace, workspaceEntryPath } from "$lib/store.svelte";
  import { goto } from "$app/navigation";
  import IconFolder from "@lucide/svelte/icons/folder-open";
  import IconLoader from "@lucide/svelte/icons/loader-circle";

  let open = $state(false);
  let dirPath = $state("");
  let label = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);

  /** 重置表单并打开导入对话框。 */
  export function show(): void {
    dirPath = "";
    label = "";
    error = null;
    busy = false;
    open = true;
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
        <Input
          id="ws-path"
          bind:value={dirPath}
          placeholder="/Users/me/.claude/skills"
          class="font-mono text-xs"
        />
        <p class="text-[11px] text-muted-foreground">
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
