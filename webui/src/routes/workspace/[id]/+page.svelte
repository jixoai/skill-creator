<script lang="ts">
  /**
   * 原始需求 [2026-07-22]：「Workspace 是双层结构；Workspace 下可以包含多个 providers。」
   * 正交意图：
   * 1. 按 Workspace Provider 路由和连接代次加载、筛选、选择技能并维持窄屏焦点往返。
   * 2. 编排技能校验和启停操作。
   * 3. 将可写技能衔接到 Creator，将安装需求衔接到 Repository。
   */
  import type { PageData } from "./$types";
  import { goto } from "$app/navigation";
  import { tick } from "svelte";
  import SkillCard from "$lib/components/skill-card.svelte";
  import SkillDetail from "$lib/components/skill-detail.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import {
    connectionState,
    clearSelection,
    filteredSkills,
    loadSkills,
    loadWorkspaces,
    selectSkill,
    setActiveWorkspace,
    skillCounts,
    skillsState,
    toggleSkills,
    validateSkill,
    workspaceState,
  } from "$lib/store.svelte";
  import { showToast } from "$lib/toast.svelte";
  import type { ProviderId, SkillId, WorkspaceProviderTarget } from "$lib/types";
  import IconLoader from "@lucide/svelte/icons/loader-circle";
  import IconPlus from "@lucide/svelte/icons/plus";
  import IconRefresh from "@lucide/svelte/icons/refresh-cw";
  import IconRepository from "@lucide/svelte/icons/git-fork";
  import IconSearch from "@lucide/svelte/icons/search";
  import IconX from "@lucide/svelte/icons/x";

  let { data }: { data: PageData } = $props();
  let id = $derived(data.workspaceId);
  let requestedProviderId = $derived(data.providerId);
  let selectedId = $state<SkillId | null>(null);
  let mobileDetailOpen = $state(false);
  let showDisabled = $state(false);
  let providerId = $state<ProviderId | null>(null);
  let providerQuery = $state("");
  let toggling = $state(false);
  let loadedKey = "";
  let skillList = $state<HTMLElement | null>(null);
  let detailHeading = $state<HTMLHeadingElement | null>(null);

  $effect(() => {
    const routeId = id;
    const routeKey = `${routeId}:${requestedProviderId ?? ""}`;
    if (connectionState.status !== "connected") {
      loadedKey = "";
      return;
    }
    if (!routeId || loadedKey === routeKey) return;

    let cancelled = false;
    loadedKey = routeKey;
    selectedId = null;
    mobileDetailOpen = false;
    clearSelection();
    void (async () => {
      try {
        await loadWorkspaces();
        if (cancelled) return;
        const activated = await setActiveWorkspace(routeId);
        if (cancelled || !activated) return;
        const workspace = workspaceState.workspaces.find((candidate) => candidate.id === routeId);
        const readableProviders = workspace?.providers.filter(
          (candidate) => candidate.path !== null,
        );
        const selected =
          readableProviders?.find((candidate) => candidate.id === requestedProviderId) ??
          readableProviders?.find((candidate) => candidate.skillCount > 0) ??
          readableProviders?.find((candidate) => candidate.available) ??
          readableProviders?.[0];
        if (!selected) throw new Error("No readable Provider is available in this Workspace.");
        providerId = selected.id;
        await loadSkills({ workspaceId: routeId, providerId: selected.id });
      } catch (error) {
        if (cancelled) return;
        loadedKey = "";
        skillsState.error = error instanceof Error ? error.message : String(error);
      }
    })();

    return () => {
      cancelled = true;
    };
  });

  let workspace = $derived(workspaceState.workspaces.find((candidate) => candidate.id === id));
  let readableProviders = $derived(
    (workspace?.providers ?? []).filter((candidate) => candidate.path !== null),
  );
  let filteredProviders = $derived(
    readableProviders.filter((candidate) =>
      candidate.label.toLowerCase().includes(providerQuery.trim().toLowerCase()),
    ),
  );
  let selectedProvider = $derived(
    workspace?.providers.find((candidate) => candidate.id === providerId),
  );
  let target = $derived<WorkspaceProviderTarget | null>(
    providerId ? { workspaceId: id, providerId } : null,
  );
  let counts = $derived(skillCounts());
  let visible = $derived(filteredSkills().filter((skill) => showDisabled || !skill.disabled));

  async function choose(skillId: SkillId): Promise<void> {
    await selectSkill(skillId);
    if (skillsState.selected?.id !== skillId) return;
    selectedId = skillId;
    mobileDetailOpen = true;
    await tick();
    if (
      selectedId === skillId &&
      skillsState.selected?.id === skillId &&
      skillList?.offsetParent === null &&
      detailHeading?.offsetParent
    ) {
      detailHeading.focus();
    }
  }

  async function closeDetail(): Promise<void> {
    const trigger = skillList?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
    mobileDetailOpen = false;
    await tick();
    if (trigger?.isConnected && trigger.offsetParent) trigger.focus();
  }

  async function toggle(mode: "enable" | "disable"): Promise<void> {
    if (!selectedId) return;
    toggling = true;
    try {
      const result = await toggleSkills([selectedId], mode);
      if (!result) return;
      const issues = result.results
        .filter((entry) => entry.status === "conflict" || entry.status === "failed")
        .map((entry) => entry.error ?? `${entry.name} could not be updated.`);
      if (issues.length > 0) {
        showToast(issues.join(" "));
      } else if (result.skipped > 0 && result.succeeded === 0) {
        const state = mode === "disable" ? "disabled" : "enabled";
        showToast(
          `No change needed. ${result.skipped} skill${result.skipped === 1 ? " is" : "s are"} already ${state}.`,
        );
      } else {
        const verb = mode === "disable" ? "Disabled" : "Enabled";
        showToast(`${verb} ${result.succeeded} skill${result.succeeded === 1 ? "" : "s"}.`);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    } finally {
      toggling = false;
    }
  }

  function creatorUrl(): string {
    if (!target) return "/creator";
    const params = new URLSearchParams(target);
    if (selectedId) params.set("skill", selectedId);
    return `/creator?${params}`;
  }
</script>

<div
  class="workspace-surface flex h-full min-w-0 flex-col"
  data-mobile-detail={mobileDetailOpen && selectedId !== null}
>
  <header class="flex min-h-12 shrink-0 items-center gap-3 border-b border-border px-4">
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2">
        <h1 class="truncate text-sm font-semibold">{workspace?.label ?? "Workspace"}</h1>
        <span class="text-xs text-muted-foreground">{counts.total} skills</span>
      </div>
      {#if selectedProvider?.path}<p class="truncate font-mono text-[10px] text-muted-foreground">
          {selectedProvider.path}
        </p>{/if}
    </div>
    <div class="ml-auto flex items-center gap-1">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}<Button
              {...props}
              variant="outline"
              size="sm"
              class="workspace-provider-command h-8 max-w-48 gap-1.5"
              ><span class="truncate">{selectedProvider?.label ?? "Choose Provider"}</span></Button
            >{/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" class="w-64 max-h-72 overflow-y-auto p-1">
          <div
            role="presentation"
            class="sticky top-0 z-10 bg-popover pb-1"
            onkeydown={(event) => event.stopPropagation()}
          >
            <Input
              aria-label="Filter Providers"
              class="h-8"
              bind:value={providerQuery}
              placeholder="Filter Providers"
            />
          </div>
          {#each filteredProviders as candidate (candidate.id)}
            <DropdownMenu.Item
              onclick={() => goto(`/workspace/${id}?provider=${encodeURIComponent(candidate.id)}`)}
              >{candidate.label}<span class="ml-auto text-muted-foreground"
                >{candidate.skillCount}</span
              ></DropdownMenu.Item
            >
          {:else}
            <DropdownMenu.Item disabled>No matching Providers</DropdownMenu.Item>
          {/each}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
      <Button
        variant="ghost"
        size="icon"
        class="workspace-refresh-command h-8 w-8"
        aria-label="Refresh skills"
        title="Refresh skills"
        onclick={() => target && loadSkills(target)}
        disabled={skillsState.refreshing}
      >
        {#if skillsState.refreshing}<IconLoader class="h-4 w-4 animate-spin" />{:else}<IconRefresh
            class="h-4 w-4"
          />{/if}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        class="workspace-compact-command h-8 gap-1.5"
        aria-label="Repository"
        title="Repository"
        onclick={() =>
          target &&
          goto(
            `/repository?targets=${encodeURIComponent(`${target.workspaceId}:${target.providerId}`)}`,
          )}
      >
        <IconRepository class="h-4 w-4" /> <span class="workspace-command-label">Repository</span>
      </Button>
      {#if selectedProvider?.writable}
        <Button
          size="sm"
          class="workspace-compact-command h-8 gap-1.5"
          aria-label="New skill"
          title="New skill"
          onclick={() => goto(creatorUrl())}
        >
          <IconPlus class="h-4 w-4" /> <span class="workspace-command-label">New skill</span>
        </Button>
      {/if}
    </div>
  </header>

  {#if skillsState.error}
    <div
      class="border-b border-destructive/30 bg-destructive/8 px-4 py-2 text-xs text-destructive"
      role="alert"
    >
      {skillsState.error}
    </div>
  {/if}

  <div class="min-h-0 flex-1">
    <aside
      bind:this={skillList}
      class="skill-list flex h-full w-[310px] shrink-0 flex-col border-r border-border"
      data-has-selection={selectedId !== null}
    >
      <div class="space-y-2 border-b border-border p-2.5">
        <div class="relative">
          <IconSearch
            class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            bind:value={skillsState.query}
            placeholder="Search skills"
            aria-label="Search skills"
            class="workspace-search-control h-8 pl-8 pr-11 text-xs"
          />
          {#if skillsState.query}<button
              class="workspace-clear-search absolute right-0 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center text-muted-foreground"
              aria-label="Clear search"
              onclick={() => (skillsState.query = "")}><IconX class="h-3.5 w-3.5" /></button
            >{/if}
        </div>
        <div class="flex items-center gap-1.5">
          <Button
            variant={showDisabled ? "secondary" : "ghost"}
            size="sm"
            class="workspace-filter-control h-7 px-2 text-[11px]"
            aria-pressed={showDisabled}
            onclick={() => (showDisabled = !showDisabled)}>Disabled {counts.disabled}</Button
          >
          <span class="ml-auto text-[10px] text-muted-foreground">{visible.length}</span>
        </div>
      </div>
      <div class="scrollbar-thin scrollbar-track-transparent min-h-0 flex-1 overflow-y-auto">
        {#if skillsState.loading}
          <div class="space-y-px">
            {#each Array(7) as _}<div
                class="h-14 animate-pulse border-b border-border bg-muted/35"
              ></div>{/each}
          </div>
        {:else if visible.length === 0}
          <div class="p-6 text-center text-xs text-muted-foreground">
            {skillsState.query ? "No matching skills." : "No skills found in this workspace."}
          </div>
        {:else}
          {#each visible as skill (skill.id)}<SkillCard
              {skill}
              selected={selectedId === skill.id}
              onclick={() => choose(skill.id)}
            />{/each}
        {/if}
      </div>
    </aside>

    <main class="skill-detail h-full min-w-0 flex-1" data-active={selectedId !== null}>
      <SkillDetail
        bind:headingRef={detailHeading}
        skill={skillsState.selected}
        busy={toggling}
        editable={selectedProvider?.writable ?? false}
        onToggle={toggle}
        onEdit={() => goto(creatorUrl())}
        onBack={() => void closeDetail()}
        onValidate={() =>
          selectedId ? validateSkill(selectedId) : Promise.reject(new Error("No skill selected."))}
      />
    </main>
  </div>
</div>

<style>
  .workspace-surface {
    container-type: inline-size;
  }
  .workspace-surface > :last-child {
    display: flex;
  }
  @container (max-width: 680px) {
    :global(.workspace-refresh-command),
    :global(.workspace-compact-command),
    :global(.workspace-provider-command),
    :global(.workspace-filter-control),
    :global(.workspace-search-control),
    .workspace-clear-search {
      min-height: 2.75rem;
    }
    :global(.workspace-refresh-command),
    :global(.workspace-compact-command) {
      width: 2.75rem;
      padding-inline: 0;
    }
    .workspace-clear-search {
      width: 2.75rem;
    }
    .workspace-command-label {
      display: none;
    }
    .skill-list {
      width: 100%;
      border-right: 0;
    }
    .skill-detail {
      display: none;
    }
    .workspace-surface[data-mobile-detail="true"] .skill-list {
      display: none;
    }
    .workspace-surface[data-mobile-detail="true"] .skill-detail {
      display: block;
    }
    :global(.detail-back) {
      display: inline-flex;
    }
  }
</style>
