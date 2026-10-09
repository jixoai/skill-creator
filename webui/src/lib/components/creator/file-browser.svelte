<!--
  用户原始需求 [2026-07-27]：「右侧『文件』子视图：SKILL.md 编辑器」。
  正交意图：
  1. edit 模式：调用 creator.load 拉取 SkillDocument 并 hydrate 草稿；草稿存共享 editor context（$state）。
  2. new 模式：目录名输入框 + 模板预填草稿；保存走 creatorStore.create（origin
     store 唯一根源 + auto-apply 收据如实呈现；成功后跳 store 编辑路由）。
  3. store 模式：creatorStore.load/save 的 store 文档编辑（revision 契约同币）。
  4. 保存：revision-safe（update=creator.save / store=creatorStore.save）；CONFLICT 提示 reload。
  视图状态：草稿 → 共享 creator-editor context（$state）；正文 → daemon RPC。
  2026-09-30 creator-editor-polish：正文编辑器升级 CodeMirror 6（markdown-editor
  懒加载组件）；new 模式校验改 validateNewDraft 字段级错误 + Save 禁用联动。
  2026-10-02 design-critique R2：工具栏危险操作隔离——Reload/Save 为常规组，
  Delete 经分隔线推到右端（confirm 链路与配色不动）。
  修订 [2026-10-04]（workspace-page-polish 2.2 处置批）：P1-3 pristine 红错延后
  （错误只在 touched/提交尝试后呈现；目录名规则文案降为常态 muted helper）；
  P2-10 加载态改 frontmatter 表单同构骨架（Delete 的 revision 闸门既有语义保持）。
  修订 [2026-10-09]（creator-skill-store 批 2）：new 保存接 creatorStore.create
  （auto-apply 结果 toast 含已应用位置，失败不吞）；store 编辑 load/save 走
  creatorStore.*；delete-origin 收口到 store 列面（本视图 edit 语义不变）。
