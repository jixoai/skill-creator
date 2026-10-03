<!--
  用户原始需求 [2026-10-02]（skills-dashboard design §2，r2/r3 修订）：
  「detail = 只读文档详情 + 管理动作；frontmatter/正文编辑唯一真相 = Creator 编辑页。
  现 ProviderView 的 name/description 行内轻量编辑随迁移退役（不迁移）」。
  正交意图：
  1. 只读文档详情：frontmatter 解析表 + markdown 正文渲染（skills.info，组件级
     $state + request-generation gate，不跨渲染周期缓存）。
  2. 管理动作：Validate / Update check（只读检查，apply 不在此面）/ Toggle
     （skills.toggle = skills 域唯一写 RPC）/ Chat about this skill
     （creator-agent-chat 1.4 实装：resume 键 = target + seedSkill 精确匹配，
     命中续聊 / 无匹配新建携带技能上下文——agent 域动作，非 skills 域写）/
     Edit in Creator 深链 / Insights 深链（workspaces.intelligence 与
     Agents screen 同链）。
  3. 零编辑写：无 creator.save/delete 调用；除 skills.toggle 外零写 RPC
     （design §7 源扫描断言面）。
  4. 窄屏返回触发行恢复由父级（skills screen）管理；本组件只回调 onBack。
