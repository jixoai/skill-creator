<!--
  用户原始需求 [2026-10-06]（skills-tabs-redesign 批 2，design.md Δ3 定稿）：
  「SkillDetail 独立路由 /w/:wsId/skills/:providerId/:skillId——detail 永远绑定
  具体 provider copy，copies 是展示关系不承担权限/定位；非法身份 typed
  not-found，禁止 fallback 掩盖；?from= 回传列表态，返回完整还原」。
  正交意图：
  1. 路由身份：manifest 三 schema load-time 收窄（非法身份 hygiene 渲染前
     redirect）；本页对 leafParams 再做一次同 schema 收窄（AppShell 传 raw
     params，schema 真相唯一在 shared contracts）——收窄失败渲染 typed
     not-found（防御面，不 fallback 掩盖）。
  2. 数据面：页面拥有 skills.info 加载（typed NOT_FOUND → 页级 not-found），
     SkillDetailPanel 以外部持有模式消费（info + onRefresh）；副本组差异经
     skills.listCanonical(q=name) 精确匹配组（跨 provider 的 disabled/描述
     差异/conflict 标记）；内容查看器（批 3 Δ2）= skill-detail-editor
     （skills.files 树 + skills.fileRead 有界读；?from= 的 file 键深链）。
  3. 回程：显式返回 = parse ?from= → 状态对象经 goById 重组 route（不拼 href）
     + handoff stash（scroll/sel/p）；浏览器原生 back 并存（列表 URL 自带
     筛选语义，滚动/焦点归 handoff）。
  4. 布局：简化版两栏容器（左信息/动作 = SkillDetailPanel，右 = 副本组差异 +
     CodeEditor 查看器）；<692px 单列堆叠（与 dashboard 单列降档同阈值）。
