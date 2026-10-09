<!--
  Creator store 列面（creator-skill-store 批 2）。
  用户原始需求 [2026-10-09]（proposal）：「我们得有一个专门管理我们创建出来的这些
  skills，比如 ~/.skill-creator/creator-skills，然后再通过 ccski-sdk 将这些 skill
  安装到本地 agent skills 目录（包括 .agents/skills .codex/skills 等）……比方说……
  直接把技能放在 .agents/skills 目录，这属于我们可以自动化做到事情。」
  正交意图：
    1. store 技能列表（creatorStore.list；不兼容条目跳过计数如实呈现）。
    2. 逐行状态角标（creatorStore.status：已应用 N 处 / 已过期；过期 = 任一已应用
       实体 hash ≠ store hash）。
    3. 应用选择面（多选 roots：Global agent roots + Imported workspace providers，
       按 root 去重；默认勾选开放标准组 ~/.agents/skills——复用 install targets 的
       选择 UI 模式）+ 逐 target 收据呈现（applied/unchanged/failed 区分）。
    4. sync（updateEntity 逐 root 收据）/ uninstall（逐 scope 或全部；末投影内核
       GC）/ delete-origin（有应用面时确认闸列出剩余应用面——与卸载正交）。
  妥协声明：状态/收据为组件本地态（per-call 代次门，断线/新请求撤销提交资格）；
  列面在任意 ws 路由下同构——store 无 ws 归属。
