<!--
  用户原始需求 [2026-10-02]（skills-dashboard design §1，Owner Q4/Q11 拍板）：
  「三块是并列 mobileScreen——每个 screen 有自身 height 概念，自动换行适应
  单/双/三/四列。Repository 作为一级导航退役，被 dashboard 吸收。」
  正交意图：
  1. mobileScreen 网格壳：container-type/named container + auto-fill minmax(340px,1fr)
     网格；Skills 主屏 span 2，单列容器（< 692px = 2×340 + 1×gap）经 container
     query 显式降档 span 1（r2 修订：CSS Grid 不保证自然回落，隐式列会横向溢出）。
  2. screen 分层：固定高（--screen-h 自定义属性）+ overflow hidden + 自带 header；
     body 内滚（overscroll-contain 不冒泡）；网格换行高度不塌。
  3. ?screen= 深链：宽屏全部 screens 并列（active 高亮）；单列容器只显示 active
     screen + 顶部 segmented 切换（窄屏单屏切换，AGENTS §7.2 窄屏法则）。
  4. wsId 身份解析（manifest zod 已校验；此处二次 safeParse 为 branded 类型）。
-->
<script lang="ts">
  import { useParams, useSearch, goById } from "$lib/shell";
  import { t } from "$lib/i18n";
  import { WorkspaceIdSchema, type WorkspaceId } from "$shared/contracts/workspaces.js";
  import SkillsScreen from "./screens/skills-screen.svelte";
  import AgentsScreen from "./screens/agents-screen.svelte";
  import ReposScreen from "./screens/repos-screen.svelte";

  type DashboardSearch = {
    screen?: "skills" | "agents" | "repos";
    provider?: string;
    q?: string;
    reposQ?: string;
    skill?: string;
    view?: "list" | "detail";
    duplicates?: "1";
  };

  const getParams = useParams<{ wsId: string }>();
  const getSearch = useSearch<DashboardSearch>();

  const rawWsId = $derived(getParams?.()?.wsId);
  const search = $derived(getSearch?.() ?? {});
  const activeScreen = $derived(search.screen ?? "skills");

  const wsId = $derived.by(() => {
    const parsed = WorkspaceIdSchema.safeParse(rawWsId);
    return parsed.success ? (parsed.data as WorkspaceId) : null;
  });

  function switchScreen(screen: "skills" | "agents" | "repos"): void {
    if (!wsId || screen === activeScreen) return;
    goById(
      "workspaces.provider",
      { wsId },
      { ...search, screen: screen === "skills" ? undefined : screen },
    );
  }

  const screens = $derived([
    { id: "skills" as const, label: t("dashboard.screenSkills") },
    { id: "agents" as const, label: t("dashboard.screenAgents") },
    { id: "repos" as const, label: t("dashboard.screenRepos") },
  ]);
</script>

{#if wsId}
  <div class="dashboard-shell flex h-full min-h-0 w-full min-w-0 flex-col">
    <!-- 单列容器的 screen 切换器（宽屏 display:none——并列全显，无需切换）。 -->
    <div
      class="screen-switcher shrink-0 px-4 pt-3"
      role="tablist"
      aria-label={t("dashboard.switcherAria")}
    >
      <div class="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
        {#each screens as screen (screen.id)}
          <button
            type="button"
            role="tab"
            aria-selected={activeScreen === screen.id}
            class="flex min-h-8 items-center rounded-md px-3 text-xs font-medium transition-colors
              {activeScreen === screen.id
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'}"
            onclick={() => switchScreen(screen.id)}
          >
            {screen.label}
          </button>
        {/each}
      </div>
    </div>

    <div class="dashboard-scroll min-h-0 flex-1 overflow-y-auto p-4">
      <div class="dashboard-grid" data-testid="dashboard-grid">
        <div class="grid-item skills-item" data-active={activeScreen === "skills"}>
          <SkillsScreen {wsId} />
        </div>
        <div class="grid-item" data-active={activeScreen === "agents"}>
          <AgentsScreen {wsId} />
        </div>
        <div class="grid-item" data-active={activeScreen === "repos"}>
          <ReposScreen {wsId} />
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .dashboard-shell {
    container-type: inline-size;
    container-name: dashboard;
  }
  .dashboard-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    gap: 12px;
    /* 单列宽度下防隐式列横向溢出的第二道闸：内容永不撑出轨道。 */
    min-width: 0;
  }
  .grid-item {
    min-width: 0;
  }
  .skills-item {
    grid-column: span 2;
  }

  /* r2 修订：1 列显式网格内 span 2 会创建隐式第二列（横向溢出）——容器窄于
     2×minmax 轨道 + 1×gap = 692px 时显式降档 span 1（阈值与轨道/间距联动，
     见 skills-dashboard-css 契约测试）。 */

  /* screen 隐喻：固定高（--screen-h 自定义属性，未来可拖拽调高）、内部滚动、
     自带 header；网格换行高度不塌（不随内容长高）。 */
  .dashboard-grid :global(.screen) {
    height: var(--screen-h, 480px);
    min-height: var(--screen-h, 480px);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    border-radius: 0.5rem;
    border: 1px solid var(--border, #e5e7eb);
    background: var(--background, #fff);
    min-width: 0;
  }
  .dashboard-grid :global(.screen > .screen-body) {
    overflow-y: auto;
    min-height: 0;
    overscroll-behavior: contain;
  }
  /* active screen 高亮（宽屏全部并列，深链 ?screen= 指示落点）。 */
  .dashboard-grid .grid-item[data-active="true"] :global(.screen) {
    border-color: color-mix(in oklab, var(--primary, #7c3aed) 40%, transparent);
  }

  /* 单列容器：显式降档 span 1（r2 修订）+ 只显示 active screen
     （mobileScreen 单屏切换；切换器接管导航）。 */
  @container dashboard (width < 692px) {
    .skills-item {
      grid-column: span 1;
    }
    .dashboard-grid .grid-item {
      display: none;
    }
    .dashboard-grid .grid-item[data-active="true"] {
      display: block;
    }
  }
  /* 宽屏：切换器退场（并列全显）。 */
  @container dashboard (width >= 692px) {
    .screen-switcher {
      display: none;
    }
  }
</style>
