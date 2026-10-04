<!--
  Creator 会话面（creator-agent-chat 1.2/1.3）：SessionFace 复用接入 + 创作护栏轨。
  用户原始需求 [2026-10-03]（design §1/§2）：「会话面组件与 SkillsAgentPage 共享
  （session-face 组件族），Creator 传入 creatorPreset」「会话内阶段 chip（当前
  环节提示，不阻塞自由对话）；test 环节提供『生成测试话术建议』；草稿产出卡 =
  diff 预览 + Save via proposal」。
  正交意图：
    1. 面复用：SessionFace 无必填 props 挂载即得 transcript+composer+todos
       （Agent 页/Panel 同源单 store）；creatorPreset 沿现有 mode 机制 = 起草
       入口设 pendingMode=create（工具面/persona 段随模式收敛，零新契约）。
    2. 护栏轨（提示性）：循环阶段 chip（本地态，不阻塞对话）；test 阶段的
       话术建议按钮 → 建议编号行一次性解析 → 点选深链 evaluating 详情
       （seedSkill 未知 = 新技能未落盘，toast 提示不深链）。
    3. 草稿产出卡：creator_save_propose 工具帧投影（args safeParse + 深扫
       proposalId）；Save via proposal = agent.proposals.approve（统一审批面
       同链；本地决定态覆盖投影）；update 卡带编辑器深链。
  妥协声明：草稿卡置于面上方 dock（SessionFace 内部编排不可注入——组件族
  归属地）；diff 以草稿正文预览呈现（unified diff 真相在审批面/修订日志）。
  双挂载拖放去重：workspace 页的 attach 面板常驻挂载（开关 = 收起不销毁），
  本面再挂 SessionFace 时文档级 drop 会被两个 DropOverlay 各消费一次（附件
  翻倍）——本面在 capture 阶段先占：停掉全部 bubble 监听、唯一执行
  handleComposerDrop，再以合成 dragleave（types 含 Files 才被接纳）复位两个
  覆盖层的深度计数与可视态。
