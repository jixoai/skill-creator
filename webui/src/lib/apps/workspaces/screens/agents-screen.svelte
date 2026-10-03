<!--
  用户原始需求 [2026-10-02]（skills-dashboard design §3）：「provider 卡片列表：
  agent 名 / root 路径 / skill 计数 / 可写性徽标；点击 = 主屏 provider 筛选联动
  （chips 选中态同步）」。
  正交意图：
  1. provider catalog 投影（workspace.list 数据源，无新 RPC）：当前 ws 的全部
     provider 卡片（含不可用条目——「Not found on disk」呈现）。
  2. 点击卡片 → 主屏 provider chip 筛选联动（?provider= 选中态同源）。
  3. per-provider「View findings」→ /w/:wsId/skills/intelligence/:providerId
     （与 skill 详情 Insights 按钮同链同身份，design §3/§6）。
-->
<script lang="ts">
  import { useSearch, goById } from "$lib/shell";
  import { workspaceState } from "$lib/store.svelte";
  import { t } from "$lib/i18n";
  import type { ProviderId, WorkspaceId } from "$shared/contracts/workspaces.js";
  import { Badge } from "$lib/components/ui/badge";
  import IconArrowRight from "@lucide/svelte/icons/arrow-right";
  import IconGraph from "@lucide/svelte/icons/network";
  import IconShieldOff from "@lucide/svelte/icons/shield-off";

  type DashboardSearch = {
    screen?: "skills" | "agents" | "repos";
    provider?: ProviderId;
    q?: string;
    skill?: string;
    view?: "list" | "detail";
    duplicates?: "1";
  };

  let { wsId }: { wsId: WorkspaceId } = $props();

  const getSearch = useSearch<DashboardSearch>();
  const search = $derived(getSearch?.() ?? {});
  const providerFilter = $derived(search.provider ?? null);

  /** 当前 ws 的 provider catalog 投影（workspace.list 全局态；+layout 首载）。 */
  const providers = $derived(
    workspaceState.workspaces.find((ws) => ws.id === wsId)?.providers ?? [],
  );

  const totalSkills = $derived(
    providers.reduce((sum, provider) => sum + (provider.skillCount ?? 0), 0),
  );

  function filterByProvider(providerId: ProviderId): void {
    goById(
      "workspaces.provider",
      { wsId },
      {
        ...search,
        screen: undefined,
        provider: providerFilter === providerId ? undefined : providerId,
        // 切 provider = 回主屏列表态：skill/view 一并清空（走查 14-fix——detail
        // 态点卡片曾残留无身份 ?view=detail，主屏落空白详情位）。
        skill: undefined,
        view: undefined,
      },
    );
  }

  function viewFindings(providerId: ProviderId): void {
    goById("workspaces.intelligence", { wsId, providerId }, {});
  }
</script>

<section class="screen" data-screen="agents" aria-label={t("agentsScreen.aria")}>
  <header class="shrink-0 border-b border-border px-4 py-3">
    <div class="flex min-w-0 items-center gap-2">
      <h2 class="min-w-0 truncate text-sm font-semibold">{t("agentsScreen.title")}</h2>
      <Badge variant="secondary" class="tabular-nums">{totalSkills}</Badge>
    </div>
    <p class="mt-0.5 text-xs text-muted-foreground">{t("agentsScreen.subtitle")}</p>
  </header>
  <div class="screen-body">
    {#if providers.length === 0}
      <p class="px-4 py-6 text-xs text-muted-foreground">{t("agentsScreen.empty")}</p>
    {:else}
      {#each providers as provider (provider.id)}
        <div
          class="border-b border-border/70 px-4 py-2.5 {providerFilter === provider.id
            ? 'bg-accent/60'
            : ''}"
        >
          <button
            type="button"
            class="flex min-h-11 w-full items-start gap-2 text-left"
            aria-pressed={providerFilter === provider.id}
            onclick={() => filterByProvider(provider.id)}
            title={provider.path ?? provider.label}
          >
            <span class="min-w-0 flex-1">
              <span class="flex items-center gap-2">
                <span class="truncate text-[13px] font-medium text-foreground">
                  {provider.label}
                </span>
                {#if provider.writable}
                  <Badge variant="outline" class="text-[10px]">{t("agentsScreen.writable")}</Badge>
                {:else}
                  <Badge variant="outline" class="text-[10px]">
                    <IconShieldOff class="h-3 w-3" />
                    {t("agentsScreen.readonly")}
                  </Badge>
                {/if}
                {#if providerFilter === provider.id}
                  <span
                    class="shrink-0 text-[10px] font-medium uppercase tracking-wide text-primary"
                  >
                    {t("agentsScreen.filtered")}
                  </span>
                {/if}
              </span>
              {#if !provider.available}
                <span class="mt-0.5 block text-xs text-muted-foreground">
                  {t("agentsScreen.notFound")}
                </span>
              {:else if provider.path}
                <span class="mt-0.5 block truncate font-mono text-xs text-muted-foreground">
                  {provider.path}
                </span>
              {/if}
            </span>
            {#if provider.skillCount > 0}
              <Badge variant="secondary" class="shrink-0 tabular-nums">
                {provider.skillCount}
              </Badge>
            {/if}
          </button>
          <div class="mt-1">
            <button
              type="button"
              class="flex min-h-7 items-center gap-1 rounded-md text-xs text-primary transition-colors hover:bg-primary/10"
              onclick={() => viewFindings(provider.id)}
            >
              <IconGraph class="h-3.5 w-3.5" />
              {t("agentsScreen.viewFindings")}
              <IconArrowRight class="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
        </div>
      {/each}
    {/if}
  </div>
</section>