-->
<script lang="ts">
  import IconBoxes from "@lucide/svelte/icons/boxes";
  import IconLoader from "@lucide/svelte/icons/loader-circle";
  import IconPlus from "@lucide/svelte/icons/plus";
  import IconRefresh from "@lucide/svelte/icons/rotate-cw";
  import { t } from "$lib/i18n";
  import { goById, useParams } from "$lib/shell";
  import { connectionState } from "$lib/stores/connection.svelte";
  import { loadWorkspaces, workspaceState } from "$lib/stores/workspaces.svelte";
  import {
    applyStoreSkill,
    listStoreSkills,
    removeStoreSkill,
    storeSkillStatus,
    syncStoreSkill,
    uninstallStoreSkill,
    type CreatorStoreCallFailure,
  } from "$lib/stores/creator-store";
  import { appliedScopeRows, storeApplyTargets } from "$lib/stores/creator-store-targets";
  import { showToast } from "$lib/toast.svelte";
  import { SkillDirectoryNameSchema } from "$shared/contracts/creator.js";
  import type {
    CreatorStoreApplyResult,
    CreatorStoreSkill,
    CreatorStoreStatusResult,
    SkillDirectoryName,
    WorkspaceProviderTarget,
  } from "$lib/types";
  import type { WorkspaceId } from "$lib/types";

  const getParams = useParams<{ wsId: WorkspaceId }>();
  const wsId = $derived(getParams?.()?.wsId);

  // ---- 列表与状态（per-call 代次门；连接闸——未连接不发 RPC，重连自动补载） ----
  let list = $state<CreatorStoreSkill[] | null>(null);
  let skippedCount = $state(0);
  let listLoading = $state(false);
  let listError = $state<string | null>(null);

  let statuses = $state<Record<string, CreatorStoreStatusResult | null>>({});
  let statusesLoading = $state<Record<string, boolean>>({});
  let statusesError = $state<Record<string, string | null>>({});

  async function refreshList(): Promise<void> {
    if (connectionState.status !== "connected") return;
    listLoading = true;
    const { list: result, error } = await listStoreSkills();
    listLoading = false;
    if (error !== null) {
      listError = error.message;
      return;
    }
    listError = null;
    if (result === null) return; // superseded：代次门作废，不投影。
    list = result.skills;
    skippedCount = result.skipped;
    statuses = {};
    statusesLoading = {};
    statusesError = {};
    for (const skill of result.skills) {
      void refreshStatus(skill.directoryName);
    }
  }

  async function refreshStatus(directoryName: SkillDirectoryName): Promise<void> {
    if (connectionState.status !== "connected") return;
    statusesLoading[directoryName] = true;
    const { status, error } = await storeSkillStatus(directoryName);
    // 竞态防线：行已不在列表（删除后）不投影。
    if (list?.some((skill) => skill.directoryName === directoryName) !== true) return;
    statusesLoading[directoryName] = false;
    if (error !== null) {
      statusesError[directoryName] = error.message;
      return;
    }
    statusesError[directoryName] = null;
    statuses[directoryName] = status;
  }

  $effect(() => {
    if (connectionState.status !== "connected") return;
    void loadWorkspaces();
    void refreshList();
  });

  // ---- 应用选择面（roots 多选；默认勾选开放标准组 ~/.agents/skills） ----
  const applyTargets = $derived(storeApplyTargets(workspaceState.workspaces));

  let applyOpenFor = $state<string | null>(null);
  let applySelected = $state<WorkspaceProviderTarget[]>([]);
  let applying = $state(false);
  let applyResult = $state<CreatorStoreApplyResult | null>(null);
  let applyError = $state<string | null>(null);

  function openApply(skill: CreatorStoreSkill): void {
    applyOpenFor = skill.directoryName;
    applyResult = null;
    applyError = null;
    // 默认勾选：开放标准组（auto-apply 同位）；已有应用面也预勾（增量语义自然）。
    const applied = statuses[skill.directoryName]?.skill.appliedRoots ?? [];
    const appliedTargets = applyTargets
      .filter((entry) => applied.some((application) => application.roots.includes(entry.root)))
      .map((entry) => entry.target);
    applySelected = [
      ...applyTargets.filter((entry) => entry.defaultChecked).map((entry) => entry.target),
      ...appliedTargets.filter(
        (target) =>
          !applyTargets
            .filter((entry) => entry.defaultChecked)
            .some(
              (entry) =>
                entry.target.workspaceId === target.workspaceId &&
                entry.target.providerId === target.providerId,
            ),
      ),
    ];
  }

  function isApplyTargetSelected(target: WorkspaceProviderTarget): boolean {
    return applySelected.some(
      (entry) => entry.workspaceId === target.workspaceId && entry.providerId === target.providerId,
    );
  }

  function toggleApplyTarget(target: WorkspaceProviderTarget): void {
    applySelected = isApplyTargetSelected(target)
      ? applySelected.filter(
          (entry) =>
            !(entry.workspaceId === target.workspaceId && entry.providerId === target.providerId),
        )
      : [...applySelected, target];
  }

  async function runApply(): Promise<void> {
    if (applyOpenFor === null || applying || applySelected.length === 0) return;
    const parsed = SkillDirectoryNameSchema.safeParse(applyOpenFor);
    if (!parsed.success) return;
    applying = true;
    applyError = null;
    const { result, error } = await applyStoreSkill({
      directoryName: parsed.data,
      targets: applySelected,
    });
    applying = false;
    if (error !== null) {
      applyError = error.message;
      return;
    }
    if (result === null) return;
    applyResult = result;
    if (result.failed > 0) {
      showToast(t("creatorStore.toastApplyPartial", { failed: result.failed }));
    } else {
      showToast(t("creatorStore.toastApplied", { count: result.applied + result.unchanged }));
    }
    await refreshStatus(parsed.data);
  }

  // ---- sync / uninstall（逐 root 收据；mutation 反馈区分 succeeded/failed） ----
  const busySync = $state(new Set<string>());
  const busyUninstall = $state(new Set<string>());

  /** 卸载忙碌键（directoryName + scopes 派生；all = 全部已登记面）。 */
  function uninstallBusyKey(
    directoryName: string,
    scopes?: Array<{ scope: "global" } | { scope: "project"; workspaceId: string }>,
  ): string {
    const scopeKey =
      scopes === undefined
        ? "all"
        : scopes
            .map((scope) => `${scope.scope}:${"workspaceId" in scope ? scope.workspaceId : ""}`)
            .join(",");
    return `${directoryName}:${scopeKey}`;
  }

  async function runSync(skill: CreatorStoreSkill): Promise<void> {
    if (busySync.has(skill.directoryName)) return;
    busySync.add(skill.directoryName);
    const { result, error } = await syncStoreSkill(skill.directoryName);
    busySync.delete(skill.directoryName);
    if (error !== null) {
      showToast(error.message);
      return;
    }
    if (result === null) return;
    if (result.failed > 0) {
      showToast(
        t("creatorStore.toastSyncFailed", { failed: result.failed, total: result.results.length }),
      );
    } else {
      showToast(
        t("creatorStore.toastSynced", {
          updated: result.updated,
          unchanged: result.unchanged,
          skipped: result.skipped,
        }),
      );
    }
    await refreshStatus(skill.directoryName);
  }

  async function runUninstall(
    skill: CreatorStoreSkill,
    scopes?: Array<{ scope: "global" } | { scope: "project"; workspaceId: string }>,
  ): Promise<void> {
    const key = uninstallBusyKey(skill.directoryName, scopes);
    if (busyUninstall.has(key)) return;
    busyUninstall.add(key);
    const { result, error } = await uninstallStoreSkill({
      directoryName: skill.directoryName,
      ...(scopes !== undefined ? { scopes } : {}),
    });
    busyUninstall.delete(key);
    if (error !== null) {
      showToast(error.message);
      return;
    }
    if (result === null) return;
    if (result.failed > 0) {
      showToast(t("creatorStore.toastUninstallFailed", { failed: result.failed }));
    } else {
      showToast(t("creatorStore.toastUninstalled", { count: result.removed }));
    }
    await refreshStatus(skill.directoryName);
  }

  // ---- delete-origin（确认闸列出剩余应用面；与卸载正交） ----
  let deleteSkill = $state<CreatorStoreSkill | null>(null);
  let deleting = $state(false);

  const deleteRemainingRows = $derived.by(() => {
    if (deleteSkill === null) return [];
    const applied = statuses[deleteSkill.directoryName]?.skill.appliedRoots ?? [];
    return appliedScopeRows(applied, workspaceState.workspaces);
  });

  async function runDelete(): Promise<void> {
    if (deleteSkill === null || deleting) return;
    const revision = statuses[deleteSkill.directoryName]?.skill.revision ?? deleteSkill.revision;
    deleting = true;
    const { result, error } = await removeStoreSkill({
      directoryName: deleteSkill.directoryName,
      expectedRevision: revision,
    });
    deleting = false;
    if (error !== null) {
      deleteSkill = null;
      showToast(error.message);
      await refreshList();
      return;
    }
    if (result === null) {
      deleteSkill = null;
      return;
    }
    if (result.remainingApplications.length > 0) {
      // 删除成功但仍有应用面：如实警告（已应用副本留在 agent 目录）。
      showToast(
        t("creatorStore.toastDeleteRemained", { count: result.remainingApplications.length }),
      );
    } else {
      showToast(t("creatorStore.toastDeleted"));
    }
    deleteSkill = null;
    await refreshList();
  }

  function scopeOf(application: {
    scope: "global" | "project";
    workspaceId?: string;
  }): { scope: "global" } | { scope: "project"; workspaceId: string } {
    return application.scope === "global"
      ? { scope: "global" }
      : { scope: "project", workspaceId: application.workspaceId ?? "" };
  }

  function openEditor(skill: CreatorStoreSkill): void {
    if (wsId === undefined) return;
    goById("creator.store.skill", { wsId, directoryName: skill.directoryName });
  }

  function openNew(): void {
    if (wsId === undefined) return;
    goById("creator.new", { wsId });
  }
