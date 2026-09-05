<!--
  用户原始需求 [2026-07-27]：「Creator 编辑 tab 左右分栏，右侧各种子视图」。
  正交意图：[1] 渲染 [文件][日志][预览][校验][测试] 五个子视图 tab；激活子视图编码到 URL。
-->
<script lang="ts">
  import { useSearch } from "$lib/shell";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import IconFile from "@lucide/svelte/icons/file-text";
  import IconHistory from "@lucide/svelte/icons/history";
  import IconEye from "@lucide/svelte/icons/eye";
  import IconCheck from "@lucide/svelte/icons/check-circle";
  import IconFlask from "@lucide/svelte/icons/flask-conical";
  import type { Component } from "svelte";

  type SubView = "file" | "log" | "preview" | "validate" | "test";

  const TABS: Array<{ id: SubView; label: string; icon: Component }> = [
    { id: "file", label: "File", icon: IconFile },
    { id: "log", label: "History", icon: IconHistory },
    { id: "preview", label: "Preview", icon: IconEye },
    { id: "validate", label: "Validate", icon: IconCheck },
    { id: "test", label: "Test", icon: IconFlask },
  ];

  const getSearch = useSearch<{ subview?: SubView }>();
  const active = $derived(getSearch?.()?.subview ?? "file");

  function switchView(view: SubView): void {
    const params = new URLSearchParams(page.url.search);
    params.set("subview", view);
    void goto(`${page.url.pathname}?${params.toString()}`);
  }
</script>

<div class="flex shrink-0 items-center gap-1 border-b border-border px-2">
  {#each TABS as tab (tab.id)}
    <button
      class="flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors {active ===
      tab.id
        ? 'border-b-2 border-primary text-primary'
        : 'text-muted-foreground hover:text-foreground'}"
      onclick={() => switchView(tab.id)}
    >
      <tab.icon class="h-3.5 w-3.5" />
      {tab.label}
    </button>
  {/each}
</div>
