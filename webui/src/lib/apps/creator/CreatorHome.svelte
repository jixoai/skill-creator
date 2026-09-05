<!--
  用户原始需求 [2026-07-27]：「Creator 用来编写 Skill，深度融合 AI」。
  正交意图：
  1. 模板画廊（按分类分组，点击打开新编辑 Tab）。
  2. 入口：打开已有技能 / 新建空白技能。
  视图状态：无（home Tab 本身无 search params）；点击操作导航到编辑 Tab。
-->
<script lang="ts">
  import { TEMPLATES, TEMPLATE_CATEGORIES, type TemplateCategory } from "$lib/templates";
  import { writableWorkspaceProviders } from "$lib/store.svelte";
  import { goto } from "$app/navigation";
  import IconCode from "@lucide/svelte/icons/code";
  import IconPen from "@lucide/svelte/icons/pen";
  import IconDatabase from "@lucide/svelte/icons/database";
  import IconPalette from "@lucide/svelte/icons/palette";
  import IconServer from "@lucide/svelte/icons/server";
  import IconScale from "@lucide/svelte/icons/scale";
  import IconBox from "@lucide/svelte/icons/box";
  import IconPlus from "@lucide/svelte/icons/plus";
  import IconFolderOpen from "@lucide/svelte/icons/folder-open";
  import type { Component } from "svelte";

  const CATEGORY_ICONS: Record<TemplateCategory, Component> = {
    coding: IconCode,
    writing: IconPen,
    data: IconDatabase,
    design: IconPalette,
    devops: IconServer,
    legal: IconScale,
    general: IconBox,
  };

  const groupedTemplates = $derived(
    Object.entries(TEMPLATE_CATEGORIES).map(([cat, meta]) => ({
      category: cat as TemplateCategory,
      label: meta.label,
      icon: CATEGORY_ICONS[cat as TemplateCategory] ?? IconBox,
      templates: TEMPLATES.filter((t) => t.category === cat),
    })),
  );

  const targets = $derived(writableWorkspaceProviders());

  function startWithTemplate(templateId: string): void {
    const target = targets[0];
    if (!target) {
      void goto("/workspaces");
      return;
    }
    void goto(
      `/creator/new/${target.target.workspaceId}/${target.target.providerId}?template=${templateId}`,
    );
  }

  function startBlank(): void {
    const target = targets[0];
    if (!target) {
      void goto("/workspaces");
      return;
    }
    void goto(`/creator/new/${target.target.workspaceId}/${target.target.providerId}`);
  }
</script>

<div class="flex h-full flex-col overflow-y-auto">
  <header class="shrink-0 border-b border-border px-5 py-4">
    <h1 class="text-lg font-semibold">Creator</h1>
    <p class="mt-0.5 text-xs text-muted-foreground">
      Write skills with AI assistance, test them in context, and iterate.
    </p>
  </header>

  <div class="mx-auto w-full max-w-4xl space-y-6 p-5">
    <div class="flex gap-3">
      <button
        class="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted/50"
        onclick={startBlank}
      >
        <IconPlus class="h-4 w-4" />
        New skill
      </button>
      <button
        class="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted/50"
        onclick={() => void goto("/workspaces")}
      >
        <IconFolderOpen class="h-4 w-4" />
        Open existing
      </button>
    </div>

    <div class="space-y-5">
      {#each groupedTemplates as group (group.category)}
        {#if group.templates.length > 0}
          <section>
            <div class="mb-2 flex items-center gap-2">
              <group.icon class="h-4 w-4 text-muted-foreground" />
              <h2 class="text-sm font-medium">{group.label}</h2>
            </div>
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {#each group.templates as tpl (tpl.id)}
                <button
                  class="rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted/50"
                  onclick={() => startWithTemplate(tpl.id)}
                >
                  <div class="text-sm font-medium">{tpl.name}</div>
                  <p class="mt-1 text-xs text-muted-foreground line-clamp-2">{tpl.description}</p>
                </button>
              {/each}
            </div>
          </section>
        {/if}
      {/each}
    </div>
  </div>
</div>