-->
<script lang="ts">
  import { untrack } from "svelte";
  import { goById } from "$lib/shell";
  import { getConnectionGeneration } from "$lib/store.svelte";
  import { fetchSkillInfo, loadSkills, toggleSkills, validateSkill } from "$lib/store.svelte";
  import {
    checkUpdates,
    clearUpdateReport,
    skillsUpdateState,
  } from "$lib/stores/skills-update.svelte";
  import { showToast } from "$lib/toast.svelte";
  import { t } from "$lib/i18n";
  import { SkillIdSchema, type SkillId } from "$shared/contracts/skills.js";
  import type { WorkspaceProviderTarget } from "$shared/contracts/workspaces.js";
  import { splitSkillContent, renderSkillBody } from "$lib/render-skill-md";
  import { createRequestGenerationGate } from "$lib/stores/request-generation";
  import { startSkillChat } from "$lib/apps/creator/skill-chat-action.svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import IconCheck from "@lucide/svelte/icons/circle-check";
  import IconDownload from "@lucide/svelte/icons/arrow-down-to-line";
  import IconFile from "@lucide/svelte/icons/file-text";
  import IconGraph from "@lucide/svelte/icons/network";
  import IconLoader from "@lucide/svelte/icons/loader-circle";
  import IconMessage from "@lucide/svelte/icons/message-square";
  import IconPen from "@lucide/svelte/icons/file-pen-line";
  import IconPower from "@lucide/svelte/icons/power";
  import IconShield from "@lucide/svelte/icons/shield-check";

  /** 详情身份（provider + skill 双参数定位）与窄屏返回回调。 */
  let {
    target,
    skillId,
    onBack,
  }: {
    target: WorkspaceProviderTarget;
    skillId: string;
    onBack?: () => void;
  } = $props();

  const infoRequests = createRequestGenerationGate(getConnectionGeneration);
  let detail = $state<Awaited<ReturnType<typeof fetchSkillInfo>> | null>(null);
  let detailLoading = $state(false);
  let detailError = $state<string | null>(null);
  let validating = $state(false);
  let validation = $state<{ success: boolean; errors: string[]; warnings: string[] } | null>(null);
  let toggling = $state(false);
  let checkingUpdate = $state(false);

  let detailHeaderEl = $state<HTMLElement | null>(null);

  // toggle/checkUpdates 的全局 target 语义（skills 域唯一写 RPC 依赖 skillsState.target）。
  $effect(() => {
    void loadSkills(target);
  });
  // 离开详情面时清除该 provider 的更新报告（报告只在面板内消费）。
  $effect(() => {
    return () => untrack(() => clearUpdateReport());
  });

  async function loadDetail(currentTarget: WorkspaceProviderTarget, id: string): Promise<void> {
    const request = infoRequests.issue();
    const parsed = SkillIdSchema.safeParse(id);
    if (!parsed.success) {
      detail = null;
      detailError = t("skillDetail.invalidId");
      return;
    }
    detailLoading = true;
    detailError = null;
    validation = null;
    try {
      const info = await fetchSkillInfo(currentTarget, parsed.data as SkillId);
      if (!request.isCurrent()) return;
      detail = info;
    } catch (error) {
      if (!request.isCurrent()) return;
      detail = null;
      detailError = error instanceof Error ? error.message : String(error);
    } finally {
      if (request.isLatest()) detailLoading = false;
    }
  }

  // 详情身份变化即重拉（skills.info；组件级 request-generation gate）。
  $effect(() => {
    void loadDetail(target, skillId);
  });

  // 详情就绪后聚焦语义标题（同技能刷新不重复夺焦）。
  $effect(() => {
    if (detailLoading || !detail) return;
    detailHeaderEl?.focus();
  });

  const split = $derived(detail ? splitSkillContent(detail.content) : null);
  const renderedBody = $derived(split ? renderSkillBody(split.body) : "");

  // editable 门控沿 ProviderView 语义：Global（~）永不可写 → 无 Edit 深链。
  const editable = $derived(target.workspaceId !== ("~" as const));

  async function handleValidate(): Promise<void> {
    const current = detail;
    if (!current || validating) return;
    validating = true;
    validation = null;
    try {
      const result = await validateSkill(current.id);
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

  async function handleToggle(): Promise<void> {
    const current = detail;
    if (!current || toggling) return;
    toggling = true;
    const mode = current.disabled ? "enable" : "disable";
    try {
      const summary = await toggleSkills([current.id], mode);
      if (!summary) return; // 请求已被取代（断线/切 provider），不投影结果
      const entry = summary.results.find((item) => item.skillId === current.id);
      if (entry) {
        // mutation 反馈区分 succeeded/skipped/conflict/failed（AGENTS §7.2）。
        if (entry.status === "conflict") {
          showToast(`${entry.name}: ${mode} conflict${entry.error ? ` — ${entry.error}` : "."}`);
        } else if (entry.status === "failed") {
          showToast(
            `${entry.name}: ${mode} failed — ${entry.error ?? t("skillDetail.unknownError")}`,
          );
        } else if (entry.status === "skipped") {
          showToast(
            `${entry.name}: ${mode === "enable" ? t("skillDetail.alreadyEnabled") : t("skillDetail.alreadyDisabled")}`,
          );
        } else {
          showToast(`${entry.name} ${entry.status}.`);
        }
      }
      await loadDetail(target, current.id);
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    } finally {
      toggling = false;
    }
  }

  // Update check（只读检查；apply 不在本面——design §2 归属清单）。
  const updateEntry = $derived(
    skillsUpdateState.results.find((entry) => entry.skillId === detail?.id) ?? null,
  );

  async function handleCheckUpdate(): Promise<void> {
    const current = detail;
    if (!current || checkingUpdate || skillsUpdateState.checking) return;
    checkingUpdate = true;
    try {
      await checkUpdates(target, [current.id]);
    } finally {
      checkingUpdate = false;
    }
  }

  // Chat about this skill（1.4）：agent 域入口——resume 键在 action 内解析
  // （target + seedSkill 精确匹配）；本面不持会话逻辑。
  function handleChatAbout(): void {
    const current = detail;
    if (!current) return;
    void startSkillChat({
      workspaceId: target.workspaceId,
      providerId: target.providerId,
      skillId: current.id,
      skillName: current.name,
    });
  }
</script>

<div class="flex min-h-0 flex-1 flex-col">
  {#if detailLoading}
    <div
      class="flex flex-1 items-center justify-center gap-2 px-4 py-8 text-xs text-muted-foreground"
    >
      <IconLoader class="h-4 w-4 animate-spin" />
      {t("skillDetail.loading")}
    </div>
  {:else if detailError}
    <div class="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-8 text-center">
      <p class="text-sm font-medium text-destructive">{t("skillDetail.notFound")}</p>
      <p class="max-w-xs text-xs text-muted-foreground">{t("skillDetail.notFoundBody")}</p>
      <p class="max-w-md break-all font-mono text-xs text-muted-foreground/70">{detailError}</p>
      <Button
        variant="outline"
        size="sm"
        class="h-8"
        onclick={() => void loadDetail(target, skillId)}
      >
        {t("common.retry")}
      </Button>
    </div>
  {:else if detail}
    <header
      bind:this={detailHeaderEl}
      tabindex="-1"
      class="shrink-0 border-b border-border px-4 py-3 focus:outline-none"
    >
      <div class="flex items-start gap-2">
        {#if onBack}
          <button
            type="button"
            class="detail-back mt-0.5 hidden h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-accent"
            aria-label={t("skillDetail.backToList")}
            onclick={onBack}
          >
            <svg
              class="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="m12 19-7-7 7-7" />
              <path d="M19 12H5" />
            </svg>
          </button>
        {/if}
        <div class="min-w-0 flex-1">
          <h2 class="truncate text-base font-semibold">{detail.name}</h2>
          <p class="mt-0.5 text-xs leading-5 text-muted-foreground">{detail.description}</p>
        </div>
        <div class="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            class="h-8 w-8"
            title={t("skillDetail.insightsTitle")}
            aria-label={t("skillDetail.insightsTitle")}
            onclick={() =>
              goById("workspaces.intelligence", {
                wsId: target.workspaceId,
                providerId: target.providerId,
              })}
          >
            <IconGraph class="h-4 w-4" />
          </Button>
          {#if editable}
            <Button
              variant="outline"
              size="sm"
              class="h-8 gap-1.5"
              title={t("skillDetail.editTitle")}
              onclick={() =>
                goById("creator.workspace.skill", {
                  mode: "edit",
                  wsId: target.workspaceId,
                  providerId: target.providerId,
                  // skillId prop 与 detail.id 同源（loadDetail 已 safeParse）；
                  // 回调闭包里 detail 的窄化不可靠，prop 是稳定真相。
                  skillId,
                })}
            >
              <IconPen class="h-3.5 w-3.5" />
              {t("skillDetail.editInCreator")}
            </Button>
          {/if}
          <Button
            variant="outline"
            size="sm"
            class="h-8 gap-1.5"
            disabled={validating}
            onclick={() => void handleValidate()}
          >
            {#if validating}<IconLoader class="h-3.5 w-3.5 animate-spin" />{:else}<IconShield
                class="h-3.5 w-3.5"
              />{/if}
            {t("skillDetail.validate")}
          </Button>
          <Button
            size="sm"
            variant={detail.disabled ? "default" : "outline"}
            class="h-8 gap-1.5"
            disabled={toggling}
            onclick={() => void handleToggle()}
          >
            {#if toggling}
              <IconLoader class="h-3.5 w-3.5 animate-spin" />
            {:else}
              <IconPower class="h-3.5 w-3.5" />
            {/if}
            {detail.disabled ? t("skillDetail.enable") : t("skillDetail.disable")}
          </Button>
        </div>
      </div>
      <div class="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary">{detail.provider}</Badge>
        {#if detail.directoryName !== detail.name}
          <Badge variant="outline">{detail.directoryName}</Badge>
        {/if}
        {#if detail.disabled}
          <Badge variant="outline" class="text-amber-700 dark:text-amber-300">
            {t("skillDetail.disabledBadge")}
          </Badge>
        {/if}
      </div>
    </header>

    <div class="detail-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
      {#if validation}
        <section class="mb-4 border-b border-border pb-3" aria-live="polite">
          <div class="flex items-center gap-2 text-xs font-medium">
            {#if validation.success}
              <IconCheck class="h-4 w-4 text-emerald-600" />
              {t("skillDetail.validSkill")}
            {:else}
              <IconShield class="h-4 w-4 text-destructive" />
              {t("skillDetail.validationIssues")}
            {/if}
          </div>
          {#each validation.errors as issue}
            <p class="mt-1 text-xs text-destructive">{issue}</p>
          {/each}
          {#each validation.warnings as issue}
            <p class="mt-1 text-xs text-amber-700 dark:text-amber-300">{issue}</p>
          {/each}
        </section>
      {/if}

      <section class="mb-4 flex items-center gap-2 border-b border-border pb-3">
        <Button
          variant="outline"
          size="sm"
          class="h-7 gap-1.5 text-xs"
          disabled={checkingUpdate || skillsUpdateState.checking}
          onclick={() => void handleCheckUpdate()}
        >
          {#if checkingUpdate || skillsUpdateState.checking}
            <IconLoader class="h-3.5 w-3.5 animate-spin" />
          {:else}
            <IconDownload class="h-3.5 w-3.5" />
          {/if}
          {t("skillDetail.updateCheck")}
        </Button>
        {#if updateEntry}
          {#if updateEntry.status === "updated"}
            <Badge variant="secondary">{t("skillDetail.updateOutdated")}</Badge>
          {:else if updateEntry.status === "already-current"}
            <Badge variant="outline">{t("skillDetail.updateCurrent")}</Badge>
          {:else if updateEntry.status === "failed"}
            <Badge variant="destructive">{t("skillDetail.updateFailed")}</Badge>
          {:else}
            <Badge variant="outline">{t("skillDetail.updateUnavailable")}</Badge>
          {/if}
          {#if updateEntry.error}
            <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {updateEntry.error}
            </span>
          {/if}
        {:else if skillsUpdateState.checkError}
          <span class="min-w-0 flex-1 truncate text-xs text-destructive" role="alert">
            {skillsUpdateState.checkError}
          </span>
        {/if}
      </section>

      <!-- Chat about this skill（creator-agent-chat 1.4）：resume/新建两态在 action 内裁决。 -->
      <section class="mb-4">
        <button
          type="button"
          class="relative flex w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-left text-xs transition-colors after:absolute after:-inset-1 after:content-[''] hover:border-primary/40 hover:bg-muted/50"
          title={t("skillDetail.chatTitle")}
          aria-label={t("skillDetail.chatTitle")}
          data-skill-chat-entry="true"
          onclick={handleChatAbout}
        >
          <IconMessage class="h-3.5 w-3.5 shrink-0" />
          <span class="min-w-0 flex-1 truncate">{t("skillDetail.chatAbout")}</span>
        </button>
      </section>

      {#if split}
        {@const fmEntries = Object.entries(split.frontmatter)}
        {#if fmEntries.length > 0}
          <section class="mb-4">
            <h3 class="mb-2 text-xs font-medium text-muted-foreground">
              {t("skillDetail.frontmatter")}
            </h3>
            <dl class="overflow-x-auto rounded-md border border-border">
              {#each fmEntries as [key, value], i}
                <div
                  class="grid grid-cols-[120px_minmax(0,1fr)] {i > 0
                    ? 'border-t border-border'
                    : ''}"
                >
                  <dt class="bg-muted/40 px-2 py-1 text-xs font-medium text-muted-foreground">
                    {key}
                  </dt>
                  <dd class="break-words px-2 py-1 text-xs">
                    {value === null ? "null" : String(value)}
                  </dd>
                </div>
              {/each}
            </dl>
          </section>
        {/if}
      {/if}

      {#if renderedBody.trim().length > 0}
        <section>
          <h3 class="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            SKILL.md
          </h3>
          <!-- 渲染器关闭原始 HTML 透传，并兜底 sanitize；详见 render-skill-md.ts -->
          <div class="prose prose-sm max-w-none overflow-x-auto">{@html renderedBody}</div>
        </section>
      {:else}
        <p class="flex items-center gap-2 text-xs text-muted-foreground">
          <IconFile class="h-3.5 w-3.5" />
          {t("skillDetail.emptyBody")}
        </p>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* 窄屏（屏容器 < 560px）显示返回按钮；宽屏由 master-detail 并列承担。 */
  .detail-back {
    display: inline-flex;
  }
  @container (min-width: 560px) {
    .detail-back {
      display: none;
    }
  }
</style>
