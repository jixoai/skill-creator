<!--
  用户原始需求 [2026-07-27]：「右侧『校验』子视图：skills.validate 结果（errors/warnings）」。
  正交意图：
  1. 调用 skills.validate 校验当前技能；展示错误（红）与警告（黄）。
  2. 『Re-validate』按钮：重新触发校验。
  视图状态：校验结果 → 组件 $state（瞬时 UI）；技能正文 → daemon RPC（基于磁盘最新内容）。
  妥协声明：校验走已保存到磁盘的 SKILL.md；草稿未保存的修改不会反映在校验结果里（与 ProviderView 行为一致）。
-->
<script lang="ts">
  import { useCreatorEditor } from "$lib/stores/creator-editor.svelte";
  import { requireRpc } from "$lib/store.svelte";
  import { createRequestGenerationGate } from "$lib/stores/request-generation";
  import { getConnectionGeneration } from "$lib/store.svelte";
  import { t } from "$lib/i18n";
  import { Button } from "$lib/components/ui/button";
  import IconLoader from "@lucide/svelte/icons/loader-circle";
  import IconShield from "@lucide/svelte/icons/shield-alert";
  import IconCheck from "@lucide/svelte/icons/circle-check";
  import type { ValidateResult } from "$lib/types";

  const editor = useCreatorEditor();
  const draft = editor.draft;

  const validateRequests = createRequestGenerationGate(getConnectionGeneration);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let result = $state<ValidateResult | null>(null);

  // 进入子视图或 skillId 变化时自动校验一次。
  $effect(() => {
    if (draft.mode !== "edit" || draft.skillId === null) return;
    void validate(draft.skillId);
  });

  async function validate(skillId: NonNullable<typeof draft.skillId>): Promise<void> {
    const request = validateRequests.issue();
    loading = true;
    error = null;
    try {
      const res = await requireRpc().skills.validate({
        workspaceId: draft.target.workspaceId,
        providerId: draft.target.providerId,
        skillId,
      });
      if (!request.isCurrent()) return;
      result = res;
    } catch (err) {
      if (!request.isCurrent()) return;
      error = err instanceof Error ? err.message : String(err);
      result = null;
    } finally {
      if (request.isLatest()) loading = false;
    }
  }

  /** 重新校验当前 edit 模式技能（null-safe 包装）。 */
  function revalidateCurrent(): void {
    if (draft.mode === "edit" && draft.skillId) {
      void validate(draft.skillId);
    }
  }
</script>

<div class="flex h-full flex-col">
  <div class="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
    <span class="text-xs font-medium">{t("creatorValidation.title")}</span>
    {#if draft.mode === "edit" && draft.skillId}
      <Button
        variant="outline"
        size="sm"
        class="h-7 gap-1.5"
        onclick={revalidateCurrent}
        disabled={loading}
      >
        {#if loading}<IconLoader class="h-3.5 w-3.5 animate-spin" />{:else}<IconShield
            class="h-3.5 w-3.5"
          />{/if}
        {t("creatorValidation.revalidate")}
      </Button>
    {/if}
  </div>

  {#if draft.mode === "new"}
    <div
      class="flex flex-1 items-center justify-center px-8 text-center text-xs text-muted-foreground"
    >
      {t("creatorValidation.saveFirst")}
    </div>
  {:else if draft.mode === "store"}
    <!-- creator-skill-store 批 2：skills.validate 是 provider-scoped 面，store 文档
         不适用——如实惰态（保存结果自带 validation 反馈），不发 RPC。 -->
    <div
      class="flex flex-1 items-center justify-center px-8 text-center text-xs text-muted-foreground"
    >
      {t("creatorValidation.storeUnavailable")}
    </div>
  {:else if loading && result === null}
    <div class="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
      <IconLoader class="h-4 w-4 animate-spin" />
      {t("creatorValidation.loading")}
    </div>
  {:else if error}
    <div class="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
      <p class="text-xs text-destructive">{error}</p>
      {#if draft.skillId}
        <Button variant="outline" size="sm" onclick={revalidateCurrent}>
          {t("common.retry")}
        </Button>
      {/if}
    </div>
  {:else if result}
    <div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
      {#if result.success && result.errors.length === 0 && result.warnings.length === 0}
        <div class="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300">
          <IconCheck class="h-4 w-4" />
          {t("creatorValidation.passes")}
        </div>
      {:else}
        {#if result.errors.length > 0}
          <section>
            <h3 class="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-destructive">
              {t("creatorValidation.errors", { count: result.errors.length })}
            </h3>
            <ul class="space-y-1">
              {#each result.errors as issue, i (i)}
                <li
                  class="flex gap-2 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
                >
                  <IconShield class="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span class="break-words">{issue}</span>
                </li>
              {/each}
            </ul>
          </section>
        {/if}
        {#if result.warnings.length > 0}
          <section>
            <h3
              class="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300"
            >
              {t("creatorValidation.warnings", { count: result.warnings.length })}
            </h3>
            <ul class="space-y-1">
              {#each result.warnings as issue, i (i)}
                <li
                  class="flex gap-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-300"
                >
                  <IconShield class="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span class="break-words">{issue}</span>
                </li>
              {/each}
            </ul>
          </section>
        {/if}
      {/if}
    </div>
  {/if}
</div>
