<!--
  Creator 首屏（creator-agent-chat 1.1/1.5/1.8）：会话工作台。
  用户原始需求 [2026-10-03]（design §1/§3 + specs/creator）：「/w/:wsId/creator
  首屏：左 = 本 ws 创作会话列表（target=ws 过滤 + creator 前端标记，非平行
  meta schema）+ 主 = 新会话引导（意图输入 + seed 模板选择）或所选会话 Chat」
  「模板画廊退位：模板作为新会话 seed 选项（capture 阶段可载入模板 frontmatter
  起点）」「Global 空态引导（切换 Imported，不隐藏导航项）」。
  正交意图：
    1. 会话列表（左）：summary 前端过滤（target.workspaceId = 当前 ws 且
       seedSkill 非空）——零新 RPC、零平行 schema，会话真相与 Agent 页/Panel
       同源一份；行内 Edit 深链（编辑唯一真相 = Creator 编辑页）。
    2. 新会话引导卡（主，capture 阶段）：三输入（意图/触发/例子）+ 模板 seed
       选项；「让 agent 起草」= 首条结构化 prompt（seed）+ pendingMode=create
       （creatorPreset 沿现有 mode 机制）+ target/cwd 归属（Imported ws root）。
    3. Global 空态（1.8）：~ 无写入目标——单焦点引导切换 Imported（顶栏 tab 是
       唯一 ws 切换面，页内不列 ws 清单；workspace-page-polish V3 收敛），不承载
       创作表单。
  妥协声明：视图态（guide/chat）为页面本地态（不进 URL——会话选择真相在
  agentSession 单例，Agent 页 ?session= 深链已覆盖直达场景）。
-->
<script lang="ts">
  import { untrack } from "svelte";
  import IconLoader from "@lucide/svelte/icons/loader-circle";
  import IconPen from "@lucide/svelte/icons/file-pen-line";
  import IconPlus from "@lucide/svelte/icons/plus";
  import IconSparkles from "@lucide/svelte/icons/sparkles";
  import { t } from "$lib/i18n";
  import { useParams, goById } from "$lib/shell";
  import { TEMPLATES, TEMPLATE_CATEGORIES, type TemplateCategory } from "$lib/templates";
  import { workspaceState } from "$lib/stores/workspaces.svelte";
  import { connectionState } from "$lib/stores/connection.svelte";
  import {
    agentPanel,
    agentSession,
    agentSessionsList,
    beginNewAgentSession,
    loadAgentSessions,
    selectAgentSession,
  } from "$lib/stores/agent.svelte";
  import { SkillIdSchema } from "$shared/contracts/skills.js";
  import { sessionDisplayName } from "$lib/apps/agent/session-tree.js";
  import { buildCreatorSeedPrompt, creatorSessionsForWorkspace } from "./creator-sessions.js";
  import CreatorChat from "./CreatorChat.svelte";

  const getParams = useParams<{
    wsId: import("$lib/types").WorkspaceId;
  }>();
  const wsId = $derived(getParams?.()?.wsId);
  const isGlobal = $derived(wsId === ("~" as const));

  // 会话列表：连接建立后拉取（未连接不发 RPC；每连接一次性，失败不重试——
  // 重连/刷新钮语义与 AgentPanel 同族；此处无刷新钮，重连重新武装）。
  let autoLoadedList = false;
  $effect(() => {
    if (connectionState.status !== "connected") {
      autoLoadedList = false;
      return;
    }
    if (autoLoadedList || agentSessionsList.loaded || agentSessionsList.loading) return;
    autoLoadedList = true;
    void loadAgentSessions();
  });

  /** 本 ws 创作会话（specs/creator「会话列表按 summary 过滤」：seedSkill 非空）。 */
  const creatorSessions = $derived(
    wsId === undefined ? [] : creatorSessionsForWorkspace(agentSessionsList.sessions, wsId),
  );

  /** 主区视图：guide（capture 引导卡）| chat（所选/新会话 Chat）。 */
  // 回访直达（一次性初始判定，刻意不追踪后续变化——untrack 表达意图）：
  // 当前会话已属本 ws 创作列表 → 直接呈现会话面（不重新夺回引导）。
  let view = $state<"guide" | "chat">(
    untrack(() => creatorSessions.some((item) => item.sessionId === agentSession.sessionId))
      ? "chat"
      : "guide",
  );

  function openSession(sessionId: string): void {
    selectAgentSession(sessionId);
    view = "chat";
  }

  // ---- 引导卡（capture 阶段）----
  let intentText = $state("");
  let triggerText = $state("");
  let examplesText = $state("");
  let templateId = $state("");

  const groupedTemplates = $derived(
    Object.entries(TEMPLATE_CATEGORIES).map(([category, meta]) => ({
      category: category as TemplateCategory,
      label: meta.label,
      templates: TEMPLATES.filter((item) => item.category === category),
    })),
  );

  const selectedTemplate = $derived(
    templateId === "" ? undefined : TEMPLATES.find((item) => item.id === templateId),
  );

  const importedWorkspaces = $derived(
    workspaceState.workspaces.filter((workspace) => workspace.kind === "directory"),
  );

  /**
   * 「让 agent 起草」（design §2 seed）：结构化 prompt + target/cwd 归属 +
   * pendingMode=create（creatorPreset = 现有 mode 机制的工具面/persona 段收敛，
   * 零新契约）；seed 不自动发送——首条消息由用户确认（惰性建会话）。
   */
  function startGuidedDraft(): void {
    if (wsId === undefined || isGlobal || intentText.trim().length === 0) return;
    const workspace = workspaceState.workspaces.find((item) => item.id === wsId);
    const cwd = workspace?.kind === "directory" ? workspace.path : undefined;
    beginNewAgentSession({
      target: { workspaceId: wsId },
      ...(cwd !== undefined ? { cwd } : {}),
    });
    agentPanel.seed = {
      text: buildCreatorSeedPrompt({
        intent: intentText,
        trigger: triggerText,
        examples: examplesText,
        ...(selectedTemplate !== undefined
          ? {
              templateName: selectedTemplate.name,
              templateDescription: selectedTemplate.description,
            }
          : {}),
      }),
    };
    agentSession.pendingMode = "create";
    view = "chat";
  }

  /** 会话行的技能 Edit 深链（design §3：seedSkill + provider 可解析才给出）。 */
  function editSkillOfSession(session: (typeof creatorSessions)[number]): void {
    const providerId = session.target?.providerId;
    const parsed = SkillIdSchema.safeParse(session.seedSkill);
    if (!providerId || !parsed.success || wsId === undefined) return;
    goById("creator.workspace.skill", {
      mode: "edit",
      wsId,
      providerId,
      skillId: parsed.data,
    });
  }
