<!--
  用户原始需求 [2026-10-06]（skills-tabs-redesign 批 1，Owner 批准 fuse2 融合稿）：
  「顶部 TabsHeader 三一等 Tabs（Skills / Agents / Discover repos），每 Tab 独占
  整幅画布」；「pulse 不再是第四个面，压缩为页题行小字 + Tab 徽标」。
  正交意图：
  1. TabsHeader chrome：tablist/tab/tabpanel ARIA + roving tabindex（←→/Home/End
     自动激活）；Tab 切换瞬时——三 panel 常驻挂载、hidden 切换，不重挂数据面
     （screen 组件内部本批不动，skills-screen 的 detail 面保留到批 2）。
  2. ?tab= 深链：参数名 tab 与 skills|agents|repos 取值语义（批 1 修订：screen→tab
     直切，无别名——AGENTS §8 无兼容策略，旧 URL 迁移归发布层；manifest zod
     enum 值域不变）；Tab 切换写 URL（skills 为缺省省略参数）。
  3. 无页题层（2026-10-09 Owner 裁决）：「Global Workspace N skills · N
     providers」独立层去除——workspace 身份在侧栏导航，计数由各屏自身 header
     承载（skills 屏 showingOf/totalCount 即同源数据），不再单独占一行。
  4. 画布契约（同裁决「Tabs/TabContent 铺满面板」）：tabs 行与 panel 内容均
     全幅无边距；.screen 不加圆角/描边包裹（去卡片层），弹性填满 panel（固定高
     语义由 flex 约束承担）+ 内滚分层（screen-body overscroll contain）；窄屏
     同一 TabsHeader 单行形态（三 tab 不换行不挤压）。
-->
<script lang="ts">
  import { useParams, useSearch, goById } from "$lib/shell";
  import { t } from "$lib/i18n";
  import { WorkspaceIdSchema, type WorkspaceId } from "$shared/contracts/workspaces.js";
  import SkillsScreen from "./screens/skills-screen.svelte";
  import AgentsScreen from "./screens/agents-screen.svelte";
  import ReposScreen from "./screens/repos-screen.svelte";

  type DashboardSearch = {
    tab?: "skills" | "agents" | "repos";
    provider?: string;
    q?: string;
    reposQ?: string;
    duplicates?: "1";
  };

  const SCREEN_IDS = ["skills", "agents", "repos"] as const;
  type ScreenId = (typeof SCREEN_IDS)[number];

  const getParams = useParams<{ wsId: string }>();
  const getSearch = useSearch<DashboardSearch>();

  const rawWsId = $derived(getParams?.()?.wsId);
  const search = $derived(getSearch?.() ?? {});
  const activeScreen: ScreenId = $derived(search.tab ?? "skills");

  const wsId = $derived.by(() => {
    const parsed = WorkspaceIdSchema.safeParse(rawWsId);
    return parsed.success ? (parsed.data as WorkspaceId) : null;
  });

  const tabs = $derived([
    { id: "skills" as const, label: t("skillsWorkspace.tabs.skills") },
    { id: "agents" as const, label: t("skillsWorkspace.tabs.agents") },
    { id: "repos" as const, label: t("skillsWorkspace.tabs.repos") },
  ]);

  let tablistEl = $state<HTMLDivElement | null>(null);

  function focusTab(screen: ScreenId): void {
    tablistEl?.querySelector<HTMLButtonElement>(`#tab-${screen}`)?.focus();
  }

  /** Tab 切换 = URL search 写入（tab 深链参数；skills 为缺省省略）。 */
  function selectScreen(screen: ScreenId, restoreFocus = false): void {
    if (!wsId) return;
    if (screen !== activeScreen) {
      goById(
        "workspaces.provider",
        { wsId },
        { ...search, tab: screen === "skills" ? undefined : screen },
      );
    }
    if (restoreFocus) focusTab(screen);
  }

  /** Tabs 键盘可达：←→/Home/End roving tabindex + 自动激活（APG tabs 模式）。 */
  function onTablistKeydown(event: KeyboardEvent): void {
    const index = SCREEN_IDS.indexOf(activeScreen);
    const next =
      event.key === "ArrowLeft"
        ? (index + SCREEN_IDS.length - 1) % SCREEN_IDS.length
        : event.key === "ArrowRight"
          ? (index + 1) % SCREEN_IDS.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? SCREEN_IDS.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    selectScreen(SCREEN_IDS[next], true);
  }
</script>

