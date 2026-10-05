<!--
  用户原始需求 [2026-09-05]（WorkspacesHome 退役随迁，skills-dashboard design §6）：
  「库快照行/self-skill banner → Global tab skills 屏页脚（冒烟锚点随迁 en 逐字）；
  位置索引区删除（Agents screen 取代）」。
  修订 [2026-10-05]（workspace-page-polish，Owner 裁决）：「IMPORTED WORKSPACES」
  区块退役——注册目录索引与 Remove 收口到标准管理页 /workspace；本页脚保留
  Global 视角内容 + 指向管理页的入口（AGENTS §7.2 Remove 可达性由管理页承担）。
  正交意图：
  1. 库快照 sr-only 冒烟锚点（workspace.list 数据驱动；web-mode 锚点
     "skills across N agent locations" en 逐字保留——test/web-mode-smoke.test.ts。
     ε 线计数收敛，2026-10-05：可见计数行退役——跨全 workspace 的库快照与
     skills 列表作用域（当前 ws）不符，主显口径迁 skills header；锚点转 sr-only）。
  2. self-skill 冲突 banner 随迁（组件原样复用，见 self-skill-conflict-banner）。
  3. Health check 入口（manage 模式 agent 审计唯一入口，种子 prompt 逐字不变）。
  4. 工作区管理入口（/workspace 深链；导入/移除等注册目录操作全部收口管理页）。
-->
<script lang="ts">
  import { goById } from "$lib/shell";
  import { startAgentAction } from "$lib/stores/agent.svelte";
  import { t } from "$lib/i18n";
  import { workspaceState } from "$lib/store.svelte";
  import SelfSkillConflictBanner from "$lib/components/self-skill-conflict-banner.svelte";
  import IconHeart from "@lucide/svelte/icons/heart-pulse";
  import IconSettings from "@lucide/svelte/icons/settings-2";

  /**
   * 计数快照（sr-only 冒烟锚点，恒复数）。Imported ws tab 上下文 =
   * 当前 ws 的 providers 计数（专注单 Workspace）；Global/缺席 = 跨全部
   * workspace 的库快照（管理中枢语义，仅供读屏/冒烟——可见数字已收敛到
   * skills header 的 workspace 总量口径）。锚点格式不变（key 同一、仅数值
   * 语境化，正则 \d+ 恒匹配）。
   */
  let { wsId }: { wsId?: string } = $props();
  const librarySnapshot = $derived.by(() => {
    if (wsId !== undefined && wsId !== "~") {
      const ws = workspaceState.workspaces.find((item) => item.id === wsId);
      let skills = 0;
      let providers = 0;
      for (const provider of ws?.providers ?? []) {
        providers += 1;
        skills += provider.skillCount ?? 0;
      }
      return { skills, providers };
    }
    let skills = 0;
    let providers = 0;
    for (const ws of workspaceState.workspaces) {
      for (const provider of ws.providers) {
        providers += 1;
        skills += provider.skillCount ?? 0;
      }
    }
    return { skills, providers };
  });

  function openManager(): void {
    goById("workspaces.manage");
  }
</script>

<footer class="shrink-0 border-t border-border">
  <!-- 库快照 sr-only 冒烟锚点（web-mode 冒烟：en 逐字，test/web-mode-smoke.test.ts）。
       可见计数行已退役（ε 线计数收敛）：同屏只保留 header 的总量+窗口两种数字语义。 -->
  <p class="sr-only">
    {t("dashboard.librarySnapshot", {
      skills: librarySnapshot.skills,
      providers: librarySnapshot.providers,
    })}
  </p>
  <div
    class="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-xs text-muted-foreground"
  >
    <button
      type="button"
      class="flex min-h-7 items-center gap-1.5 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
      title={t("dashboard.healthCheckTitle")}
      onclick={() =>
        startAgentAction(
          "manage",
          "Audit my skill library: find duplicates, vague descriptions, and stale skills, then propose concrete fixes.",
        )}
    >
      <IconHeart class="h-3.5 w-3.5" />
      {t("dashboard.healthCheck")}
    </button>
    <button
      type="button"
      class="flex min-h-7 items-center gap-1.5 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
      title={t("workspacePage.manageTitle")}
      data-testid="open-workspace-manager"
      onclick={() => openManager()}
    >
      <IconSettings class="h-3.5 w-3.5" />
      {t("workspacePage.manage")}
    </button>
  </div>

  <SelfSkillConflictBanner />
</footer>
