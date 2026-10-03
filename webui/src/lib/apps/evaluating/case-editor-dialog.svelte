<!--
  用户原始需求 [2026-10-03]（evaluating-dashboard design §3 / spec ADDED）：
  「case 新建编辑（Imported only；Global 只读）」——详情屏 case 编写的唯一入口。
  正交意图：
  1. 双形态：新建（boundRevision = 当前 revision，消费方注入）与编辑（保留原
     boundRevision——编辑语料内容不改绑定；重绑 = 删除后新建）。
  2. 五类断言编辑（kind 选择驱动 value 控件：string 三类 / boolean triggered /
     severity 枚举）+ 前端校验（prompt min1、断言 min1、string 值 min1）；
     Global target 一律拒绝打开（消费方不入口，本层再闸）。
  视图状态：表单草稿 → 组件本地 $state；提交 → cases.create/update/remove RPC
  + toast；成功后 onSaved 回调（消费方重拉行）。
-->
<script lang="ts">
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Textarea } from "$lib/components/ui/textarea";
  import { t } from "$lib/i18n";
  import { showToast } from "$lib/toast.svelte";
  import { getRpc } from "$lib/stores/connection.svelte";
  import { isGlobalEvaluationTarget } from "$lib/stores/evaluation-view.svelte";
  import type {
    EvaluationAssertion,
    EvaluationCase,
    EvaluationTarget,
  } from "$shared/contracts/evaluation.js";
  import IconLoader from "@lucide/svelte/icons/loader-circle";
  import IconPlus from "@lucide/svelte/icons/plus";
  import IconTrash from "@lucide/svelte/icons/trash-2";

  type AssertionKind = EvaluationAssertion["kind"];
  type SeverityValue = "info" | "warning" | "error";

  /** 表单断言模型（kind 决定 value 控件与序列化分支）。 */
  interface AssertionDraft {
    kind: AssertionKind;
    text: string;
    triggered: boolean;
    severity: SeverityValue;
    description: string;
  }

  function emptyAssertion(): AssertionDraft {
    return { kind: "contains", text: "", triggered: false, severity: "warning", description: "" };
  }

  function draftFromAssertion(assertion: EvaluationAssertion): AssertionDraft {
    return {
      kind: assertion.kind,
      text: typeof assertion.value === "string" ? assertion.value : String(assertion.value),
      triggered: assertion.kind === "finding-triggered" && assertion.value === true,
      severity:
        assertion.kind === "finding-severity"
          ? (assertion.value satisfies SeverityValue)
          : "warning",
      description: assertion.description ?? "",
    };
  }

  /** 草稿 → 契约断言（非法值返回 null——提交前统一校验）。 */
  function toAssertion(draft: AssertionDraft): EvaluationAssertion | null {
    const description = draft.description.trim() === "" ? undefined : draft.description.trim();
    switch (draft.kind) {
      case "contains":
      case "not-contains":
      case "finding-kind":
        if (draft.text.trim() === "") return null;
        return {
          kind: draft.kind,
          value: draft.text.trim(),
          ...(description ? { description } : {}),
        };
      case "finding-triggered":
        return {
          kind: draft.kind,
          value: draft.triggered,
          ...(description ? { description } : {}),
        };
      case "finding-severity":
        return { kind: draft.kind, value: draft.severity, ...(description ? { description } : {}) };
    }
  }

  let {
    open = $bindable(false),
    target,
    editing = null,
    currentRevision,
    onSaved = () => {},
  }: {
    open?: boolean;
    target: EvaluationTarget;
    /** null = 新建；非 null = 编辑该 case。 */
    editing?: EvaluationCase | null;
    /** 新建时的 boundRevision（消费方 = skills.info 现读 revision）。 */
    currentRevision: string;
    onSaved?: () => void;
  } = $props();

  let prompt = $state("");
  let assertions = $state<AssertionDraft[]>([emptyAssertion()]);
  let enabled = $state(true);
  let submitting = $state(false);
  let deleting = $state(false);
  let confirmDelete = $state(false);
  let validation = $state<string | null>(null);

  // 弹层开启时播种表单（关闭即弃草稿——重新打开重播种）。
  $effect(() => {
    if (!open) return;
    if (editing === null) {
      prompt = "";
      assertions = [emptyAssertion()];
      enabled = true;
    } else {
      prompt = editing.input.prompt;
      assertions = editing.input.assertions.map(draftFromAssertion);
      enabled = editing.enabled;
    }
    validation = null;
    confirmDelete = false;
  });

  function kindLabel(kind: AssertionKind): string {
    switch (kind) {
      case "contains":
        return t("evaluating.kindContains");
      case "not-contains":
        return t("evaluating.kindNotContains");
      case "finding-kind":
        return t("evaluating.kindFindingKind");
      case "finding-triggered":
        return t("evaluating.kindFindingTriggered");
      case "finding-severity":
        return t("evaluating.kindFindingSeverity");
    }
  }

  function addAssertion(): void {
    assertions = [...assertions, emptyAssertion()];
  }

  function removeAssertion(index: number): void {
    assertions = assertions.filter((_, i) => i !== index);
  }

  function patchAssertion(index: number, patch: Partial<AssertionDraft>): void {
    assertions = assertions.map((draft, i) => (i === index ? { ...draft, ...patch } : draft));
  }

  /** 提交校验（i18n 文案；失败停在弹层内，不发 RPC）。 */
  function validate(promptValue: string, drafts: AssertionDraft[]): string | null {
    if (promptValue.trim() === "") return t("evaluating.casePromptRequired");
    if (drafts.length === 0) return t("evaluating.caseNeedOneAssertion");
    for (const draft of drafts) {
      if (
        (draft.kind === "contains" ||
          draft.kind === "not-contains" ||
          draft.kind === "finding-kind") &&
        draft.text.trim() === ""
      ) {
        return t("evaluating.caseAssertionValueRequired");
      }
    }
    return null;
  }

  async function submit(): Promise<void> {
    if (isGlobalEvaluationTarget(target)) return;
    const invalid = validate(prompt, assertions);
    if (invalid !== null) {
      validation = invalid;
      return;
    }
    const serialized = assertions.map(toAssertion);
    if (serialized.some((entry) => entry === null)) {
      validation = t("evaluating.caseAssertionValueRequired");
      return;
    }
    const rpc = getRpc();
    if (!rpc) {
      showToast(t("evaluating.runDisconnectedToast"));
      return;
    }
    submitting = true;
    try {
      const input = {
        prompt: prompt.trim(),
        assertions: serialized as EvaluationAssertion[],
      };
      if (editing === null) {
        await rpc.evaluation.cases.create({
          target,
          input,
          boundRevision: currentRevision,
          enabled,
        });
      } else {
        await rpc.evaluation.cases.update({
          target,
          caseId: editing.caseId,
          input,
          boundRevision: editing.boundRevision,
          enabled,
        });
      }
      showToast(t("evaluating.caseSavedToast"));
      open = false;
      onSaved();
    } catch (error) {
      showToast(
        t("evaluating.caseSaveFailedToast", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      submitting = false;
    }
  }

  async function removeCase(): Promise<void> {
    if (editing === null) return;
    if (isGlobalEvaluationTarget(target)) return;
    const rpc = getRpc();
    if (!rpc) {
      showToast(t("evaluating.runDisconnectedToast"));
      return;
    }
    deleting = true;
    try {
      await rpc.evaluation.cases.remove({ target, caseId: editing.caseId });
      showToast(t("evaluating.caseDeletedToast"));
      open = false;
      onSaved();
    } catch (error) {
      showToast(
        t("evaluating.caseDeleteFailedToast", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      deleting = false;
      confirmDelete = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-[560px]">
    <Dialog.Header>
      <Dialog.Title>
        {editing === null ? t("evaluating.caseEditorNewTitle") : t("evaluating.editCaseTitle")}
      </Dialog.Title>
    </Dialog.Header>

    <div class="space-y-4">
      <div class="space-y-1.5">
        <label class="text-xs font-medium" for="evaluating-case-prompt">
          {t("evaluating.casePromptLabel")}
        </label>
        <Textarea
          id="evaluating-case-prompt"
          bind:value={prompt}
          rows={3}
          placeholder={t("evaluating.casePromptPlaceholder")}
          class="text-xs"
        />
      </div>

      <div class="space-y-1.5">
        <p class="text-xs font-medium">{t("evaluating.caseAssertionsLabel")}</p>
        <div class="space-y-2">
          {#each assertions as draft, index (index)}
            <div
              class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 rounded-md border border-border p-2"
            >
              <select
                class="h-8 rounded-md border border-border bg-transparent px-2 text-xs"
                aria-label={t("evaluating.caseAssertionKind")}
                value={draft.kind}
                onchange={(event) =>
                  patchAssertion(index, {
                    kind: (event.currentTarget as HTMLSelectElement).value as AssertionKind,
                  })}
              >
                {#each ["contains", "not-contains", "finding-kind", "finding-triggered", "finding-severity"] as kind (kind)}
                  <option value={kind}>{kindLabel(kind as AssertionKind)}</option>
                {/each}
              </select>
              <div class="min-w-0 space-y-1.5">
                {#if draft.kind === "finding-triggered"}
                  <label class="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      class="size-4"
                      checked={draft.triggered}
                      onchange={(event) =>
                        patchAssertion(index, {
                          triggered: (event.currentTarget as HTMLInputElement).checked,
                        })}
                    />
                    true
                  </label>
                {:else if draft.kind === "finding-severity"}
                  <select
                    class="h-8 w-full rounded-md border border-border bg-transparent px-2 text-xs"
                    aria-label={t("evaluating.caseAssertionValue")}
                    value={draft.severity}
                    onchange={(event) =>
                      patchAssertion(index, {
                        severity: (event.currentTarget as HTMLSelectElement).value as SeverityValue,
                      })}
                  >
                    {#each ["info", "warning", "error"] as severity (severity)}
                      <option value={severity}>{severity}</option>
                    {/each}
                  </select>
                {:else}
                  <Input
                    class="h-8 text-xs"
                    aria-label={t("evaluating.caseAssertionValue")}
                    bind:value={draft.text}
                  />
                {/if}
                <Input
                  class="h-7 text-[11px] text-muted-foreground"
                  aria-label={t("evaluating.caseAssertionDescription")}
                  bind:value={draft.description}
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                class="h-8 w-8 p-0 text-muted-foreground"
                title={t("evaluating.deleteCaseTitle")}
                onclick={() => removeAssertion(index)}
              >
                <IconTrash class="h-3.5 w-3.5" />
              </Button>
            </div>
          {/each}
        </div>
        <Button variant="outline" size="sm" class="h-7 gap-1.5 text-xs" onclick={addAssertion}>
          <IconPlus class="h-3.5 w-3.5" />
          {t("evaluating.caseAddAssertion")}
        </Button>
      </div>

      <label class="flex items-center gap-2 text-xs">
        <input type="checkbox" class="size-4" bind:checked={enabled} />
        {t("evaluating.caseEnabledLabel")}
      </label>

      {#if validation}
        <p class="text-xs text-destructive" data-testid="case-validation">{validation}</p>
      {/if}
    </div>

    <Dialog.Footer>
      {#if editing !== null}
        {#if confirmDelete}
          <Button
            variant="destructive"
            size="sm"
            class="gap-1.5"
            disabled={deleting}
            onclick={() => void removeCase()}
          >
            {#if deleting}<IconLoader class="h-3.5 w-3.5 animate-spin" />{/if}
            {t("evaluating.caseDeleteConfirmTitle")}
          </Button>
        {:else}
          <Button
            variant="ghost"
            size="sm"
            class="gap-1.5 text-muted-foreground"
            title={t("evaluating.caseDeleteConfirmBody")}
            onclick={() => (confirmDelete = true)}
          >
            <IconTrash class="h-3.5 w-3.5" />
            {t("evaluating.caseDelete")}
          </Button>
        {/if}
      {/if}
      <Button variant="outline" size="sm" onclick={() => (open = false)}>
        {t("common.cancel")}
      </Button>
      <Button size="sm" disabled={submitting} onclick={() => void submit()}>
        {#if submitting}<IconLoader class="h-3.5 w-3.5 animate-spin" />{/if}
        {t("evaluating.caseSave")}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