{#if wsId}
  <div class="dashboard-shell flex h-full min-h-0 w-full min-w-0 flex-col">
    <!-- TabsHeader：三一等 tab（grid 均分，激活 = 底线）；tablist 键盘 roving。
         svelte-ignore a11y_interactive_supports_focus —— APG tabs 模式：tablist
         自身不是 tab stop，焦点经 roving tabindex 由 role=tab 子按钮管理。 -->
    <!-- svelte-ignore a11y_interactive_supports_focus -->
    <div
      class="dashboard-tabs shrink-0"
      role="tablist"
      aria-label={t("skillsWorkspace.tabs.tablistAria")}
      bind:this={tablistEl}
      onkeydown={onTablistKeydown}
    >
      {#each tabs as tab (tab.id)}
        <button
          type="button"
          role="tab"
          id="tab-{tab.id}"
          class="dashboard-tab"
          aria-selected={activeScreen === tab.id}
          aria-controls="panel-{tab.id}"
          tabindex={activeScreen === tab.id ? 0 : -1}
          onclick={() => selectScreen(tab.id)}
        >
          {tab.label}
        </button>
      {/each}
    </div>

    <!-- Tab 工作面：panel 独占整幅画布（grid 同格堆叠 + hidden 切换；三 panel
         常驻挂载保切换瞬时与各屏内滚态）。 -->
    <div class="dashboard-panels min-h-0 flex-1">
      <div
        role="tabpanel"
        id="panel-skills"
        aria-labelledby="tab-skills"
        class="dashboard-panel"
        tabindex="-1"
        hidden={activeScreen !== "skills"}
      >
        <SkillsScreen {wsId} />
      </div>
      <div
        role="tabpanel"
        id="panel-agents"
        aria-labelledby="tab-agents"
        class="dashboard-panel"
        tabindex="-1"
        hidden={activeScreen !== "agents"}
      >
        <AgentsScreen {wsId} />
      </div>
      <div
        role="tabpanel"
        id="panel-repos"
        aria-labelledby="tab-repos"
        class="dashboard-panel"
        tabindex="-1"
        hidden={activeScreen !== "repos"}
      >
        <ReposScreen {wsId} />
      </div>
    </div>
  </div>
{/if}

<style>
  .dashboard-shell {
    container-type: inline-size;
    container-name: dashboard;
  }

  /* TabsHeader：三一等 tab（grid 均分），激活 = 底线；切 tab 无过渡（瞬时）。
     全幅无边距（2026-10-09 Owner 裁决：tabs 与内容一起铺满面板）。 */
  .dashboard-tabs {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    margin: 0;
    border-bottom: 1px solid var(--border, #e5e7eb);
  }
  .dashboard-tab {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    min-height: 42px;
    min-width: 0;
    padding: 0 10px;
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--muted-foreground, #71717a);
    font-size: 12.5px;
    font-weight: 500;
    /* 单行不换行（窄屏三 tab 不挤压）：nowrap + 超极端窄宽裁切兜底。 */
    white-space: nowrap;
    overflow: hidden;
    cursor: pointer;
  }
  .dashboard-tab:hover {
    color: var(--foreground, #18181b);
  }
  .dashboard-tab[aria-selected="true"] {
    color: var(--primary, #7c3aed);
    font-weight: 600;
    border-bottom-color: var(--primary, #7c3aed);
  }

  /* Tab 工作面：panel 独占整幅画布——grid 同格堆叠（1×1），hidden 面退场，
     禁绝对定位。 */
  .dashboard-panels {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
    min-width: 0;
    padding: 0;
  }
  .dashboard-panel {
    grid-area: 1 / 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  /* hidden 属性退场必须显式（author display 覆盖 UA [hidden] 样式）。 */
  .dashboard-panel[hidden] {
    display: none;
  }

  /* screen 弹性填满 panel（Tab 化后画布 = 弹性剩余空间）：固定高语义由 flex
     约束承担（不随内容长高），内滚分层（body 滚 + overscroll 不冒泡）不变。 */
  .dashboard-panels :global(.screen) {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: var(--background, #fff);
    min-width: 0;
  }
  .dashboard-panels :global(.screen > .screen-body) {
    overflow-y: auto;
    min-height: 0;
    overscroll-behavior: contain;
  }

  /* 窄屏：同一 TabsHeader 单行形态（不换行不挤压）+ 触达 ≥44px（AGENTS §7.2）。
     阈值与 skills-screen master-detail 栈切换共享 692px 真相源（同容器名）。 */
  @container dashboard (width < 692px) {
    .dashboard-tab {
      min-height: 44px;
      font-size: 11.5px;
    }
  }
</style>
