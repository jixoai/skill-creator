<script lang="ts">
  /**
   * 原始需求 [2026-07-14]：「这需要你的导航功能足够清晰简单」。
   * 修订 [2026-09-17]（skill-search-gui）：增异步 Skills 组——跨 Workspace 的
   * BM25 全局检索（skills.search RPC），结果按 workspace/provider 分组，
   * 选中直达 ProviderView 技能详情。
   * 正交意图：
   * 1. 管理 Cmd/Ctrl+K 命令面板生命周期。
   * 2. 提供一级路由导航。
   * 3. 提供 workspace 快速切换。
   * 4. 承载跨 Workspace 的技能全局检索（去抖 → searchState → 作用域分组行）。
   */
  import * as Command from "$lib/components/ui/command";
  import { goto } from "$app/navigation";
  import { goById } from "$lib/shell";
  import {
    installationScopeLabel,
    openSkillSearchConfig,
    SEARCH_DEBOUNCE_MS,
    SEARCH_LIMIT,
    resetSkillSearch,
    searchSkills,
    searchState,
    workspaceEntryPath,
    workspaceState,
  } from "$lib/store.svelte";
  import type { ProviderId, SkillSearchResult, WorkspaceId } from "$lib/types";
  import IconFolder from "@lucide/svelte/icons/folder-open";
  import IconPen from "@lucide/svelte/icons/file-plus-2";
  import IconGlobe from "@lucide/svelte/icons/globe";
  import IconSliders from "@lucide/svelte/icons/sliders-horizontal";
  import IconGrid from "@lucide/svelte/icons/layout-grid";
  import IconSparkles from "@lucide/svelte/icons/sparkles";

  let open = $state(false);
  let query = $state("");

  $effect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        open = !open;
      }
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  });

  // 面板打开且输入非空：去抖后走全局 BM25 检索；定时器在 effect cleanup 回收。
  $effect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) return;
    const timer = setTimeout(() => void searchSkills(q, SEARCH_LIMIT), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  });

  // 面板关闭即配对回收：query 与全局检索态同时清空——残留 query 会让下一次
  // 打开以旧值发起检索，并与 resetSkillSearch 置空的 searchState.query 错配，
  // 令 searchFresh 恒假（走查 Case C P2：面板陷入永久「Searching skills…」）。
  $effect(() => {
    if (!open) {
      query = "";
      resetSkillSearch();
    }
  });

  function run(action: () => void): void {
    open = false;
    action();
  }

  const trimmedQuery = $derived(query.trim());
  /** 检索态是否属于本面板当前输入（searchState 是全局单例）。 */
  const searchFresh = $derived(searchState.query === trimmedQuery);
  /** 去抖窗口或在途（非 fresh 即去抖中——面板关闭时已回收检索态）。 */
  const searchPending = $derived(!searchFresh || (searchFresh && searchState.searching));

  /** result × installations 展开行（同一技能多安装 = 多行，各自带作用域三元组）。 */
  interface SkillPaletteRow {
    key: string;
    result: SkillSearchResult;
    workspaceId: WorkspaceId;
    providerId: ProviderId;
    heading: string;
  }

  const skillRows = $derived.by(() => {
    if (!trimmedQuery || !searchFresh || searchState.error) return [];
    const rows: SkillPaletteRow[] = [];
    for (const result of searchState.results) {
      for (const installation of result.installations) {
        rows.push({
          key: `${installation.workspaceId}:${installation.providerId}:${result.id}`,
          result,
          workspaceId: installation.workspaceId,
          providerId: installation.providerId,
          heading: installationScopeLabel(installation.workspaceId, installation.providerId),
        });
      }
    }
    return rows;
  });

  /** 作用域分组投影：组序 = 首次出现序，组内保持 BM25 排序。 */
  const skillGroups = $derived.by(() => {
    const byScope = new Map<string, { scope: string; heading: string; rows: SkillPaletteRow[] }>();
    for (const row of skillRows) {
      const scope = `${row.workspaceId}/${row.providerId}`;
      const group = byScope.get(scope) ?? { scope, heading: row.heading, rows: [] };
      group.rows.push(row);
      byScope.set(scope, group);
    }
    return [...byScope.values()];
  });
</script>

