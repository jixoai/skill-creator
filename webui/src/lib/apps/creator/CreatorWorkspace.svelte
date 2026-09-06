<!--
  用户原始需求 [2026-07-27]：「Creator 编辑 tab 左右分栏，左侧 ACP 对话，右侧子视图」。
  正交意图：
  1. 左右分栏布局（左 40% ACP 对话 / 右 60% 子视图），可拖拽分隔条。
  2. 窄屏堆叠 + 顶部 toggle（对话/子视图）。
  3. 子视图通过 sub-view-tabs 组件切换，激活子视图编码到 URL search param。
  4. 通过 Svelte context 下发共享编辑草稿（File 写入 / Preview / Log / Validate 读取）。
  视图状态：分栏比例 → 组件局部 $state（瞬时 UI）；子视图 → URL；草稿 → 共享 creator-editor context（$state），
  同一身份的草稿在卸载时快照进模块级缓存（island 关闭→重开 / 与官方 session 往返不丢 dirty draft）。
-->
<script lang="ts">
  import { useParams, useSearch } from "$lib/shell";
  import SubViewTabs from "$lib/components/creator/sub-view-tabs.svelte";
  import AcpPanel from "$lib/components/creator/acp-panel.svelte";
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

  // 分栏比例（组件局部 $state，瞬时 UI）。
  let splitRatio = $state(0.4);
  let dragging = $state(false);

  // 窄屏 toggle（对话/子视图）。
  let narrowPanel = $state<"chat" | "view">("chat");

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

  function startDrag(e: MouseEvent): void {
    e.preventDefault();
    dragging = true;
    const container = (e.currentTarget as HTMLElement).parentElement!;
    const onMove = (ev: MouseEvent): void => {
      if (!dragging) return;
      const rect = container.getBoundingClientRect();
      splitRatio = Math.max(0.2, Math.min(0.7, (ev.clientX - rect.left) / rect.width));
    };
    const onUp = (): void => {
      dragging = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }
</script>

<div class="flex h-full flex-col overflow-hidden">
  <!-- 标题栏 -->
  <header class="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
    <span class="text-sm font-medium">
      {mode === "new" ? "New skill" : skillId ? `Edit: ${skillId.slice(0, 12)}…` : "Editor"}
    </span>
    <span class="text-xs text-muted-foreground">{wsId} / {providerId}</span>
  </header>

  <!-- 窄屏 toggle（≤1024px） -->
  <div class="flex shrink-0 border-b border-border lg:hidden">
    <button
      class="flex-1 py-2 text-xs font-medium {narrowPanel === 'chat'
        ? 'bg-muted text-foreground'
        : 'text-muted-foreground'}"
      onclick={() => (narrowPanel = "chat")}
    >
      AI Chat
    </button>
    <button
      class="flex-1 py-2 text-xs font-medium {narrowPanel === 'view'
        ? 'bg-muted text-foreground'
        : 'text-muted-foreground'}"
      onclick={() => (narrowPanel = "view")}
    >
      Views
    </button>
  </div>

  <!-- 主体：桌面左右分栏 / 窄屏单面板 -->
  <div class="flex min-h-0 flex-1">
    <!-- 左侧：ACP 对话面板（桌面 40%） -->
    <div class="hidden flex-col border-r border-border lg:flex" style="width: {splitRatio * 100}%">
      {#if target}
        <AcpPanel {target} />
      {:else}
        <div
          class="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground"
        >
          Invalid workspace target.
        </div>
      {/if}
    </div>

    <!-- 拖拽分隔条（桌面） -->
    <button
      type="button"
      class="hidden w-1 shrink-0 cursor-col-resize border-0 bg-border p-0 transition-colors hover:bg-primary/30 lg:block"
      aria-label="Resize panels"
      onmousedown={startDrag}
    ></button>

    <!-- 右侧：子视图区（桌面 60%） -->
    <div class="flex min-w-0 flex-1 flex-col" class:hidden={narrowPanel === "chat"}>
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
              <p>A secondary ACP session to exercise this skill lands here.</p>
              <p class="text-muted-foreground/60">(Not yet implemented.)</p>
            </div>
          </div>
        {:else}
          <FileBrowser />
        {/if}
      </div>
    </div>
  </div>
</div>
