<!--
  用户原始需求 [2026-07-27]：「右侧『文件』子视图：SKILL.md 编辑器」。
  正交意图：
  1. edit 模式：调用 creator.load 拉取 SkillDocument 并 hydrate 草稿；草稿存共享 editor context（$state）。
  2. new 模式：目录名输入框 + 模板预填草稿；保存走 creator.save(mode=create)。
  3. 保存：creator.save(mode=update) revision-safe；CONFLICT 提示 reload。
  视图状态：草稿 → 共享 creator-editor context（$state）；正文 → daemon RPC。
  妥协声明：编辑器用 monospace textarea（CodeMirror 懒加载留待后续迭代）。
-->
<script lang="ts">
  import { useCreatorEditor, draftToFrontmatter } from "$lib/stores/creator-editor.svelte";
  import { loadSkillDoc, removeSkill, saveSkill } from "$lib/store.svelte";
  import { showToast } from "$lib/toast.svelte";
  import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
  import { goto } from "$app/navigation";
  import { createRequestGenerationGate } from "$lib/stores/request-generation";
  import { getConnectionGeneration } from "$lib/store.svelte";
  import { ORPCError } from "@orpc/client";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import IconLoader from "@lucide/svelte/icons/loader-circle";
  import IconSave from "@lucide/svelte/icons/save";
  import IconRotate from "@lucide/svelte/icons/rotate-cw";
  import IconTrash from "@lucide/svelte/icons/trash-2";
  import { SkillDirectoryNameSchema } from "$shared/contracts/creator.js";

  const editor = useCreatorEditor();
  const draft = editor.draft;

  const loadRequests = createRequestGenerationGate(getConnectionGeneration);
  let loading = $state(false);
  let loadError = $state<string | null>(null);
  let saving = $state(false);

  // edit 模式：挂载或 skillId 变化时拉取文档并 hydrate 草稿。
  $effect(() => {
    if (draft.mode !== "edit" || draft.skillId === null) return;
    void loadDocument(draft.target, draft.skillId);
  });

  async function loadDocument(
    target: typeof draft.target,
    skillId: NonNullable<typeof draft.skillId>,
  ): Promise<void> {
    const request = loadRequests.issue();
    loading = true;
    loadError = null;
    try {
      const document = await loadSkillDoc(target, skillId);
      if (!request.isCurrent()) return;
      editor.hydrateFromDocument(document);
    } catch (error) {
      if (!request.isCurrent()) return;
      loadError = error instanceof Error ? error.message : String(error);
    } finally {
      if (request.isLatest()) loading = false;
    }
  }

  /** 重载当前 edit 模式技能文档（null-safe 包装，供模板回调）。 */
  function reloadCurrent(): void {
    if (draft.mode === "edit" && draft.skillId) {
      void loadDocument(draft.target, draft.skillId);
    }
  }

  // 目录名校验（new 模式）。
  const directoryNameValid = $derived(
    draft.mode !== "new" || SkillDirectoryNameSchema.safeParse(draft.directoryName).success,
  );
  const canSave = $derived(
    !saving &&
      draft.name.trim().length > 0 &&
      draft.description.trim().length > 0 &&
      (draft.mode === "edit" || directoryNameValid) &&
      (draft.revision !== null) === (draft.mode === "edit"),
  );

  async function handleSave(): Promise<void> {
    if (draft.mode === "edit") {
      if (draft.skillId === null || draft.revision === null) return;
      saving = true;
      try {
        const result = await saveSkill({
          mode: "update",
          workspaceId: draft.target.workspaceId,
          providerId: draft.target.providerId,
          skillId: draft.skillId,
          expectedRevision: draft.revision,
          frontmatter: draftToFrontmatter(draft),
          body: draft.body,
        });
        editor.advanceRevision(result.document.revision);
        showToast("Saved.");
      } catch (error) {
        handleSaveError(error);
      } finally {
        saving = false;
      }
      return;
    }
    // new 模式
    const parsed = SkillDirectoryNameSchema.safeParse(draft.directoryName);
    if (!parsed.success) {
      showToast("Directory name must be lowercase letters, numbers, and hyphens.");
      return;
    }
    saving = true;
    try {
      const result = await saveSkill({
        mode: "create",
        workspaceId: draft.target.workspaceId,
        providerId: draft.target.providerId,
        directoryName: parsed.data,
        frontmatter: draftToFrontmatter(draft),
        body: draft.body,
      });
      // 新建成功后切换到 edit 语义（后续保存走 update）。
      editor.hydrateFromDocument(result.document);
      showToast("Skill created.");
    } catch (error) {
      handleSaveError(error);
    } finally {
      saving = false;
    }
  }

  function handleSaveError(error: unknown): void {
    if (error instanceof ORPCError && error.code === "CONFLICT") {
      showToast("This skill changed elsewhere. Reload to view the latest.", {
        label: "Reload",
        run: reloadCurrent,
      });
      return;
    }
    showToast(error instanceof Error ? error.message : String(error));
  }

  // ---- 删除（edit 模式；revision-safe + confirm + busy 锁） ----
  let deleteOpen = $state(false);
  let deleting = $state(false);

  const canDelete = $derived(
    draft.mode === "edit" && draft.skillId !== null && draft.revision !== null,
  );

  async function handleDelete(): Promise<void> {
    if (!canDelete || deleting) return;
    const skillId = draft.skillId;
    const revision = draft.revision;
    if (skillId === null || revision === null) return;
    deleting = true;
    try {
      await removeSkill({ target: draft.target, skillId, expectedRevision: revision });
      deleteOpen = false;
      showToast("Skill deleted.");
      await goto("/creator");
    } catch (error) {
      if (error instanceof ORPCError && error.code === "CONFLICT") {
        deleteOpen = false;
        showToast("This skill changed elsewhere. Reload before deleting.", {
          label: "Reload",
          run: reloadCurrent,
        });
      } else {
        showToast(error instanceof Error ? error.message : String(error));
      }
    } finally {
      deleting = false;
    }
  }
