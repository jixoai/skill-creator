<script lang="ts">
  /**
   * 正交意图（2026-07-22）
   * 原始需求 [2026-07-22]：「下载到某个 Workspace.provider；另外这里应该要能多选。」
   * 1. 扫描并固定 Git commit，预览与安装复用同一快照。
   * 2. 多选 Workspace Provider 目标、冲突策略与 dry-run，再执行安装。
   * 3. 以安装时的 Workspace Provider 身份呈现结果，并同步技能计数。
   * 4. 在窄屏显式切换技能列表与快照预览，始终保留返回路径。
   * 妥协声明：四项属于 Repository 单页连续任务；RPC 状态已拆入 store，继续拆散页面状态会破坏操作上下文。
   */
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { tick } from "svelte";
  import { ProviderIdSchema, WorkspaceIdSchema } from "$shared/contracts/workspaces.js";
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
    writableWorkspaceProviders,
  } from "$lib/store.svelte";
  import type { InstallResult, RemoteSkillId, SkillId, WorkspaceProviderTarget } from "$lib/types";
  import IconArrowLeft from "@lucide/svelte/icons/arrow-left";
  import IconAlert from "@lucide/svelte/icons/triangle-alert";
  import IconCheck from "@lucide/svelte/icons/circle-check";
  import IconChevron from "@lucide/svelte/icons/chevron-down";
  import IconDownload from "@lucide/svelte/icons/download";
  import IconEye from "@lucide/svelte/icons/eye";
  import IconGit from "@lucide/svelte/icons/git-branch";
  import IconLoader from "@lucide/svelte/icons/loader-circle";
  import IconPen from "@lucide/svelte/icons/file-pen-line";
  import IconSearch from "@lucide/svelte/icons/search";

  let source = $state("");
  let ref = $state("");
  let targetQuery = $state("");
  interface InstallOutcome {
    result: InstallResult;
    destinationLabel: string;
  }

  let selectedTargetKeys = $state<Set<string>>(new Set());
  let selectedIds = $state<Set<RemoteSkillId>>(new Set());
  let selectedPreviewId = $state<RemoteSkillId | null>(null);
  let force = $state(false);
  let outcome = $state<InstallOutcome | null>(null);
  let initialized = $state(false);
  let appliedRouteTargets = "";
  let actionError = $state<string | null>(null);
  let mobilePreviewOpen = $state(false);
  let previewTrigger = $state<HTMLButtonElement | null>(null);
  let mobilePreviewHeading = $state<HTMLElement | null>(null);

  let targets = $derived(writableWorkspaceProviders());
  let filteredTargets = $derived(
    targets.filter((target) =>
      target.label.toLowerCase().includes(targetQuery.trim().toLowerCase()),
    ),
  );
  let selectedTargets = $derived(
    targets.filter((target) => selectedTargetKeys.has(targetKey(target.target))),
  );
  let scan = $derived(repositoryState.scan);
  let preview = $derived(repositoryState.preview);
  let selectedPreview = $derived(
    scan?.skills.find((skill) => skill.id === selectedPreviewId) ?? null,
  );
  let reviewTargets = $derived.by(() => {
    if (!outcome || outcome.result.kind !== "result") return [];
    const targets = new Map<
      string,
      { skillId: SkillId; name: string; target: WorkspaceProviderTarget }
    >();
    for (const entry of outcome.result.results) {
      if (entry.status === "installed" || entry.status === "overwritten") {
        targets.set(`${targetKey(entry.target)}:${entry.skillId}`, {
          skillId: entry.skillId,
          name: entry.skill,
          target: entry.target,
        });
      }
    }
    return [...targets.values()];
  });

  $effect(() => {
    if (connectionState.status !== "connected") {
      initialized = false;
      return;
    }
    if (initialized) return;
    initialized = true;
    void loadWorkspaces();
  });

  $effect(() => {
    const requestedValue = page.url.searchParams.get("targets") ?? "";
    const availableTargets = targets;
    if (connectionState.status !== "connected" || !initialized) return;
    if (appliedRouteTargets === requestedValue) return;
    const next = new Set<string>();
    for (const source of requestedValue.split(",").filter(Boolean)) {
      const delimiter = source.lastIndexOf(":");
      if (delimiter < 1) continue;
      const workspaceId = WorkspaceIdSchema.safeParse(source.slice(0, delimiter));
      const providerId = ProviderIdSchema.safeParse(source.slice(delimiter + 1));
      if (!workspaceId.success || !providerId.success) continue;
      const target = { workspaceId: workspaceId.data, providerId: providerId.data };
      if (availableTargets.some((candidate) => targetKey(candidate.target) === targetKey(target))) {
        next.add(targetKey(target));
      }
    }
    selectedTargetKeys = next;
    appliedRouteTargets = requestedValue;
  });

  async function scanRepository(): Promise<void> {
    if (!source.trim()) return;
    selectedIds = new Set();
    selectedPreviewId = null;
    outcome = null;
    actionError = null;
    mobilePreviewOpen = false;
    await scanRemoteRepo(source.trim(), ref.trim() || undefined);
  }

  async function choosePreview(skillId: RemoteSkillId, trigger: HTMLButtonElement): Promise<void> {
    if (repositoryState.installing) return;
    previewTrigger = trigger;
    selectedPreviewId = skillId;
    mobilePreviewOpen = true;
    await tick();
    if (mobilePreviewHeading?.offsetParent) mobilePreviewHeading.focus();
    await previewRemoteSkill(skillId);
  }

  async function closeMobilePreview(): Promise<void> {
    mobilePreviewOpen = false;
    await tick();
    if (previewTrigger?.isConnected) previewTrigger.focus();
  }

  function toggleSelection(skillId: RemoteSkillId): void {
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

  function targetKey(target: WorkspaceProviderTarget): string {
    return `${target.workspaceId}:${target.providerId}`;
  }

  function toggleTarget(target: WorkspaceProviderTarget): void {
    const next = new Set(selectedTargetKeys);
    const key = targetKey(target);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selectedTargetKeys = next;
  }

  async function install(dryRun: boolean): Promise<void> {
    const submittedTargets = selectedTargets.map((target) => target.target);
    if (submittedTargets.length === 0 || selectedIds.size === 0) return;
    const submittedSkillIds = [...selectedIds];
    actionError = null;
    outcome = null;
    try {
      const result = await installRemoteSkills({
        skillIds: submittedSkillIds,
        targets: submittedTargets,
        force,
        dryRun,
      });
      if (!result) return;
      if (
        result.kind === "result" &&
        result.targets.some(
          (target) =>
            !submittedTargets.some((candidate) => targetKey(candidate) === targetKey(target)),
        )
      ) {
        throw new Error(
          "The daemon returned an install result for an unexpected Workspace Provider.",
        );
      }
      outcome = {
        result,
        destinationLabel: selectedTargets.map((target) => target.label).join(", "),
      };
      if (!dryRun && result.kind === "result") await loadWorkspaces();
    } catch (cause) {
      actionError = cause instanceof Error ? cause.message : String(cause);
    }
  }

  function creatorReviewUrl(target: WorkspaceProviderTarget, skillId: SkillId): string {
    const search = new URLSearchParams({
      workspace: target.workspaceId,
      provider: target.providerId,
      skill: skillId,
    });
    return `/creator?${search.toString()}`;
  }
</script>

<div class="repository-surface flex h-full min-w-0 flex-col">
  <header class="border-b border-border px-4 py-3">
    <div class="repository-search flex items-end gap-2">
      <div class="repository-source min-w-0 flex-1 space-y-1">
        <Label for="repository-source" class="text-xs">Git repository</Label>
        <Input
          id="repository-source"
          bind:value={source}
          class="repository-mobile-control h-8 font-mono text-xs"
          placeholder="https://github.com/owner/repository"
          onkeydown={(event) => event.key === "Enter" && scanRepository()}
          disabled={repositoryState.scanning || repositoryState.installing}
        />
      </div>
      <div class="repository-ref w-32 space-y-1">
        <Label for="repository-ref" class="text-xs">Branch or tag</Label><Input
          id="repository-ref"
          bind:value={ref}
          class="repository-mobile-control h-8 font-mono text-xs"
          placeholder="default"
          disabled={repositoryState.scanning || repositoryState.installing}
        />
      </div>
      <Button
        class="repository-mobile-control h-8 gap-1.5"
        size="sm"
        onclick={scanRepository}
        disabled={!source.trim() || repositoryState.scanning || repositoryState.installing}
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
  {#if outcome}
    <div
      class="repository-outcome flex min-w-0 flex-wrap items-center gap-2 border-b border-border bg-muted/50 px-4 py-2 text-xs"
      aria-live="polite"
    >
      {#if outcome.result.kind === "result" && (outcome.result.failed > 0 || reviewTargets.length === 0)}<IconAlert
          class="h-4 w-4 shrink-0 text-amber-600"
        />{:else}<IconCheck class="h-4 w-4 shrink-0 text-emerald-600" />{/if}
      <span class="min-w-0">
        {#if outcome.result.kind === "preview"}Preview: {outcome.result.totalInstalls} installation(s)
          into
          {outcome.destinationLabel}.{:else}Installation result for {outcome.destinationLabel}: {outcome
            .result.installed} installed; {outcome.result.overwritten} overwritten; {outcome.result
            .skipped} skipped; {outcome.result.failed} failed.{/if}
      </span>
      {#if reviewTargets.length === 1}
        <Button
          href={creatorReviewUrl(reviewTargets[0].target, reviewTargets[0].skillId)}
          variant="outline"
          size="sm"
          class="repository-outcome-action h-7 gap-1.5"
        >
          <IconPen class="h-3.5 w-3.5" />Review installed
        </Button>
      {:else if reviewTargets.length > 1}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            {#snippet child({ props })}<Button
                {...props}
                variant="outline"
                size="sm"
                class="repository-outcome-action h-7 gap-1.5"
              >
                <IconPen class="h-3.5 w-3.5" />Review installed<IconChevron class="h-3.5 w-3.5" />
              </Button>{/snippet}
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end" class="max-w-64">
            {#each reviewTargets as target (`${targetKey(target.target)}:${target.skillId}`)}
              <DropdownMenu.Item
                onclick={() => goto(creatorReviewUrl(target.target, target.skillId))}
              >
                <IconPen class="h-3.5 w-3.5" /><span class="truncate"
                  >{target.name} · {targets.find(
                    (candidate) => targetKey(candidate.target) === targetKey(target.target),
                  )?.label ?? target.target.providerId}</span
                >
              </DropdownMenu.Item>
            {/each}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      {/if}
    </div>
  {/if}

  <div class="repository-body min-h-0 flex-1" data-mobile-preview={mobilePreviewOpen}>
    <aside class="repository-list flex h-full w-[300px] shrink-0 flex-col border-r border-border">
      <div
        class="repository-list-heading flex h-10 items-center gap-2 border-b border-border px-3 text-xs"
      >
        <span class="font-medium">Discovered skills</span>
        <button
          class="repository-select-all ml-auto text-primary disabled:text-muted-foreground"
          onclick={selectAll}
          disabled={!scan || repositoryState.installing}>Select all</button
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
                class="flex w-11 shrink-0 items-start justify-center pt-3"
                aria-label={`Select ${skill.name}`}
                ><Checkbox
                  checked={selectedIds.has(skill.id)}
                  disabled={!skill.installable || repositoryState.installing}
                  onCheckedChange={() => toggleSelection(skill.id)}
                /></label
              >
              <button
                class="min-w-0 flex-1 px-1 py-2.5 pr-3 text-left"
                onclick={(event) => choosePreview(skill.id, event.currentTarget)}
                disabled={repositoryState.installing}
                aria-current={selectedPreviewId === skill.id ? "true" : undefined}
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
                class="repository-destination h-8 w-full justify-between"
                disabled={repositoryState.installing}
                ><span class="truncate"
                  >{selectedTargets.length === 0
                    ? "Choose destinations"
                    : selectedTargets.length === 1
                      ? selectedTargets[0]?.label
                      : `${selectedTargets.length} destinations`}</span
                ><IconChevron class="h-3.5 w-3.5" /></Button
              >{/snippet}</DropdownMenu.Trigger
          >
          <DropdownMenu.Content align="end" class="w-80 max-h-72 overflow-y-auto p-1">
            <div
              role="presentation"
              class="sticky top-0 z-10 bg-popover pb-1"
              onkeydown={(event) => event.stopPropagation()}
            >
              <Input
                aria-label="Filter destinations"
                class="h-8"
                bind:value={targetQuery}
                placeholder="Filter destinations"
              />
            </div>
            {#each filteredTargets as target (targetKey(target.target))}
              <DropdownMenu.CheckboxItem
                checked={selectedTargetKeys.has(targetKey(target.target))}
                closeOnSelect={false}
                onCheckedChange={() => toggleTarget(target.target)}
                >{target.label}</DropdownMenu.CheckboxItem
              >
            {/each}
            {#if filteredTargets.length === 0}
              <DropdownMenu.Item disabled>No matching destinations</DropdownMenu.Item>
            {/if}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
        <label class="repository-force flex items-center justify-between text-xs"
          ><span>Overwrite conflicts</span><Switch
            bind:checked={force}
            disabled={repositoryState.installing}
          /></label
        >
        <div class="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            class="repository-install-action h-8"
            disabled={selectedTargets.length === 0 ||
              selectedIds.size === 0 ||
              repositoryState.installing}
            onclick={() => install(true)}>Preview</Button
          >
          <Button
            size="sm"
            class="repository-install-action h-8 gap-1.5"
            disabled={selectedTargets.length === 0 ||
              selectedIds.size === 0 ||
              repositoryState.installing}
            onclick={() => install(false)}
            >{#if repositoryState.installing}<IconLoader
                class="h-3.5 w-3.5 animate-spin"
              />{:else}<IconDownload class="h-3.5 w-3.5" />{/if}Install {selectedIds.size ||
              ""}</Button
          >
        </div>
      </div>
    </aside>

    <main class="repository-preview flex h-full min-w-0 flex-1 flex-col">
      <div
        class="repository-preview-mobile-header h-10 items-center gap-2 border-b border-border px-2"
      >
        <Button
          variant="ghost"
          size="icon"
          class="repository-preview-back h-8 w-8"
          aria-label="Back to discovered skills"
          title="Back to discovered skills"
          onclick={closeMobilePreview}
        >
          <IconArrowLeft class="h-4 w-4" />
        </Button>
        <h2
          bind:this={mobilePreviewHeading}
          class="min-w-0 truncate text-xs font-medium focus:outline-none"
          tabindex="-1"
        >
          {selectedPreview ? `${selectedPreview.name} snapshot` : "Skill snapshot"}
        </h2>
      </div>
      <div class="min-h-0 flex-1">
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
      </div>
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
  .repository-preview-mobile-header {
    display: none;
  }
  :global(.repository-outcome-action) {
    margin-left: auto;
  }
  @container (max-width: 650px) {
    .repository-search {
      flex-wrap: wrap;
    }
    .repository-source {
      flex-basis: 100%;
    }
    .repository-ref {
      width: auto;
      min-width: 0;
      flex: 1;
    }
    .repository-list {
      width: 100%;
      border-right: 0;
    }
    .repository-body[data-mobile-preview="false"] .repository-preview,
    .repository-body[data-mobile-preview="true"] .repository-list {
      display: none;
    }
    .repository-body[data-mobile-preview="true"] .repository-preview,
    .repository-preview-mobile-header {
      display: flex;
    }
    .repository-preview-mobile-header {
      height: 2.75rem;
    }
    :global(.repository-mobile-control),
    :global(.repository-destination),
    :global(.repository-install-action),
    :global(.repository-preview-back),
    :global(.repository-outcome-action),
    .repository-force {
      min-height: 2.75rem;
    }
    .repository-list-heading,
    .repository-select-all {
      min-height: 2.75rem;
    }
    :global(.repository-preview-back) {
      width: 2.75rem;
    }
  }
</style>
