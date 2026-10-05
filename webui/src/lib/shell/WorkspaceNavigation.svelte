<!--
  用户原始需求 [2026-09-30]：workspace 页左侧页内导航（Omnibox 汉堡开合）。
  正交意图：
    1. 桌面（≥1024 宽标签列 / 721–1023 图标条）：static 侧栏列，随内容行 flex。
    2. 移动（≤719）：grid 同格抽屉（2026-10-05 布局裁决「absolute/fixed 尽量
       退场」——scrim 与抽屉列同格 1/1 堆叠，覆盖关系 = 小 z 阶梯 scrim 10 <
       抽屉 20，恒低于全局 Dialog 50；开合仍由 workspaceNavigation.open 驱动，
       点 scrim 关闭语义不变）。
-->
<script lang="ts">
  import { page } from "$app/state";
  import IconBoxes from "@lucide/svelte/icons/boxes";
  import IconPen from "@lucide/svelte/icons/file-pen-line";
  import IconBook from "@lucide/svelte/icons/book-open";
  import IconChart from "@lucide/svelte/icons/chart-no-axes-column-increasing";
  import { t } from "$lib/i18n";
  import { tabIdForPath } from "./tab-session.js";
  import { navigateTab } from "./tab-session.svelte.js";
  import { closeWorkspaceNavigation, workspaceNavigation } from "./workspace-navigation.svelte.js";

  const workspaceId = $derived(tabIdForPath(page.url.pathname) ?? "~");
  const section = $derived(page.url.pathname.split("/")[3] ?? "skills");
  // labels 经 $derived 内 t() 读取 locale（导航名 zh 保留英文专名——design §5）。
  const items = $derived([
    { id: "skills", label: t("shell.navSkills"), icon: IconBoxes },
    { id: "creator", label: t("shell.navCreator"), icon: IconPen },
    { id: "wiki", label: t("shell.navWiki"), icon: IconBook },
    { id: "evaluating", label: t("shell.navEvaluating"), icon: IconChart },
  ]);
</script>

{#if workspaceNavigation.open}
  <button
    type="button"
    class="hidden bg-foreground/15 max-[719px]:[grid-area:1/1] max-[719px]:z-10 max-[719px]:block"
    aria-label={t("shell.closeNavigationAria")}
    onclick={closeWorkspaceNavigation}
  ></button>
{/if}
<nav
  class="flex w-44 shrink-0 flex-col gap-1 border-r border-border bg-muted/20 p-2 max-[1023px]:w-11 max-[1023px]:items-center max-[1023px]:px-1 max-[719px]:[grid-area:1/1] max-[719px]:z-20 max-[719px]:w-56 max-[719px]:items-stretch max-[719px]:border-r max-[719px]:bg-background max-[719px]:p-2 {workspaceNavigation.open
    ? 'max-[719px]:flex'
    : 'max-[719px]:hidden'}"
  aria-label={t("shell.workspacePagesAria")}
>
  {#each items as item (item.id)}
    {@const Icon = item.icon}
    <button
      class="flex h-9 items-center gap-2 rounded px-2 text-left text-xs transition-colors max-[1023px]:w-9 max-[1023px]:justify-center max-[1023px]:px-0 max-[719px]:w-auto max-[719px]:justify-start max-[719px]:px-2 {section ===
      item.id
        ? 'bg-primary/10 text-primary'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
      aria-current={section === item.id ? "page" : undefined}
      title={item.label}
      onclick={() => {
        closeWorkspaceNavigation();
        navigateTab(`/w/${encodeURIComponent(workspaceId)}/${item.id}`);
      }}
    >
      <Icon class="h-4 w-4" />
      <span class="max-[1023px]:sr-only max-[719px]:not-sr-only">{item.label}</span>
    </button>
  {/each}
</nav>
