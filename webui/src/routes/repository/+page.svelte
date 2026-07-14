<script lang="ts">
  /**
   * 正交意图（2026-07-14）
   * 原始需求 [2026-07-14]：「我们还需要一个 `/repository/`，来支持远程仓库预览 skills 并安装 它们」。
   * 1. 扫描并固定 Git commit，预览与安装复用同一快照。
   * 2. 选择目标 workspace、冲突策略与 dry-run，再执行安装。
   * 3. 安装后同步 workspace 技能计数。
   */
  import { page } from "$app/state";
  import { Button } from "$lib/components/ui/button";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Switch } from "$lib/components/ui/switch";
  import {
    connectionState,
    installRemoteSkills,
    loadWorkspaces,
    previewRemoteSkill,
    repositoryState,
    scanRemoteRepo,
    writableWorkspaces,
  } from "$lib/store.svelte";
  import type { InstallResult } from "$lib/types";
  import IconAlert from "@lucide/svelte/icons/triangle-alert";
  import IconCheck from "@lucide/svelte/icons/circle-check";
  import IconChevron from "@lucide/svelte/icons/chevron-down";
  import IconDownload from "@lucide/svelte/icons/download";
  import IconEye from "@lucide/svelte/icons/eye";
  import IconGit from "@lucide/svelte/icons/git-branch";
  import IconLoader from "@lucide/svelte/icons/loader-circle";
  import IconSearch from "@lucide/svelte/icons/search";

  let source = $state("");
  let ref = $state("");
  let workspaceId = $state("");
  let selectedIds = $state<Set<string>>(new Set());
  let selectedPreviewId = $state<string | null>(null);
  let force = $state(false);
  let result = $state<InstallResult | null>(null);
  let initialized = $state(false);
  let actionError = $state<string | null>(null);

  let workspaces = $derived(writableWorkspaces());
  let targetWorkspace = $derived(workspaces.find((workspace) => workspace.id === workspaceId));
  let scan = $derived(repositoryState.scan);
  let preview = $derived(repositoryState.preview);

  $effect(() => {
    if (connectionState.status !== "connected" || initialized) return;
    initialized = true;
    void (async () => {
      await loadWorkspaces();
      const requested = page.url.searchParams.get("workspace");
      workspaceId =
        workspaces.find((workspace) => workspace.id === requested)?.id ?? workspaces[0]?.id ?? "";
    })();
  });

  async function scanRepository(): Promise<void> {
    if (!source.trim()) return;
    selectedIds = new Set();
    selectedPreviewId = null;
    result = null;
    actionError = null;
    await scanRemoteRepo(source.trim(), ref.trim() || undefined);
  }

  async function choosePreview(skillId: string): Promise<void> {
    selectedPreviewId = skillId;
    await previewRemoteSkill(skillId);
  }

  function toggleSelection(skillId: string): void {
    const next = new Set(selectedIds);
    if (next.has(skillId)) next.delete(skillId);
    else next.add(skillId);
    selectedIds = next;
  }

  function selectAll(): void {
    if (!scan) return;
    const installable = scan.skills.filter((skill) => skill.installable).map((skill) => skill.id);
    selectedIds = selectedIds.size === installable.length ? new Set() : new Set(installable);
  }

  async function install(dryRun: boolean): Promise<void> {
    if (!workspaceId || selectedIds.size === 0) return;
    actionError = null;
    result = null;
    try {
      result = await installRemoteSkills({
        skillIds: [...selectedIds],
        workspaceId,
        force,
        dryRun,
      });
      if (!dryRun && result.kind === "result") await loadWorkspaces();
    } catch (cause) {
      actionError = cause instanceof Error ? cause.message : String(cause);
    }
  }
</script>