-->
<script lang="ts">
  import IconFileDiff from "@lucide/svelte/icons/file-diff";
  import IconLoader from "@lucide/svelte/icons/loader-circle";
  import IconPen from "@lucide/svelte/icons/file-pen-line";
  import IconSparkles from "@lucide/svelte/icons/sparkles";
  import { goById } from "$lib/shell";
  import { t } from "$lib/i18n";
  import { showErrorToast, showToast } from "$lib/toast.svelte";
  import { requireRpc } from "$lib/stores/connection.svelte";
  import { agentComposer, handleComposerDrop } from "$lib/stores/agent-composer.svelte";
  import { agentSession, agentSessionsList } from "$lib/stores/agent.svelte";
  import { SkillIdSchema } from "$shared/contracts/skills.js";
  import SessionFace from "$lib/components/agent/SessionFace.svelte";
  import {
    CREATOR_LOOP_STAGES,
    buildTestSuggestionPrompt,
    draftCardsFromItems,
    parseTestSuggestions,
    type CreatorLoopStage,
  } from "./creator-sessions.js";

  /** 阶段标签文案键（chip 逐阶段；键集与 CREATOR_LOOP_STAGES 同序）。 */
  const STAGE_LABEL_KEYS: Record<CreatorLoopStage, Parameters<typeof t>[0]> = {
    capture: "creatorChat.stageCapture",
    draft: "creatorChat.stageDraft",
    test: "creatorChat.stageTest",
    review: "creatorChat.stageReview",
    improve: "creatorChat.stageImprove",
  };

  /** 当前阶段（提示性本地态；会话切换复位 capture——不写会话真相）。 */
  let stage = $state<CreatorLoopStage>("capture");
  $effect(() => {
    void agentSession.sessionId;
    stage = "capture";
    awaitingSuggestions = false;
    suggestions = [];
  });

  /** 话术建议流：请求后首条 assistant 终帧一次性解析（编号行）。 */
  let awaitingSuggestions = $state(false);
  let suggestions = $state<string[]>([]);
  $effect(() => {
    if (!awaitingSuggestions) return;
    const last = agentSession.items[agentSession.items.length - 1];
    if (!last || last.kind !== "assistant" || last.streaming) return;
    const parsed = parseTestSuggestions(last.text);
    if (parsed.length === 0) return;
    awaitingSuggestions = false;
    suggestions = parsed;
  });

  /** 会话摘要（深链身份：seedSkill + provider 从 server 投影取）。 */
  const summary = $derived(
    agentSessionsList.sessions.find((item) => item.sessionId === agentSession.sessionId) ?? null,
  );

  /** 建议请求：空稿直接填，有稿追加（不覆盖用户草稿；不自动发送）。 */
  function requestTestSuggestions(): void {
    const prompt = buildTestSuggestionPrompt();
    agentComposer.text =
      agentComposer.text.trim().length === 0
        ? prompt
        : `${agentComposer.text.trimEnd()}\n\n${prompt}`;
    awaitingSuggestions = true;
    suggestions = [];
  }

  /** 建议点选 → 深链 evaluating 详情的 case 草稿（design §2：衔接 evaluating）。 */
  function openSuggestionInEvaluating(): void {
    const target = summary?.target;
    const seedSkill = summary?.seedSkill ?? null;
    if (!target?.providerId || seedSkill === null) {
      showToast(t("creatorChat.suggestionNoSkill"));
      return;
    }
    goById("evaluating.detail", {
      wsId: target.workspaceId,
      providerId: target.providerId,
      skillId: seedSkill,
    });
  }

  /** 草稿卡（帧投影；proposalId 缺 = calling 中或结果不含提案）。 */
  const draftCards = $derived(draftCardsFromItems(agentSession.items));

  /** 本地决定态（seq → 决定结果；覆盖帧投影——approve 是一次性动作）。 */
  let decided = $state<Record<number, "executed" | "failed" | "rejected">>({});
  let decidingSeq = $state<number | null>(null);

  /** Save via proposal（design §2：proposal 链 + revision 闸在 server capability）。 */
  async function decideDraft(
    cardSeq: number,
    proposalId: string,
    decision: "approve" | "reject",
  ): Promise<void> {
    if (decidingSeq !== null) return;
    decidingSeq = cardSeq;
    try {
      const rpc = requireRpc();
      const result =
        decision === "approve"
          ? await rpc.agent.proposals.approve({ proposalId })
          : await rpc.agent.proposals.reject({ proposalId });
      decided[cardSeq] =
        result.proposal.status === "executed"
          ? "executed"
          : result.proposal.status === "rejected"
            ? "rejected"
            : "failed";
      showToast(
        decision === "approve"
          ? decided[cardSeq] === "executed"
            ? t("creatorChat.draftSaved")
            : t("creatorChat.draftFailed")
          : t("creatorChat.draftRejected"),
      );
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : String(error));
    } finally {
      decidingSeq = null;
    }
  }

  /** 草稿正文预览行（首 24 行；展开完整）。 */
  let expandedDraft = $state<number | null>(null);
  const PREVIEW_LINES = 24;

  function draftPreviewLines(body: string, seq: number): string {
    const lines = body.split("\n");
    if (expandedDraft === seq || lines.length <= PREVIEW_LINES) return body;
    return lines.slice(0, PREVIEW_LINES).join("\n");
  }

  /** update 草稿 → 编辑器深链（编辑唯一真相 = Creator 编辑页；id 先收窄）。 */
  function openDraftInEditor(cardMode: "create" | "update", cardSkillId: string | undefined): void {
    const target = summary?.target;
    const parsed = cardSkillId === undefined ? null : SkillIdSchema.safeParse(cardSkillId);
    if (cardMode !== "update" || !parsed?.success || !target?.providerId) {
      showToast(t("creatorChat.draftEditNewHint"));
      return;
    }
    goById("creator.workspace.skill", {
      mode: "edit",
      wsId: target.workspaceId,
      providerId: target.providerId,
      skillId: parsed.data,
    });
  }

  // ---- 双挂载拖放去重（见文件头妥协声明）----
  function carriesFiles(event: DragEvent): boolean {
    return [...(event.dataTransfer?.types ?? [])].includes("Files");
  }

  function onDropCapture(event: DragEvent): void {
    if (!carriesFiles(event)) return;
    event.stopImmediatePropagation();
    handleComposerDrop(event);
    // 合成 dragleave 复位两个覆盖层（无 dataTransfer 的合成事件会被其守卫忽略）。
    for (let i = 0; i < 5; i += 1) {
      const leave = new DragEvent("dragleave");
      Object.defineProperty(leave, "dataTransfer", { value: { types: ["Files"] } });
      document.dispatchEvent(leave);
    }
  }

  $effect(() => {
    document.addEventListener("drop", onDropCapture, true);
    return () => document.removeEventListener("drop", onDropCapture, true);
  });
