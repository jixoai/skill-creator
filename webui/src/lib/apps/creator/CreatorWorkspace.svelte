<!--
  用户原始需求 [2026-07-27]：「Creator 编辑 tab 左右分栏，左侧 ACP 对话，右侧子视图」
  → [2026-09-07]（openspec dsh-webui-composition 3.2）：移除 generic ACP 对话面板，
  Agent 会话由 DSH host 唯一承载；Creator 回归单列编辑器。
  修订 [2026-10-02]（design-critique R1 Gap 1）：页头主标题 = 技能名（draft.name）。
  修订 [2026-10-04]（workspace-page-polish vision P1-4）：面包屑全 label 化——
  workspace label / provider label（workspaceState 投影）/ 技能名（草稿同源）；
  ws_/sk_ opaque id 不再进页头（只留 omnibox URL），复制 id 入口随 id 一并退役。
  修订 [2026-10-03]（evaluating-dashboard 1.4）：test/eval 子视图退役（评估迁独立
  Evaluating 区块）；编辑页保留「View evaluation」深链（三段路由同三元组）。
  修订 [2026-10-09]（creator-skill-store 批 2）：三路由形态——edit（provider
  scoped，零变化）/ new（store 直建，无 provider 身份）/ store（store 编辑，身份 =
  directoryName，load/save 走 creatorStore.*）。
  正交意图：
  1. 单列编辑器布局（子视图区占满），子视图通过 sub-view-tabs 切换，激活子视图编码到 URL search param。
  2. 通过 Svelte context 下发共享编辑草稿（File 写入 / Preview / Log / Validate 读取）。
  视图状态：子视图 → URL；草稿 → 共享 creator-editor context（$state），
  同一身份的草稿在卸载时快照进模块级缓存（island 关闭→重开 / 与官方 session 往返不丢 dirty draft）。