<div class="repository-surface flex h-full min-w-0 flex-col">
  <header class="border-b border-border px-4 py-3">
    <div class="flex items-end gap-2">
      <div class="min-w-0 flex-1 space-y-1">
        <Label for="repository-source" class="text-xs">Git repository</Label>
        <Input
          id="repository-source"
          bind:value={source}
          class="h-8 font-mono text-xs"
          placeholder="https://github.com/owner/repository"
          onkeydown={(event) => event.key === "Enter" && scanRepository()}
        />
      </div>
      <div class="w-32 space-y-1">
        <Label for="repository-ref" class="text-xs">Branch or tag</Label><Input
          id="repository-ref"
          bind:value={ref}
          class="h-8 font-mono text-xs"
          placeholder="default"
        />
      </div>
      <Button
        class="h-8 gap-1.5"
        size="sm"
        onclick={scanRepository}
        disabled={!source.trim() || repositoryState.scanning}
      >
        {#if repositoryState.scanning}<IconLoader class="h-4 w-4 animate-spin" />{:else}<IconSearch
            class="h-4 w-4"
          />{/if}Scan
      </Button>
    </div>
    {#if scan}
      <div class="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
        <IconGit class="h-3 w-3" /><span>{scan.title}</span><code>{scan.commit.slice(0, 12)}</code
        ><span>{scan.skills.length} skills</span>
      </div>
    {/if}
  </header>

  {#if repositoryState.error || actionError}<div
      class="border-b border-destructive/30 bg-destructive/8 px-4 py-2 text-xs text-destructive"
      role="alert"
    >
      {repositoryState.error ?? actionError}
    </div>{/if}
  {#if result}
    <div
      class="flex items-center gap-2 border-b border-border bg-muted/50 px-4 py-2 text-xs"
      aria-live="polite"
    >
      <IconCheck class="h-4 w-4 text-emerald-600" />
      {#if result.kind === "preview"}Preview: {result.totalInstalls} installation(s) into {targetWorkspace?.label}.{:else}Installed
        {result.installed}; overwritten {result.overwritten}; skipped {result.skipped}; failed {result.failed}.{/if}
    </div>
  {/if}

  <div class="min-h-0 flex-1">
    <aside class="repository-list flex h-full w-[300px] shrink-0 flex-col border-r border-border">
      <div class="flex h-10 items-center gap-2 border-b border-border px-3 text-xs">
        <span class="font-medium">Discovered skills</span>
        <button
          class="ml-auto text-primary disabled:text-muted-foreground"
          onclick={selectAll}
          disabled={!scan}>Select all</button
        >
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto">
        {#if repositoryState.scanning}
          <div class="flex items-center justify-center gap-2 p-8 text-xs text-muted-foreground">
            <IconLoader class="h-4 w-4 animate-spin" />Cloning and scanning
          </div>
        {:else if !scan}
          <div class="p-6 text-center text-xs text-muted-foreground">
            Scan a git repository to review its skills at a fixed commit.
          </div>
        {:else if scan.skills.length === 0}
          <div class="p-6 text-center text-xs text-muted-foreground">No SKILL.md files found.</div>
        {:else}
          {#each scan.skills as skill (skill.id)}
            <div
              class="flex border-b border-border/70"
              class:bg-accent={selectedPreviewId === skill.id}
            >
              <label
                class="flex w-9 shrink-0 items-start justify-center pt-3"
                aria-label={`Select ${skill.name}`}
                ><Checkbox
                  checked={selectedIds.has(skill.id)}
                  disabled={!skill.installable}
                  onCheckedChange={() => toggleSelection(skill.id)}
                /></label
              >
              <button
                class="min-w-0 flex-1 px-1 py-2.5 pr-3 text-left"
                onclick={() => choosePreview(skill.id)}
              >
                <span class="flex items-center gap-1.5"
                  ><span class="truncate text-xs font-medium">{skill.name}</span
                  >{#if !skill.installable}<IconAlert
                      class="h-3.5 w-3.5 shrink-0 text-amber-600"
                    />{/if}</span
                >
                <span class="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground"
                  >{skill.description || skill.issues[0] || "No description"}</span
                >
                <code class="mt-1 block truncate text-[9px] text-muted-foreground"
                  >{skill.relativePath}</code
                >
              </button>
            </div>
          {/each}
        {/if}
      </div>
      <div class="space-y-2 border-t border-border p-2.5">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            >{#snippet child({ props })}<Button
                {...props}
                variant="outline"
                size="sm"
                class="h-8 w-full justify-between"
                ><span class="truncate">{targetWorkspace?.label ?? "Choose destination"}</span
                ><IconChevron class="h-3.5 w-3.5" /></Button
              >{/snippet}</DropdownMenu.Trigger
          >
          <DropdownMenu.Content
            >{#each workspaces as workspace}<DropdownMenu.Item
                onclick={() => (workspaceId = workspace.id)}>{workspace.label}</DropdownMenu.Item
              >{/each}</DropdownMenu.Content
          >
        </DropdownMenu.Root>
        <label class="flex items-center justify-between text-xs"
          ><span>Overwrite conflicts</span><Switch bind:checked={force} /></label
        >
        <div class="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            class="h-8"
            disabled={!workspaceId || selectedIds.size === 0 || repositoryState.installing}
            onclick={() => install(true)}>Preview</Button
          >
          <Button
            size="sm"
            class="h-8 gap-1.5"
            disabled={!workspaceId || selectedIds.size === 0 || repositoryState.installing}
            onclick={() => install(false)}
            >{#if repositoryState.installing}<IconLoader
                class="h-3.5 w-3.5 animate-spin"
              />{:else}<IconDownload class="h-3.5 w-3.5" />{/if}Install {selectedIds.size ||
              ""}</Button
          >
        </div>
      </div>
    </aside>

    <main class="repository-preview h-full min-w-0 flex-1">
      {#if repositoryState.previewing}<div
          class="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground"
        >
          <IconLoader class="h-4 w-4 animate-spin" />Loading snapshot
        </div>
      {:else if preview}<div class="flex h-full flex-col">
          <div class="border-b border-border px-4 py-3">
            <h2 class="text-sm font-semibold">{preview.skill.name}</h2>
            <p class="mt-0.5 text-xs text-muted-foreground">{preview.skill.description}</p>
          </div>
          <pre
            class="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[11px] leading-5">{preview.content}</pre>
        </div>
      {:else}<div
          class="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground"
        >
          <IconEye class="h-8 w-8 opacity-50" />
          <p class="text-xs">Select a skill to inspect the exact SKILL.md snapshot.</p>
        </div>{/if}
    </main>
  </div>
</div>

<style>
  .repository-surface {
    container-type: inline-size;
  }
  .repository-surface > :last-child {
    display: flex;
  }
  @container (max-width: 650px) {
    .repository-list {
      width: 100%;
      border-right: 0;
    }
    .repository-preview {
      display: none;
    }
  }
</style>
