<!--
  工作区管理页（workspace-page-polish：IMPORTED 词汇从用户面退役的标准承接页）。
  用户原始需求 [2026-10-05]（Owner 裁决）：「IMPORTED 的技术语义正确，但
  『IMPORTED』是实现细节泄漏进用户面——删除操作收口到标准管理页；概念呈现退化。」
  修订 [2026-10-05]（skills-workspace-world-class 批 B FP-09/10/11）：窄屏卡片化
  （<720px 表格→卡片式，所有信息可见，Remove 触达≥44px）；删宽屏重复 path 列
  （身份列已内嵌）；missing amber 化 + 行级 Refresh 按钮。
  正交意图：
  1. 注册目录索引：全部已注册工作区（label + 真实路径等宽呈现 + provider/技能
     计数 + Open 跳转 dashboard）——本页即 AGENTS §7.2「Remove Workspace 必须
     在 workspace 索引仍可达」的那个索引；Global（~）是固定 tab、非注册目录，
     不出现在此列表。
  2. Remove 危险操作确认闸（ConfirmDialog 复用，先例同 dashboard-footer 旧位）
     + 成功/失败 toast；导入入口复用全局 import-workspace-dialog。
  3. 空态引导导入（无注册工作区时）；loading/error 态可区分。
  4. 窄屏卡片化（<720px）：每工作区一卡，label/missing/path/计数/Open/Remove
     全部可见；Remove 触达≥44px（带文字或等高 padding）。
  5. missing 降 amber（text-amber-600/400）+ 行级 Refresh 按钮（重载 workspaces）。
-->
<script lang="ts">
  import { goById } from "$lib/shell";
  import { t } from "$lib/i18n";
  import { loadWorkspaces, removeWorkspace, workspaceState } from "$lib/store.svelte";
  import { requestImportWorkspace } from "$lib/stores/import-workspace.svelte";
  import { showErrorToast, showToast } from "$lib/toast.svelte";
  import type { ImportedWorkspace } from "$lib/types";
  import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
  import ErrorHint from "$lib/components/error-hint.svelte";
  import IconAlert from "@lucide/svelte/icons/triangle-alert";
  import IconFolder from "@lucide/svelte/icons/folder";
  import IconPlus from "@lucide/svelte/icons/plus";
  import IconRefreshCw from "@lucide/svelte/icons/refresh-cw";
  import IconTrash from "@lucide/svelte/icons/trash-2";

  // 挂载即拉一次 registry 投影（同代在途共享；断线/失败面由 error 态呈现）。
  $effect(() => {
    void loadWorkspaces();
  });

  /** 注册目录索引（Global `~` 是固定 tab，非注册目录，不入此列表）。 */
  const registered = $derived(workspaceState.workspaces.filter((ws) => ws.kind === "directory"));

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
        showToast(t("workspacePage.removedToast", { label: workspace.label }));
      }
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : String(error));
    } finally {
      removeBusy = false;
    }
  }

  /** Open = 在 tabs 打开该 ws 的 dashboard（既有 open 语义的 canonical 落点）。 */
  function openDashboard(ws: ImportedWorkspace): void {
    goById("workspaces.provider", { wsId: ws.id });
  }
</script>