</script>

<div class="flex h-full flex-col">
  <div class="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
    <span class="text-xs font-medium">
      {draft.mode === "new" ? "New SKILL.md" : "SKILL.md"}
    </span>
    <div class="flex items-center gap-1.5">
      {#if draft.mode === "edit" && draft.skillId}
        <Button
          variant="outline"
          size="sm"
          class="h-7 gap-1.5"
          onclick={reloadCurrent}
          disabled={loading}
        >
          <IconRotate class="h-3.5 w-3.5" />
          Reload
        </Button>
      {/if}
      {#if draft.mode === "edit"}
        <Button
          variant="ghost"
          size="sm"
          class="h-7 gap-1.5 px-2 text-destructive hover:text-destructive"
          title="Delete this skill"
          disabled={!canDelete || deleting}
          onclick={() => (deleteOpen = true)}
        >
          <IconTrash class="h-3.5 w-3.5" />
          <span class="hidden sm:inline">Delete</span>
        </Button>
      {/if}
      <Button size="sm" class="h-7 gap-1.5" onclick={handleSave} disabled={!canSave}>
        {#if saving}<IconLoader class="h-3.5 w-3.5 animate-spin" />{:else}<IconSave
            class="h-3.5 w-3.5"
          />{/if}
        {draft.mode === "new" ? "Create" : "Save"}
      </Button>
    </div>
  </div>

  {#if loading}
    <div class="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
      <IconLoader class="h-4 w-4 animate-spin" /> Loading…
    </div>
  {:else if loadError}
    <div class="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
      <p class="text-xs text-destructive">{loadError}</p>
      {#if draft.mode === "edit" && draft.skillId}
        <Button variant="outline" size="sm" onclick={reloadCurrent}>Retry</Button>
      {/if}
    </div>
  {:else}
    <div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
      {#if draft.mode === "new"}
        <label class="block space-y-1">
          <span class="text-[11px] font-medium text-muted-foreground">Directory name</span>
          <Input
            bind:value={draft.directoryName}
            class="h-8 font-mono text-xs"
            placeholder="my-skill"
          />
          {#if !directoryNameValid}
            <span class="text-[11px] text-destructive">
              Use lowercase letters, numbers, and hyphens.
            </span>
          {/if}
        </label>
      {/if}

      <label class="block space-y-1">
        <span class="text-[11px] font-medium text-muted-foreground">Name</span>
        <Input bind:value={draft.name} class="h-8 text-sm" placeholder="Skill name" />
      </label>

      <label class="block space-y-1">
        <span class="text-[11px] font-medium text-muted-foreground">Description</span>
        <textarea
          bind:value={draft.description}
          rows="2"
          class="w-full resize-y rounded-md border border-input bg-input/20 px-2 py-1 text-xs leading-5 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          placeholder="What this skill does"></textarea>
      </label>

      <label class="block flex min-h-0 flex-1 flex-col space-y-1">
        <span class="text-[11px] font-medium text-muted-foreground">Body (Markdown)</span>
        <textarea
          bind:value={draft.body}
          rows="16"
          class="w-full flex-1 resize-y rounded-md border border-input bg-input/20 px-2 py-1.5 font-mono text-xs leading-5 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          placeholder="## When to Use&#10;&#10;Describe when this skill should be invoked."
        ></textarea>
      </label>
    </div>
  {/if}
</div>

<ConfirmDialog
  bind:open={deleteOpen}
  title="Delete skill"
  description={`Delete this skill from ${draft.target.providerId}? Its SKILL.md directory is removed from disk.`}
  confirmLabel="Delete"
  busy={deleting}
  onConfirm={() => void handleDelete()}
/>
