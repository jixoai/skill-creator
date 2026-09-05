<!--
  用户原始需求 [2026-07-27]：「参考 gaubee.com 的 AppShell 标准」。
  正交意图：
  1. 堆叠隔离：isolation:isolate 建独立堆叠上下文，应用内 position:fixed/z-* 不穿透到 shell。
  2. Portal 锚定：内嵌 app-portal-root，bits-ui Portal 默认挂这里，不逃逸到 document.body。
  3. 上下文下发：setPortalTarget + setAppContext + setRouterContext。
  4. 叶子组件懒加载：async import → $state 存储解析后的组件 → 模板渲染。
  参考：gaubee.com/src/lib/app-scaffold/AppShell.svelte。
-->
<script lang="ts">
  import type { AppManifest, AppActivity } from "./types";
  import { matchRouteTree, type RouteMatchResult, type MatchedRouteNode } from "./match";
  import {
    setAppContext,
    setPortalTarget,
    setRouterContext,
    type RouterContextValue,
  } from "./portal-context.svelte";
  import { page } from "$app/state";
  import { parseSearchString } from "./search";
  import type { ZodSchema } from "zod";
  import type { Component } from "svelte";

  let {
    app,
    activity,
  }: {
    app: AppManifest;
    activity: AppActivity;
  } = $props();

  let portalRoot = $state<HTMLElement | null>(null);

  const matchResult = $derived.by(() => {
    const result = matchRouteTree(
      activity.root,
      page.url.pathname,
      page.url.search,
      activity.pattern,
    ) as RouteMatchResult;
    return result;
  });

  const leafChain = $derived(
    matchResult.kind === "matched" || matchResult.kind === "parse-error" ? matchResult.chain : [],
  );

  const leafParams = $derived(extractParams(leafChain));
  const leafSearch = $derived(extractSearch(matchResult, leafChain));

  setPortalTarget(() => portalRoot);
  setAppContext({
    get manifest() {
      return { id: app.id, name: app.name, icon: app.icon };
    },
    get pathname() {
      return page.url.pathname;
    },
  });

  const routerContextGetter = (): RouterContextValue => ({
    match: matchResult,
    params: leafParams,
    search: leafSearch,
    chain: leafChain,
  });
  setRouterContext(routerContextGetter);

  // 叶子组件懒加载：URL 变化 → 重新 import → 存入 $state → 模板渲染。
  let leafComponent = $state<Component | null>(null);
  let leafError = $state<string | null>(null);

  $effect(() => {
    const chain = leafChain;
    if (chain.length === 0) {
      leafComponent = null;
      return;
    }
    const leaf = chain[chain.length - 1];
    if (!leaf) {
      leafComponent = null;
      return;
    }
    leafComponent = null;
    leafError = null;
    leaf.route
      .component()
      .then((mod) => {
        leafComponent = mod.default as Component;
      })
      .catch((err: unknown) => {
        leafError = err instanceof Error ? err.message : String(err);
      });
  });

  function extractParams(
    chain: readonly MatchedRouteNode[],
  ): Readonly<Record<string, unknown>> | undefined {
    if (chain.length === 0) return undefined;
    const merged: Record<string, string> = {};
    for (const node of chain) Object.assign(merged, node.rawParams);
    return merged;
  }

  function extractSearch(
    result: RouteMatchResult,
    chain: readonly MatchedRouteNode[],
  ): Readonly<Record<string, unknown>> | undefined {
    if (result.kind === "no-match" || chain.length === 0) return undefined;
    const leaf = chain[chain.length - 1];
    const searchSchema = leaf?.route.search as ZodSchema | undefined;
    if (!searchSchema) return undefined;
    const parsed = searchSchema.safeParse(parseSearchString(page.url.search));
    return parsed.success ? (parsed.data as Readonly<Record<string, unknown>>) : undefined;
  }
</script>

<div class="app-shell">
  {#if leafError}
    <div class="app-shell-error">Failed to load: {leafError}</div>
  {:else if leafComponent}
    {@const View = leafComponent}
    <View />
  {:else if leafChain.length > 0}
    <div class="app-shell-loading" aria-label="Loading"></div>
  {:else}
    <div class="app-shell-empty">No route matched</div>
  {/if}
  <div class="app-portal-root" bind:this={portalRoot}></div>
</div>

<style>
  .app-shell {
    position: relative;
    isolation: isolate;
    height: 100%;
  }
  .app-portal-root {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: var(--z-app-overlay, 50);
  }
  .app-portal-root :global(*) {
    pointer-events: auto;
  }
  .app-shell-error,
  .app-shell-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--muted-foreground, gray);
    font-size: 0.875rem;
  }
  .app-shell-loading {
    width: 100%;
    min-height: 100%;
    background: var(--muted);
    animation: skeleton-pulse 1.6s ease-in-out infinite;
  }
  @keyframes skeleton-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.55;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .app-shell-loading {
      animation: none;
    }
  }
</style>
