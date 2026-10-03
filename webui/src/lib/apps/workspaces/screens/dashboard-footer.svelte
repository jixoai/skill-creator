<!--
  用户原始需求 [2026-09-05]（WorkspacesHome 退役随迁，skills-dashboard design §6）：
  「库快照行/self-skill banner → Global tab skills 屏页脚（冒烟锚点随迁 en 逐字）；
  位置索引区删除（Agents screen 取代）」。
  正交意图：
  1. 库快照屏读摘要（workspace.list 数据驱动渲染；web-mode 冒烟锚点
     "skills across N agent locations" en 逐字保留——test/web-mode-smoke.test.ts）。
  2. self-skill 冲突 banner 随迁（组件原样复用，见 self-skill-conflict-banner）。
  3. Health check 入口（manage 模式 agent 审计唯一入口，种子 prompt 逐字不变）。
  4. 导入 workspace 管理（Remove 可达性：AGENTS §7.2「Remove Workspace 必须在
     workspace 索引仍可达」——WorkspacesHome 退役后 Global 页脚承担）。
-->
<script lang="ts">
  import { removeWorkspace, workspaceState } from "$lib/store.svelte";
  import { startAgentAction } from "$lib/stores/agent.svelte";
  import { showToast } from "$lib/toast.svelte";
  import { t } from "$lib/i18n";
  import type { ImportedWorkspace } from "$lib/types";
  import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
  import SelfSkillConflictBanner from "$lib/components/self-skill-conflict-banner.svelte";
  import IconAlert from "@lucide/svelte/icons/triangle-alert";
  import IconFolder from "@lucide/svelte/icons/folder";
  import IconHeart from "@lucide/svelte/icons/heart-pulse";
  import IconTrash from "@lucide/svelte/icons/trash-2";

  const importedWorkspaces = $derived(
    workspaceState.workspaces.filter((ws) => ws.kind === "directory"),
  );

  /** 库快照：跨全部 workspace 的技能/位置总数（屏读摘要行 + 冒烟锚点，恒复数）。 */
  const librarySnapshot = $derived.by(() => {
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

  let removing = $state<ImportedWorkspace | null>(null);
  let removeOpen = $state(false);
  let removeBusy = $state(false);

  $effect(() => {
    if (!removeOpen) removing = null;
  });

  function requestRemove(ws: ImportedWorkspace): void {
    removing = ws;
    removeOpen = true;
  }

  async function confirmRemove(): Promise<void> {
    const workspace = removing;
    if (!workspace) return;
    removeBusy = true;
    try {
      const removed = await removeWorkspace(workspace.id);
      if (removed) {
        removeOpen = false;
        showToast(t("dashboard.removedToast", { label: workspace.label }));
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    } finally {
      removeBusy = false;
    }
  }
</script>

<footer class="shrink-0 border-t border-border">
  <!-- 库快照屏读摘要（web-mode 冒烟锚点：en 逐字，test/web-mode-smoke.test.ts）。 -->
  <p class="sr-only">
    {t("dashboard.librarySnapshot", {
      skills: librarySnapshot.skills,
      providers: librarySnapshot.providers,
    })}
  </p>
  <div
    class="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-xs text-muted-foreground"
  >
    <span class="tabular-nums">
      {t("dashboard.snapshotCounts", {
        skills: librarySnapshot.skills,
        providers: librarySnapshot.providers,
      })}
    </span>
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
  </div>

  <SelfSkillConflictBanner />

  {#if importedWorkspaces.length > 0}
    <div class="border-t border-border/60 px-4 py-2.5">
      <h3 class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {t("dashboard.importedWorkspaces")}
      </h3>
      <ul class="mt-1.5 space-y-0.5">
        {#each importedWorkspaces as ws (ws.id)}
          {@const removable = ws.kind === "directory" ? ws : null}
          <li class="flex min-h-9 items-center gap-2">
            <IconFolder
              class="h-3.5 w-3.5 shrink-0 {ws.available ? 'text-primary' : 'text-destructive'}"
            />
            <span class="min-w-0 flex-1 truncate text-xs font-medium">{ws.label}</span>
            {#if !ws.available}
              <span class="flex shrink-0 items-center gap-1 text-xs text-destructive">
                <IconAlert class="h-3 w-3" />
                {t("dashboard.missing")}
              </span>
            {/if}
            <span class="shrink-0 tabular-nums text-xs text-muted-foreground">{ws.skillCount}</span>
            {#if removable}
              <button
                type="button"
                class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-destructive"
                title={t("dashboard.removeTitle", { label: removable.label })}
                aria-label={t("dashboard.removeTitle", { label: removable.label })}
                onclick={() => requestRemove(removable)}
              >
                <IconTrash class="h-3.5 w-3.5" />
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</footer>

<ConfirmDialog
  bind:open={removeOpen}
  title={t("dashboard.removeDialog.title")}
  description={removing ? t("dashboard.removeDialog.description", { label: removing.label }) : ""}
  confirmLabel={t("dashboard.removeDialog.confirm")}
  busy={removeBusy}
  onConfirm={() => void confirmRemove()}
/>
