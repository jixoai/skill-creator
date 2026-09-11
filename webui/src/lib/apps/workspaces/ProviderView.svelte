<!--
  用户原始需求 [2026-07-27]：「看不到技能正文是当前最大的产品缺口」。
  正交意图：
  1. 列出当前 Workspace.Provider 的技能（数据来自 skills.list RPC）。
  2. 选中技能后渲染 frontmatter 元数据表 + markdown 正文（正文来自 skills.info RPC，组件级 $state，不跨渲染周期缓存）。
  3. 可写 Provider 下 name/description 行内轻量编辑（草稿存组件 $state，保存走 creator.save revision-safe）。
  4. 视图状态（选中技能 / 筛选词 / 子视图）全部编码在 URL search params。
  5. 窄屏（@container max-width 680px）下详情面板折叠到列表下方，?view=detail 切换焦点。
-->
<script lang="ts">
  import { untrack } from "svelte";
  import { useParams, useSearch, goById } from "$lib/shell";
  import { getConnectionGeneration } from "$lib/store.svelte";
  import {
    loadSkills,
    skillsState,
    fetchSkillInfo,
    toggleSkills,
    validateSkill,
  } from "$lib/store.svelte";
  import { saveSkill } from "$lib/store.svelte";
  import {
    applyUpdates,
    checkUpdates,
    clearUpdateReport,
    skillsUpdateState,
    updateApplyCounts,
    updateCheckCounts,
  } from "$lib/stores/skills-update.svelte";
  import { showToast } from "$lib/toast.svelte";
  import { ORPCError } from "@orpc/client";
  import type { SkillInfo, SkillFrontmatter } from "$lib/types";
  import { SkillFrontmatterSchema } from "$shared/contracts/creator.js";
  import { SkillIdSchema } from "$shared/contracts/skills.js";
  import { WorkspaceIdSchema, ProviderIdSchema } from "$shared/contracts/workspaces.js";
  import { splitSkillContent, renderSkillBody } from "$lib/render-skill-md";
  import { createRequestGenerationGate } from "$lib/stores/request-generation";
  import SkillCard from "$lib/components/skill-card.svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import IconArrowLeft from "@lucide/svelte/icons/arrow-left";
  import IconCheck from "@lucide/svelte/icons/circle-check";
  import IconDownload from "@lucide/svelte/icons/arrow-down-to-line";
  import IconFile from "@lucide/svelte/icons/file-text";
  import IconGraph from "@lucide/svelte/icons/network";
  import IconLoader from "@lucide/svelte/icons/loader-circle";
  import IconPower from "@lucide/svelte/icons/power";
  import IconShield from "@lucide/svelte/icons/shield-check";
  import IconSearch from "@lucide/svelte/icons/search";
  import IconX from "@lucide/svelte/icons/x";

  type ProviderSearch = { q?: string; skill?: string; view?: "list" | "detail" };

  const getParams = useParams<{ wsId: string; providerId: string }>();
  const getSearch = useSearch<ProviderSearch>();

  const wsId = $derived.by(() => getParams?.()?.wsId);
  const providerId = $derived.by(() => getParams?.()?.providerId);
  const search = $derived.by(() => getSearch?.() ?? {});
  const selectedSkillId = $derived(search.skill);
  const filterQuery = $derived(search.q ?? "");
  const viewMode = $derived(search.view ?? "list");

  // 组件级 detail 面板状态（render-cycle scoped；不写全局 store / localStorage）。
  const infoRequests = createRequestGenerationGate(getConnectionGeneration);
  let detail = $state<SkillInfo | null>(null);
  let detailLoading = $state(false);
  let detailError = $state<string | null>(null);
  let validating = $state(false);
  let validation = $state<{ success: boolean; errors: string[]; warnings: string[] } | null>(null);
  let saving = $state(false);
  let toggling = $state(false);

  // 行内轻量编辑草稿（仅当 detail 加载后初始化；不写 localStorage）。
  let draftName = $state("");
  let draftDescription = $state("");

  // 焦点管理目标：详情语义标题（programmatic focus target）与筛选输入。
  let detailHeaderEl = $state<HTMLElement | null>(null);
  let filterInputEl = $state<HTMLInputElement | null>(null);
  // backToList 记录待恢复的触发行，由下方 viewMode 迁移 effect 在渲染 flush 内恢复。
  let pendingFocusSkillId: string | null = null;

  // URL params 经 manifest 的 zod schema 校验（match 阶段）；这里再次安全解析以获得 branded 类型。
  const providerTarget = $derived.by(() => {
    if (!wsId || !providerId) return null;
    const ws = WorkspaceIdSchema.safeParse(wsId);
    const prov = ProviderIdSchema.safeParse(providerId);
    if (!ws.success || !prov.success) return null;
    return { workspaceId: ws.data, providerId: prov.data };
  });

  // 加载技能列表（来自 skills.list RPC，存全局 skillsState——列表数据由 store 管理）。
  $effect(() => {
    if (providerTarget) void loadSkills(providerTarget);
  });

  // 选中技能变化时拉取详情（来自 skills.info RPC，存组件 $state）。
  $effect(() => {
    const target = providerTarget;
    const skillId = selectedSkillId;
    if (!target || !skillId) {
      detail = null;
      detailError = null;
      return;
    }
    void loadDetail(target, skillId);
  });

  async function loadDetail(
    target: NonNullable<typeof providerTarget>,
    skillId: string,
  ): Promise<void> {
    const request = infoRequests.issue();
    // URL 传入的 skill id 可能格式非法；安全解析为 SkillId，失败即降级报错。
    const parsed = SkillIdSchema.safeParse(skillId);
    if (!parsed.success) {
      detail = null;
      detailError = "Invalid skill id in URL.";
      return;
    }
    detailLoading = true;
    detailError = null;
    validation = null;
    try {
      const info = await fetchSkillInfo(target, parsed.data);
      if (!request.isCurrent()) return;
      detail = info;
      const { frontmatter } = splitSkillContent(info.content);
      const fm = SkillFrontmatterSchema.safeParse(frontmatter);
      draftName = fm.success ? (fm.data.name as string) : info.name;
      draftDescription = fm.success ? (fm.data.description as string) : info.description;
    } catch (error) {
      if (!request.isCurrent()) return;
      detail = null;
      detailError = error instanceof Error ? error.message : String(error);
    } finally {
      if (request.isLatest()) detailLoading = false;
    }
  }

  const visibleSkills = $derived.by(() => {
    const q = filterQuery.trim().toLowerCase();
    const skills = skillsState.skills;
    if (!q) return skills;
    return skills.filter((skill) =>
      [skill.name, skill.description, skill.provider].some((value) =>
        value.toLowerCase().includes(q),
      ),
    );
  });

  const split = $derived(detail ? splitSkillContent(detail.content) : null);
  const renderedBody = $derived(split ? renderSkillBody(split.body) : "");

  // 当前 Provider 是否可写（决定 name/description 是否可编辑 + 是否显示 Save）。
  // Global Workspace 永不可写；导入 Workspace 的 provider 默认可写。
  const providerWritable = $derived(
    providerTarget !== null && providerTarget.workspaceId !== ("~" as const),
  );

  function selectSkill(skillId: string): void {
    if (!wsId || !providerId) return;
    // 选中技能即切到详情焦点（窄屏）；保留现有筛选词。
    goById(
      "workspaces.provider",
      { wsId, providerId },
      { ...search, skill: skillId, view: "detail" },
    );
  }

  function setFilterQuery(value: string): void {
    if (!wsId || !providerId) return;
    goById(
      "workspaces.provider",
      { wsId, providerId },
      { ...search, q: value || undefined },
      "REPLACE",
    );
  }

  function backToList(): void {
    if (!wsId || !providerId) return;
    pendingFocusSkillId = selectedSkillId ?? null;
    goById("workspaces.provider", { wsId, providerId }, { ...search, view: "list" });
  }

  // detail→list 迁移时恢复触发行焦点；行已被筛选掉时退回筛选输入。
  // 焦点必须在渲染 flush 内落位：SvelteKit 完成导航时会检测手动焦点管理
  // （changed_focus），只要 activeElement 已离开 body 就跳过自身 reset_focus。
  let previousViewMode: "list" | "detail" = "list";
  $effect(() => {
    const mode = viewMode;
    const wasDetail = untrack(() => previousViewMode);
    const restoreSkillId = untrack(() => pendingFocusSkillId);
    previousViewMode = mode;
    if (mode !== "list" || wasDetail !== "detail" || !restoreSkillId) return;
    pendingFocusSkillId = null;
    const row = document.querySelector<HTMLButtonElement>(
      `button[data-skill-id="${CSS.escape(restoreSkillId)}"]`,
    );
    (row ?? filterInputEl)?.focus();
  });

  // 进入详情视图且详情就绪后聚焦语义标题（同一技能刷新不重复夺焦）。
  $effect(() => {
    if (viewMode !== "detail" || detailLoading) return;
    const loadedSkillId = detail?.id;
    if (loadedSkillId === undefined) return;
    detailHeaderEl?.focus();
  });

  async function handleToggle(): Promise<void> {
    const current = detail;
    if (!current || !providerTarget || toggling) return;
    toggling = true;
    const mode = current.disabled ? "enable" : "disable";
    try {
      const summary = await toggleSkills([current.id], mode);
      if (!summary) return; // 请求已被取代（切换 Provider / 断线），不投影结果
      const entry = summary.results.find((item) => item.skillId === current.id);
      if (entry) {
        if (entry.status === "conflict") {
          showToast(`${entry.name}: ${mode} conflict${entry.error ? ` — ${entry.error}` : "."}`);
        } else if (entry.status === "failed") {
          showToast(`${entry.name}: ${mode} failed — ${entry.error ?? "unknown error"}`);
        } else if (entry.status === "skipped") {
          showToast(`${entry.name}: already ${mode === "enable" ? "enabled" : "disabled"}.`);
        } else {
          showToast(`${entry.name} ${entry.status}.`);
        }
      }
      await loadDetail(providerTarget, current.id);
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    } finally {
      toggling = false;
    }
  }

  // ---- 更新检查 / 重装（skills.update.check + apply；结果按技能逐项分类） ----

  const outdatedIds = $derived(
    skillsUpdateState.results
      .filter((entry) => entry.status === "updated")
      .map((entry) => entry.skillId),
  );
  const checkCounts = $derived(updateCheckCounts(skillsUpdateState.results));
  const applySummary = $derived(
    skillsUpdateState.applyResults ? updateApplyCounts(skillsUpdateState.applyResults) : null,
  );

  // 切换 Provider 时清除上一份更新报告。
  $effect(() => {
    if (providerTarget) clearUpdateReport();
  });

  async function handleCheckUpdates(): Promise<void> {
    if (!providerTarget || skillsUpdateState.checking) return;
    await checkUpdates(providerTarget);
  }

  async function handleApplyUpdates(): Promise<void> {
    if (!providerTarget || skillsUpdateState.applying || outdatedIds.length === 0) return;
    try {
      const results = await applyUpdates(providerTarget, outdatedIds);
      if (!results) return;
      const counts = updateApplyCounts(results);
      const parts = [
        counts.updated > 0 ? `${counts.updated} updated` : null,
        counts.current > 0 ? `${counts.current} already current` : null,
        counts.failed > 0 ? `${counts.failed} failed` : null,
      ].filter((part): part is string => part !== null);
      // 禁止把 skipped-only 写成成功；parts 为空时如实报告无变化。
      showToast(parts.length > 0 ? parts.join(" · ") : "No changes applied.");
      await loadSkills(providerTarget);
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleValidate(): Promise<void> {
    if (!detail || !providerTarget) return;
    validating = true;
    validation = null;
    try {
      const result = await validateSkill(detail.id);
      if (result) {
        validation = { success: result.success, errors: result.errors, warnings: result.warnings };
      }
    } catch (error) {
      validation = {
        success: false,
        errors: [error instanceof Error ? error.message : String(error)],
        warnings: [],
      };
    } finally {
      validating = false;
    }
  }

  async function handleSave(): Promise<void> {
    const info = detail;
    const target = providerTarget;
    const body = split?.body;
    if (!info || !target || body === undefined) return;
    const trimmedName = draftName.trim();
    const trimmedDescription = draftDescription.trim();
    if (!trimmedName || !trimmedDescription) {
      showToast("Name and description cannot be empty.");
      return;
    }
    saving = true;
    try {
      // 透传原 frontmatter 的未知字段，仅覆盖 name/description；经 schema 校验后类型安全。
      const existing = split ? split.frontmatter : {};
      const fmParsed = SkillFrontmatterSchema.safeParse({
        ...existing,
        name: trimmedName,
        description: trimmedDescription,
      });
      if (!fmParsed.success) {
        showToast("Frontmatter is invalid after edit.");
        return;
      }
      const frontmatter: SkillFrontmatter = fmParsed.data;
      const result = await saveSkill({
        mode: "update",
        workspaceId: target.workspaceId,
        providerId: target.providerId,
        skillId: info.id,
        expectedRevision: info.revision,
        frontmatter,
        body,
      });
      // 用返回的新 revision 刷新组件局部持有的 revision（仅当前渲染周期）。
      detail = {
        ...info,
        revision: result.document.revision,
        name: trimmedName,
        description: trimmedDescription,
      };
      showToast("Saved.");
    } catch (error) {
      if (error instanceof ORPCError && error.code === "CONFLICT") {
        showToast("This skill changed elsewhere. Reload to view the latest.", {
          label: "Reload",
          run: () => {
            if (target && detail) void loadDetail(target, detail.id);
          },
        });
      } else {
        showToast(error instanceof Error ? error.message : String(error));
      }
    } finally {
      saving = false;
    }
  }

  // 导入 creator 契约 frontmatter schema 以安全解析已加载 frontmatter（见文件顶部）。
</script>

<div class="provider-surface flex h-full min-h-0 w-full min-w-0">
  <!-- 技能列表（窄屏 ?view=detail 时隐藏） -->
  <section
    class="provider-list flex min-h-0 flex-col border-r border-border {viewMode === 'detail'
      ? 'provider-list-hidden'
      : ''}"
    aria-label="Skills"
  >
    <header class="shrink-0 border-b border-border px-4 py-3">
      <!-- 列栏固定 18rem：标题与四个操作按钮必须可换行——nowrap+truncate 会让
           h1（overflow:hidden → flex min-width 归零）塌陷为 0，按钮越界画到详情栏。 -->
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <h1 class="min-w-0 truncate text-base font-semibold">{providerId ?? "—"}</h1>
        {#if skillsState.refreshing}
          <IconLoader
            class="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground"
            title="Refreshing skills"
          />
        {:else}
          <Badge variant="secondary">{visibleSkills.length}</Badge>
        {/if}
        <div class="ml-auto flex flex-wrap items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            class="h-7 gap-1.5 px-2 text-xs"
            title="Read-only analysis: duplicates, conflicts, shared resources"
            onclick={() => {
              if (wsId && providerId) {
                goById("workspaces.intelligence", { wsId, providerId }, {});
              }
            }}
          >
            <IconGraph class="h-3.5 w-3.5" />
            Insights
          </Button>
          <Button
            variant="ghost"
            size="sm"
            class="h-7 gap-1.5 px-2 text-xs"
            title="Compare installed skills against their upstream sources"
            disabled={skillsUpdateState.checking}
            onclick={() => void handleCheckUpdates()}
          >
            {#if skillsUpdateState.checking}
              <IconLoader class="h-3.5 w-3.5 animate-spin" />
            {:else}
              <IconDownload class="h-3.5 w-3.5" />
            {/if}
            Updates
          </Button>
        </div>
      </div>
      <div class="relative mt-2">
        <IconSearch
          class="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <input
          bind:this={filterInputEl}
          class="h-7 w-full rounded-md border border-input bg-input/20 pl-7 pr-2 text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          placeholder="Filter skills"
          aria-label="Filter skills"
          value={filterQuery}
          oninput={(e) => setFilterQuery((e.currentTarget as HTMLInputElement).value)}
        />
      </div>
    </header>

    {#if skillsUpdateState.checking}
      <p
        class="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2 text-xs text-muted-foreground"
        role="status"
      >
        <IconLoader class="h-3.5 w-3.5 animate-spin" /> Checking upstream sources…
      </p>
    {:else if skillsUpdateState.checkError}
      <div
        class="flex shrink-0 items-start gap-2 border-b border-border px-4 py-2 text-xs text-destructive"
        role="alert"
      >
        <span class="min-w-0 flex-1 break-words">{skillsUpdateState.checkError}</span>
        <button
          class="shrink-0 underline underline-offset-2"
          onclick={() => void handleCheckUpdates()}
        >
          Retry
        </button>
      </div>
    {:else if skillsUpdateState.results.length > 0 || skillsUpdateState.applyResults}
      <section
        class="shrink-0 border-b border-border px-4 py-2.5"
        aria-label="Update report"
        data-testid="update-report"
      >
        <div class="flex items-center gap-2">
          {#if applySummary}
            <p class="min-w-0 flex-1 text-xs">
              <span class="font-medium">Applied</span>
              {#if applySummary.updated > 0}
                <span class="text-muted-foreground"> · {applySummary.updated} updated</span>
              {/if}
              {#if applySummary.current > 0}
                <span class="text-muted-foreground"> · {applySummary.current} already current</span>
              {/if}
              {#if applySummary.failed > 0}
                <span class="text-destructive"> · {applySummary.failed} failed</span>
              {/if}
            </p>
          {:else}
            <p class="min-w-0 flex-1 text-xs">
              {#if checkCounts.outdated > 0}
                <span class="font-medium text-primary">{checkCounts.outdated} outdated</span>
              {:else}
                <span class="font-medium">All current</span>
              {/if}
              {#if checkCounts.current > 0}
                <span class="text-muted-foreground"> · {checkCounts.current} up to date</span>
              {/if}
              {#if checkCounts.unavailable > 0}
                <span class="text-muted-foreground"> · {checkCounts.unavailable} unavailable</span>
              {/if}
              {#if checkCounts.failed > 0}
                <span class="text-destructive"> · {checkCounts.failed} failed</span>
              {/if}
            </p>
            {#if outdatedIds.length > 0}
              <Button
                size="sm"
                class="h-7 gap-1.5 px-2 text-xs"
                disabled={skillsUpdateState.applying}
                onclick={() => void handleApplyUpdates()}
              >
                {#if skillsUpdateState.applying}
                  <IconLoader class="h-3.5 w-3.5 animate-spin" />
                {:else}
                  <IconDownload class="h-3.5 w-3.5" />
                {/if}
                Update {outdatedIds.length}
              </Button>
            {/if}
          {/if}
          <button
            class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Dismiss update report"
            onclick={() => clearUpdateReport()}
          >
            <IconX class="h-3.5 w-3.5" />
          </button>
        </div>
        {#if skillsUpdateState.applyResults ?? skillsUpdateState.results}
          {@const report = skillsUpdateState.applyResults ?? skillsUpdateState.results}
          <ul class="mt-1.5 max-h-40 space-y-1 overflow-y-auto text-[11px]">
            {#each report as entry (entry.skillId)}
              <li class="flex items-baseline gap-1.5">
                <span class="min-w-0 flex-1 truncate">{entry.name}</span>
                {#if entry.status === "updated"}
                  <Badge variant="secondary" class="text-[10px]">
                    {applySummary ? "reinstalled" : "outdated"}
                  </Badge>
                {:else if entry.status === "already-current"}
                  <Badge variant="outline" class="text-[10px]">current</Badge>
                {:else if entry.status === "failed"}
                  <Badge variant="destructive" class="text-[10px]">failed</Badge>
                {:else}
                  <Badge variant="outline" class="text-[10px]">unavailable</Badge>
                {/if}
              </li>
              {#if entry.error}
                <li class="pl-3 text-[10px] text-muted-foreground">{entry.error}</li>
              {/if}
            {/each}
          </ul>
        {/if}
      </section>
    {/if}
    <div class="min-h-0 flex-1 overflow-y-auto">
      {#if skillsState.loading}
        <div class="flex items-center gap-2 px-4 py-6 text-xs text-muted-foreground">
          <IconLoader class="h-3.5 w-3.5 animate-spin" /> Loading skills…
        </div>
      {:else if skillsState.error}
        <div class="flex flex-col items-start gap-2 px-4 py-6 text-xs text-destructive">
          <p class="break-words">{skillsState.error}</p>
          {#if providerTarget}
            <Button
              variant="outline"
              size="sm"
              class="h-7 text-xs"
              onclick={() => void loadSkills(providerTarget)}
            >
              Retry
            </Button>
          {/if}
        </div>
      {:else if visibleSkills.length === 0}
        <p class="px-4 py-6 text-xs text-muted-foreground">No skills match.</p>
      {:else}
        {#each visibleSkills as skill (skill.id)}
          <SkillCard
            {skill}
            selected={skill.id === selectedSkillId}
            onclick={() => selectSkill(skill.id)}
          />
        {/each}
      {/if}
    </div>
  </section>

  <!-- 技能详情面板（窄屏 ?view=list 时隐藏） -->
  <section
    class="provider-detail flex min-h-0 flex-col {viewMode === 'list'
      ? 'provider-detail-hidden'
      : ''}"
    aria-label="Skill detail"
  >
    {#if !selectedSkillId}
      <div
        class="flex h-full flex-col items-center justify-center gap-2 px-8 text-center text-muted-foreground"
      >
        <IconFile class="h-8 w-8 opacity-50" />
        <p class="text-sm font-medium text-foreground">Select a skill</p>
        <p class="max-w-xs text-xs">
          Inspect its frontmatter, rendered body, and validation status.
        </p>
      </div>
    {:else if detailLoading}
      <div class="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
        <IconLoader class="h-4 w-4 animate-spin" /> Loading skill…
      </div>
    {:else if detailError}
      <div class="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
        <p class="text-xs text-destructive">{detailError}</p>
        {#if providerTarget && selectedSkillId}
          <Button
            variant="outline"
            size="sm"
            onclick={() => loadDetail(providerTarget, selectedSkillId)}
          >
            Retry
          </Button>
        {/if}
      </div>
    {:else if detail}
      {@const editable = providerWritable}
      <header
        bind:this={detailHeaderEl}
        tabindex="-1"
        class="detail-header shrink-0 border-b border-border px-4 py-3 focus:outline-none"
      >
        <div class="flex items-start gap-2">
          <button
            class="provider-back mt-0.5 hidden h-8 w-8 items-center justify-center"
            aria-label="Back to skills"
            onclick={backToList}
          >
            <IconArrowLeft class="h-4 w-4" />
          </button>
          <div class="min-w-0 flex-1">
            {#if editable}
              <Input
                bind:value={draftName}
                class="h-8 text-base font-semibold"
                aria-label="Skill name"
              />
            {:else}
              <h2 class="truncate text-base font-semibold">{detail.name}</h2>
            {/if}
            {#if editable}
              <textarea
                bind:value={draftDescription}
                rows="2"
                class="mt-1 w-full resize-y rounded-md border border-input bg-input/20 px-2 py-1 text-xs leading-5 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                aria-label="Skill description"></textarea>
            {:else}
              <p class="mt-0.5 text-xs leading-5 text-muted-foreground">{detail.description}</p>
            {/if}
          </div>
          <div class="flex shrink-0 items-center gap-1.5">
            {#if editable}
              <Button size="sm" class="h-8 gap-1.5" onclick={handleSave} disabled={saving}>
                {#if saving}<IconLoader class="h-3.5 w-3.5 animate-spin" /> Save{:else}Save{/if}
              </Button>
            {/if}
            <Button
              variant="outline"
              size="sm"
              class="h-8 gap-1.5"
              onclick={handleValidate}
              disabled={validating}
            >
              {#if validating}<IconLoader class="h-3.5 w-3.5 animate-spin" />{:else}<IconShield
                  class="h-3.5 w-3.5"
                />{/if}
              Validate
            </Button>
            <Button
              size="sm"
              variant={detail.disabled ? "default" : "outline"}
              class="h-8 gap-1.5"
              disabled={toggling}
              onclick={handleToggle}
            >
              {#if toggling}
                <IconLoader class="h-3.5 w-3.5 animate-spin" />
              {:else}
                <IconPower class="h-3.5 w-3.5" />
              {/if}
              {detail.disabled ? "Enable" : "Disable"}
            </Button>
          </div>
        </div>
        <div class="mt-2 flex flex-wrap gap-1.5">
          <Badge variant="secondary">{detail.provider}</Badge>
          <Badge variant="outline">{detail.directoryName}</Badge>
          {#if detail.disabled}
            <Badge variant="outline" class="text-amber-700 dark:text-amber-300">Disabled</Badge>
          {/if}
        </div>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {#if validation}
          <section class="mb-4 border-b border-border pb-3" aria-live="polite">
            <div class="flex items-center gap-2 text-xs font-medium">
              {#if validation.success}<IconCheck class="h-4 w-4 text-emerald-600" /> Valid skill{:else}<IconShield
                  class="h-4 w-4 text-destructive"
                /> Validation issues{/if}
            </div>
            {#each validation.errors as issue}
              <p class="mt-1 text-xs text-destructive">{issue}</p>
            {/each}
            {#each validation.warnings as issue}
              <p class="mt-1 text-xs text-amber-700 dark:text-amber-300">{issue}</p>
            {/each}
          </section>
        {/if}

        {#if split}
          <section class="mb-4">
            <h3 class="mb-2 text-xs font-medium text-muted-foreground">Frontmatter</h3>
            <dl class="overflow-x-auto rounded-md border border-border">
              {#each Object.entries(split.frontmatter) as [key, value], i}
                <div
                  class="grid grid-cols-[120px_minmax(0,1fr)] {i > 0
                    ? 'border-t border-border'
                    : ''}"
                >
                  <dt class="bg-muted/40 px-2 py-1 text-[11px] font-medium text-muted-foreground">
                    {key}
                  </dt>
                  <dd class="break-words px-2 py-1 text-[11px]">
                    {value === null ? "null" : String(value)}
                  </dd>
                </div>
              {/each}
            </dl>
          </section>
        {/if}

        <section>
          <h3 class="mb-2 text-xs font-medium text-muted-foreground">SKILL.md</h3>
          <!-- 渲染器关闭原始 HTML 透传，并兜底 sanitize；详见 render-skill-md.ts -->
          <div class="prose prose-sm max-w-none overflow-x-auto">{@html renderedBody}</div>
        </section>
      </div>
    {/if}
  </section>
</div>

<style>
  .provider-surface {
    container-type: inline-size;
  }

  /* 宽屏：列表固定宽度，详情占满剩余；两者始终并排可见。 */
  .provider-list {
    width: 18rem;
    flex-shrink: 0;
  }
  .provider-detail {
    flex: 1 1 0%;
    /* flex item 默认 min-width:auto 会随长代码行增长，导致 pre 的横向滚动永不触发、
       面板宽度被内容撑破；显式归零后宽度由容器分配，代码块改为内部滚动。 */
    min-width: 0;
  }
  /* 列表/详情在宽屏下都可见；隐藏类只在窄屏生效。 */
  .provider-back {
    display: none;
  }

  /* 窄屏：列表与详情栈式切换（同一时刻只显示一个）。 */
  @container (max-width: 680px) {
    .provider-list,
    .provider-detail {
      width: 100%;
      flex: 1 1 0%;
    }
    .provider-list-hidden {
      display: none;
    }
    .provider-detail-hidden {
      display: none;
    }
    .provider-back {
      display: inline-flex;
    }
    .detail-header :global(button) {
      min-height: 2.25rem;
    }
  }
</style>
