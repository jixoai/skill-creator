<!--
  用户原始需求 [2026-09-08]（tasks 3.2）：「审批请求卡（决定经 Manager approval 链）」。
  正交意图：
  1. ask_user_question 的待答投影：问题/选项/多选；提交经 agent.session.answer
     （daemon 侧 answerer claim 的 waterfall——决定面在 Manager 进程内）。
  2. resolved 态降级为只读（幂等：重复提交返回 answered:false）。
  妥协声明：无。
-->
<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { answerAgentApproval } from "$lib/stores/agent.svelte";
  import type { PanelApprovalQuestion } from "$lib/stores/agent.svelte";

  let {
    seq,
    questions,
    resolved,
  }: {
    seq: number;
    questions: PanelApprovalQuestion[];
    resolved: boolean;
  } = $props();

  /** 每个问题的本地选择（option label 集合 + 自由文本）。 */
  let selections = $state<Record<string, string[]>>({});
  let customs = $state<Record<string, string>>({});

  function toggle(question: PanelApprovalQuestion, label: string): void {
    const current = selections[question.id] ?? [];
    if (question.multiSelect) {
      selections[question.id] = current.includes(label)
        ? current.filter((item) => item !== label)
        : [...current, label];
    } else {
      selections[question.id] = current.includes(label) ? [] : [label];
    }
  }

  function canSubmit(): boolean {
    return questions.every(
      (question) =>
        (selections[question.id] ?? []).length > 0 ||
        (customs[question.id] ?? "").trim().length > 0,
    );
  }

  function submit(): void {
    void answerAgentApproval(
      seq,
      questions.map((question) => ({
        id: question.id,
        selected: selections[question.id] ?? [],
        custom: (customs[question.id] ?? "").trim() || undefined,
      })),
    );
  }
</script>

<div
  class="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2.5 text-xs"
  role="group"
  aria-label={resolved ? "Answered question" : "Pending question"}
>
  <div class="mb-2 flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400">
    {resolved ? "Answered" : "Your decision"}
  </div>
  {#each questions as question (question.id)}
    <div class="mb-2 space-y-1.5">
      {#if question.header}
        <div class="text-[11px] font-medium text-muted-foreground">{question.header}</div>
      {/if}
      <div class="whitespace-pre-wrap">{question.question}</div>
      {#if question.detail}
        <div class="whitespace-pre-wrap text-[11px] text-muted-foreground">{question.detail}</div>
      {/if}
      {#if question.options && question.options.length > 0}
        <div class="flex flex-wrap gap-1.5">
          {#each question.options as option (option.label)}
            <button
              class="rounded-md border px-2 py-1 transition-colors {(
                selections[question.id] ?? []
              ).includes(option.label)
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border hover:bg-muted'}"
              disabled={resolved}
              aria-pressed={(selections[question.id] ?? []).includes(option.label)}
              onclick={() => toggle(question, option.label)}
            >
              {option.label}
              {#if option.description}
                <span class="block text-[10px] text-muted-foreground">{option.description}</span>
              {/if}
            </button>
          {/each}
        </div>
      {/if}
      <Input
        placeholder="Custom answer (optional)"
        disabled={resolved}
        value={customs[question.id] ?? ""}
        onchange={(event) => (customs[question.id] = event.currentTarget.value)}
        class="h-7 text-xs"
        aria-label="Custom answer for {question.question}"
      />
    </div>
  {/each}
  {#if !resolved}
    <div class="flex justify-end">
      <Button size="sm" disabled={!canSubmit()} onclick={submit}>Submit answer</Button>
    </div>
  {/if}
</div>