</script>

<section class="flex h-full min-h-0 flex-col overflow-hidden" data-creator-store="true">
  <header
    class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-4 py-3"
  >
    <div class="flex min-w-0 items-center gap-1.5">
      <IconBoxes class="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <span class="text-sm font-semibold">{t("creatorStore.title")}</span>
    </div>
    <p class="min-w-0 flex-1 truncate text-xs text-muted-foreground">
      {t("creatorStore.subtitle")}
    </p>
    <button
      type="button"
      class="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 text-[11px] transition-colors hover:bg-muted/50 disabled:opacity-50"
      disabled={listLoading}
      title={t("creatorStore.refresh")}
      onclick={() => void refreshList()}
    >
      <IconRefresh class="h-3.5 w-3.5" aria-hidden="true" />
      {t("creatorStore.refresh")}
    </button>
    <button
      type="button"
      class="flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      data-store-new="true"
      onclick={openNew}
    >
      <IconPlus class="h-3.5 w-3.5" aria-hidden="true" />
      {t("creatorStore.newSkill")}
    </button>
  </header>

  {#if listLoading && list === null}
    <div
      class="p-4"
      role="status"
      aria-label={t("creatorStore.loading")}
      data-testid="store-skeleton"
    >
      {#each { length: 4 } as _, i (i)}
        <div class="mb-2.5 flex items-start gap-2">
          <div class="h-3.5 w-2/5 animate-pulse rounded bg-muted/60"></div>
          <div class="h-3 w-1/5 animate-pulse rounded bg-muted/60"></div>
        </div>
      {/each}
    </div>
  {:else if listError}
    <div class="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
      <p class="text-xs text-destructive" role="alert">{listError}</p>
      <button
        type="button"
        class="h-7 rounded-md border border-border px-3 text-[11px] hover:bg-muted/50"
        onclick={() => void refreshList()}
      >
        {t("common.retry")}
      </button>
    </div>
  {:else if list !== null && list.length === 0}
    <div class="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
      <p class="text-xs text-muted-foreground">{t("creatorStore.empty")}</p>
      <button
        type="button"
        class="h-7 rounded-md bg-primary px-3 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
        data-store-new-empty="true"
        onclick={openNew}
      >
        {t("creatorStore.newSkill")}
      </button>
    </div>
  {:else if list !== null}
    {#if skippedCount > 0}
      <p
        class="shrink-0 border-b border-border px-4 py-1.5 text-[11px] text-amber-600 dark:text-amber-400"
      >
        {t("creatorStore.skippedWarning", { count: skippedCount })}
      </p>
    {/if}
    <div class="min-h-0 flex-1 overflow-y-auto">
      {#each list as skill (skill.directoryName)}
        {@const status = statuses[skill.directoryName] ?? null}
        {@const statusLoading = statusesLoading[skill.directoryName] === true}
        {@const statusError = statusesError[skill.directoryName] ?? null}
        {@const applications = status?.skill.appliedRoots ?? []}
        {@const outdated = status?.skill.outdated === true}
        <article
          class="flex flex-col gap-2 border-b border-border/70 px-4 py-3"
          data-testid="store-row"
          data-directory={skill.directoryName}
        >
          <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <button
              type="button"
              class="relative truncate text-[13px] font-medium text-foreground after:absolute after:-inset-1 after:content-[''] hover:text-primary hover:underline"
              title={t("creatorStore.openEditorTitle")}
              onclick={() => openEditor(skill)}
            >
              {skill.name}
            </button>
            <span class="truncate font-mono text-[11px] text-muted-foreground">
              {skill.directoryName}
            </span>
            <span class="min-w-0 flex-1"></span>
            <!-- 状态角标（status RPC；加载中骨架、失败如实呈现）。 -->
            {#if statusLoading && status === null}
              <span class="flex items-center gap-1 text-[10px] text-muted-foreground" role="status">
                <IconLoader class="h-3 w-3 animate-spin" aria-hidden="true" />
                {t("creatorStore.statusLoading")}
              </span>
            {:else if statusError}
              <span
                class="max-w-64 truncate text-[10px] text-destructive"
                title={statusError}
                role="alert">{statusError}</span
              >
            {:else if applications.length === 0}
              <span
                class="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                data-testid="store-status-badge"
              >
                {t("creatorStore.notApplied")}
              </span>
            {:else}
              <span
                class="rounded-sm bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300"
                data-testid="store-status-badge"
                title={applications.flatMap((application) => application.roots).join("\n")}
              >
                {t("creatorStore.appliedBadge", { count: applications.length })}
              </span>
            {/if}
            {#if outdated}
              <span
                class="rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400"
                data-testid="store-outdated-badge"
              >
                {t("creatorStore.outdated")}
              </span>
            {/if}
          </div>

          <p class="line-clamp-2 text-[11px] leading-4 text-muted-foreground">
            {skill.description}
          </p>

          <!-- 已应用面（逐 scope 展开 roots；逐 scope 卸载入口）。 -->
          {#if applications.length > 0}
            <ul class="space-y-0.5" data-testid="store-applied-roots">
              {#each appliedScopeRows(applications, workspaceState.workspaces) as row (row.scope + ":" + (row.workspaceId ?? "-"))}
                {@const rowScope = scopeOf({
                  scope: row.scope,
                  ...(row.workspaceId !== undefined ? { workspaceId: row.workspaceId } : {}),
                })}
                <li class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span class="text-[10px] font-medium text-muted-foreground">{row.label}</span>
                  {#each row.roots as root (root)}
                    <code
                      class="max-w-72 truncate rounded bg-muted/50 px-1 py-0.5 font-mono text-[10px] text-muted-foreground"
                      >{root}</code
                    >
                  {/each}
                  <button
                    type="button"
                    class="relative ml-auto rounded px-1 text-[10px] text-muted-foreground underline-offset-2 after:absolute after:-inset-1 after:content-[''] hover:text-destructive hover:underline disabled:opacity-50"
                    disabled={busyUninstall.has(uninstallBusyKey(skill.directoryName, [rowScope]))}
                    onclick={() => void runUninstall(skill, [rowScope])}
                  >
                    {t("creatorStore.uninstallScope")}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}

          <!-- 行动作：Apply to… / Sync（有过期或已应用才有意义，但保留可用性：
               sync 幂等收敛）/ Uninstall all / Delete origin。 -->
          <div class="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              class="h-7 rounded-md border border-border px-2 text-[11px] hover:bg-muted/50 disabled:opacity-50"
              data-store-apply-open="true"
              onclick={() => openApply(skill)}
            >
              {t("creatorStore.applyTo")}
            </button>
            <button
              type="button"
              class="relative flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] after:absolute after:-inset-1 after:content-[''] hover:bg-muted/50 disabled:opacity-50"
              disabled={applications.length === 0 || busySync.has(skill.directoryName)}
              data-store-sync="true"
              onclick={() => void runSync(skill)}
            >
              {#if busySync.has(skill.directoryName)}
                <IconLoader class="h-3 w-3 animate-spin" aria-hidden="true" />
              {/if}
              {t("creatorStore.sync")}
            </button>
            {#if applications.length > 1}
              <button
                type="button"
                class="h-7 rounded-md border border-border px-2 text-[11px] hover:bg-muted/50 disabled:opacity-50"
                disabled={busyUninstall.has(uninstallBusyKey(skill.directoryName))}
                data-store-uninstall-all="true"
                onclick={() => void runUninstall(skill)}
              >
                {t("creatorStore.uninstallAll")}
              </button>
            {/if}
            <span class="min-w-0 flex-1"></span>
            <!-- 危险操作隔离（R2 同法）：分隔线后右置 delete-origin。 -->
            <span class="mx-0.5 h-4 w-px shrink-0 bg-border" aria-hidden="true"></span>
            <button
              type="button"
              class="relative h-7 rounded-md px-2 text-[11px] text-destructive after:absolute after:-inset-1 after:content-[''] hover:bg-destructive/10 disabled:opacity-50"
              data-store-delete="true"
              onclick={() => (deleteSkill = skill)}
            >
              {t("creatorStore.deleteOrigin")}
            </button>
          </div>
        </article>
      {/each}
    </div>
  {:else}
    <!-- 未连接窗口：连接转 ready 由上方 effect 自动补载。 -->
    <div
      class="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground"
      role="status"
    >
      <IconLoader class="h-4 w-4 animate-spin" aria-hidden="true" />
      {t("creatorStore.loading")}
    </div>
  {/if}
</section>

{#if applyOpenFor !== null}
  <!-- 应用选择面：roots 多选（按 root 去重；默认勾选开放标准组 ~/.agents/skills）；
       复用 install targets 的选择 UI 模式（分组 + checkbox + 计数头）。 -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    role="dialog"
    aria-modal="true"
    aria-label={t("creatorStore.applyDialogAria")}
    data-testid="store-apply-dialog"
  >
    <div
      class="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border border-border bg-background p-4 shadow-lg"
    >
      <h2 class="shrink-0 text-sm font-semibold">
        {t("creatorStore.applyDialogTitle", { name: applyOpenFor })}
      </h2>
      <p class="mt-0.5 shrink-0 text-xs text-muted-foreground">
        {t("creatorStore.applyDefaultHint")}
      </p>
      {#if applyTargets.length === 0}
        <p class="mt-3 text-xs text-muted-foreground">{t("creatorStore.noTargets")}</p>
      {:else}
        <div class="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto">
          {#each applyTargets as entry (entry.target.workspaceId + ":" + entry.target.providerId)}
            <label
              class="flex min-h-9 items-center gap-2 text-xs"
              data-testid="apply-target-option"
              data-root={entry.root}
              data-default-checked={entry.defaultChecked ? "true" : undefined}
            >
              <input
                type="checkbox"
                checked={isApplyTargetSelected(entry.target)}
                onchange={() => toggleApplyTarget(entry.target)}
                class="h-3.5 w-3.5"
              />
              <span class="min-w-0 flex-1">
                <span class="block truncate font-mono text-[11px]">{entry.root}</span>
                <span class="block truncate text-[10px] text-muted-foreground">
                  {entry.scope === "global"
                    ? t("creatorStore.applyGlobalSection")
                    : entry.workspaceLabel}
                </span>
              </span>
            </label>
          {/each}
        </div>
      {/if}
      {#if applyError}
        <p class="mt-2 shrink-0 break-words text-xs text-destructive" role="alert">{applyError}</p>
      {/if}
      {#if applyResult !== null}
        <div
          class="mt-2 shrink-0 rounded-md border border-border p-2 text-[11px]"
          data-testid="apply-receipts"
        >
          <p class="font-medium text-muted-foreground">
            {t("creatorStore.applyResultSummary", {
              applied: applyResult.applied,
              unchanged: applyResult.unchanged,
              failed: applyResult.failed,
            })}
          </p>
          {#each applyResult.results as receipt, i (i)}
            {#if receipt.status === "failed"}
              <p class="mt-1 break-words text-destructive" data-testid="apply-receipt-failed">
                {receipt.root}: {receipt.error ?? ""}
              </p>
            {/if}
          {/each}
        </div>
      {/if}
      <div class="mt-4 flex shrink-0 justify-end gap-2">
        <button
          type="button"
          class="h-9 rounded-md border border-border px-3 text-xs hover:bg-muted/50"
          onclick={() => (applyOpenFor = null)}
        >
          {t("common.dismiss")}
        </button>
        <button
          type="button"
          class="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          disabled={applying || applySelected.length === 0}
          data-store-apply-run="true"
          onclick={() => void runApply()}
        >
          {#if applying}<IconLoader class="h-3.5 w-3.5 animate-spin" aria-hidden="true" />{/if}
          {t("creatorStore.applyButton", { count: applySelected.length })}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if deleteSkill !== null}
  <!-- delete-origin 确认闸（与卸载正交）：有应用面时列出剩余应用面——已应用副本
       不随根源删除（仍需卸载），用户须知后确认。 -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    role="dialog"
    aria-modal="true"
    aria-label={t("creatorStore.deleteConfirmTitle")}
    data-testid="store-delete-confirm"
  >
    <div class="w-full max-w-md rounded-lg border border-border bg-background p-4 shadow-lg">
      <h2 class="text-sm font-semibold">{t("creatorStore.deleteConfirmTitle")}</h2>
      <p class="mt-1 text-xs text-muted-foreground">
        {t("creatorStore.deleteConfirmBody", {
          name: deleteSkill.name,
          directory: deleteSkill.directoryName,
        })}
      </p>
      {#if deleteRemainingRows.length > 0}
        <div class="mt-2" data-testid="delete-remaining">
          <p class="text-xs font-medium text-amber-700 dark:text-amber-400">
            {t("creatorStore.deleteConfirmApplied", { count: deleteRemainingRows.length })}
          </p>
          <ul class="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
            {#each deleteRemainingRows as row (row.scope + ":" + (row.workspaceId ?? "-"))}
              {#each row.roots as root (root)}
                <li
                  class="truncate rounded border border-border px-2 py-1 font-mono text-[10px] text-muted-foreground"
                  data-testid="delete-remaining-root"
                  title={root}
                >
                  {root}
                </li>
              {/each}
            {/each}
          </ul>
        </div>
      {/if}
      <div class="mt-4 flex justify-end gap-2">
        <button
          type="button"
          class="h-9 rounded-md border border-border px-3 text-xs hover:bg-muted/50"
          onclick={() => (deleteSkill = null)}
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          class="h-9 rounded-md bg-destructive px-3 text-xs font-medium text-white hover:bg-destructive/90 disabled:opacity-50"
          disabled={deleting}
          data-store-delete-confirm="true"
          onclick={() => void runDelete()}
        >
          {#if deleting}<IconLoader
              class="mr-1 inline h-3.5 w-3.5 animate-spin"
              aria-hidden="true"
            />{/if}
          {t("creatorStore.deleteOrigin")}
        </button>
      </div>
    </div>
  </div>
{/if}
