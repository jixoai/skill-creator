<!--
  用户原始需求 [2026-07-27]：「Creator 编辑 tab 左右分栏，左侧 ACP 对话，右侧子视图」
  → [2026-09-07]（openspec dsh-webui-composition 3.2）：移除 generic ACP 对话面板，
  Agent 会话由 DSH host 唯一承载；Creator 回归单列编辑器。
  正交意图：
  1. 单列编辑器布局（子视图区占满），子视图通过 sub-view-tabs 切换，激活子视图编码到 URL search param。
  2. 通过 Svelte context 下发共享编辑草稿（File 写入 / Preview / Log / Validate 读取）。
  视图状态：子视图 → URL；草稿 → 共享 creator-editor context（$state），
  同一身份的草稿在卸载时快照进模块级缓存（island 关闭→重开 / 与官方 session 往返不丢 dirty draft）。
-->
<script lang="ts">
  import { useParams, useSearch } from "$lib/shell";
  import SubViewTabs from "$lib/components/creator/sub-view-tabs.svelte";
  import FileBrowser from "$lib/components/creator/file-browser.svelte";
  import ChangeLog from "$lib/components/creator/change-log.svelte";
  import PreviewView from "$lib/components/creator/preview.svelte";
  import ValidationView from "$lib/components/creator/validation-view.svelte";
  import {
    provideCreatorEditor,
    placeholderDraft,
    editDraft,
    emptyDraft,
    cacheCreatorDraft,
    creatorDraftKey,
    markDraftHydrated,
    takeCachedCreatorDraft,
    type CreatorDraft,
  } from "$lib/stores/creator-editor.svelte";
  import { TEMPLATES } from "$lib/templates";
  import type { WorkspaceProviderTarget } from "$lib/types";
  import type { SkillId } from "$lib/types";

  // 路由参数（来自 URL pathname；manifest 的 zod schema 已把它们解析为 branded 类型）。
  const getParams = useParams<{
    mode: "edit" | "new";
    wsId: WorkspaceProviderTarget["workspaceId"];
    providerId: WorkspaceProviderTarget["providerId"];
    skillId?: SkillId;
  }>();
  const params = $derived(getParams?.());
  const mode = $derived(params?.mode);
  const wsId = $derived(params?.wsId);
  const providerId = $derived(params?.providerId);
  const skillId = $derived(params?.skillId);

  // 子视图（来自 URL search）。
  const getSearch = useSearch<{ subview?: string; template?: string }>();
  const search = $derived(getSearch?.() ?? {});
  const subview = $derived(search.subview ?? "file");

  // 由 URL params 派生的 Workspace Provider 目标。
  const target = $derived.by<WorkspaceProviderTarget | null>(() => {
    if (!wsId || !providerId) return null;
    return { workspaceId: wsId, providerId };
  });

  // 构造初始草稿。edit 模式：空占位（File 子视图挂载时 loadSkillDoc 后 hydrate）；
  // new 模式：可选模板预填。无 target（非法 URL）时退化为占位草稿。
  const initialDraft = $derived.by<CreatorDraft>(() => {
    if (!target) return placeholderDraft();
    if (mode === "edit" && skillId) return editDraft(target, skillId);
    const template = search.template ? TEMPLATES.find((t) => t.id === search.template) : undefined;
    const draft = emptyDraft(target, template ? template.name : "");
    if (template) {
      draft.name = template.name;
      draft.description = template.description;
      draft.body = template.body;
    }
    return draft;
  });

  // 下发共享编辑草稿 context（占位种子；真实初值由下方 $effect 同步进去）。
  const editor = provideCreatorEditor(placeholderDraft());

  // 3.1c：草稿身份键（同一身份的跨卸载缓存归属）。
  const draftKey = $derived(
    creatorDraftKey(target, mode === "edit" ? "edit" : "new", skillId ?? null),
  );

  // target/mode/skillId 变化时（含首次挂载）把派生草稿同步进共享 context。
  // 同一身份存在跨卸载缓存（island 关闭→重开）时优先恢复缓存草稿，并标记该身份
  // 已 hydrate——缓存草稿不比服务器旧，FileBrowser 不再自动重拉重置 baseline。
  $effect(() => {
    const key = draftKey;
    const next = initialDraft;
    const restored = key === null ? null : takeCachedCreatorDraft(key);
    const source: CreatorDraft = restored ?? next;
    editor.draft.mode = source.mode;
    editor.draft.target = source.target;
    editor.draft.skillId = source.skillId;
    editor.draft.name = source.name;
    editor.draft.description = source.description;
    editor.draft.body = source.body;
    editor.draft.revision = source.revision;
    editor.draft.extraFrontmatter = source.extraFrontmatter;
    editor.draft.directoryName = source.directoryName;
    if (restored !== null && key !== null) {
      markDraftHydrated(key);
    }
  });

  // 3.1c：卸载快照——tab 关闭 / island 关闭（与官方 session 往返）时保留当前草稿。
  // 键取自草稿自身身份（new 保存成功后草稿已切 edit 语义，不能落在 URL 的 new 键下）；
  // 占位 target 不缓存。同一 realm 内重开同一路由即恢复（显式新建/删除按原语义清缓存）。
  $effect(() => {
    return () => {
      const snapshot = editor.draft;
      if (snapshot.target.workspaceId === "~") return;
      const key = creatorDraftKey(snapshot.target, snapshot.mode, snapshot.skillId);
      if (key !== null) {
        cacheCreatorDraft(key, snapshot);
      }
    };
  });
</script>

<div class="flex h-full flex-col overflow-hidden">
  <!-- 标题栏 -->
  <header class="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
    <span class="text-sm font-medium">
      {mode === "new" ? "New skill" : skillId ? `Edit: ${skillId.slice(0, 12)}…` : "Editor"}
    </span>
    <span class="text-xs text-muted-foreground">{wsId} / {providerId}</span>
  </header>

  <!-- 主体：单列子视图区（3.2：generic ACP 对话面板移除，Agent 会话归 DSH host） -->
  <div class="flex min-h-0 flex-1 flex-col">
    {#if !target}
      <div
        class="flex flex-1 items-center justify-center p-4 text-center text-xs text-muted-foreground"
      >
        Invalid workspace target.
      </div>
    {:else}
      <SubViewTabs />

      <div class="min-h-0 flex-1 overflow-hidden">
        {#if subview === "file"}
          <FileBrowser />
        {:else if subview === "log"}
          <ChangeLog />
        {:else if subview === "preview"}
          <PreviewView />
        {:else if subview === "validate"}
          <ValidationView />
        {:else if subview === "test"}
          <div
            class="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground"
          >
            <div class="space-y-1">
              <p class="font-medium text-foreground">Test run</p>
              <p>Exercising this skill inside the DSH-hosted agent session lands here.</p>
              <p class="text-muted-foreground/60">(Not yet implemented.)</p>
            </div>
          </div>
        {:else}
          <FileBrowser />
        {/if}
      </div>
    {/if}
  </div>
</div>