-->
<script lang="ts">
  import { useParams, useSearch, goById } from "$lib/shell";
  import { untrack } from "svelte";
  import { ORPCError } from "@orpc/client";
  import { connectionState, getConnectionGeneration, requireRpc } from "$lib/store.svelte";
  import { fetchSkillInfo } from "$lib/store.svelte";
  import { workspaceState } from "$lib/store.svelte";
  import SkillDetailPanel from "$lib/components/skills/skill-detail-panel.svelte";
  import SkillDetailEditor from "./skill-detail-editor.svelte";
  import {
    listStateToDashboardSearch,
    parseListStateParam,
    stashSkillsListRestore,
  } from "./skill-detail-route.js";
  import { t } from "$lib/i18n";
  import {
    ProviderIdSchema,
    WorkspaceIdSchema,
    type WorkspaceId,
    type WorkspaceProviderTarget,
  } from "$shared/contracts/workspaces.js";
  import { SkillIdSchema, type SkillId, type SkillInfo } from "$shared/contracts/skills.js";
  import type { SkillsCanonicalGroup } from "$shared/rpc-contract.js";
  import { createRequestGenerationGate } from "$lib/stores/request-generation";
  import IconChevronLeft from "@lucide/svelte/icons/chevron-left";
  import IconLayers from "@lucide/svelte/icons/layers";
  import IconLoader from "@lucide/svelte/icons/loader-circle";
  import IconSearchX from "@lucide/svelte/icons/search-x";

  const getParams = useParams<{
    wsId?: string;
    providerId?: string;
    skillId?: string;
  }>();
  const getSearch = useSearch<{ from?: string }>();

  /** load-time 三 schema 收窄（Δ3；AppShell 传 raw params，这里以同一 schema 真相收窄）。 */
  const identity = $derived.by(() => {
    const params = getParams?.() ?? {};
    const wsId = WorkspaceIdSchema.safeParse(params.wsId);
    const providerId = ProviderIdSchema.safeParse(params.providerId);
    const skillId = SkillIdSchema.safeParse(params.skillId);
    if (!wsId.success || !providerId.success || !skillId.success) return null;
    return {
      wsId: wsId.data as WorkspaceId,
      target: {
        workspaceId: wsId.data as WorkspaceId,
        providerId: providerId.data,
      } satisfies WorkspaceProviderTarget,
      skillId: skillId.data as SkillId,
    };
  });

  // ---- 数据面：skills.info（页面拥有；typed NOT_FOUND = 页级 not-found） ----

  type DetailIdentity = {
    wsId: WorkspaceId;
    target: WorkspaceProviderTarget;
    skillId: SkillId;
  };

  const infoRequests = createRequestGenerationGate(getConnectionGeneration);
  let info = $state<SkillInfo | null>(null);
  let infoLoading = $state(false);
  let notFound = $state(false);
  let infoError = $state<string | null>(null);

  async function loadInfo(current: DetailIdentity): Promise<void> {
    const request = infoRequests.issue();
    infoLoading = true;
    notFound = false;
    infoError = null;
    try {
      const loaded = await fetchSkillInfo(current.target, current.skillId);
      if (!request.isCurrent()) return;
      info = loaded;
    } catch (error) {
      if (!request.isCurrent()) return;
      info = null;
      if (error instanceof ORPCError && error.code === "NOT_FOUND") {
        notFound = true;
      } else {
        infoError = error instanceof Error ? error.message : String(error);
      }
    } finally {
      if (request.isLatest()) infoLoading = false;
    }
  }

  const thisIdentity = $derived(identity);

  $effect(() => {
    const current = thisIdentity;
    if (!current) return;
    void loadInfo(current);
  });

  // 重连自愈（FD-14 同族；skills-screen 同样板）：冷载深链时 info RPC 可能先于
  // WS 就绪抢跑失败（requireRpc 同步 throw = 通用错误，非 typed NOT_FOUND），
  // connection owner generation 只作废旧响应、不重发失败首载——转 connected 且
  // 错误态无数据时这里是唯一重发器。
  let lastConnectionStatus = $state(connectionState.status);
  $effect(() => {
    const status = connectionState.status;
    const was = untrack(() => lastConnectionStatus);
    lastConnectionStatus = status;
    if (was === "connected" || status !== "connected") return;
    if (
      untrack(() => infoError) !== null &&
      untrack(() => info === null) &&
      untrack(() => !notFound)
    ) {
      const current = untrack(() => thisIdentity);
      if (current) void loadInfo(current);
    }
  });

  // 身份变化即重置页级 not-found（路由实例跨参数变化持久存活的防线）。
  $effect(() => {
    void thisIdentity?.skillId;
    notFound = false;
  });

  // ---- 副本组差异（listCanonical q=name 精确匹配；copies 是展示关系） ----

  const copiesRequests = createRequestGenerationGate(getConnectionGeneration);
  let copiesGroup = $state<SkillsCanonicalGroup | null>(null);
  let copiesLoading = $state(false);
  let copiesError = $state<string | null>(null);

  $effect(() => {
    const current = thisIdentity;
    if (!current || !info || notFound) return;
    const name = info.name;
    void (async () => {
      const request = copiesRequests.issue();
      copiesLoading = true;
      copiesError = null;
      try {
        const output = await requireRpc().skills.listCanonical({
          wsId: current.wsId,
          q: name,
          limit: 50,
        });
        if (!request.isCurrent()) return;
        copiesGroup = output.groups.find((group) => group.name === name) ?? null;
      } catch (error) {
        if (!request.isCurrent()) return;
        copiesGroup = null;
        copiesError = error instanceof Error ? error.message : String(error);
      } finally {
        if (request.isLatest()) copiesLoading = false;
      }
    })();
  });

  /** 组代表身份是否等于当前路由 copy（代表标记）。 */
  function isRepresentative(providerId: string, skillId: string): boolean {
    const group = copiesGroup;
    if (!group) return false;
    return (
      group.representative.providerId === providerId && group.representative.skillId === skillId
    );
  }

  // ---- 面包屑身份与回程 ----

  /** `?from=` 列表态解析（批 3：file 键 = 编辑器文件深链；回程复用同一解析）。 */
  const fromState = $derived(parseListStateParam(getSearch?.()?.from));

  const workspaceLabel = $derived(
    workspaceState.workspaces.find((workspace) => workspace.id === thisIdentity?.wsId)?.label ??
      thisIdentity?.wsId ??
      "",
  );

  /** 显式返回：?from= → 状态对象 → goById 重组 route（不拼 href）+ handoff stash。 */
  function backToSkills(): void {
    const wsId = thisIdentity?.wsId;
    if (!wsId) return;
    const state = parseListStateParam(getSearch?.()?.from);
    stashSkillsListRestore(wsId, state);
    goById("workspaces.provider", { wsId }, listStateToDashboardSearch(state), "PUSH");
  }

  /** 副本行点击：路由到该 copy 的 detail（from 原样保留——列表态不因换 copy 漂移）。 */
  function openCopy(providerId: string, skillId: string): void {
    const wsId = thisIdentity?.wsId;
    if (!wsId) return;
    goById(
      "workspaces.skillDetail",
      { wsId, providerId, skillId },
      { from: getSearch?.()?.from },
      "PUSH",
    );
  }
