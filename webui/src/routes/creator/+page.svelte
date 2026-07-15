<script lang="ts">
  /**
   * 正交意图（2026-07-14）
   * 原始需求 [2026-07-14]：「我们还需要有一个 创造、编辑 技能的路由(/creator)。二者是有机互联的」。
   * 1. 按可选 workspace 创建作用域与 workspace+skill 编辑身份，创建、编辑、预览和删除技能。
   * 2. 以 revision 防止陈旧表单覆盖磁盘新版本。
   * 3. 保存后同步技能列表与 workspace 计数。
   * 4. 在窄屏维持技能列表与编辑器的可恢复焦点路径。
   * 妥协声明：四项共同维护一份 revision-safe 草稿会话；拆分 UI 状态将制造跨组件提交竞态。
   */
  import type { PageData } from "./$types";
  import { beforeNavigate } from "$app/navigation";
  import { onDestroy, tick } from "svelte";
  import { SkillIdSchema } from "$shared/contracts/skills.js";
  import { Button } from "$lib/components/ui/button";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Textarea } from "$lib/components/ui/textarea";
  import {
    connectionState,
    getConnectionGeneration,
    loadSkillDoc,
    loadSkills,
    loadWorkspaces,
    removeSkill,
    saveSkill,
    skillsState,
    writableWorkspaces,
    workspaceState,
  } from "$lib/store.svelte";
  import {
    createRequestGenerationGate,
    type RequestGeneration,
  } from "$lib/stores/request-generation";
  import { TEMPLATES, type SkillTemplate } from "$lib/templates";
  import type { ImportedWorkspaceId, SaveSkillInput, SkillDocument, SkillId } from "$lib/types";
  import IconChevron from "@lucide/svelte/icons/chevron-down";
  import IconArrowLeft from "@lucide/svelte/icons/arrow-left";
  import IconFile from "@lucide/svelte/icons/file-text";
  import IconFolderOpen from "@lucide/svelte/icons/folder-open";
  import IconLayout from "@lucide/svelte/icons/layout-template";
  import IconLoader from "@lucide/svelte/icons/loader-circle";
  import IconPlus from "@lucide/svelte/icons/plus";
  import IconSave from "@lucide/svelte/icons/save";
  import IconSearch from "@lucide/svelte/icons/search";
  import IconTrash from "@lucide/svelte/icons/trash-2";

  let { data }: { data: PageData } = $props();

  const routeRequests = createRequestGenerationGate(getConnectionGeneration);
  const documentRequests = createRequestGenerationGate(getConnectionGeneration);
  const mutationRequests = createRequestGenerationGate(getConnectionGeneration);

  let workspaceId = $state<ImportedWorkspaceId | null>(null);
  let document = $state<SkillDocument | null>(null);
  let editorMode = $state<"create" | "edit">("create");
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
  let mobileListOpen = $state(false);
  let mounted = true;
  let sessionRouteKey: string | null = null;
  let completedRouteKey: string | null = null;
  let pendingRouteKey: string | null = null;
  let mobileListTrigger = $state<HTMLButtonElement | null>(null);
  let mobileSearchInput = $state<HTMLInputElement | null>(null);
  let editorSurface = $state<HTMLElement | null>(null);

  onDestroy(() => {
    mounted = false;
    routeRequests.invalidate();
    documentRequests.invalidate();
    mutationRequests.invalidate();
  });

  beforeNavigate(({ cancel, willUnload }) => {
    if (willUnload) return;
    if (busy || (dirty && !globalThis.confirm("Discard your unsaved changes?"))) cancel();
  });

  let workspaces = $derived(writableWorkspaces());
  let selectedWorkspace = $derived(workspaces.find((workspace) => workspace.id === workspaceId));
  let filteredExisting = $derived(
    skillsState.skills.filter(
      (skill) => !search.trim() || skill.name.toLowerCase().includes(search.trim().toLowerCase()),
    ),
  );
  let snapshot = $derived(
    JSON.stringify({ workspaceId, editorMode, name, description, body, extraFrontmatter }),
  );
  let dirty = $derived(Boolean(baseline) && snapshot !== baseline);

  $effect(() => {
    const requestedWorkspaceId = data.workspaceId;
    const requestedSkillId = data.skillId;
    const routeKey = `${requestedWorkspaceId ?? ""}:${requestedSkillId ?? ""}`;
    if (sessionRouteKey !== routeKey) {
      sessionRouteKey = routeKey;
      completedRouteKey = null;
      mutationRequests.invalidate();
    }
    if (connectionState.status !== "connected") {
      routeRequests.invalidate();
      if (pendingRouteKey === routeKey) {
        pendingRouteKey = null;
        busy = false;
      }
      return;
    }
    if (completedRouteKey === routeKey || pendingRouteKey === routeKey) return;

    const request = routeRequests.issue();
    pendingRouteKey = routeKey;
    void initialize(requestedWorkspaceId, requestedSkillId, request).then((completed) => {
      if (!request.isCurrent() || pendingRouteKey !== routeKey) return;
      pendingRouteKey = null;
      if (completed) completedRouteKey = routeKey;
    });

    return () => {
      if (request.isCurrent()) routeRequests.invalidate();
      if (pendingRouteKey === routeKey) {
        pendingRouteKey = null;
        busy = false;
      }
    };
  });

  async function initialize(
    requestedWorkspaceId: ImportedWorkspaceId | null,
    requestedSkillId: SkillId | null,
    request: RequestGeneration,
  ): Promise<boolean> {
    documentRequests.invalidate();
    busy = true;
    resetDraft(requestedSkillId ? "edit" : "create");
    try {
      const workspaceLoad = await loadCreatorWorkspaces(request);
      if (workspaceLoad === "stale") return false;
      if (workspaceLoad === "failed") {
        workspaceId = null;
        error = workspaceState.error ?? "The writable Workspace list could not be loaded.";
        markBaseline();
        return true;
      }

      const availableWorkspaces = writableWorkspaces();
      const requestedWorkspace = availableWorkspaces.find(
        (workspace) => workspace.id === requestedWorkspaceId,
      );
      if (requestedWorkspaceId && !requestedWorkspace) {
        workspaceId = null;
        error = "The requested Workspace is no longer available as a writable destination.";
        markBaseline();
        return true;
      }

      workspaceId = requestedWorkspace?.id ?? availableWorkspaces[0]?.id ?? null;
      if (!workspaceId) {
        markBaseline();
        return true;
      }
      const targetWorkspaceId = workspaceId;
      await loadSkills(targetWorkspaceId);
      if (!request.isCurrent()) return false;
      if (requestedSkillId) {
        return await loadExistingDocument(
          targetWorkspaceId,
          requestedSkillId,
          () => request.isCurrent() && workspaceId === targetWorkspaceId,
        );
      }
      markBaseline();
      return true;
    } catch (cause) {
      if (request.isCurrent()) error = cause instanceof Error ? cause.message : String(cause);
      return false;
    } finally {
      if (request.isCurrent()) busy = false;
    }
  }

  async function loadCreatorWorkspaces(
    request: RequestGeneration,
  ): Promise<"loaded" | "failed" | "stale"> {
    while (request.isCurrent()) {
      const outcome = await loadWorkspaces();
      if (!request.isCurrent()) return "stale";
      if (outcome === "superseded") continue;
      return outcome;
    }
    return "stale";
  }

  function markBaseline(): void {
    baseline = JSON.stringify({
      workspaceId,
      editorMode,
      name,
      description,
      body,
      extraFrontmatter,
    });
  }

  function allowDiscard(): boolean {
    return !dirty || globalThis.confirm("Discard your unsaved changes?");
  }

  async function chooseWorkspace(nextId: ImportedWorkspaceId): Promise<void> {
    if (busy || nextId === workspaceId || !allowDiscard()) return;
    documentRequests.invalidate();
    workspaceId = nextId;
    resetDraft("create");
    await loadSkills(nextId);
    mobileListOpen = false;
    markBaseline();
  }

  function resetDraft(mode: "create" | "edit"): void {
    editorMode = mode;
    document = null;
    name = "";
    description = "";
    body = "# Instructions\n\nDescribe when and how to use this skill.\n";
    extraFrontmatter = {};
    error = null;
    notice = null;
  }

  function newSkill(): void {
    if (busy || !allowDiscard()) return;
    documentRequests.invalidate();
    resetDraft("create");
    mobileListOpen = false;
    markBaseline();
  }

  function useTemplate(template: SkillTemplate): void {
    if (busy || !allowDiscard()) return;
    documentRequests.invalidate();
    editorMode = "create";
    document = null;
    name = template.name;
    description = template.description;
    body = template.body;
    extraFrontmatter = {};
    mobileListOpen = false;
    notice = `Started from ${template.name}. Review every placeholder before saving.`;
    markBaseline();
  }

  async function showMobileList(): Promise<void> {
    mobileListOpen = true;
    await tick();
    if (mobileSearchInput?.offsetParent) mobileSearchInput.focus();
  }

  async function closeMobileList(): Promise<void> {
    mobileListOpen = false;
    await tick();
    if (mobileListTrigger?.isConnected) mobileListTrigger.focus();
  }

  async function focusEditorAfterMobileSelection(): Promise<void> {
    await tick();
    if (editorSurface?.offsetParent) editorSurface.focus();
  }

  async function loadExistingDocument(
    targetWorkspaceId: ImportedWorkspaceId,
    skillId: SkillId,
    canCommit: () => boolean,
  ): Promise<boolean> {
    const loaded = await loadSkillDoc(targetWorkspaceId, skillId);
    if (!canCommit()) return false;
    editorMode = "edit";
    document = loaded;
    name = loaded.frontmatter.name;
    description = loaded.frontmatter.description;
    body = loaded.body;
    const { name: _name, description: _description, ...extra } = loaded.frontmatter;
    extraFrontmatter = extra;
    mobileListOpen = false;
    markBaseline();
    return true;
  }

  async function openExisting(skillId: string): Promise<void> {
    if (busy || !workspaceId || !allowDiscard()) return;
    const parsedSkillId = SkillIdSchema.safeParse(skillId);
    if (!parsedSkillId.success) {
      error = "The requested skill ID is invalid.";
      return;
    }
    const targetWorkspaceId = workspaceId;
    const request = documentRequests.issue();
    const restoreEditorFocus = mobileListOpen;
    resetDraft("edit");
    busy = true;
    try {
      const committed = await loadExistingDocument(
        targetWorkspaceId,
        parsedSkillId.data,
        () => request.isCurrent() && mounted && workspaceId === targetWorkspaceId,
      );
      if (committed && restoreEditorFocus) await focusEditorAfterMobileSelection();
    } catch (cause) {
      if (request.isCurrent() && mounted) {
        error = cause instanceof Error ? cause.message : String(cause);
      }
    } finally {
      if (request.isCurrent() && mounted) busy = false;
    }
  }

  async function save(): Promise<void> {
    if (!workspaceId || !name.trim() || !description.trim()) return;
    const submittedWorkspaceId = workspaceId;
    const submittedMode = editorMode;
    const submittedDocument = document;
    const submittedBody = body;
    const frontmatter = {
      ...extraFrontmatter,
      name: name.trim(),
      description: description.trim(),
    };
    let input: SaveSkillInput;
    if (submittedMode === "edit") {
      if (!submittedDocument) return;
      input = {
        mode: "update",
        workspaceId: submittedDocument.workspaceId,
        skillId: submittedDocument.skillId,
        expectedRevision: submittedDocument.revision,
        frontmatter,
        body: submittedBody,
      };
    } else {
      input = {
        mode: "create",
        workspaceId: submittedWorkspaceId,
        directoryName: name.trim(),
        frontmatter,
        body: submittedBody,
      };
    }
    const request = mutationRequests.issue();
    const canCommit = (): boolean =>
      request.isCurrent() && mounted && workspaceId === submittedWorkspaceId;
    busy = true;
    error = null;
    notice = null;
    try {
      const result = await saveSkill(input);
      if (!canCommit()) return;
      editorMode = "edit";
      document = result.document;
      notice = result.validation.success
        ? result.created
          ? "Skill created and validated."
          : "Changes saved and validated."
        : `Saved with ${result.validation.errors.length} validation issue(s).`;
      await Promise.all([loadSkills(submittedWorkspaceId), loadWorkspaces()]);
      if (!canCommit()) return;
      markBaseline();
    } catch (cause) {
      if (canCommit()) error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (request.isLatest() && mounted) busy = false;
    }
  }

  async function removeCurrent(): Promise<void> {
    const currentWorkspaceId = workspaceId;
    const currentDocument = document;
    if (
      busy ||
      !currentDocument ||
      !currentWorkspaceId ||
      !globalThis.confirm(`Delete ${currentDocument.frontmatter.name} and its resource directory?`)
    )
      return;
    const request = mutationRequests.issue();
    const canCommit = (): boolean =>
      request.isCurrent() && mounted && workspaceId === currentWorkspaceId;
    busy = true;
    try {
      await removeSkill(currentDocument);
      if (!canCommit()) return;
      resetDraft("create");
      await Promise.all([loadSkills(currentWorkspaceId), loadWorkspaces()]);
      if (!canCommit()) return;
      markBaseline();
    } catch (cause) {
      if (canCommit()) error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (request.isLatest() && mounted) busy = false;
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
              disabled={busy}
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
              disabled={busy}
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
        disabled={busy}
        ><IconPlus class="h-4 w-4" /><span class="creator-icon-label">New</span></Button
      >
      <Button
        bind:ref={mobileListTrigger}
        variant="ghost"
        size="icon"
        class="creator-open-list h-8 w-8"
        aria-label="Open existing skill"
        title="Open existing skill"
        onclick={showMobileList}
        disabled={busy || !workspaceId}
      >
        <IconFolderOpen class="h-4 w-4" />
      </Button>
      {#if document}<Button
          variant="ghost"
          size="icon"
          class="creator-delete h-8 w-8 text-destructive"
          aria-label="Delete skill"
          title="Delete skill"
          disabled={busy}
          onclick={removeCurrent}><IconTrash class="h-4 w-4" /></Button
        >{/if}
      <Button
        size="sm"
        class="creator-save h-8 gap-1.5"
        onclick={save}
        disabled={busy ||
          !workspaceId ||
          !name.trim() ||
          !description.trim() ||
          (editorMode === "edit" && !document)}
      >
        {#if busy}<IconLoader class="h-4 w-4 animate-spin" />{:else}<IconSave
            class="h-4 w-4"
          />{/if}{editorMode === "edit" ? "Save" : "Create"}
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
    <div class="creator-body flex min-h-0 flex-1" data-mobile-list={mobileListOpen}>
      <aside class="creator-list flex w-[220px] shrink-0 flex-col border-r border-border">
        <div class="creator-list-mobile-header h-10 items-center gap-2 border-b border-border px-2">
          <Button
            variant="ghost"
            size="icon"
            class="creator-list-back h-8 w-8"
            aria-label="Back to editor"
            title="Back to editor"
            onclick={closeMobileList}
          >
            <IconArrowLeft class="h-4 w-4" />
          </Button>
          <span class="text-xs font-medium">Workspace skills</span>
        </div>
        <div class="relative border-b border-border p-2">
          <IconSearch
            class="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            bind:ref={mobileSearchInput}
            bind:value={search}
            placeholder="Open skill"
            aria-label="Search existing skills"
            class="creator-search h-8 pl-8 text-xs"
            disabled={busy}
          />
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto py-1">
          {#each filteredExisting as skill (skill.id)}
            <button
              class="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-accent"
              class:bg-accent={document?.skillId === skill.id}
              aria-current={document?.skillId === skill.id ? "true" : undefined}
              onclick={() => openExisting(skill.id)}
              disabled={busy}
              ><IconFile class="h-3.5 w-3.5 shrink-0" /><span class="truncate">{skill.name}</span
              ></button
            >
          {:else}<p class="p-4 text-xs text-muted-foreground">
              No skills in this workspace.
            </p>{/each}
        </div>
      </aside>

      <main
        bind:this={editorSurface}
        class="creator-editor min-w-0 flex-1 focus:outline-none"
        tabindex="-1"
        aria-label={document
          ? `Skill editor for ${document.frontmatter.name}`
          : editorMode === "edit"
            ? "Unavailable skill editor"
            : "New skill editor"}
      >
        <div class="flex h-full min-w-0 flex-col">
          <div class="flex items-center gap-1 border-b border-border px-3 py-2">
            <div class="inline-flex rounded-md bg-muted p-0.5 text-xs">
              <button
                class="creator-view-tab rounded px-2.5 py-1"
                class:bg-background={view === "edit"}
                aria-pressed={view === "edit"}
                onclick={() => (view = "edit")}>Edit</button
              >
              <button
                class="creator-view-tab rounded px-2.5 py-1"
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
                    class="creator-field-control h-8 font-mono text-xs"
                    placeholder="my-skill"
                    disabled={busy || editorMode === "edit"}
                  />
                </div>
                <div class="space-y-1.5">
                  <Label for="skill-description" class="text-xs">Description</Label><Input
                    id="skill-description"
                    bind:value={description}
                    class="creator-field-control h-8 text-xs"
                    placeholder="What this skill does and when to use it"
                    disabled={busy || (editorMode === "edit" && !document)}
                  />
                </div>
              </div>
              <div class="flex min-h-0 flex-col">
                <Label for="skill-body" class="mb-1.5 text-xs">Instructions (Markdown)</Label
                ><Textarea
                  id="skill-body"
                  bind:value={body}
                  class="min-h-[320px] flex-1 resize-none font-mono text-xs leading-5"
                  disabled={busy || (editorMode === "edit" && !document)}
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
  .creator-list-mobile-header,
  :global(.creator-open-list) {
    display: none;
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
      flex-wrap: wrap;
      gap: 0.25rem;
    }
    :global(.creator-workspace-select) {
      min-width: 0;
      max-width: none;
      width: 100%;
      height: 2.75rem;
      flex: 1 0 100%;
      justify-content: space-between;
    }
    :global(.creator-icon-command) {
      width: 2.75rem;
      height: 2.75rem;
      padding-inline: 0;
    }
    .creator-icon-label {
      display: none;
    }
    :global(.creator-open-list) {
      display: inline-flex;
      width: 2.75rem;
      height: 2.75rem;
    }
    :global(.creator-delete) {
      width: 2.75rem;
      height: 2.75rem;
    }
    :global(.creator-save) {
      height: 2.75rem;
      margin-left: auto;
    }
    .creator-list {
      display: none;
    }
    .creator-body[data-mobile-list="true"] .creator-list {
      display: flex;
      width: 100%;
      border-right: 0;
    }
    .creator-body[data-mobile-list="true"] .creator-list-mobile-header {
      display: flex;
      height: 2.75rem;
    }
    .creator-body[data-mobile-list="true"] .creator-editor {
      display: none;
    }
    .creator-fields {
      grid-template-columns: minmax(0, 1fr);
    }
    :global(.creator-list-back),
    :global(.creator-search),
    :global(.creator-field-control),
    .creator-view-tab {
      min-height: 2.75rem;
    }
    :global(.creator-list-back) {
      width: 2.75rem;
    }
  }
</style>