-->
<script lang="ts">
  import { useParams, useSearch, goById } from "$lib/shell";
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
    storeDraft,
    cacheCreatorDraft,
    draftCacheKey,
    isDraftHydrated,
    markDraftHydrated,
    takeCachedCreatorDraft,
    creatorDraftKey,
    creatorStoreDraftKey,
    type CreatorDraft,
  } from "$lib/stores/creator-editor.svelte";
  import { connectionState, loadSkillDoc, loadStoreSkillDoc } from "$lib/store.svelte";
  import { workspaceState } from "$lib/stores/workspaces.svelte";
  import { t } from "$lib/i18n";
  import { TEMPLATES } from "$lib/templates";
  import { SkillDirectoryNameSchema } from "$shared/contracts/creator.js";
  import type { SkillId, WorkspaceId, WorkspaceProviderTarget } from "$lib/types";

  // 路由参数（来自 URL pathname；manifest 的 zod schema 已做渲染前收窄）。
  // 三形态按参数存在性判别：edit 携 mode=edit+providerId（+skillId）；
  // new 仅 wsId；store 携 directoryName（store 身份，无 provider）。
  const getParams = useParams<{
    mode?: "edit";
    wsId: WorkspaceId;
    providerId?: WorkspaceProviderTarget["providerId"];
    skillId?: SkillId;
    directoryName?: string;
  }>();
  const params = $derived(getParams?.());
  const wsId = $derived(params?.wsId);
  const providerId = $derived(params?.providerId);
  const skillId = $derived(params?.skillId);
  const storeDirectoryName = $derived.by(() => {
    const raw = params?.directoryName;
    if (raw === undefined) return null;
    const parsed = SkillDirectoryNameSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  });

  // 子视图（来自 URL search）。
  const getSearch = useSearch<{ subview?: string; template?: string }>();
  const search = $derived(getSearch?.() ?? {});
  const subview = $derived(search.subview ?? "file");

  // 草稿形态：store（store 编辑）| new（store 直建）| edit（provider scoped）。
  const draftMode = $derived.by<"store" | "new" | "edit" | null>(() => {
    if (storeDirectoryName !== null) return "store";
    if (params?.mode === "edit" && providerId !== undefined) return "edit";
    if (params?.mode === undefined && providerId === undefined) return "new";
    return null;
  });

  // edit 形态的 Workspace Provider 目标（new/store 无 provider 身份）。
  const target = $derived.by<WorkspaceProviderTarget | null>(() => {
    if (draftMode !== "edit" || !wsId || !providerId) return null;
    return { workspaceId: wsId, providerId };
  });

  // 构造初始草稿。edit：空占位（File 子视图挂载时 loadSkillDoc 后 hydrate）；
  // new：可选模板预填（store 直建，无 provider 身份）；store：directoryName 身份
  // 占位（loadStoreSkillDoc 后 hydrate）。非法形态退化为占位草稿。
  const initialDraft = $derived.by<CreatorDraft>(() => {
    if (draftMode === "store" && storeDirectoryName !== null) {
      return storeDraft(storeDirectoryName);
    }
    if (draftMode === "new") {
      const template = search.template
        ? TEMPLATES.find((t) => t.id === search.template)
        : undefined;
      const draft = emptyDraft(null, template ? template.name : "");
      if (template) {
        draft.name = template.name;
        draft.description = template.description;
        draft.body = template.body;
      }
      return draft;
    }
    if (draftMode === "edit" && target && skillId) return editDraft(target, skillId);
    return placeholderDraft();
  });

  // 下发共享编辑草稿 context（占位种子；真实初值由下方 $effect 同步进去）。
  const editor = provideCreatorEditor(placeholderDraft());

  // 3.1c：草稿身份键（同一身份的跨卸载缓存归属）——edit=provider 身份；
  // new=全局新草稿槽（store 无 ws 归属）；store=directoryName 身份。
  const draftKey = $derived(draftCacheKey(initialDraft));

  // 路由形态/身份变化时（含首次挂载）把派生草稿同步进共享 context。
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

  // WS4 r7 minor：深链非 file 子视图（如 ?subview=log 直开）时 FileBrowser 未
  // 挂载，文档加载无人执行——Test 门槛（revision）永久停留。由路由属主兜底
  // 加载；file 子视图仍由 FileBrowser 负责，isDraftHydrated 双闸幂等。
  // WS5 走查 B（阻塞根因链）：连接闸——未连接时不发（requireRpc 同步 throw 会
  // 从本 effect 逃逸，打断挂载 flush 把整个分支 discard 成僵尸 DOM）；status 是
  // 本 effect 的依赖，连接转 ready 自动重跑补载，断线窗口内的深链不再永久缺文档。
  $effect(() => {
    if (subview === "file") return;
    if (connectionState.status !== "connected") return;
    if (draftMode === "edit") {
      if (skillId === undefined || target === null) return;
      const key = creatorDraftKey(target, "edit", skillId);
      if (key !== null && isDraftHydrated(key)) return;
      void loadSkillDoc(target, skillId)
        .then((document) => {
          editor.hydrateFromDocument(document);
          if (key !== null) markDraftHydrated(key);
        })
        .catch(() => {
          // 兜底加载静默失败：错误面由 File 子视图的 loadError 承担。
        });
      return;
    }
    if (draftMode === "store" && storeDirectoryName !== null) {
      const key = creatorStoreDraftKey(storeDirectoryName);
      if (isDraftHydrated(key)) return;
      void loadStoreSkillDoc(storeDirectoryName)
        .then((document) => {
          editor.hydrateFromStoreDocument(document);
          markDraftHydrated(key);
        })
        .catch(() => {
          // 兜底加载静默失败：错误面由 File 子视图的 loadError 承担。
        });
    }
  });

  // 3.1c：卸载快照——tab 关闭 / island 关闭（与官方 session 往返）时保留当前草稿。
  // 键取自草稿自身身份（new 保存成功后草稿已切 store 身份，不能落在 URL 的 new 键下）；
  // 占位 target 的 edit 草稿不缓存（draftCacheKey 返回 null）。同一 realm 内重开
  // 同一路由即恢复（显式新建/删除按原语义清缓存）。
  $effect(() => {
    return () => {
      const snapshot = editor.draft;
      const key = draftCacheKey(snapshot);
      if (key !== null) {
        cacheCreatorDraft(key, snapshot);
      }
    };
  });

  // 页头主标题（R1 Gap 1）：技能名优先（人语汇），空名回退 "Skill"。
  const headerTitle = $derived.by(() => {
    if (draftMode === "new") return t("creatorEditor.newSkillTitle");
    const name = editor.draft.name.trim();
    return name.length > 0 ? name : t("creatorEditor.untitledSkill");
  });

  // P1-4：面包屑 label 段。edit：workspace label / provider label / 技能名；
  // store：store 列面 label / 技能名；new：无。label 来自 workspaceState 投影——
  // 未加载或未知段直接缺省（不回退 opaque id），投影到位后响应式回填。
  const breadcrumb = $derived.by<string[]>(() => {
    if (draftMode === "store") {
      const parts = [t("creatorStore.title")];
      const name = editor.draft.name.trim();
      if (name.length > 0) parts.push(name);
      return parts;
    }
    if (draftMode !== "edit" || !wsId || !providerId) return [];
    const parts: string[] = [];
    const workspace = workspaceState.workspaces.find((item) => item.id === wsId);
    if (workspace) {
      parts.push(workspace.label);
      const provider = workspace.providers.find((item) => item.id === providerId);
      if (provider) parts.push(provider.label);
    }
    if (skillId !== undefined) {
      const name = editor.draft.name.trim();
      if (name.length > 0) parts.push(name);
    }
    return parts;
  });

  // 合法形态判定：edit 需要 target+skillId；new/store 只需各自身份到位。
  const validRoute = $derived(
    draftMode !== null && (draftMode !== "edit" || (target !== null && skillId !== undefined)),
  );