<div class="flex h-full min-h-0 flex-col" aria-label={t("workspacePage.aria")}>
  <header
    class="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 pb-4 pt-5"
  >
    <div>
      <h1 class="text-lg font-semibold">{t("workspacePage.title")}</h1>
      <p class="mt-0.5 text-xs text-muted-foreground">{t("workspacePage.subtitle")}</p>
    </div>
    <button
      type="button"
      class="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs transition-colors hover:bg-muted/50"
      onclick={() => requestImportWorkspace()}
    >
      <IconPlus class="h-3.5 w-3.5" />
      {t("workspacePage.import")}
    </button>
  </header>

  <div class="min-h-0 flex-1 overflow-y-auto">
    {#if workspaceState.loading && registered.length === 0}
      <p class="flex items-center gap-2 px-5 py-8 text-xs text-muted-foreground" role="status">
        {t("workspacePage.loading")}
      </p>
    {:else if workspaceState.error !== null && registered.length === 0}
      <div class="flex flex-col items-start gap-2 px-5 py-8 text-xs text-destructive">
        <ErrorHint error={workspaceState.error} />
        <button class="underline underline-offset-2" onclick={() => void loadWorkspaces(true)}>
          {t("common.retry")}
        </button>
      </div>
    {:else if registered.length === 0}
      <div
        class="m-auto flex max-w-sm flex-col items-center gap-2 px-8 py-16 text-center text-muted-foreground"
      >
        <IconFolder class="h-6 w-6" />
        <p class="text-sm font-medium text-foreground">{t("workspacePage.emptyTitle")}</p>
        <p class="text-xs">{t("workspacePage.emptyBody")}</p>
        <button
          type="button"
          class="mt-2 flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-xs transition-colors hover:bg-muted/50"
          onclick={() => requestImportWorkspace()}
        >
          <IconPlus class="h-3.5 w-3.5" />
          {t("workspacePage.import")}
        </button>
      </div>
    {:else}
      <!-- 管理表（FP-09/10）：宽屏表格（删重复 path 列）；窄屏<720px 卡片化。 -->
      <table class="w-full border-collapse text-xs max-[720px]:hidden">
        <thead>
          <tr
            class="border-b border-border text-left text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
          >
            <th scope="col" class="px-5 py-2 font-medium">{t("workspacePage.colWorkspace")}</th>
            <th scope="col" class="px-3 py-2 text-right font-medium">
              {t("workspacePage.colProviders")}
            </th>
            <!-- r2 评图（计数矛盾 61 vs 82）：本表口径 = 去重技能键集
                 （workspaceSkillCount），与 skills 屏 header 的「技能位置数」
                 （per-provider 计数和）不同——单位显式化，数字带名词。 -->
            <th scope="col" class="px-3 py-2 text-right font-medium">
              {t("skillsWorkspace.workspaceManager.colUniqueSkills")}
            </th>
            <th scope="col" class="px-5 py-2 text-right font-medium">
              {t("workspacePage.colActions")}
            </th>
          </tr>
        </thead>
        <tbody>
          {#each registered as ws (ws.id)}
            {@const removable = ws.kind === "directory" ? ws : null}
            <tr class="border-b border-border/60 align-middle hover:bg-muted/30">
              <td class="px-5 py-2.5">
                <span class="flex min-h-9 flex-col justify-center gap-0.5">
                  <span class="flex items-center gap-1.5">
                    <IconFolder
                      class="h-3.5 w-3.5 shrink-0 {ws.available
                        ? 'text-primary'
                        : 'text-amber-600 dark:text-amber-400'}"
                    />
                    <span class="truncate text-[13px] font-medium text-foreground">{ws.label}</span>
                    {#if !ws.available}
                      <span
                        class="flex shrink-0 items-center gap-1 text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400"
                      >
                        <IconAlert class="h-3 w-3" />
                        {t("skillsWorkspace.workspaceManager.missing")}
                      </span>
                    {/if}
                  </span>
                  <span
                    class="truncate font-mono text-[10px] leading-3 text-muted-foreground/80"
                    title={ws.path}>{ws.path}</span
                  >
                </span>
              </td>
              <td class="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                {ws.providers.length}
              </td>
              <td class="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                {ws.skillCount}
              </td>
              <td class="px-5 py-2.5">
                <span class="flex items-center justify-end gap-1">
                  <button
                    type="button"
                    class="flex h-9 items-center rounded-md px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    title={t("workspacePage.openTitle", { label: ws.label })}
                    onclick={() => removable && openDashboard(removable)}
                  >
                    {t("workspacePage.open")}
                  </button>
                  {#if !ws.available}
                    <button
                      type="button"
                      class="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      title={t("skillsWorkspace.workspaceManager.refreshWorkspace")}
                      aria-label={t("skillsWorkspace.workspaceManager.refreshWorkspace")}
                      onclick={() => void loadWorkspaces(true)}
                    >
                      <IconRefreshCw class="h-3.5 w-3.5" />
                    </button>
                  {/if}
                  {#if removable}
                    <button
                      type="button"
                      class="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-destructive"
                      title={t("workspacePage.removeTitle", { label: removable.label })}
                      aria-label={t("workspacePage.removeTitle", { label: removable.label })}
                      onclick={() => requestRemove(removable)}
                    >
                      <IconTrash class="h-3.5 w-3.5" />
                    </button>
                  {/if}
                </span>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>

      <!-- 窄屏卡片化（FP-09）：<720px 表格退役，每工作区一张卡，所有信息可见。 -->
      <div class="hidden space-y-2 max-[720px]:block">
        {#each registered as ws (ws.id)}
          {@const removable = ws.kind === "directory" ? ws : null}
          <div class="rounded-md border border-border p-3" data-testid="workspace-card">
            <div class="flex items-start gap-2">
              <IconFolder
                class="mt-0.5 h-4 w-4 shrink-0 {ws.available
                  ? 'text-primary'
                  : 'text-amber-600 dark:text-amber-400'}"
              />
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                  <span class="truncate text-sm font-medium text-foreground">{ws.label}</span>
                  {#if !ws.available}
                    <span
                      class="flex shrink-0 items-center gap-1 text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400"
                    >
                      <IconAlert class="h-3 w-3" />
                      {t("skillsWorkspace.workspaceManager.missing")}
                    </span>
                  {/if}
                </div>
                <p
                  class="mt-0.5 truncate font-mono text-[10px] text-muted-foreground"
                  title={ws.path}
                >
                  {ws.path}
                </p>
                <div class="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{ws.providers.length} {t("workspacePage.colProviders")}</span>
                  <span
                    >{ws.skillCount} {t("skillsWorkspace.workspaceManager.colUniqueSkills")}</span
                  >
                </div>
                <div class="mt-2 flex items-center gap-1.5">
                  <button
                    type="button"
                    class="flex h-9 items-center rounded-md border border-border px-3 text-xs transition-colors hover:bg-muted"
                    onclick={() => removable && openDashboard(removable)}
                  >
                    {t("workspacePage.open")}
                  </button>
                  {#if !ws.available}
                    <button
                      type="button"
                      class="flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-xs transition-colors hover:bg-muted"
                      aria-label={t("skillsWorkspace.workspaceManager.refreshWorkspace")}
                      onclick={() => void loadWorkspaces(true)}
                    >
                      <IconRefreshCw class="h-3.5 w-3.5" />
                      {t("skillsWorkspace.workspaceManager.refreshWorkspace")}
                    </button>
                  {/if}
                  {#if removable}
                    <button
                      type="button"
                      class="ml-auto flex h-9 items-center gap-1.5 rounded-md px-3 text-xs text-destructive transition-colors hover:bg-destructive/10"
                      onclick={() => requestRemove(removable)}
                    >
                      <IconTrash class="h-3.5 w-3.5" />
                      {t("skillsWorkspace.workspaceManager.remove")}
                    </button>
                  {/if}
                </div>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<ConfirmDialog
  bind:open={removeOpen}
  title={t("workspacePage.removeDialog.title")}
  description={removing
    ? t("workspacePage.removeDialog.description", { label: removing.label })
    : ""}
  confirmLabel={t("workspacePage.removeDialog.confirm")}
  busy={removeBusy}
  onConfirm={() => void confirmRemove()}
/>