<!-- Root(Dialog) 的 value 是「选中条目的值」（bits-ui Command 契约），输入文本
     挂在 Command.Input 的 value 上——query 必须绑 Input，绑 Root 会让检索永不
     触发且选中条目污染 query（走查 Case C P1）。 -->
<Command.Dialog bind:open>
  <Command.Input bind:value={query} placeholder="Search navigation, workspaces and skills…" />
  <Command.List>
    <!-- 全局 Empty 只在空输入时参与（bits-ui 的 filtered.count 不计 forceMount
         行；非空输入的空态由 Skills 组自带行承载，避免双空态并存）。 -->
    {#if !trimmedQuery}
      <Command.Empty>No matching destination.</Command.Empty>
    {/if}

    <Command.Group heading="Navigate">
      <Command.Item
        onSelect={() => run(() => goto("/workspaces"))}
        value="go workspaces manage locations"
      >
        <IconGrid class="h-4 w-4" />
        Workspaces
      </Command.Item>
      <Command.Item onSelect={() => run(() => goto("/creator"))} value="go creator new skill">
        <IconPen class="h-4 w-4" />
        Creator
      </Command.Item>
      <Command.Item
        onSelect={() => run(() => goto("/repository"))}
        value="go repository browse remote"
      >
        <IconGlobe class="h-4 w-4" />
        Repository
      </Command.Item>
      <Command.Item
        onSelect={() => run(() => void openSkillSearchConfig())}
        value="go search config toml"
      >
        <IconSliders class="h-4 w-4" />
        Open search config
      </Command.Item>
    </Command.Group>

    {#if workspaceState.workspaces.length > 0}
      <Command.Group heading="Workspaces">
        {#each workspaceState.workspaces as ws (ws.id)}
          <Command.Item
            value={`workspace ${ws.label} ${ws.path}`}
            onSelect={() => run(() => goto(workspaceEntryPath(ws)))}
          >
            <IconFolder class="h-4 w-4" />
            <span class="flex-1 truncate">{ws.label}</span>
            <span class="text-[10px] tabular-nums text-muted-foreground">{ws.skillCount ?? 0}</span>
          </Command.Item>
        {/each}
      </Command.Group>
    {/if}

    <!-- Skills 全局检索组：forceMount 绕过面板的本地前缀过滤——中文/typo 查询
         的召回与排序由 daemon BM25 裁决，面板只做分组渲染。 -->
    {#if !trimmedQuery}
      <Command.Group heading="Skills" value="skills" forceMount>
        <div class="px-2.5 py-1.5 text-[11px] text-muted-foreground">
          Type to search skills across workspaces…
        </div>
      </Command.Group>
    {:else if searchPending}
      <Command.Group heading="Skills" value="skills" forceMount>
        <Command.Loading>Searching skills…</Command.Loading>
      </Command.Group>
    {:else if searchFresh && searchState.error}
      <Command.Group heading="Skills" value="skills" forceMount>
        <div class="px-2.5 py-1.5 text-[11px] text-destructive">
          Skill search failed — {searchState.error}
        </div>
      </Command.Group>
    {:else if skillGroups.length === 0}
      <Command.Group heading="Skills" value="skills" forceMount>
        <div class="px-2.5 py-1.5 text-[11px] text-muted-foreground">No matching skill.</div>
      </Command.Group>
    {:else}
      {#each skillGroups as group (group.scope)}
        <Command.Group heading={group.heading} value={group.scope} forceMount>
          {#each group.rows as row (row.key)}
            <Command.Item
              value={`skill ${row.result.name} ${row.key}`}
              forceMount
              onSelect={() =>
                run(() =>
                  goById(
                    "workspaces.provider",
                    { wsId: row.workspaceId, providerId: row.providerId },
                    { skill: row.result.id, view: "detail" },
                  ),
                )}
            >
              <IconSparkles class="h-4 w-4 shrink-0" />
              <span class="min-w-0 flex-1 truncate">{row.result.name}</span>
              {#if row.result.description}
                <span
                  class="hidden min-w-0 max-w-[45%] truncate text-[11px] text-muted-foreground sm:block"
                  >{row.result.description}</span
                >
              {/if}
            </Command.Item>
          {/each}
        </Command.Group>
      {/each}
    {/if}
  </Command.List>
</Command.Dialog>
