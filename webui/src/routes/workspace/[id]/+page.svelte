<script lang="ts">
  /**
   * 原始需求 [2026-07-14]：「skills manager 只是路由的一部分(`/workspace/~/`)；我们还需要支持导入 workspace」。
   * 正交意图：
   * 1. 按路由和连接代次加载、筛选与选择技能。
   * 2. 编排技能校验和启停操作。
   * 3. 将可写技能衔接到 Creator，将安装需求衔接到 Repository。
   */
  import type { PageData } from "./$types";
  import { goto } from "$app/navigation";
  import SkillCard from "$lib/components/skill-card.svelte";
  import SkillDetail from "$lib/components/skill-detail.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import {
    connectionState,
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
  import type { SkillId } from "$lib/types";
  import IconFilter from "@lucide/svelte/icons/list-filter";
  import IconLoader from "@lucide/svelte/icons/loader-circle";
  import IconPlus from "@lucide/svelte/icons/plus";
  import IconRefresh from "@lucide/svelte/icons/refresh-cw";
  import IconRepository from "@lucide/svelte/icons/git-fork";
  import IconSearch from "@lucide/svelte/icons/search";
  import IconX from "@lucide/svelte/icons/x";

  let { data }: { data: PageData } = $props();
  let id = $derived(data.workspaceId);
  let selectedId = $state<SkillId | null>(null);
  let showDisabled = $state(false);
  let provider = $state<string | null>(null);
  let toggling = $state(false);
  let loadedKey = "";

  $effect(() => {
    const routeId = id;
    if (connectionState.status !== "connected") {
      loadedKey = "";
      return;
    }
    if (!routeId || loadedKey === routeId) return;

    let cancelled = false;
    loadedKey = routeId;
    void (async () => {
      try {
        await loadWorkspaces();
        if (cancelled) return;
        await setActiveWorkspace(routeId);
        if (cancelled) return;
        await loadSkills(routeId);
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
  let counts = $derived(skillCounts());
  let providers = $derived(
    Object.entries(counts.byProvider).sort((left, right) => right[1] - left[1]),
  );
  let visible = $derived(
    filteredSkills().filter(
      (skill) => (showDisabled || !skill.disabled) && (!provider || skill.provider === provider),
    ),
  );

  async function choose(skillId: SkillId): Promise<void> {
    selectedId = skillId;
    await selectSkill(skillId);
  }

  async function toggle(mode: "enable" | "disable"): Promise<void> {
    if (!selectedId) return;
    toggling = true;
    try {
      const result = await toggleSkills([selectedId], mode);
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
    const params = new URLSearchParams({ workspace: id });
    if (selectedId) params.set("skill", selectedId);
    return `/creator?${params}`;
  }
</script>

<div class="workspace-surface flex h-full min-w-0 flex-col" data-selected={selectedId !== null}>
  <header class="flex min-h-12 shrink-0 items-center gap-3 border-b border-border px-4">
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2">
        <h1 class="truncate text-sm font-semibold">{workspace?.label ?? "Workspace"}</h1>
        <span class="text-xs text-muted-foreground">{counts.total} skills</span>
      </div>
      {#if workspace?.path}<p class="truncate font-mono text-[10px] text-muted-foreground">
          {workspace.path}
        </p>{/if}
    </div>
    <div class="ml-auto flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        class="h-8 w-8"
        aria-label="Refresh skills"
        title="Refresh skills"
        onclick={() => loadSkills(id)}
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
        onclick={() => goto(`/repository?workspace=${encodeURIComponent(id)}`)}
      >
        <IconRepository class="h-4 w-4" /> <span class="workspace-command-label">Repository</span>
      </Button>
      {#if workspace?.kind === "directory"}
        <Button
          size="sm"
          class="workspace-compact-command h-8 gap-1.5"
          aria-label="New skill"
          title="New skill"
          onclick={() => goto(`/creator?workspace=${encodeURIComponent(id)}`)}
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
            class="h-8 pl-8 pr-8 text-xs"
          />
          {#if skillsState.query}<button
              class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
              aria-label="Clear search"
              onclick={() => (skillsState.query = "")}><IconX class="h-3.5 w-3.5" /></button
            >{/if}
        </div>
        <div class="flex items-center gap-1.5">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              {#snippet child({ props })}<Button
                  {...props}
                  variant="outline"
                  size="sm"
                  class="h-7 gap-1.5 px-2 text-[11px]"
                  ><IconFilter class="h-3 w-3" />{provider ?? "All providers"}</Button
                >{/snippet}
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              <DropdownMenu.Item onclick={() => (provider = null)}>All providers</DropdownMenu.Item>
              {#each providers as [name, count]}<DropdownMenu.Item onclick={() => (provider = name)}
                  >{name}<span class="ml-auto text-muted-foreground">{count}</span
                  ></DropdownMenu.Item
                >{/each}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
          <Button
            variant={showDisabled ? "secondary" : "ghost"}
            size="sm"
            class="h-7 px-2 text-[11px]"
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
        skill={skillsState.selected}
        busy={toggling}
        editable={workspace?.kind === "directory"}
        onToggle={toggle}
        onEdit={() => goto(creatorUrl())}
        onBack={() => {
          selectedId = null;
          skillsState.selected = null;
        }}
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
    :global(.workspace-compact-command) {
      width: 2rem;
      padding-inline: 0;
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
    .workspace-surface[data-selected="true"] .skill-list {
      display: none;
    }
    .workspace-surface[data-selected="true"] .skill-detail {
      display: block;
    }
    :global(.detail-back) {
      display: inline-flex;
    }
  }
</style>
