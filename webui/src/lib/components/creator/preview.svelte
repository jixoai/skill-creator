<!--
  用户原始需求 [2026-07-27]：「右侧『预览』子视图：渲染后的 SKILL.md（markdown + frontmatter 表）」。
  正交意图：
  1. 从共享 editor context 读取草稿（name/description/body），渲染为 frontmatter 元数据表 + markdown 正文。
  2. 实时预览：草稿变更（File 子视图编辑）即刻反映，无需保存。
  视图状态：无（纯读 draft，派生渲染）。
-->
<script lang="ts">
  import { useCreatorEditor, draftToFrontmatter } from "$lib/stores/creator-editor.svelte";
  import { renderSkillBody } from "$lib/render-skill-md";

  const editor = useCreatorEditor();
  const draft = editor.draft;

  const frontmatter = $derived(draftToFrontmatter(draft));
  const renderedBody = $derived(renderSkillBody(draft.body));
  const entries = $derived(
    Object.entries(frontmatter).filter(([key]) => key !== "name" && key !== "description"),
  );
</script>

<div class="flex h-full flex-col overflow-y-auto p-4">
  <section class="mb-4">
    <h1 class="text-base font-semibold">{draft.name || "Untitled skill"}</h1>
    <p class="mt-0.5 text-xs leading-5 text-muted-foreground">
      {draft.description || "No description yet."}
    </p>
  </section>

  <section class="mb-4">
    <h2 class="mb-2 text-[11px] font-medium text-muted-foreground">Frontmatter</h2>
    {#if entries.length === 0}
      <p class="text-[11px] text-muted-foreground/70">
        Only name and description — no additional metadata.
      </p>
    {:else}
      <dl class="overflow-x-auto rounded-md border border-border">
        {#each entries as [key, value], i (key)}
          <div class="grid grid-cols-[120px_minmax(0,1fr)] {i > 0 ? 'border-t border-border' : ''}">
            <dt class="bg-muted/40 px-2 py-1 text-[11px] font-medium text-muted-foreground">
              {key}
            </dt>
            <dd class="break-words px-2 py-1 text-[11px]">
              {value === null ? "null" : String(value)}
            </dd>
          </div>
        {/each}
      </dl>
    {/if}
  </section>

  <section class="min-h-0 flex-1">
    <h2 class="mb-2 text-[11px] font-medium text-muted-foreground">Body</h2>
    {#if draft.body.trim().length === 0}
      <p class="text-xs text-muted-foreground/70">Nothing to preview yet.</p>
    {:else}
      <div class="prose prose-sm max-w-none overflow-x-auto">{@html renderedBody}</div>
    {/if}
  </section>
</div>
