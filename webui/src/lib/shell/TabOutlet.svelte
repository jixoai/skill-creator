<!--
  用户原始需求 [2026-07-27]：「三个导航意味着三个 ChromeTabs」。
  正交意图：
  1. 按 URL 匹配当前激活 App + activity，渲染对应 AppShell。
  2. 多 activity 支持：entry activity（home）+ 非 entry activity（实例）。
  参考：gaubee.com/src/lib/components/layout/AreaOutlet.svelte（精简版）。
-->
<script lang="ts">
  import { page } from "$app/state";
  import AppShell from "./AppShell.svelte";
  import { appRegistry } from "./registry.js";
  import { resolveTabIdentity } from "./nav-controller.svelte.js";
  import { matchRouteTree } from "./match.js";
  import type { AppActivity, AppManifest } from "./types.js";

  // 当前 URL pathname（响应式依赖）。
  const pathname = $derived(page.url.pathname);

  // 从 URL 解析当前激活 App id。
  const activeAppId = $derived.by(() => resolveTabIdentity(pathname)?.app ?? null);

  // 当前激活 App manifest。
  const activeApp = $derived.by(() => (activeAppId ? appRegistry.get(activeAppId) : null));

  // 解析当前 URL 应该用哪个 activity：用 matchRouteTree 逐个尝试，取首个 matched。
  const activeActivity = $derived.by(() => {
    if (!activeApp) return null;
    // 优先尝试每个 activity 的 matchRouteTree；取首个 matched。
    for (const a of activeApp.activities) {
      const result = matchRouteTree(a.root, pathname, page.url.search, a.pattern);
      if (result.kind === "matched" || result.kind === "parse-error") return a;
    }
    // 无匹配：回退到 entry activity。
    return activeApp.activities.find((a) => a.entry) ?? activeApp.activities[0] ?? null;
  });
</script>

<div class="tab-outlet-root">
  {#if activeApp && activeActivity}
    <AppShell app={activeApp} activity={activeActivity} />
  {:else}
    <div class="tab-empty">Select an app from the sidebar.</div>
  {/if}
</div>

<style>
  .tab-outlet-root {
    position: relative;
    height: 100%;
    overflow: hidden;
  }
  .tab-empty {
    display: flex;
    height: 100%;
    align-items: center;
    justify-content: center;
    color: var(--muted-foreground, gray);
    font-size: 0.875rem;
  }
</style>
