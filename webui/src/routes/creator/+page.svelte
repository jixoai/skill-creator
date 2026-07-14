<script lang="ts">
  /**
   * 正交意图（2026-07-14）
   * 原始需求 [2026-07-14]：「我们还需要有一个 创造、编辑 技能的路由(/creator)。二者是有机互联的」。
   * 1. 在显式可写 workspace 中创建、编辑、预览和删除技能。
   * 2. 以 revision 防止陈旧表单覆盖磁盘新版本。
   * 3. 保存后同步技能列表与 workspace 计数。
   */
  import { page } from "$app/state";
  import { ImportedWorkspaceIdSchema } from "$shared/contracts/workspaces.js";
  import { SkillIdSchema } from "$shared/contracts/skills.js";
  import { Button } from "$lib/components/ui/button";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Textarea } from "$lib/components/ui/textarea";
  import {
    connectionState,
    loadSkillDoc,
    loadSkills,
    loadWorkspaces,
    removeSkill,
    saveSkill,
    skillsState,
    workspaceState,
    writableWorkspaces,
  } from "$lib/store.svelte";
  import { TEMPLATES, type SkillTemplate } from "$lib/templates";
  import type { ImportedWorkspaceId, SkillDocument } from "$lib/types";
  import IconChevron from "@lucide/svelte/icons/chevron-down";
  import IconFile from "@lucide/svelte/icons/file-text";
  import IconLayout from "@lucide/svelte/icons/layout-template";
  import IconLoader from "@lucide/svelte/icons/loader-circle";
  import IconPlus from "@lucide/svelte/icons/plus";
  import IconSave from "@lucide/svelte/icons/save";
  import IconSearch from "@lucide/svelte/icons/search";
  import IconTrash from "@lucide/svelte/icons/trash-2";

  let workspaceId = $state<ImportedWorkspaceId | null>(null);
  let document = $state<SkillDocument | null>(null);
  let name = $state("");
  let description = $state("");
  let body = $state("# Instructions\n\nDescribe when and how to use this skill.\n");
  let extraFrontmatter = $state<Record<string, unknown>>({});
  let baseline = $state("");
  let search = $state("");
  let view = $state<"edit" | "preview">("edit");
  let busy = $state(false);
  let error = $state<string | null>(null);
  let notice = $state<string | null>(null);
  let initialized = $state(false);

  let workspaces = $derived(writableWorkspaces());
  let selectedWorkspace = $derived(workspaces.find((workspace) => workspace.id === workspaceId));
  let filteredExisting = $derived(
    skillsState.skills.filter(
      (skill) => !search.trim() || skill.name.toLowerCase().includes(search.trim().toLowerCase()),
    ),
  );
  let snapshot = $derived(
    JSON.stringify({ workspaceId, name, description, body, extraFrontmatter }),
  );
  let dirty = $derived(Boolean(baseline) && snapshot !== baseline);

  $effect(() => {
    if (connectionState.status !== "connected" || initialized) return;
    initialized = true;
    void initialize();
  });

  async function initialize(): Promise<void> {
    await loadWorkspaces();
    const requestedWorkspace = ImportedWorkspaceIdSchema.safeParse(
      page.url.searchParams.get("workspace"),
    );
    workspaceId =
      workspaces.find((workspace) => workspace.id === requestedWorkspace.data)?.id ??
      workspaces[0]?.id ??
      null;
    if (!workspaceId) return;
    await loadSkills(workspaceId);
    const requestedSkill = page.url.searchParams.get("skill");
    if (requestedSkill) await openExisting(requestedSkill, true);
    else markBaseline();
  }

  function markBaseline(): void {
    baseline = JSON.stringify({ workspaceId, name, description, body, extraFrontmatter });
  }

  function allowDiscard(): boolean {
    return !dirty || globalThis.confirm("Discard your unsaved changes?");
  }

  async function chooseWorkspace(nextId: ImportedWorkspaceId): Promise<void> {
    if (nextId === workspaceId || !allowDiscard()) return;
    workspaceId = nextId;
    resetDraft();
    await loadSkills(nextId);
    markBaseline();
  }

  function resetDraft(): void {
    document = null;
    name = "";
    description = "";
    body = "# Instructions\n\nDescribe when and how to use this skill.\n";
    extraFrontmatter = {};
    error = null;
    notice = null;
  }

  function newSkill(): void {
    if (!allowDiscard()) return;
    resetDraft();
    markBaseline();
  }

  function useTemplate(template: SkillTemplate): void {
    if (!allowDiscard()) return;
    document = null;
    name = template.name;
    description = template.description;
    body = template.body;
    extraFrontmatter = {};
    notice = `Started from ${template.name}. Review every placeholder before saving.`;
    markBaseline();
  }

  async function openExisting(skillId: string, force = false): Promise<void> {
    if (!workspaceId || (!force && !allowDiscard())) return;
    const parsedSkillId = SkillIdSchema.safeParse(skillId);
    if (!parsedSkillId.success) {
      error = "The requested skill ID is invalid.";
      return;
    }
    busy = true;
    error = null;
    try {
      const loaded = await loadSkillDoc(workspaceId, parsedSkillId.data);
      document = loaded;
      name = loaded.frontmatter.name;
      description = loaded.frontmatter.description;
      body = loaded.body;
      const { name: _name, description: _description, ...extra } = loaded.frontmatter;
      extraFrontmatter = extra;
      markBaseline();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      busy = false;
    }
  }

  async function save(): Promise<void> {
    if (!workspaceId || !name.trim() || !description.trim()) return;
    busy = true;
    error = null;
    notice = null;
    try {
      const frontmatter = {
        ...extraFrontmatter,
        name: name.trim(),
        description: description.trim(),
      };
      const result = await saveSkill(
        document
          ? {
              mode: "update",
              workspaceId: document.workspaceId,
              skillId: document.skillId,
              expectedRevision: document.revision,
              frontmatter,
              body,
            }
          : {
              mode: "create",
              workspaceId,
              directoryName: name.trim(),
              frontmatter,
              body,
            },
      );
      document = result.document;
      notice = result.validation.success
        ? result.created
          ? "Skill created and validated."
          : "Changes saved and validated."
        : `Saved with ${result.validation.errors.length} validation issue(s).`;
      await Promise.all([loadSkills(workspaceId), loadWorkspaces()]);
      markBaseline();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      busy = false;
    }
  }

  async function removeCurrent(): Promise<void> {
    const currentWorkspaceId = workspaceId;
    if (
      !document ||
      !currentWorkspaceId ||
      !globalThis.confirm(`Delete ${document.frontmatter.name} and its resource directory?`)
    )
      return;
    busy = true;
    try {
      await removeSkill(document);
      resetDraft();
      await Promise.all([loadSkills(currentWorkspaceId), loadWorkspaces()]);
      markBaseline();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:window
  onbeforeunload={(event) => {
    if (dirty) event.preventDefault();
  }}
/>

<div class="creator-surface flex h-full min-w-0 flex-col">
  <header
    class="creator-header flex min-h-12 shrink-0 items-center gap-2 border-b border-border px-3"
  >
    <div class="creator-heading min-w-0">
      <h1 class="text-sm font-semibold">Creator</h1>
      <p class="truncate text-[10px] text-muted-foreground">
        {selectedWorkspace?.path ?? "Import a writable workspace to begin"}
      </p>
    </div>
    <div class="creator-toolbar ml-auto flex min-w-0 items-center gap-1.5">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}<Button
              {...props}
              variant="outline"
              size="sm"
              class="creator-workspace-select h-8 max-w-48 gap-1.5"
              ><span class="truncate">{selectedWorkspace?.label ?? "Choose workspace"}</span
              ><IconChevron class="h-3.5 w-3.5" /></Button
            >{/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content
          >{#each workspaces as workspace}<DropdownMenu.Item
              onclick={() => chooseWorkspace(workspace.id)}>{workspace.label}</DropdownMenu.Item
            >{/each}</DropdownMenu.Content
        >
      </DropdownMenu.Root>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}<Button
              {...props}
              variant="ghost"
              size="sm"
              class="creator-icon-command h-8 gap-1.5"
              aria-label="Choose template"
              title="Choose template"
              ><IconLayout class="h-4 w-4" /><span class="creator-icon-label">Template</span
              ></Button
            >{/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content class="max-h-72 overflow-y-auto"
          >{#each TEMPLATES as template}<DropdownMenu.Item onclick={() => useTemplate(template)}
              >{template.name}</DropdownMenu.Item
            >{/each}</DropdownMenu.Content
        >
      </DropdownMenu.Root>
      <Button
        variant="ghost"
        size="sm"
        class="creator-icon-command h-8 gap-1.5"
        aria-label="New skill"
        title="New skill"
        onclick={newSkill}
        ><IconPlus class="h-4 w-4" /><span class="creator-icon-label">New</span></Button
      >
      {#if document}<Button
          variant="ghost"
          size="icon"
          class="h-8 w-8 text-destructive"
          aria-label="Delete skill"
          title="Delete skill"
          onclick={removeCurrent}><IconTrash class="h-4 w-4" /></Button
        >{/if}
      <Button
        size="sm"
        class="h-8 gap-1.5"
        onclick={save}
        disabled={busy || !workspaceId || !name.trim() || !description.trim()}
      >
        {#if busy}<IconLoader class="h-4 w-4 animate-spin" />{:else}<IconSave
            class="h-4 w-4"
          />{/if}{document ? "Save" : "Create"}
      </Button>
    </div>
  </header>

  {#if error}<div
      class="border-b border-destructive/30 bg-destructive/8 px-4 py-2 text-xs text-destructive"
      role="alert"
    >
      {error}
    </div>{/if}
  {#if notice}<div
      class="border-b border-border bg-muted/50 px-4 py-2 text-xs text-foreground"
      aria-live="polite"
    >
      {notice}
    </div>{/if}

  {#if workspaces.length === 0}
    <div class="flex flex-1 items-center justify-center p-8 text-center">
      <div>
        <p class="text-sm font-medium">Creator needs a writable workspace</p>
        <p class="mt-1 text-xs text-muted-foreground">
          Import a directory from the sidebar, then create or edit skills here.
        </p>
      </div>
    </div>
  {:else}
    <div class="flex min-h-0 flex-1">
      <aside class="creator-list flex w-[220px] shrink-0 flex-col border-r border-border">
        <div class="relative border-b border-border p-2">
          <IconSearch
            class="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            bind:value={search}
            placeholder="Open skill"
            aria-label="Search existing skills"
            class="h-8 pl-8 text-xs"
          />
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto py-1">
          {#each filteredExisting as skill (skill.id)}
            <button
              class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-accent"
              class:bg-accent={document?.skillId === skill.id}
              onclick={() => openExisting(skill.id)}
              ><IconFile class="h-3.5 w-3.5 shrink-0" /><span class="truncate">{skill.name}</span
              ></button
            >
          {:else}<p class="p-4 text-xs text-muted-foreground">
              No skills in this workspace.
            </p>{/each}
        </div>
      </aside>

      <main class="min-w-0 flex-1">
        <div class="flex h-full min-w-0 flex-col">
          <div class="flex items-center gap-1 border-b border-border px-3 py-2">
            <div class="inline-flex rounded-md bg-muted p-0.5 text-xs">
              <button
                class="rounded px-2.5 py-1"
                class:bg-background={view === "edit"}
                aria-pressed={view === "edit"}
                onclick={() => (view = "edit")}>Edit</button
              >
              <button
                class="rounded px-2.5 py-1"
                class:bg-background={view === "preview"}
                aria-pressed={view === "preview"}
                onclick={() => (view = "preview")}>Preview</button
              >
            </div>
            {#if dirty}<span class="ml-auto text-[10px] text-amber-700 dark:text-amber-300"
                >Unsaved changes</span
              >{/if}
          </div>

          {#if view === "edit"}
            <div
              class="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-3 overflow-y-auto p-4"
            >
              <div
                class="creator-fields grid grid-cols-[minmax(160px,0.7fr)_minmax(240px,1.3fr)] gap-3"
              >
                <div class="space-y-1.5">
                  <Label for="skill-name" class="text-xs">Name</Label><Input
                    id="skill-name"
                    bind:value={name}
                    class="h-8 font-mono text-xs"
                    placeholder="my-skill"
                    disabled={Boolean(document)}
                  />
                </div>
                <div class="space-y-1.5">
                  <Label for="skill-description" class="text-xs">Description</Label><Input
                    id="skill-description"
                    bind:value={description}
                    class="h-8 text-xs"
                    placeholder="What this skill does and when to use it"
                  />
                </div>
              </div>
              <div class="flex min-h-0 flex-col">
                <Label for="skill-body" class="mb-1.5 text-xs">Instructions (Markdown)</Label
                ><Textarea
                  id="skill-body"
                  bind:value={body}
                  class="min-h-[320px] flex-1 resize-none font-mono text-xs leading-5"
                />
              </div>
            </div>
          {:else}
            <div class="min-h-0 flex-1 overflow-y-auto p-5">
              <h2 class="text-base font-semibold">{name || "Untitled skill"}</h2>
              <p class="mt-1 text-xs text-muted-foreground">
                {description || "No description yet."}
              </p>
              <pre
                class="mt-5 whitespace-pre-wrap break-words font-mono text-xs leading-5">{body}</pre>
            </div>
          {/if}
        </div>
      </main>
    </div>
  {/if}
</div>

<style>
  .creator-surface {
    container-type: inline-size;
  }
  @container (max-width: 700px) {
    .creator-header {
      flex-wrap: wrap;
      gap: 0.375rem;
      padding-block: 0.5rem;
    }
    .creator-heading,
    .creator-toolbar {
      width: 100%;
    }
    .creator-toolbar {
      margin-left: 0;
    }
    :global(.creator-workspace-select) {
      min-width: 0;
      max-width: none;
      flex: 1;
      justify-content: space-between;
    }
    :global(.creator-icon-command) {
      width: 2rem;
      padding-inline: 0;
    }
    .creator-icon-label {
      display: none;
    }
    .creator-list {
      display: none;
    }
    .creator-fields {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
