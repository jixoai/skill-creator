<!--
  工作区管理页（workspace-page-polish：IMPORTED 词汇从用户面退役的标准承接页）。
  用户原始需求 [2026-10-05]（Owner 裁决）：「IMPORTED 的技术语义正确，但
  『IMPORTED』是实现细节泄漏进用户面——删除操作收口到标准管理页；概念呈现退化。」
  正交意图：
  1. 注册目录索引：全部已注册工作区（label + 真实路径等宽呈现 + provider/技能
     计数 + Open 跳转 dashboard）——本页即 AGENTS §7.2「Remove Workspace 必须
     在 workspace 索引仍可达」的那个索引；Global（~）是固定 tab、非注册目录，
     不出现在此列表。
  2. Remove 危险操作确认闸（ConfirmDialog 复用，先例同 dashboard-footer 旧位）
     + 成功/失败 toast；导入入口复用全局 import-workspace-dialog。
  3. 空态引导导入（无注册工作区时）；loading/error 态可区分。
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
      <!-- 管理表：真实路径（等宽）+ 动态计数 + 危险操作；窄屏降为两行卡片式行
           （label/状态行 + path/动作行），动作触达不小于 36px 高。 -->
      <table class="w-full border-collapse text-xs">
        <thead>
          <tr
            class="border-b border-border text-left text-[10px] font-medium uppercase tracking-wide text-muted-foreground max-[720px]:hidden"
          >
            <th scope="col" class="px-5 py-2 font-medium">{t("workspacePage.colWorkspace")}</th>
            <th scope="col" class="px-3 py-2 font-medium">{t("workspacePage.colPath")}</th>
            <th scope="col" class="px-3 py-2 text-right font-medium">
              {t("workspacePage.colProviders")}
            </th>
            <th scope="col" class="px-3 py-2 text-right font-medium">
              {t("workspacePage.colSkills")}
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
              <td class="px-5 py-2.5 max-[720px]:px-4">
                <span class="flex min-h-9 flex-col justify-center gap-0.5">
                  <span class="flex items-center gap-1.5">
                    <IconFolder
                      class="h-3.5 w-3.5 shrink-0 {ws.available
                        ? 'text-primary'
                        : 'text-destructive'}"
                    />
                    <span class="truncate text-[13px] font-medium text-foreground">{ws.label}</span>
                    {#if !ws.available}
                      <span
                        class="flex shrink-0 items-center gap-1 text-[10px] uppercase tracking-wide text-destructive"
                      >
                        <IconAlert class="h-3 w-3" />
                        {t("workspacePage.missing")}
                      </span>
                    {/if}
                  </span>
                  <span
                    class="truncate font-mono text-[10px] leading-3 text-muted-foreground/80 max-[720px]:block"
                    title={ws.path}>{ws.path}</span
                  >
                </span>
              </td>
              <td class="hidden px-3 py-2.5 max-[720px]:hidden">
                <span
                  class="block max-w-[26rem] truncate font-mono text-[11px] text-muted-foreground"
                  title={ws.path}>{ws.path}</span
                >
              </td>
              <td
                class="px-3 py-2.5 text-right tabular-nums text-muted-foreground max-[720px]:hidden"
              >
                {ws.providers.length}
              </td>
              <td
                class="px-3 py-2.5 text-right tabular-nums text-muted-foreground max-[720px]:hidden"
              >
                {ws.skillCount}
              </td>
              <td class="px-5 py-2.5 max-[720px]:px-4">
                <span class="flex items-center justify-end gap-1">
                  <button
                    type="button"
                    class="flex h-9 items-center rounded-md px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    title={t("workspacePage.openTitle", { label: ws.label })}
                    onclick={() => removable && openDashboard(removable)}
                  >
                    {t("workspacePage.open")}
                  </button>
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
