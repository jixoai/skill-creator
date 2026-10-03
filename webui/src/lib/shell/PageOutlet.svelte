<script lang="ts">
  import { page } from "$app/state";
  import AppShell from "./AppShell.svelte";
  import { resolveShellRoute, sanitizeShellLocation } from "./route-hygiene.js";
  import { navigateTab, tabSession } from "./tab-session.svelte.js";

  const pathname = $derived(page.url.pathname);
  const search = $derived(page.url.search);
  const match = $derived(resolveShellRoute(pathname, search));
  const app = $derived(match?.result.kind === "matched" ? match.app : null);
  const activity = $derived(match?.result.kind === "matched" ? match.activity : null);

  // 走查 12-fix（redirect 落点卡 page-outlet-empty）：重定向导航必须在
  // $effect.pre 的执行上下文之外发起——在 pre 阶段同步调用 navigateTab（含
  // tabSession $state mutation + 异步 goto）会阻断本组件对 page.url 的依赖
  // 传播，URL 已到落点但 outlet 永不清除。推迟到宏任务并在执行时按当前 URL
  // 复核（期间布局侧 initializeTabSession 的 redirect 可能已修正 URL——重复
  // 或过期的重定向一律跳过；navigateTab 自身对目标再做一次 sanitize）。
  $effect.pre(() => {
    if (!tabSession.initialized) return;
    const decision = sanitizeShellLocation(pathname, search);
    if (decision.kind !== "redirect") return;
    setTimeout(() => {
      const current = sanitizeShellLocation(page.url.pathname, page.url.search);
      if (current.kind === "redirect") navigateTab(current.path, "REPLACE");
    }, 0);
  });
</script>

<div class="page-outlet-root">
  {#if app && activity}
    <AppShell {app} {activity} />
  {:else}
    <div class="page-outlet-empty" role="status">Opening page…</div>
  {/if}
</div>

<style>
  .page-outlet-root {
    position: relative;
    height: 100%;
    overflow: hidden;
  }
  .page-outlet-empty {
    display: flex;
    height: 100%;
    align-items: center;
    justify-content: center;
    color: var(--muted-foreground, gray);
    font-size: 0.875rem;
  }
</style>
