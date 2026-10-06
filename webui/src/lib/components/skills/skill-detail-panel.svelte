<!--
  用户原始需求 [2026-10-02]（skills-dashboard design §2，r2/r3 修订）：
  「detail = 只读文档详情 + 管理动作；frontmatter/正文编辑唯一真相 = Creator 编辑页。
  现 ProviderView 的 name/description 行内轻量编辑随迁移退役（不迁移）」。
  修订 [2026-10-06]（skills-tabs-redesign 批 2，Δ3）：宿主从 skills-screen 的
  master-detail 面板退役为 workspaces.skillDetail 独立路由页（SkillDetailPage）
  的信息/动作单元；新增外部持有模式（`info` + `onRefresh` 可选 prop——页面拥有
  数据加载与 not-found 裁决，组件在 info !== undefined 时跳过自载）。
  正交意图：
  1. 只读文档详情：frontmatter 解析表 + markdown 正文渲染（skills.info，组件级
     $state + request-generation gate，不跨渲染周期缓存；外部持有模式跳过）。
  2. 管理动作：Validate / Update check（只读检查，apply 不在此面）/ Toggle
     （skills.toggle = skills 域唯一写 RPC）/ Chat about this skill
     （creator-agent-chat 1.4 实装：resume 键 = target + seedSkill 精确匹配，
     命中续聊 / 无匹配新建携带技能上下文——agent 域动作，非 skills 域写）/
     Edit in Creator 深链 / Insights 深链（workspaces.intelligence 与
     Agents screen 同链）。
  3. 零编辑写：无 creator.save/delete 调用；除 skills.toggle 外零写 RPC
     （design §7 源扫描断言面）。
  4. 窄屏返回触发行恢复由宿主管理；本组件只回调 onBack（独立路由页宿主用
     面包屑承担返回，不传 onBack）。
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
  import { showErrorToast, showToast } from "$lib/toast.svelte";
  import { t } from "$lib/i18n";
  import { SkillIdSchema, type SkillId, type SkillInfo } from "$shared/contracts/skills.js";
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
    isNarrowScreen = false,
    info = undefined,
    onRefresh,
  }: {
    target: WorkspaceProviderTarget;
    skillId: string;
    onBack?: () => void;
    isNarrowScreen?: boolean;
    /** 外部持有模式（独立路由页宿主）：页面拥有 skills.info 加载与 typed
     *  not-found 裁决；undefined = 组件自载（历史模式，当前无其他消费方）。 */
    info?: SkillInfo | null;
    /** 外部持有模式下 toggle 后的刷新回调（页面重拉 info 投影新状态）。 */
    onRefresh?: () => void | Promise<void>;
  } = $props();

  const infoRequests = createRequestGenerationGate(getConnectionGeneration);
  let loadedDetail = $state<Awaited<ReturnType<typeof fetchSkillInfo>> | null>(null);
  let detailLoading = $state(false);
  let detailError = $state<string | null>(null);
  let validating = $state(false);
  let validation = $state<{ success: boolean; errors: string[]; warnings: string[] } | null>(null);
  let toggling = $state(false);
  let checkingUpdate = $state(false);

  // 外部持有模式优先；自载模式回退组件内数据。
  const detail = $derived(info !== undefined ? info : loadedDetail);

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
      loadedDetail = null;
      detailError = t("skillDetail.invalidId");
      return;
    }
    detailLoading = true;
    detailError = null;
    validation = null;
    try {
      const info = await fetchSkillInfo(currentTarget, parsed.data as SkillId);
      if (!request.isCurrent()) return;
      loadedDetail = info;
    } catch (error) {
      if (!request.isCurrent()) return;
      loadedDetail = null;
      detailError = error instanceof Error ? error.message : String(error);
    } finally {
      if (request.isLatest()) detailLoading = false;
    }
  }

  // 详情身份变化即重拉（skills.info；仅自载模式；组件级 request-generation gate）。
  $effect(() => {
    if (info !== undefined) return;
    void loadDetail(target, skillId);
  });

  // 详情就绪后聚焦语义标题（同技能刷新不重复夺焦）。
  $effect(() => {
    if (!detail) return;
    if (info === undefined && detailLoading) return;
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
    const modeLabel =
      mode === "enable" ? t("skillDetail.modeEnable") : t("skillDetail.modeDisable");
    try {
      const summary = await toggleSkills([current.id], mode);
      if (!summary) return; // 请求已被取代（断线/切 provider），不投影结果
      const entry = summary.results.find((item) => item.skillId === current.id);
      if (entry) {
        // mutation 反馈区分 succeeded/skipped/conflict/failed（AGENTS §7.2）。
        if (entry.status === "conflict") {
          // 冲突态带 daemon 原文（entry.error）→ 错误 toast 叠加宽泛提示。
          if (entry.error) {
            showErrorToast(
              t("skillDetail.toastConflict", {
                name: entry.name,
                mode: modeLabel,
                error: entry.error,
              }),
            );
          } else {
            showToast(t("skillDetail.toastConflictPlain", { name: entry.name, mode: modeLabel }));
          }
        } else if (entry.status === "failed") {
          showErrorToast(
            t("skillDetail.toastFailed", {
              name: entry.name,
              mode: modeLabel,
              error: entry.error ?? t("skillDetail.unknownError"),
            }),
          );
        } else if (entry.status === "skipped") {
          showToast(
            `${entry.name}: ${mode === "enable" ? t("skillDetail.alreadyEnabled") : t("skillDetail.alreadyDisabled")}`,
          );
        } else {
          showToast(t("skillDetail.toastStatus", { name: entry.name, status: entry.status }));
        }
      }
      // 外部持有模式：宿主重拉 info 投影新状态；自载模式原地刷新。
      if (onRefresh) await onRefresh();
      else await loadDetail(target, current.id);
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : String(error));
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
  // FD-05 Chat 启动后上下文衔接：窄屏 backToList() / 宽屏 toast。
  function handleChatAbout(): void {
    const current = detail;
    if (!current) return;
    void startSkillChat(
      {
        workspaceId: target.workspaceId,
        providerId: target.providerId,
        skillId: current.id,
        skillName: current.name,
      },
      {
        onChatStarted: () => {
          if (isNarrowScreen) {
            onBack?.();
          } else {
            showToast(t("skillsWorkspace.skillsScreen.chatOpenedInPanel"));
          }
        },
      },
    );
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
      <!-- 头部栈式两行（修复批 2 P1-1）：标题/描述横跨 pane 全宽，动作按钮独立
           成行——同级行布局下 shrink-0 动作列（~300px）会把 flex-1 文本柱挤压成
           60-90px 的逐词换行细柱（master-detail pane 宽 ~430px 时，1919px 视口
           三屏复现——pane 宽由网格轨道决定，与视口宽度无关）。 -->
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
          <h2 class="truncate text-base font-semibold" title={detail.name}>{detail.name}</h2>
          <p class="mt-0.5 text-xs leading-5 text-muted-foreground">{detail.description}</p>
        </div>
      </div>
      <!-- 动作行（2.2 处置批 P2-9）：nowrap + 行内横滚（chips-row 同族）——四个
           动作不再 3+1 ragged wrap（换行位置随 pane 宽度漂移）；滚动条隐藏，
           溢出可拖。 -->
      <div class="detail-actions mt-2 flex shrink-0 items-center justify-end gap-1.5">
        <Button
          variant="ghost"
          size="icon"
          class="h-8 w-8 shrink-0"
          title={t("skillDetail.insightsTitle")}
          aria-label={t("skillDetail.insightsTitle")}
          onclick={() =>
            goById(
              "workspaces.insights",
              {
                wsId: target.workspaceId,
                providerId: target.providerId,
              },
              { skill: skillId },
            )}
        >
          <IconGraph class="h-4 w-4" />
        </Button>
        {#if editable}
          <Button
            variant="outline"
            size="sm"
            class="h-8 shrink-0 gap-1.5"
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
          class="h-8 shrink-0 gap-1.5"
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
          class="h-8 shrink-0 gap-1.5"
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
      <!-- metadata 行（P2-9）：Update check 并入（原 body 独立区块退役）——徽标
           流（provider/目录/禁用/更新态）与轻量只读动作同列，正文区不再被
           单按钮区块打断。 -->
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
        <Button
          variant="outline"
          size="sm"
          class="h-6 shrink-0 gap-1 px-2 text-[11px]"
          disabled={checkingUpdate || skillsUpdateState.checking}
          onclick={() => void handleCheckUpdate()}
        >
          {#if checkingUpdate || skillsUpdateState.checking}
            <IconLoader class="h-3 w-3 animate-spin" />
          {:else}
            <IconDownload class="h-3 w-3" />
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
            <span
              class="min-w-0 flex-1 truncate text-xs text-muted-foreground"
              title={updateEntry.error}
            >
              {updateEntry.error}
            </span>
          {/if}
        {:else if skillsUpdateState.checkError}
          <span
            class="min-w-0 flex-1 truncate text-xs text-destructive"
            role="alert"
            title={skillsUpdateState.checkError}
          >
            {skillsUpdateState.checkError}
          </span>
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

      <!-- Update check 独立区块已并入头部 metadata 行（2.2 处置批 P2-9）。 -->

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
          <!-- 渲染器关闭原始 HTML 透传，并兜底 sanitize；详见 render-skill-md.ts。
               pre 在列内折行（2.2 处置批 P2-9，与 creator preview P2-5 同族法则）。 -->
          <div
            class="prose prose-sm max-w-none prose-pre:whitespace-pre-wrap prose-pre:break-words"
          >
            {@html renderedBody}
          </div>
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
  /* 窄屏栈式态显示返回按钮；宽屏由 master-detail 并列承担。阈值 660px：
     dashboard 单列降档（<692px）下详情满宽 ≈ 视口 - padding（620 视口 →
     ~604px pane）——旧的 560px 阈值会在栈式态恰好隐藏返回钮（r2 评图
     TOP5：最需要返回的时候按钮消失），抬到 660 保证栈式 pane 恒显示；
     分栏态 detail pane 通常 ≥660 时不显示（中档分栏 pane 偏窄时多显一个
     返回钮无害——行为与列表返回同族）。 */
  .detail-back {
    display: inline-flex;
  }
  @container (min-width: 660px) {
    .detail-back {
      display: none;
    }
  }
  /* 动作行单行横滚（2.2 处置批 P2-9，skills-screen chips-row 同族）：滚动条
     隐藏，「可滚」由溢出截断自证；动作永不 ragged wrap。 */
  .detail-actions {
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .detail-actions::-webkit-scrollbar {
    display: none;
  }
</style>