</script>

<div class="flex h-full min-h-0 flex-col" data-creator-chat="true">
  <!-- 护栏轨：阶段 chip（提示性）+ test 话术建议入口。 -->
  <div
    class="flex h-9 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border px-3"
    role="group"
    aria-label={t("creatorChat.stageRailAria")}
  >
    {#each CREATOR_LOOP_STAGES as entry, index (entry)}
      {#if index > 0}
        <span class="text-[10px] text-muted-foreground/60" aria-hidden="true">→</span>
      {/if}
      <button
        type="button"
        class="relative shrink-0 rounded-full px-2.5 py-0.5 text-[11px] transition-colors after:absolute after:-inset-1 after:content-[''] {stage ===
        entry
          ? 'bg-primary/10 font-medium text-primary'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
        aria-current={stage === entry ? "step" : undefined}
        title={t("creatorChat.stageHint")}
        onclick={() => (stage = entry)}
      >
        {t(STAGE_LABEL_KEYS[entry])}
      </button>
    {/each}
    <span class="min-w-2 flex-1"></span>
    <button
      type="button"
      class="relative flex shrink-0 items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted-foreground transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-muted hover:text-foreground {stage ===
      'test'
        ? 'border-primary/40 text-primary'
        : ''}"
      title={t("creatorChat.suggestTestsTitle")}
      onclick={requestTestSuggestions}
    >
      <IconSparkles class="h-3 w-3" aria-hidden="true" />
      {t("creatorChat.suggestTests")}
    </button>
  </div>

  <!-- 话术建议条：编号话术点选 → evaluating 详情 case 草稿（seedSkill 已知才深链）。 -->
  {#if suggestions.length > 0}
    <div
      class="shrink-0 border-b border-border bg-muted/20 px-3 py-2"
      role="group"
      aria-label={t("creatorChat.suggestionsTitle")}
    >
      <p class="mb-1.5 text-[11px] font-medium text-muted-foreground">
        {t("creatorChat.suggestionsTitle")}
      </p>
      <div class="flex flex-col gap-1">
        {#each suggestions as suggestion, index (index)}
          <button
            type="button"
            class="relative rounded-md border border-border bg-background px-2.5 py-1.5 text-left text-xs transition-colors after:absolute after:-inset-1 after:content-[''] hover:border-primary/40 hover:bg-muted/50"
            title={t("creatorChat.suggestionChipTitle")}
            onclick={openSuggestionInEvaluating}
          >
            <span class="mr-1.5 text-muted-foreground">{index + 1}.</span>{suggestion}
          </button>
        {/each}
      </div>
    </div>
  {/if}

  <!-- 草稿产出卡 dock：面上方（SessionFace 内部编排不可注入）；最新在上。 -->
  {#if draftCards.length > 0}
    <div
      class="max-h-64 shrink-0 overflow-y-auto border-b border-border px-3 py-2"
      role="group"
      aria-label={t("creatorChat.draftDockAria")}
    >
      {#each [...draftCards].reverse() as card (card.seq)}
        {@const decision = decided[card.seq]}
        <div
          class="mb-2 rounded-lg border border-border bg-card px-3 py-2.5 text-xs shadow-sm"
          data-creator-draft-card={card.seq}
        >
          <div class="flex items-center gap-1.5">
            <IconFileDiff class="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span
              class="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
            >
              {card.mode === "create"
                ? t("creatorChat.draftModeCreate")
                : t("creatorChat.draftModeUpdate")}
            </span>
            <span class="min-w-0 flex-1 truncate font-medium">{card.name}</span>
            {#if card.expectedRevision}
              <span
                class="shrink-0 font-mono text-[9px] text-muted-foreground/70"
                title={t("creatorChat.draftRevisionTitle")}
              >
                {card.expectedRevision.slice(0, 14)}…
              </span>
            {/if}
          </div>
          <p class="mt-1 line-clamp-2 text-muted-foreground">{card.description}</p>
          <details class="mt-1.5">
            <summary
              class="cursor-pointer list-none text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              {expandedDraft === card.seq
                ? t("creatorChat.draftCollapse")
                : t("creatorChat.draftExpand")}
            </summary>
            <pre
              class="mt-1.5 max-h-48 overflow-auto rounded-md border border-border bg-muted/30 p-2 font-mono text-[10px] leading-4 whitespace-pre-wrap">{draftPreviewLines(
                card.body,
                card.seq,
              )}</pre>
          </details>
          <div class="mt-2 flex flex-wrap items-center justify-end gap-1.5">
            {#if card.mode === "update"}
              <button
                type="button"
                class="relative flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground after:absolute after:-inset-1 after:content-[''] hover:text-foreground"
                title={t("creatorChat.draftEditInEditor")}
                onclick={() => openDraftInEditor(card.mode, card.skillId)}
              >
                <IconPen class="h-3 w-3" aria-hidden="true" />
                {t("creatorChat.draftEditInEditor")}
              </button>
            {/if}
            {#if decision !== undefined}
              <span
                class="rounded px-2 py-1 text-[11px] {decision === 'executed'
                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : decision === 'rejected'
                    ? 'bg-muted text-muted-foreground'
                    : 'bg-destructive/10 text-destructive'}"
                role="status"
              >
                {decision === "executed"
                  ? t("creatorChat.draftSaved")
                  : decision === "rejected"
                    ? t("creatorChat.draftRejected")
                    : t("creatorChat.draftFailed")}
              </span>
            {:else if card.proposalId === null}
              {#if card.phase === "calling"}
                <span class="flex items-center gap-1 px-1 text-[11px] text-muted-foreground">
                  <IconLoader class="h-3 w-3 animate-spin" aria-hidden="true" />
                  {t("creatorChat.draftWaitingProposal")}
                </span>
              {:else}
                <span class="px-1 text-[11px] text-muted-foreground">
                  {t("creatorChat.draftNoProposal")}
                </span>
              {/if}
            {:else}
              <button
                type="button"
                class="relative rounded px-2 py-1 text-[11px] text-muted-foreground after:absolute after:-inset-1 after:content-[''] hover:text-foreground"
                disabled={decidingSeq !== null}
                onclick={() => void decideDraft(card.seq, card.proposalId ?? "", "reject")}
              >
                {t("creatorChat.draftReject")}
              </button>
              <button
                type="button"
                class="relative flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground after:absolute after:-inset-1 after:content-[''] hover:bg-primary/90 disabled:opacity-50"
                disabled={decidingSeq !== null}
                data-draft-save="true"
                onclick={() => void decideDraft(card.seq, card.proposalId ?? "", "approve")}
              >
                {#if decidingSeq === card.seq}
                  <IconLoader class="h-3 w-3 animate-spin" aria-hidden="true" />
                {/if}
                {t("creatorChat.draftSave")}
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <SessionFace />
</div>
