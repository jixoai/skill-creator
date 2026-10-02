<!--
  用户原始需求 [2026-09-30]（evaluation-corpus Ch3 后续批 / evaluation-webui-view）：
  「webui 里面还有一些残留的未完成的工作，比如 skill 测试与评估」——Eval 子视图 =
  评估语料的最小只读查看入口。
  正交意图：
  1. edit 模式：只读列出当前技能的评估 case 与每案最新结果（五态 outcome 徽标 +
     observedEndRevision 短显 + 展示层 stale 角标）；不提供任何创建/运行入口。
  2. new 模式：无稳定 skillId——「先保存」空态（与 Test 子视图同族），不发 RPC。
  视图状态：行数据 → evaluation-view store（latest-request-wins 代次门）；
  草稿身份 → 共享 creator-editor context。
-->
<script lang="ts">
  import { untrack } from "svelte";
  import { useCreatorEditor } from "$lib/stores/creator-editor.svelte";
  import {
    evaluationOutcomeBadge,
    evaluationViewState,
    loadEvaluationView,
    resetEvaluationView,
    type EvaluationRow,
  } from "$lib/stores/evaluation-view.svelte";
  import { connectionState } from "$lib/store.svelte";
  import { Button } from "$lib/components/ui/button";
  import IconClipboard from "@lucide/svelte/icons/clipboard-check";
  import IconLoader from "@lucide/svelte/icons/loader-circle";
  import IconSave from "@lucide/svelte/icons/save";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";

  const editor = useCreatorEditor();
  const draft = editor.draft;

  // edit 身份就绪时自动拉取（skillId 变化重拉）；卸载清空（防跨技能串数据）。
  $effect(() => {
    if (draft.mode !== "edit" || draft.skillId === null) return;
    void loadEvaluationView({
      workspaceId: draft.target.workspaceId,
      providerId: draft.target.providerId,
      skillId: draft.skillId,
    });
  });
  $effect(() => {
    return () => resetEvaluationView();
  });

  // 挂载竞态补救（WS5 走查 B；与 ProviderView/file-browser 同族）：深链首帧
  // WS 未就绪时 loadEvaluationView 对 rpc=null 静默 no-op——rows/error/loading
  // 全空即无重试入口的空白面板。连接转 ready 且尚无数据时自动重发。
  let lastConnectionStatus = $state(connectionState.status);
  $effect(() => {
    const status = connectionState.status;
    const was = untrack(() => lastConnectionStatus);
    lastConnectionStatus = status;
    if (was === "connected" || status !== "connected") return;
    if (untrack(() => evaluationViewState.rows) !== null) return;
    const retrySkillId = untrack(() => draft.skillId);
    if (untrack(() => draft.mode) !== "edit" || retrySkillId === null) return;
    void loadEvaluationView({
      workspaceId: untrack(() => draft.target.workspaceId),
      providerId: untrack(() => draft.target.providerId),
      skillId: retrySkillId,
    });
  });

  const rows = $derived(evaluationViewState.rows);
  const loading = $derived(evaluationViewState.loading);
  const error = $derived(evaluationViewState.error);

  /** prompt 摘要（首行 + 截断；完整正文留在 CLI/MCP 语料里）。 */
  function promptSummary(row: EvaluationRow): string {
    const firstLine = row.prompt.split("\n")[0] ?? "";
    return firstLine.length > 72 ? `${firstLine.slice(0, 72)}…` : firstLine;
  }

  /** revision 短显：剥掉 `sha256:` 前缀后截 hex 部分（整串截 14 只露 7 位 hex）。 */
  function shortRevision(value: string): string {
    const hex = value.startsWith("sha256:") ? value.slice("sha256:".length) : value;
    return hex.slice(0, 14);
  }

  function reload(): void {
    if (draft.mode === "edit" && draft.skillId !== null) {
      void loadEvaluationView({
        workspaceId: draft.target.workspaceId,
        providerId: draft.target.providerId,
        skillId: draft.skillId,
      });
    }
  }

  function goSave(): void {
    const params = new URLSearchParams(page.url.searchParams);
    params.set("subview", "file");
    void goto(`${page.url.pathname}?${params.toString()}`);
  }
</script>

<div class="flex h-full flex-col">
  <div class="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
    <span class="flex items-center gap-2 text-xs font-medium">
      <IconClipboard class="size-3.5 text-muted-foreground" />
      Evaluation
      {#if rows !== null}
        <span class="font-normal text-muted-foreground">
          {rows.length} case{rows.length === 1 ? "" : "s"} · read-only
        </span>
      {/if}
    </span>
    {#if draft.mode === "edit" && draft.skillId}
      <Button variant="outline" size="sm" class="h-7 gap-1.5" onclick={reload} disabled={loading}>
        {#if loading}<IconLoader class="h-3.5 w-3.5 animate-spin" />{:else}<IconClipboard
            class="h-3.5 w-3.5"
          />{/if}
        Refresh
      </Button>
    {/if}
  </div>

  {#if draft.mode !== "edit" || draft.skillId === null}
    <!-- new 模式：与 Test 子视图同族的「先保存」空态。 -->
    <div
      class="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground"
    >
      <div class="space-y-2">
        <p class="font-medium text-foreground">Evaluation</p>
        <p>
          Save the skill first to view its evaluation results — the view needs a stable skill
          identity.
        </p>
        <Button size="sm" variant="secondary" onclick={goSave}>
          <IconSave class="size-4" />
          Go save
        </Button>
      </div>
    </div>
  {:else if loading && rows === null}
    <div class="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
      <IconLoader class="h-4 w-4 animate-spin" /> Loading evaluation…
    </div>
  {:else if error}
    <div class="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
      <p class="text-xs text-destructive">{error}</p>
      <Button variant="outline" size="sm" onclick={reload}>Retry</Button>
    </div>
  {:else if rows !== null && rows.length === 0}
    <!-- edit 模式但该技能尚无语料：指向 CLI/MCP（本批不做创建 UI）。 -->
    <div
      class="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground"
    >
      No evaluation cases for this skill yet — create them via CLI/MCP.
    </div>
  {:else if rows !== null}
    <div class="min-h-0 flex-1 overflow-y-auto p-3">
      <ul class="space-y-1.5">
        {#each rows as row (row.caseId)}
          <li class="rounded-md border border-border px-3 py-2">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <p class="truncate text-xs">{promptSummary(row)}</p>
                <p
                  class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground"
                >
                  <span>{row.enabled ? "enabled" : "disabled"}</span>
                  <span>{row.assertionCount} assertion{row.assertionCount === 1 ? "" : "s"}</span>
                  <span title={row.boundRevision}>bound {shortRevision(row.boundRevision)}…</span>
                </p>
              </div>
              <div class="flex shrink-0 flex-col items-end gap-1">
                {#if row.latest}
                  <span
                    class="rounded px-1.5 py-0.5 text-[11px] font-medium {evaluationOutcomeBadge(
                      row.latest.outcome,
                    )}"
                  >
                    {row.latest.outcome}
                  </span>
                  <span
                    class="flex items-center gap-1.5 text-[11px] text-muted-foreground"
                    title={row.latest.observedEndRevision}
                  >
                    {#if row.latest.stale && row.latest.outcome !== "stale"}
                      <span
                        class="rounded bg-amber-500/10 px-1 py-0.5 text-amber-700 dark:text-amber-300"
                      >
                        stale
                      </span>
                    {/if}
                    rev {shortRevision(row.latest.observedEndRevision)}…
                  </span>
                {:else}
                  <span
                    class="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
                  >
                    not run
                  </span>
                {/if}
              </div>
            </div>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>
