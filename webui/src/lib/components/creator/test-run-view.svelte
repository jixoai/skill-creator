<!--
  用户原始需求 [2026-09-30]：「webui 里面还有一些残留的未完成的工作，比如 skill
  测试与评估」（creator-test-session：Test 子视图做实）。
  正交意图：
  1. saved 模式：探针模板正文（可编辑）+「在 Agent 面板试跑」动作——经
     seedAgentTestRun 种子（文本 + 技能引用芯片 + seed 元数据），不自动发送。
  2. new 模式：无稳定 skillId——「先保存才能试跑」空态 + 去保存的入口
     （切回 File 子视图），不构造临时身份（A2）。
  视图状态：探针文本 → 组件 $state（名字变化时未编辑则跟随重渲染）；
  草稿身份 → 共享 creator-editor context。
-->
<script lang="ts">
  import { useCreatorEditor } from "$lib/stores/creator-editor.svelte";
  import { seedAgentTestRun } from "$lib/stores/agent.svelte";
  import { PROBE_RECALL_V1 } from "$lib/components/creator/test-probe";
  import { Button } from "$lib/components/ui/button";
  import IconFlask from "@lucide/svelte/icons/flask-conical";
  import IconSave from "@lucide/svelte/icons/save";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";

  const editor = useCreatorEditor();
  const draft = editor.draft;

  // 探针文本：跟随技能名重渲染，直到用户编辑（dirty 后不再覆盖）。
  let probeDirty = $state(false);
  let probeText = $state("");
  $effect(() => {
    const name = draft.name;
    if (!probeDirty) probeText = PROBE_RECALL_V1.render(name.length > 0 ? name : "skill");
  });

  const canRun = $derived(
    draft.mode === "edit" && draft.skillId !== null && draft.revision !== null,
  );

  function runInAgentPanel(): void {
    if (!canRun || draft.skillId === null || draft.revision === null) return;
    seedAgentTestRun({
      text: probeText.trim().length > 0 ? probeText : PROBE_RECALL_V1.render(draft.name),
      skill: {
        workspaceId: draft.target.workspaceId,
        providerId: draft.target.providerId,
        skillId: draft.skillId,
      },
      skillName: draft.name.length > 0 ? draft.name : draft.skillId,
      revision: draft.revision,
      templateId: PROBE_RECALL_V1.id,
      templateVersion: PROBE_RECALL_V1.version,
    });
  }

  function goSave(): void {
    const params = new URLSearchParams(page.url.searchParams);
    params.set("subview", "file");
    void goto(`${page.url.pathname}?${params.toString()}`);
  }
</script>

{#if canRun}
  <div class="flex h-full flex-col gap-3 p-4">
    <div class="flex items-center gap-2 text-sm font-medium">
      <IconFlask class="size-4 text-muted-foreground" />
      Test run
      <span class="text-xs font-normal text-muted-foreground">
        probe {PROBE_RECALL_V1.id} v{PROBE_RECALL_V1.version} · revision
        {draft.revision?.slice(0, 14)}…
      </span>
    </div>
    <p class="text-xs text-muted-foreground">
      在 Agent 面板打开一个携带 <code class="rounded bg-muted px-1">${draft.name}</code>
      技能引用的试跑会话——发送后由 daemon 展开技能文档，你可以编辑最终指令。
    </p>
    <textarea
      class="min-h-0 flex-1 resize-none rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      bind:value={probeText}
      oninput={() => (probeDirty = true)}
      aria-label="Test run prompt"
      spellcheck="false"
    ></textarea>
    <div class="flex shrink-0 items-center justify-end gap-2">
      <Button size="sm" variant="secondary" onclick={() => (probeDirty = false)}>
        Reset probe
      </Button>
      <Button size="sm" onclick={runInAgentPanel}>
        <IconFlask class="size-4" />
        Run in Agent panel
      </Button>
    </div>
  </div>
{:else}
  <div class="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
    <div class="space-y-2">
      <p class="font-medium text-foreground">Test run</p>
      <p>Save the skill first to test it — the run needs a stable skill identity.</p>
      <Button size="sm" variant="secondary" onclick={goSave}>
        <IconSave class="size-4" />
        Go save
      </Button>
    </div>
  </div>
{/if}