</script>

<div class="flex h-full flex-col overflow-hidden">
  <!-- 标题栏：主标题 = 技能名；次要行 = 全 label 面包屑（P1-4，无 opaque id）。 -->
  <header class="flex shrink-0 flex-col gap-0.5 border-b border-border px-4 py-2">
    <div class="flex items-center justify-between gap-2">
      <span class="truncate text-sm font-medium">{headerTitle}</span>
      {#if draftMode === "edit" && skillId && target}
        <!-- evaluating-dashboard 1.4：test/eval 子视图退役——「查看评估」深链到
             Evaluating 详情（三段路由，同三元组）。 -->
        <button
          type="button"
          class="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          title={t("creatorEditor.viewEvaluationTitle")}
          onclick={() =>
            goById("evaluating.detail", {
              wsId: target.workspaceId,
              providerId: target.providerId,
              skillId,
            })}
        >
          {t("creatorEditor.viewEvaluation")}
        </button>
      {/if}
    </div>
    {#if breadcrumb.length > 0}
      <!-- P1-4：全 label 面包屑——opaque id 只留 omnibox URL。 -->
      <nav
        class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground"
        aria-label={t("creatorEditor.breadcrumbAria")}
      >
        {#each breadcrumb as part, index (index)}
          {#if index > 0}
            <span aria-hidden="true" class="text-border">/</span>
          {/if}
          <span class="max-w-40 truncate" title={part}>{part}</span>
        {/each}
      </nav>
    {/if}
  </header>

  <!-- 主体：单列子视图区（3.2：generic ACP 对话面板移除，Agent 会话归 DSH host） -->
  <div class="flex min-h-0 flex-1 flex-col">
    {#if !validRoute}
      <div
        class="flex flex-1 items-center justify-center p-4 text-center text-xs text-muted-foreground"
      >
        {t("creatorEditor.invalidTarget")}
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
        {:else}
          <FileBrowser />
        {/if}
      </div>
    {/if}
  </div>
</div>