</script>

{#if isGlobal}
  <!-- Global 空态（1.8）：~ 无写入目标——引导切换 Imported；导航项不隐藏（shell 属地）。 -->
  <div class="flex h-full flex-col overflow-y-auto">
    <header class="shrink-0 border-b border-border px-5 py-4">
      <h1 class="text-lg font-semibold">{t("creatorHome.title")}</h1>
      <p class="mt-0.5 text-xs text-muted-foreground">{t("creatorHome.subtitle")}</p>
    </header>
    <div class="mx-auto w-full max-w-xl p-5">
      <div
        class="rounded-xl border border-dashed border-border p-5 text-center"
        data-creator-global-guide="true"
      >
        <IconSparkles class="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <h2 class="mt-2 text-sm font-medium">{t("creatorHome.globalTitle")}</h2>
        <p class="mt-1 text-xs leading-5 text-muted-foreground">{t("creatorHome.globalBody")}</p>
        {#if importedWorkspaces.length > 0}
          <p class="mt-3 text-xs text-muted-foreground/80">
            {t("creatorHome.globalSwitchHint")}
          </p>
        {:else}
          <p class="mt-3 text-xs text-muted-foreground/80">{t("creatorHome.globalNone")}</p>
        {/if}
      </div>
    </div>
  </div>
{:else}
  <section
    class="flex h-full min-h-0 flex-col overflow-hidden bg-background"
    data-creator-home="true"
  >
    <div class="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
      <IconPen class="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      <span class="text-xs font-medium">{t("creatorHome.title")}</span>
      <span class="min-w-0 flex-1"></span>
      <button
        type="button"
        class="relative flex h-6 items-center gap-1 rounded px-2 text-[11px] text-muted-foreground after:absolute after:-inset-1 after:content-[''] hover:bg-muted hover:text-foreground {view ===
        'guide'
          ? 'bg-muted text-foreground'
          : ''}"
        aria-current={view === "guide" ? "true" : undefined}
        onclick={() => (view = "guide")}
      >
        <IconPlus class="h-3 w-3" aria-hidden="true" />
        {t("creatorHome.newCreation")}
      </button>
    </div>

    <div class="flex min-h-0 flex-1">
      <!-- 左：本 ws 创作会话列表（summary 过滤；行内 Edit 深链）。 -->
      <nav
        class="w-56 shrink-0 overflow-y-auto border-r border-border p-1"
        aria-label={t("creatorHome.sessionsHeader")}
        data-creator-sessions="true"
      >
        <p class="px-2 py-1 text-[11px] font-medium text-muted-foreground">
          {t("creatorHome.sessionsHeader")}
        </p>
        {#if agentSessionsList.loading && !agentSessionsList.loaded}
          <div
            class="flex items-center gap-1.5 px-2 py-2 text-[11px] text-muted-foreground"
            role="status"
          >
            <IconLoader class="h-3 w-3 animate-spin" aria-hidden="true" />
            {t("creatorHome.sessionsLoading")}
          </div>
        {:else if agentSessionsList.error}
          <p class="px-2 py-2 text-[11px] text-destructive" role="alert">
            {agentSessionsList.error}
          </p>
        {:else if creatorSessions.length === 0}
          <p class="px-2 py-2 text-[11px] leading-4 text-muted-foreground">
            {t("creatorHome.sessionsEmpty")}
          </p>
        {:else}
          {#each creatorSessions as session (session.sessionId)}
            <div
              class="group/row flex h-8 items-center gap-1.5 rounded pr-1 pl-2 transition-colors {agentSession.sessionId ===
              session.sessionId
                ? 'bg-primary/10'
                : 'hover:bg-muted'}"
            >
              <span
                class="h-1.5 w-1.5 shrink-0 rounded-full {session.status === 'running'
                  ? 'bg-primary'
                  : session.status === 'disposed'
                    ? 'bg-muted-foreground/40'
                    : 'bg-muted-foreground'}"
                aria-hidden="true"
              ></span>
              <button
                type="button"
                class="relative min-w-0 flex-1 truncate text-left text-xs {agentSession.sessionId ===
                session.sessionId
                  ? 'text-primary'
                  : 'text-foreground/80'} after:absolute after:-inset-1 after:content-['']"
                aria-current={agentSession.sessionId === session.sessionId ? "true" : undefined}
                title="{sessionDisplayName(session)} ({session.status})"
                onclick={() => openSession(session.sessionId)}
              >
                {sessionDisplayName(session)}
              </button>
              {#if session.target?.providerId && session.seedSkill}
                <button
                  type="button"
                  class="relative flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 opacity-0 transition-opacity after:absolute after:-inset-1 after:content-[''] group-hover/row:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100"
                  title={t("creatorHome.sessionEditTitle")}
                  aria-label={t("creatorHome.sessionEditTitle")}
                  onclick={() => editSkillOfSession(session)}
                >
                  <IconPen class="h-3 w-3" aria-hidden="true" />
                </button>
              {/if}
            </div>
          {/each}
        {/if}
      </nav>

      <!-- 主：capture 引导卡 或 所选会话 Chat。 -->
      {#if view === "chat"}
        <main class="flex min-w-0 flex-1 flex-col">
          <CreatorChat />
        </main>
      {:else}
        <main class="min-w-0 flex-1 overflow-y-auto">
          <div class="mx-auto w-full max-w-xl px-5 py-6" data-creator-guide="true">
            <h2 class="text-sm font-medium">{t("creatorHome.guideTitle")}</h2>
            <p class="mt-1 text-xs text-muted-foreground">{t("creatorHome.guideIntro")}</p>
            <p
              class="mt-1.5 rounded-md bg-muted/40 px-2.5 py-1.5 font-mono text-[10px] text-muted-foreground"
            >
              {t("creatorHome.loopHint")}
            </p>

            <div class="mt-4 flex flex-col gap-3">
              <label class="flex flex-col gap-1 text-xs">
                <span class="font-medium">{t("creatorHome.intentLabel")}</span>
                <textarea
                  rows="2"
                  class="resize-none rounded-lg border border-border bg-transparent px-2.5 py-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder={t("creatorHome.intentPlaceholder")}
                  bind:value={intentText}></textarea>
              </label>
              <label class="flex flex-col gap-1 text-xs">
                <span class="font-medium">{t("creatorHome.triggerLabel")}</span>
                <input
                  type="text"
                  class="rounded-lg border border-border bg-transparent px-2.5 py-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder={t("creatorHome.triggerPlaceholder")}
                  bind:value={triggerText}
                />
              </label>
              <label class="flex flex-col gap-1 text-xs">
                <span class="font-medium">{t("creatorHome.examplesLabel")}</span>
                <textarea
                  rows="3"
                  class="resize-none rounded-lg border border-border bg-transparent px-2.5 py-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder={t("creatorHome.examplesPlaceholder")}
                  bind:value={examplesText}></textarea>
              </label>
              <label class="flex flex-col gap-1 text-xs">
                <span class="font-medium">{t("creatorHome.templateLabel")}</span>
                <select
                  class="h-8 rounded-lg border border-border bg-transparent px-2 text-xs"
                  bind:value={templateId}
                >
                  <option value="">{t("creatorHome.templateNone")}</option>
                  {#each groupedTemplates as group (group.category)}
                    {#if group.templates.length > 0}
                      <optgroup label={group.label}>
                        {#each group.templates as template (template.id)}
                          <option value={template.id}>{template.name}</option>
                        {/each}
                      </optgroup>
                    {/if}
                  {/each}
                </select>
              </label>
            </div>

            <button
              type="button"
              class="relative mt-4 flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground after:absolute after:-inset-1 after:content-[''] hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={intentText.trim().length === 0}
              title={t("creatorHome.startDraftTitle")}
              data-start-draft="true"
              onclick={startGuidedDraft}
            >
              <IconSparkles class="h-4 w-4" aria-hidden="true" />
              {t("creatorHome.startDraft")}
            </button>
          </div>
        </main>
      {/if}
    </div>
  </section>
{/if}