</script>

<div class="skill-detail-page">
  <header class="flex shrink-0 items-center gap-1.5 border-b border-border px-4 py-2">
    <button
      type="button"
      class="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      aria-label={t("skillsWorkspace.skillDetail.backToSkills")}
      onclick={backToSkills}
    >
      <IconChevronLeft class="h-3.5 w-3.5" aria-hidden="true" />
      {t("skillsWorkspace.skillDetail.backToSkills")}
    </button>
    <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground" aria-hidden="true">
      {workspaceLabel} · {t("skillsWorkspace.tabs.skills")}
      {#if info}
        · <span class="font-medium text-foreground">{info.name}</span>
      {/if}
    </span>
  </header>

  {#if !thisIdentity}
    <!-- 防御面：manifest schema 已在渲染前 redirect；到这里 = 未收窄身份，不 fallback。 -->
    <div class="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <IconSearchX class="h-6 w-6 text-muted-foreground" aria-hidden="true" />
      <p class="text-sm font-medium text-destructive">
        {t("skillsWorkspace.skillDetail.notFoundTitle")}
      </p>
      <p class="max-w-xs text-xs text-muted-foreground">
        {t("skillsWorkspace.skillDetail.notFoundBody")}
      </p>
    </div>
  {:else if notFound}
    <!-- typed not-found：wellformed 身份但 daemon 侧不存在（不 fallback 掩盖）。 -->
    <div class="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <IconSearchX class="h-6 w-6 text-muted-foreground" aria-hidden="true" />
      <p class="text-sm font-medium text-destructive" data-testid="skill-not-found">
        {t("skillsWorkspace.skillDetail.notFoundTitle")}
      </p>
      <p class="max-w-xs text-xs text-muted-foreground">
        {t("skillsWorkspace.skillDetail.notFoundBody")}
      </p>
      <p class="max-w-md break-all font-mono text-xs text-muted-foreground/70">
        {thisIdentity.target.providerId}/{thisIdentity.skillId}
      </p>
      <button
        type="button"
        class="mt-1 flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs transition-colors hover:bg-muted/50"
        onclick={backToSkills}
      >
        <IconChevronLeft class="h-3.5 w-3.5" aria-hidden="true" />
        {t("skillsWorkspace.skillDetail.backToSkills")}
      </button>
    </div>
  {:else if infoLoading && !info}
    <div
      class="flex flex-1 items-center justify-center gap-2 px-4 py-8 text-xs text-muted-foreground"
      role="status"
    >
      <IconLoader class="h-4 w-4 animate-spin" />
      {t("skillDetail.loading")}
    </div>
  {:else if infoError}
    <div class="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-8 text-center">
      <p class="text-sm font-medium text-destructive">{t("skillDetail.notFound")}</p>
      <p class="max-w-md break-all font-mono text-xs text-muted-foreground/70">{infoError}</p>
      <button
        type="button"
        class="mt-1 flex h-8 items-center rounded-md border border-border px-3 text-xs transition-colors hover:bg-muted/50"
        onclick={() => thisIdentity && void loadInfo(thisIdentity)}
      >
        {t("common.retry")}
      </button>
    </div>
  {:else if info}
    <!-- 简化版两栏容器（批 3 填充右侧编辑器）：左 = 信息/动作，右 = 副本组差异
         + 内容占位；<692px 单列堆叠（dashboard 单列降档同阈值）。 -->
    <div class="skill-detail-grid min-h-0 flex-1">
      <div class="min-h-0 min-w-0">
        <SkillDetailPanel
          target={thisIdentity.target}
          skillId={thisIdentity.skillId}
          {info}
          onRefresh={() => thisIdentity && loadInfo(thisIdentity)}
        />
      </div>
      <aside class="detail-aside min-h-0 min-w-0 overflow-y-auto overscroll-contain px-4 py-3">
        <section aria-label={t("skillsWorkspace.skillDetail.copiesHeading")}>
          <h3 class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <IconLayers class="h-3.5 w-3.5" aria-hidden="true" />
            {t("skillsWorkspace.skillDetail.copiesHeading")}
            {#if copiesGroup}
              <span class="tabular-nums opacity-70">×{copiesGroup.groupMeta.copyCount}</span>
            {/if}
          </h3>
          <p class="mt-0.5 text-xs text-muted-foreground/70">
            {t("skillsWorkspace.skillDetail.copiesHint")}
          </p>
          {#if copiesLoading}
            <p class="mt-2 flex items-center gap-2 text-xs text-muted-foreground" role="status">
              <IconLoader class="h-3 w-3 animate-spin" />
              {t("skillDetail.loading")}
            </p>
          {:else if copiesError}
            <p class="mt-2 text-xs text-destructive" role="alert">{copiesError}</p>
          {:else if copiesGroup}
            <ul class="mt-2 overflow-hidden rounded-md border border-border">
              {#each copiesGroup.copies as copy (`${copy.providerId}:${copy.skillId}`)}
                <li>
                  <button
                    type="button"
                    class="flex w-full items-center gap-2 border-b border-border/70 px-2.5 py-2 text-left text-xs transition-colors last:border-b-0 hover:bg-accent/60
                      {copy.unavailable ? 'opacity-50' : ''}"
                    title={t("skillsWorkspace.skillDetail.openCopy")}
                    onclick={() => openCopy(copy.providerId, copy.skillId)}
                  >
                    <span
                      class="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
                      title={copy.providerId}
                    >
                      {copy.provider}
                    </span>
                    {#if isRepresentative(copy.providerId, copy.skillId)}
                      <span
                        class="shrink-0 rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-foreground"
                      >
                        {t("skillsWorkspace.skillDetail.representativeMark")}
                      </span>
                    {/if}
                    {#if copy.disabled}
                      <span
                        class="shrink-0 text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400"
                      >
                        {t("skillDetail.disabledBadge")}
                      </span>
                    {/if}
                    {#if copy.conflict}
                      <span
                        class="shrink-0 text-[10px] uppercase tracking-wide text-destructive"
                        title="SKILL.md + .SKILL.md"
                      >
                        {t("skillsWorkspace.skillDetail.conflictMark")}
                      </span>
                    {/if}
                    {#if copy.unavailable}
                      <span
                        class="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground/70"
                      >
                        {t("skillsWorkspace.skillDetail.unavailableMark")}
                      </span>
                    {/if}
                    {#if copy.description !== copiesGroup.representative.description}
                      <span class="min-w-0 flex-1 truncate text-muted-foreground">
                        {copy.description}
                      </span>
                    {/if}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </section>

        <!-- 内容查看器（批 3：左文件树 + 中内容查看器；只读 CodeEditor）。 -->
        <section class="mt-4" aria-label={t("skillsWorkspace.skillDetail.viewerTitle")}>
          <SkillDetailEditor
            target={thisIdentity.target}
            skillId={thisIdentity.skillId}
            {info}
            initialFile={fromState.file}
          />
        </section>
      </aside>
    </div>
  {/if}
</div>

<style>
  .skill-detail-page {
    container-type: inline-size;
    container-name: skill-detail;
    display: flex;
    height: 100%;
    min-height: 0;
    min-width: 0;
    flex-direction: column;
  }
  .skill-detail-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    /* 窄屏两行各占半幅：panel / aside 各自内滚（隐式 auto 行会被 stretch 分配
       后又放行内容溢出本行，画到下一行的透明 aside 底下——必须显式 minmax(0,1fr)
       钉死行高约束）。 */
    grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
    min-width: 0;
  }
  .skill-detail-grid > :global(*) {
    min-height: 0;
    overflow: hidden;
  }
  /* ≥692px 两栏（dashboard 单列降档同阈值）：单行双列，左栏信息/动作自带内滚
     （panel），右栏副本差异 + 占位独立内滚。 */
  @container skill-detail (min-width: 692px) {
    .skill-detail-grid {
      grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr);
    }
    .detail-aside {
      border-left: 1px solid var(--border, #e5e7eb);
    }
  }
</style>
