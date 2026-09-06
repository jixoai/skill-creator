<!--
  DSH island 内的 Manager App 壳（openspec dsh-webui-composition task 3.1a）。

  用户原始需求 [2026-09-06]（integration-contract）：「island 只能拥有分配给它的
  DOM，DSH React 与 Svelte 不共同管理一个 DOM 子树。」本壳是 AppShell 的 island
  版：路由树匹配与上下文下发（portal/app/router）逻辑同源，location 来自
  island-nav（无 SvelteKit page，无宿主 URL 副作用）。
-->
<script lang="ts">
  import { untrack } from "svelte";
  import type { Component } from "svelte";
  import type { ZodSchema } from "zod";
  import type { AppManifest, AppActivity } from "$lib/shell/types";
  import { matchRouteTree, type RouteMatchResult, type MatchedRouteNode } from "$lib/shell/match";
  import {
    setAppContext,
    setPortalTarget,
    setRouterContext,
    type RouterContextValue,
  } from "$lib/shell/portal-context.svelte";
  import { parseSearchString } from "$lib/shell/search";
  import { islandNav } from "./island-nav.svelte";

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
      islandNav.pathname,
      islandNav.search,
      activity.pattern,
    ) as RouteMatchResult;
    return result;
  });

  const leafChain = $derived(matchResult.kind === "matched" ? matchResult.chain : []);

  const leafParams = $derived(extractParams(leafChain));
  const leafSearch = $derived(extractSearch(matchResult, leafChain));

  setPortalTarget(() => portalRoot);
  setAppContext({
    get manifest() {
      return { id: app.id, name: app.name, icon: app.icon };
    },
    get pathname() {
      return islandNav.pathname;
    },
  });

  const routerContextGetter = (): RouterContextValue => ({
    match: matchResult,
    params: leafParams,
    search: leafSearch,
    chain: leafChain,
  });
  setRouterContext(routerContextGetter);

  // 叶子组件懒加载（与 AppShell 相同的 route 身份稳定策略：纯 search 变化不卸载叶子）。
  let leafComponent = $state<Component | null>(null);
  let leafError = $state<string | null>(null);
  let leafLoadedRoute: MatchedRouteNode["route"] | null = null;
  let leafLoadToken = 0;

  $effect(() => {
    const leaf = leafChain.length > 0 ? leafChain[leafChain.length - 1] : undefined;
    const route = leaf?.route;
    const loadedRoute = untrack(() => leafLoadedRoute);
    if (!route) {
      leafLoadedRoute = null;
      leafLoadToken += 1;
      leafComponent = null;
      leafError = null;
      return;
    }
    if (loadedRoute === route) return;
    leafLoadedRoute = route;
    leafComponent = null;
    leafError = null;
    const token = ++leafLoadToken;
    route
      .component()
      .then((mod) => {
        if (token !== leafLoadToken) return;
        leafComponent = mod.default as Component;
      })
      .catch((err: unknown) => {
        if (token !== leafLoadToken) return;
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
    _result: RouteMatchResult,
    chain: readonly MatchedRouteNode[],
  ): Readonly<Record<string, unknown>> | undefined {
    if (chain.length === 0) return undefined;
    const leaf = chain[chain.length - 1];
    const searchSchema = leaf?.route.search as ZodSchema | undefined;
    if (!searchSchema) return undefined;
    const parsed = searchSchema.safeParse(parseSearchString(islandNav.search));
    return parsed.success ? (parsed.data as Readonly<Record<string, unknown>>) : undefined;
  }
</script>

<div
  class="island-shell"
  style="isolation:isolate;min-height:100%;display:flex;flex-direction:column;"
>
  <header
    style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.08);font-size:13px;font-weight:600;"
  >
    Skill Creator · {app.name}
  </header>
  <main style="flex:1;min-height:0;overflow:auto;position:relative;">
    {#if leafError}
      <p role="alert" style="padding:16px;color:#f87171;font-size:13px;">{leafError}</p>
    {:else if leafComponent}
      {@const Leaf = leafComponent}
      <Leaf />
    {:else if islandNav.pathname === "/workspaces" && leafChain.length === 0}
      <p style="padding:16px;opacity:0.7;font-size:13px;">Workspaces 索引在下方加载…</p>
    {:else}
      <p style="padding:16px;opacity:0.7;font-size:13px;">
        无法匹配 island 路由：{islandNav.pathname}
      </p>
    {/if}
    <div bind:this={portalRoot} style="position:relative;"></div>
  </main>
</div>
