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
  import { tick } from "svelte";
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

  // 深链滚动（2.2 处置批 P2-10）：?screen= 深链落点在换行网格里可能在折叠线下
  // （skills span 2 + agents/repos 换行）——active 变化时把落点滚进视口；高亮由
  // 既有 data-active 边框承担（下追加 ring 强化落点可寻）。单列窄容器只有
  // active screen 可见，scrollIntoView 无害。
  let gridEl = $state<HTMLDivElement | null>(null);
  $effect(() => {
    const screen = activeScreen;
    if (screen === "skills") return;
    void tick().then(() => {
      gridEl
        ?.querySelector<HTMLElement>(`.grid-item[data-screen="${screen}"]`)
        ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    });
  });
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
      <div class="dashboard-grid" bind:this={gridEl} data-testid="dashboard-grid">
        <div
          class="grid-item skills-item"
          data-screen="skills"
          data-active={activeScreen === "skills"}
        >
          <SkillsScreen {wsId} />
        </div>
        <div class="grid-item" data-screen="agents" data-active={activeScreen === "agents"}>
          <AgentsScreen {wsId} />
        </div>
        <div class="grid-item" data-screen="repos" data-active={activeScreen === "repos"}>
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
  /* Owner 纠偏（2026-10-05 第二轮）：「我强调 list-detail 了，你还均分」——
     span N 在 1fr 均分网格里只是 N 个普通列宽，不是 list-detail 要的不成比例
     主宽。改为主副结构：Skills 弹性主列吃全部剩余宽度并跨双行（list-detail
     的宽与高都成主体），Agents/Repos 共享右侧窄列纵向堆叠。副列 320-360px
     微弹性（Agents 卡片与 Repos feed 的信息密度不需要更宽）。 */
  .dashboard-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(320px, 360px);
    grid-auto-rows: min-content;
    gap: 12px;
    min-width: 0;
  }
  .grid-item {
    min-width: 0;
  }
  .skills-item {
    grid-column: 1;
    grid-row: 1 / 3;
  }
  .grid-item[data-screen="agents"] {
    grid-column: 2;
    grid-row: 1;
  }
  .grid-item[data-screen="repos"] {
    grid-column: 2;
    grid-row: 2;
  }

  /* 中档降级（< 1044px = 主列下限 680 + gap + 副列下限 320 + 余量）：回均分
     auto-fill 网格 + skills span 2（list-detail 至少两个 340 轨道）。 */
  @container dashboard (width < 1044px) {
    .dashboard-grid {
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    }
    .skills-item,
    .grid-item[data-screen="agents"],
    .grid-item[data-screen="repos"] {
      grid-column: auto;
      grid-row: auto;
    }
    .skills-item {
      grid-column: span 2;
    }
  }

  /* screen 隐喻：弹性固定高（--screen-h 自定义属性，未来可拖拽调高）+ 内部滚动
     + 自带 header；网格换行高度不塌（不随内容长高）。默认下限 = max(480px,
     100dvh - 240px)：真实目录规模（多行 header chips + Global 页脚）下 480px 会把
     master-detail 挤到 0px（走查 13-fix）——大视口按视口高度分配更多 screen 高，
     小视口退回 480px 桌面下限；「固定高、内部滚动、换行不塌」语义不变。 */
  .dashboard-grid :global(.screen) {
    height: var(--screen-h, max(480px, calc(100dvh - 240px)));
    min-height: var(--screen-h, max(480px, calc(100dvh - 240px)));
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
  /* active screen 高亮（宽屏全部并列，深链 ?screen= 指示落点）。2.2 处置批
     P2-10：ring 强化深链落点可寻（滚动由 script 侧 scrollIntoView 承担）。 */
  .dashboard-grid .grid-item[data-active="true"] :global(.screen) {
    border-color: color-mix(in oklab, var(--primary, #7c3aed) 40%, transparent);
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--primary, #7c3aed) 25%, transparent);
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