-->
<script lang="ts">
  import { untrack } from "svelte";
  import {
    useCreatorEditor,
    draftToFrontmatter,
    creatorDraftKey,
    creatorStoreDraftKey,
    dropCachedCreatorDraft,
    isDraftHydrated,
    markDraftHydrated,
    resetDraftHydration,
  } from "$lib/stores/creator-editor.svelte";
  import { hasNewDraftErrors, validateNewDraft } from "$lib/stores/creator-draft";
  import MarkdownEditor from "$lib/components/creator/markdown-editor.svelte";
  import { useParams } from "$lib/shell";
  import {
    connectionState,
    createStoreSkill,
    loadSkillDoc,
    loadStoreSkillDoc,
    removeSkill,
    saveSkill,
    saveStoreSkill,
  } from "$lib/store.svelte";
  import { showToast } from "$lib/toast.svelte";
  import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
  import { goto } from "$app/navigation";
  import { createRequestGenerationGate } from "$lib/stores/request-generation";
  import { getConnectionGeneration } from "$lib/store.svelte";
  import { ORPCError } from "@orpc/client";
  import { t } from "$lib/i18n";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import IconLoader from "@lucide/svelte/icons/loader-circle";
  import IconSave from "@lucide/svelte/icons/save";
  import IconRotate from "@lucide/svelte/icons/rotate-cw";
  import IconTrash from "@lucide/svelte/icons/trash-2";
  import { SkillDirectoryNameSchema } from "$shared/contracts/creator.js";
  import type { WorkspaceId } from "$lib/types";

  const editor = useCreatorEditor();
  const draft = editor.draft;

  // create 成功后跳 store 编辑路由需要当前 ws 路由段（store 无 ws 归属，路由按
  // 当前上下文承载）。
  const getParams = useParams<{ wsId: WorkspaceId }>();
  const routeWsId = $derived(getParams?.()?.wsId);

  const loadRequests = createRequestGenerationGate(getConnectionGeneration);
  let loading = $state(false);
  let loadError = $state<string | null>(null);
  let saving = $state(false);

  // edit 模式：挂载或 skillId 变化时拉取文档并 hydrate 草稿。
  // 3.1c：同一身份只自动 hydrate 一次——子视图往返 / 断线重连 / island 重开（缓存
  // 草稿恢复）不重置 baseline；显式 Reload/Retry 走 resetDraftHydration 后重拉。
  $effect(() => {
    if (draft.mode === "edit" && draft.skillId !== null) {
      const key = creatorDraftKey(draft.target, "edit", draft.skillId);
      if (key !== null && isDraftHydrated(key)) return;
      void loadDocument(draft.target, draft.skillId);
      return;
    }
    if (draft.mode === "store") {
      const key = creatorStoreDraftKey(draft.directoryName);
      if (isDraftHydrated(key)) return;
      void loadStoreDocument(draft.directoryName);
    }
  });

  // 挂载竞态补救（走查 r6#2）：硬刷新时首轮 load 可能因 WS 未就绪失败（error
  // 态 + Test tab 门槛停留）；连接转 ready 即重发一次。cache 命中/已 hydrate
  // 的身份不在此路径（上方 effect 已短路，loadError 恒 null）。
  let lastConnectionStatus = $state(connectionState.status);
  $effect(() => {
    const status = connectionState.status;
    const was = untrack(() => lastConnectionStatus);
    lastConnectionStatus = status;
    if (was === "connected" || status !== "connected") return;
    const retryMode = untrack(() => draft.mode);
    if (untrack(() => loadError) === null) return;
    if (retryMode === "edit") {
      const retrySkillId = untrack(() => draft.skillId);
      if (retrySkillId === null) return;
      void loadDocument(
        untrack(() => draft.target),
        retrySkillId,
      );
    } else if (retryMode === "store") {
      void loadStoreDocument(untrack(() => draft.directoryName));
    }
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
      const key = creatorDraftKey(target, "edit", skillId);
      if (key !== null) markDraftHydrated(key);
    } catch (error) {
      if (!request.isCurrent()) return;
      loadError = error instanceof Error ? error.message : String(error);
    } finally {
      if (request.isLatest()) loading = false;
    }
  }

  // store 文档加载（creator-skill-store 批 2）：与 edit 同闸同骨架；缺席 = typed
  // NOT_FOUND 落 loadError 面。
  async function loadStoreDocument(directoryName: string): Promise<void> {
    const parsed = SkillDirectoryNameSchema.safeParse(directoryName);
    if (!parsed.success) return;
    const request = loadRequests.issue();
    loading = true;
    loadError = null;
    try {
      const document = await loadStoreSkillDoc(parsed.data);
      if (!request.isCurrent()) return;
      editor.hydrateFromStoreDocument(document);
      markDraftHydrated(creatorStoreDraftKey(parsed.data));
    } catch (error) {
      if (!request.isCurrent()) return;
      loadError = error instanceof Error ? error.message : String(error);
    } finally {
      if (request.isLatest()) loading = false;
    }
  }

  /** 重载当前已载文档（conflict 恢复 / 手动 Retry；null-safe 包装，edit|store 两态）。 */
  function reloadCurrent(): void {
    if (draft.mode === "edit" && draft.skillId) {
      const key = creatorDraftKey(draft.target, "edit", draft.skillId);
      if (key !== null) resetDraftHydration(key);
      void loadDocument(draft.target, draft.skillId);
    } else if (draft.mode === "store") {
      resetDraftHydration(creatorStoreDraftKey(draft.directoryName));
      void loadStoreDocument(draft.directoryName);
    }
  }

  // new 模式字段级校验（creator-editor-polish）；edit/store 模式恒通过。
  const newDraftErrors = $derived(validateNewDraft(draft));
  const directoryNameValid = $derived(
    draft.mode !== "new" || newDraftErrors.directoryName === null,
  );

  // pristine 红错延后（2.2 处置批 P1-3）：错误只在字段 touched（blur）或提交尝试
  // 后呈现——空表单开局不再三条 text-destructive。目录名规则文案常态 muted helper。
  let submittedAttempt = $state(false);
  const touched = $state({ directoryName: false, name: false, description: false });
  const showDirectoryError = $derived(
    draft.mode === "new" && (touched.directoryName || submittedAttempt) && !directoryNameValid,
  );
  const showNameError = $derived(
    draft.mode === "new" && (touched.name || submittedAttempt) && newDraftErrors.name !== null,
  );
  const showDescriptionError = $derived(
    draft.mode === "new" &&
      (touched.description || submittedAttempt) &&
      newDraftErrors.description !== null,
  );
  const canSave = $derived(
    !saving &&
      draft.name.trim().length > 0 &&
      draft.description.trim().length > 0 &&
      (draft.mode !== "new" || !hasNewDraftErrors(newDraftErrors)) &&
      // edit/store 保存需要已载 revision；new 恒无 revision。
      (draft.revision !== null) === (draft.mode !== "new"),
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
        showToast(t("creatorEditor.toastSaved"));
      } catch (error) {
        handleSaveError(error);
      } finally {
        saving = false;
      }
      return;
    }
    if (draft.mode === "store") {
      // store 编辑：revision-safe 保存（CONFLICT 呈现与 edit 同语义）。
      if (draft.revision === null) return;
      saving = true;
      try {
        const result = await saveStoreSkill({
          directoryName: SkillDirectoryNameSchema.parse(draft.directoryName),
          expectedRevision: draft.revision,
          frontmatter: draftToFrontmatter(draft),
          body: draft.body,
        });
        editor.advanceRevision(result.document.revision);
        showToast(t("creatorEditor.toastSaved"));
      } catch (error) {
        handleSaveError(error);
      } finally {
        saving = false;
      }
      return;
    }
    // new 模式（store 直建）：创建即 auto-apply（默认 ~/.agents/skills
    // entity-local）——收据如实呈现，失败不吞；成功后跳 store 编辑路由。
    submittedAttempt = true;
    const parsed = SkillDirectoryNameSchema.safeParse(draft.directoryName);
    if (!parsed.success) {
      showToast(t("creatorEditor.toastDirectoryRule"));
      return;
    }
    saving = true;
    try {
      const result = await createStoreSkill({
        directoryName: parsed.data,
        frontmatter: draftToFrontmatter(draft),
        body: draft.body,
      });
      const appliedEntry = result.autoApply.results.find((entry) => entry.status !== "failed");
      const failedEntry = result.autoApply.results.find((entry) => entry.status === "failed");
      if (failedEntry !== undefined) {
        // typed 呈现不吞：auto-apply 失败逐条可见（收据 error 为 daemon 有限词表）。
        showToast(t("creatorEditor.toastCreateApplyFailed", { error: failedEntry.error ?? "" }));
      } else if (appliedEntry !== undefined) {
        showToast(t("creatorEditor.toastCreatedApplied", { root: appliedEntry.root }));
      } else {
        showToast(t("creatorEditor.toastCreated"));
      }
      if (routeWsId !== undefined) {
        await goto(
          `/w/${encodeURIComponent(routeWsId)}/creator/store/${encodeURIComponent(parsed.data)}`,
        );
      }
    } catch (error) {
      handleSaveError(error);
    } finally {
      saving = false;
    }
  }

  function handleSaveError(error: unknown): void {
    if (error instanceof ORPCError && error.code === "CONFLICT") {
      if (draft.mode === "new") {
        // create 的 CONFLICT = 目录已存在（WS4 走查：不得误报 changed elsewhere）。
        showToast(t("creatorEditor.toastDirectoryExists"));
        return;
      }
      showToast(t("creatorEditor.toastChangedView"), {
        label: t("creatorEditor.reload"),
        run: reloadCurrent,
      });
      return;
    }
    showToast(error instanceof Error ? error.message : String(error));
  }

  // ---- 删除（edit 模式；revision-safe + confirm + busy 锁） ----
  // store 技能的删除根源（delete-origin）在 store 列面（确认闸列出剩余应用面），
  // 本视图不承载。
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
      showToast(t("creatorEditor.toastDeleted"));
      // 身份已消亡：清掉跨卸载缓存与 hydration 标记，防止重开残留死草稿。
      const deletedKey = creatorDraftKey(draft.target, "edit", skillId);
      if (deletedKey !== null) {
        dropCachedCreatorDraft(deletedKey);
        resetDraftHydration(deletedKey);
      }
      await goto("/creator");
    } catch (error) {
      if (error instanceof ORPCError && error.code === "CONFLICT") {
        deleteOpen = false;
        showToast(t("creatorEditor.toastChangedDelete"), {
          label: t("creatorEditor.reload"),
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
  <div class="flex shrink-0 items-center border-b border-border px-4 py-2">
    <span class="text-xs font-medium">
      {draft.mode === "new" ? t("creatorEditor.newFileTitle") : t("creatorEditor.fileTitle")}
    </span>
    <div class="ml-auto flex items-center gap-1.5">
      {#if (draft.mode === "edit" && draft.skillId) || draft.mode === "store"}
        <Button
          variant="outline"
          size="sm"
          class="h-7 gap-1.5"
          onclick={reloadCurrent}
          disabled={loading}
        >
          <IconRotate class="h-3.5 w-3.5" />
          {t("creatorEditor.reload")}
        </Button>
      {/if}
      <Button size="sm" class="h-7 gap-1.5" onclick={handleSave} disabled={!canSave}>
        {#if saving}<IconLoader class="h-3.5 w-3.5 animate-spin" />{:else}<IconSave
            class="h-3.5 w-3.5"
          />{/if}
        {draft.mode === "new" ? t("creatorEditor.create") : t("creatorEditor.save")}
      </Button>
      {#if draft.mode === "edit"}
        <!-- R2 #3：危险操作隔离——分隔线后右置 Delete（confirm 链路不动）。 -->
        <span class="mx-0.5 h-4 w-px shrink-0 bg-border" aria-hidden="true"></span>
        <Button
          variant="ghost"
          size="sm"
          class="h-7 gap-1.5 px-2 text-destructive hover:text-destructive"
          title={t("creatorEditor.deleteTitle")}
          disabled={!canDelete || deleting}
          onclick={() => (deleteOpen = true)}
        >
          <IconTrash class="h-3.5 w-3.5" />
          <span class="hidden sm:inline">{t("creatorEditor.delete")}</span>
        </Button>
      {/if}
    </div>
  </div>

  {#if loading}
    <!-- 加载骨架（2.2 处置批 P2-10）：frontmatter 表单同构骨架（label 条 + 输入条
         ×3 + 正文大块）——结构预留给眼睛定位，替代裸 Loading 文本。 -->
    <div class="min-h-0 flex-1 space-y-4 p-4" role="status" aria-busy="true">
      <div class="space-y-1.5">
        <div class="h-3 w-24 animate-pulse rounded bg-muted/60"></div>
        <div class="h-8 w-full animate-pulse rounded-md bg-muted/60"></div>
      </div>
      <div class="space-y-1.5">
        <div class="h-3 w-16 animate-pulse rounded bg-muted/60"></div>
        <div class="h-8 w-full animate-pulse rounded-md bg-muted/60"></div>
      </div>
      <div class="space-y-1.5">
        <div class="h-3 w-20 animate-pulse rounded bg-muted/60"></div>
        <div class="h-16 w-full animate-pulse rounded-md bg-muted/60"></div>
      </div>
      <div class="flex min-h-48 flex-1 flex-col gap-1.5">
        <div class="h-3 w-28 animate-pulse rounded bg-muted/60"></div>
        <div class="h-full min-h-36 w-full animate-pulse rounded-md bg-muted/60"></div>
      </div>
    </div>
  {:else if loadError}
    <div class="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
      <p class="text-xs text-destructive">{loadError}</p>
      {#if (draft.mode === "edit" && draft.skillId) || draft.mode === "store"}
        <Button variant="outline" size="sm" onclick={reloadCurrent}>
          {t("common.retry")}
        </Button>
      {/if}
    </div>
  {:else}
    <!-- 编辑器主导版面（design-critique R1 Gap 9）：容器改 flex-col——Body 标签
         的 flex-1 才真正吃到剩余高度（原 block 容器里 flex-1 断链，编辑器
         ~300px 即止）；内容超出时整栏滚动（Body 有 min-h 兜底，小屏仍可用）。 -->
    <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      {#if draft.mode === "new"}
        <label class="block space-y-1">
          <span class="text-[11px] font-medium text-muted-foreground">
            {t("creatorEditor.directoryName")}
          </span>
          <Input
            bind:value={draft.directoryName}
            onblur={() => (touched.directoryName = true)}
            class="h-8 font-mono text-xs"
            placeholder={t("creatorEditor.directoryPlaceholder")}
          />
          {#if showDirectoryError}
            <span class="text-[11px] text-destructive" data-testid="directory-name-error">
              {t(newDraftErrors.directoryName ?? "creatorEditor.directoryRule")}
            </span>
          {:else}
            <!-- 规则 helper 常态 muted（P1-3）：pristine 期只提示规则，不红错。 -->
            <span class="text-[11px] text-muted-foreground" data-testid="directory-name-helper">
              {t("creatorEditor.directoryRule")}
            </span>
          {/if}
        </label>
      {/if}

      <label class="block space-y-1">
        <span class="text-[11px] font-medium text-muted-foreground">{t("creatorEditor.name")}</span>
        <Input
          bind:value={draft.name}
          onblur={() => (touched.name = true)}
          class="h-8 text-sm"
          placeholder={t("creatorEditor.namePlaceholder")}
        />
        {#if showNameError}
          <span class="text-[11px] text-destructive">
            {newDraftErrors.name ? t(newDraftErrors.name) : ""}
          </span>
        {/if}
      </label>

      <label class="block space-y-1">
        <span class="text-[11px] font-medium text-muted-foreground">
          {t("creatorEditor.description")}
        </span>
        <textarea
          bind:value={draft.description}
          onblur={() => (touched.description = true)}
          rows="2"
          class="w-full resize-y rounded-md border border-input bg-input/20 px-2 py-1 text-xs leading-5 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          placeholder={t("creatorEditor.descriptionPlaceholder")}></textarea>
        {#if showDescriptionError}
          <span class="text-[11px] text-destructive">
            {newDraftErrors.description ? t(newDraftErrors.description) : ""}
          </span>
        {/if}
      </label>

      <label class="flex min-h-64 flex-1 flex-col gap-1">
        <span class="text-[11px] font-medium text-muted-foreground">
          {t("creatorEditor.body")}
        </span>
        <MarkdownEditor bind:value={draft.body} placeholder={t("creatorEditor.bodyPlaceholder")} />
      </label>
    </div>
  {/if}
</div>

<ConfirmDialog
  bind:open={deleteOpen}
  title={t("creatorEditor.deleteConfirmTitle")}
  description={t("creatorEditor.deleteConfirmBody", { provider: draft.target.providerId })}
  confirmLabel={t("creatorEditor.delete")}
  busy={deleting}
  onConfirm={() => void handleDelete()}
/>
