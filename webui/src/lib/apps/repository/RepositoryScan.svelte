<!--
  用户原始需求 [2026-07-27]：「扫描实例 Tab：复用现有 scan + preview + install 流程，视图状态来自 URL。」
  正交意图：
    1. 从 URL path param sourceId 解析源 gitUrl（curated 静态目录或 user 源 RPC list），首扫自动触发。
    2. 选中技能编码到 URL ?selected=rsk_1,rsk_2（视图状态真相源，刷新可恢复）；安装目标走组件 $state 表单。
    3. scan session daemon-owned：浏览器按需拉取 repository.scan / preview / install RPC，不缓存跨渲染周期。
  妥协声明：targets 表单提交时直接走 install RPC（短列表用 $state；超 URL 长度的方案见设计 D5，当前以
  组件 $state 表单为主，刷新可恢复 selected，targets 需重选——已在 tasks 5.4 标注）。
-->
<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { useParams, useSearch, goById } from "$lib/shell";
  import { curatedSourceEntry } from "$shared/curated-sources.js";
  import {
    installRemoteSkills,
    isSessionExpired,
    previewRemoteSkill,
    scanRemoteRepo,
    type RepositoryCallFailure,
  } from "$lib/stores/repository.svelte";
  import { loadSources, repositorySourcesState } from "$lib/stores/repository-sources.svelte";
  import { recordScanSummary } from "$lib/stores/scan-summary.svelte";
  import { loadWorkspaces, writableWorkspaceProviders } from "$lib/stores/workspaces.svelte";
  import type {
    InstallResult,
    InstallSummary,
    RemoteRepoScan,
    RemoteSkill,
    RemoteSkillId,
    RemoteSkillPreview,
    WorkspaceProviderTarget,
  } from "$lib/types";

  const getParams = useParams<{ sourceId: string }>();
  const getSearch = useSearch<{ selected?: string; skill?: string }>();

  const sourceId = $derived(getParams?.()?.sourceId);

  // 源解析：优先 curated 静态目录，回退到 user 源 RPC list。
  const curatedHit = $derived(sourceId ? curatedSourceEntry(sourceId) : undefined);
  const userHit = $derived(
    sourceId ? repositorySourcesState.user.find((entry) => entry.id === sourceId) : undefined,
  );
  const sourceLabel = $derived(curatedHit?.label ?? userHit?.label ?? sourceId ?? "Repository");
  const gitUrl = $derived(curatedHit?.gitUrl ?? userHit?.gitUrl);

  // 扫描会话（daemon-owned，组件持当前视图所需结果）。
  let scan = $state<RemoteRepoScan | null>(null);
  let scanning = $state(false);
  let scanError = $state<RepositoryCallFailure | null>(null);
  let preview = $state<RemoteSkillPreview | null>(null);
  let previewing = $state(false);
  let previewError = $state<RepositoryCallFailure | null>(null);
  let installResult = $state<InstallResult | null>(null);
  let installing = $state(false);
  let installError = $state<RepositoryCallFailure | null>(null);
  // 手动 ref（branch/tag）输入；为空扫描默认分支。
  let scanRef = $state("");

  // 选中技能从 URL ?selected= 派生（视图状态真相源）。
  const selectedParam = $derived(getSearch?.()?.selected ?? "");
  const selectedIds = $derived.by<Set<string>>(() => {
    const ids = selectedParam
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    return new Set(ids);
  });

  // 当前预览的 skillId（来自 URL ?skill=，刷新可恢复）。
  const previewSkillParam = $derived(getSearch?.()?.skill);

  // 安装目标表单（组件 $state；提交时走 install RPC）。
  let selectedTargets = $state<WorkspaceProviderTarget[]>([]);

  // 加载源列表与 workspaces（user 源 + 可写目标）。
  $effect(() => {
    void loadSources();
  });
  $effect(() => {
    void loadWorkspaces();
  });

  const targets = $derived(writableWorkspaceProviders());

  // 触发扫描；sourceId 与 gitUrl 就绪后只跑一次（基于已扫描的 sourceId 记忆）。
  let scannedSourceKey = $state<string | null>(null);
  $effect(() => {
    if (!sourceId || !gitUrl) return;
    if (scannedSourceKey === sourceId && scan) return;
    scannedSourceKey = sourceId;
    void runScan(gitUrl);
  });

  async function runScan(url: string, ref?: string): Promise<void> {
    scanning = true;
    scanError = null;
    scan = null;
    preview = null;
    previewError = null;
    installResult = null;
    installError = null;
    const trimmedRef = ref?.trim() || undefined;
    const { scan: result, error } = await scanRemoteRepo(url, trimmedRef);
    scan = result;
    scanError = error;
    if (result && sourceId) {
      recordScanSummary(sourceId, {
        skillCount: result.skills.length,
        commit: result.commit,
      });
    }
    scanning = false;
  }

  // 预览：URL ?skill= 变化时拉取。
  $effect(() => {
    if (!scan || !previewSkillParam) {
      preview = null;
      return;
    }
    const skillId = previewSkillParam as RemoteSkillId;
    if (!scan.skills.some((skill) => skill.id === skillId)) {
      preview = null;
      return;
    }
    void runPreview(scan.sessionId, skillId);
  });

  async function runPreview(
    sessionId: RemoteRepoScan["sessionId"],
    skillId: RemoteSkillId,
  ): Promise<void> {
    previewing = true;
    previewError = null;
    const { preview: result, error } = await previewRemoteSkill(sessionId, skillId);
    preview = result;
    previewError = error;
    previewing = false;
  }

  function toggleSelected(skill: RemoteSkill): void {
    const next = new Set(selectedIds);
    if (next.has(skill.id)) next.delete(skill.id);
    else next.add(skill.id);
    writeSelected(next);
  }

  function writeSelected(ids: Set<string>): void {
    const value = [...ids].join(",");
    const search = new URLSearchParams(page.url.search);
    if (value) search.set("selected", value);
    else search.delete("selected");
    const qs = search.toString();
    void goto(`/repository/scan/${encodeURIComponent(sourceId ?? "")}${qs ? `?${qs}` : ""}`, {
      replaceState: true,
    });
  }

  function selectSkillForPreview(skill: RemoteSkill): void {
    const search = new URLSearchParams(page.url.search);
    search.set("skill", skill.id);
    void goto(`/repository/scan/${encodeURIComponent(sourceId ?? "")}?${search.toString()}`, {
      replaceState: true,
    });
  }

  function toggleTarget(target: WorkspaceProviderTarget): void {
    const exists = selectedTargets.some(
      (entry) => entry.workspaceId === target.workspaceId && entry.providerId === target.providerId,
    );
    selectedTargets = exists
      ? selectedTargets.filter(
          (entry) =>
            !(entry.workspaceId === target.workspaceId && entry.providerId === target.providerId),
        )
      : [...selectedTargets, target];
  }

  function isTargetSelected(target: WorkspaceProviderTarget): boolean {
    return selectedTargets.some(
      (entry) => entry.workspaceId === target.workspaceId && entry.providerId === target.providerId,
    );
  }

  const selectedSkills = $derived.by<RemoteSkill[]>(() => {
    if (!scan) return [];
    return scan.skills.filter((skill) => selectedIds.has(skill.id));
  });

  const installableSelected = $derived(selectedSkills.filter((skill) => skill.installable));

  async function runInstall(dryRun: boolean): Promise<void> {
    if (!scan) return;
    if (installableSelected.length === 0 || selectedTargets.length === 0) return;
    installing = true;
    installError = null;
    installResult = null;
    const skillIds = installableSelected.map((skill) => skill.id) as RemoteSkillId[];
    const { result, error } = await installRemoteSkills({
      sessionId: scan.sessionId,
      skillIds,
      targets: selectedTargets,
      dryRun,
    });
    installResult = result;
    installError = error;
    installing = false;
    if (result && !dryRun) {
      // 安装成功后刷新 workspaces 投影，使跳转目标可见。
      await loadWorkspaces();
    }
  }

  // pinned session 已在 daemon 侧失效：提示重扫（preview 与 install 共用该判定）。
  const sessionExpired = $derived(isSessionExpired(previewError) || isSessionExpired(installError));

  // 安装后跳转目标（从 InstallSummary.targets 与 installed/overwritten 条目推导）。
  const installSummary = $derived(
    installResult?.kind === "result" ? (installResult as InstallSummary) : null,
  );
  const installedEntries = $derived.by(() => {
    if (!installSummary) return [];
    return installSummary.results.filter(
      (entry) => entry.status === "installed" || entry.status === "overwritten",
    );
  });

  function viewInWorkspaces(workspaceId: string, providerId: string, skillId: string): void {
    goById("workspaces.provider", { wsId: workspaceId, providerId }, { skill: skillId });
  }
</script>

<div class="flex h-full flex-col overflow-hidden">
  <header class="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
    <div class="min-w-0 flex-1">
      <h1 class="truncate text-sm font-semibold">{sourceLabel}</h1>
      {#if gitUrl}
        <p class="truncate font-mono text-[11px] text-muted-foreground">{gitUrl}</p>
      {/if}
    </div>
    {#if scan}
      <span class="shrink-0 text-[11px] text-muted-foreground">
        {scan.skills.length} skills · commit {scan.commit.slice(0, 12)}
      </span>
    {/if}
    <form
      class="flex shrink-0 items-center gap-1"
      onsubmit={(event) => {
        event.preventDefault();
        if (gitUrl) void runScan(gitUrl, scanRef);
      }}
    >
      <input
        bind:value={scanRef}
        placeholder="branch / tag"
        title="Optional Git ref to scan (defaults to the repository default branch)"
        aria-label="Git ref for scanning"
        class="h-7 w-28 rounded-md border border-input bg-input/20 px-2 font-mono text-[11px] outline-none placeholder:text-muted-foreground focus-visible:border-ring"
      />
      <button
        type="submit"
        disabled={scanning || !gitUrl}
        class="h-7 rounded-md border border-border px-2 text-[11px] transition-colors hover:bg-muted/50 disabled:opacity-50"
      >
        {scanning ? "Scanning…" : "Rescan"}
      </button>
    </form>
    <button
      type="button"
      onclick={() => goto("/repository")}
      class="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted/50"
    >
      Discover
    </button>
  </header>

  {#if sessionExpired}
    <div
      class="flex shrink-0 items-center gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs"
      role="alert"
      data-testid="session-expired"
    >
      <span class="min-w-0 flex-1">
        <span class="font-medium">Scan session expired.</span>
        <span class="text-muted-foreground">
          The pinned commit is no longer held by the daemon. Rescan this repository to continue.
        </span>
      </span>
      <button
        type="button"
        disabled={scanning || !gitUrl}
        onclick={() => gitUrl && void runScan(gitUrl, scanRef)}
        class="h-7 shrink-0 rounded-md border border-border bg-background px-3 text-[11px] font-medium transition-colors hover:bg-muted/50 disabled:opacity-50"
      >
        Rescan
      </button>
    </div>
  {/if}
  {#if scanning}
    <p class="px-4 py-8 text-center text-xs text-muted-foreground">Scanning…</p>
  {:else if scanError}
    <p class="px-4 py-8 text-center text-xs text-destructive">{scanError.message}</p>
    {#if gitUrl}
      <div class="px-4 text-center">
        <button
          type="button"
          onclick={() => runScan(gitUrl)}
          class="rounded-md border border-border px-3 py-1 text-xs hover:bg-muted/50"
        >
          Retry scan
        </button>
      </div>
    {/if}
  {:else if !scan}
    <p class="px-4 py-8 text-center text-xs text-muted-foreground">No scan yet.</p>
  {:else if scan.skills.length === 0}
    <p class="px-4 py-8 text-center text-xs text-muted-foreground">
      No installable skills found in this repository.
    </p>
  {:else}
    <div class="flex min-h-0 flex-1">
      <!-- 左：技能列表（多选） -->
      <section class="flex w-1/2 min-w-0 flex-col border-r border-border">
        <header
          class="flex shrink-0 items-center justify-between px-3 py-2 text-xs text-muted-foreground"
        >
          <span>{selectedIds.size} selected</span>
          {#if selectedIds.size > 0}
            <button
              type="button"
              class="hover:text-foreground"
              onclick={() => writeSelected(new Set())}
            >
              Clear
            </button>
          {/if}
        </header>
        <div class="min-h-0 flex-1 overflow-y-auto">
          {#each scan.skills as skill (skill.id)}
            <button
              type="button"
              class="flex w-full items-start gap-2 border-b border-border/70 px-3 py-2 text-left transition-colors {selectedIds.has(
                skill.id,
              )
                ? 'bg-accent'
                : 'hover:bg-accent/60'}"
              aria-pressed={selectedIds.has(skill.id)}
              onclick={() => selectSkillForPreview(skill)}
            >
              <input
                type="checkbox"
                checked={selectedIds.has(skill.id)}
                onclick={(event) => {
                  event.stopPropagation();
                  toggleSelected(skill);
                }}
                class="mt-0.5 h-3.5 w-3.5"
                aria-label="Select skill"
              />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-[13px] font-medium text-foreground">
                  {skill.name}
                </span>
                <span class="mt-0.5 line-clamp-2 block text-[11px] text-muted-foreground">
                  {skill.description || "No description"}
                </span>
                {#if !skill.installable}
                  <span class="mt-0.5 block text-[10px] text-amber-600 dark:text-amber-400">
                    {skill.issues.join(" ") || "Not installable"}
                  </span>
                {/if}
              </span>
            </button>
          {/each}
        </div>
      </section>

      <!-- 右：预览 + 安装表单 + 结果 -->
      <section class="flex w-1/2 min-w-0 flex-col overflow-y-auto">
        <div class="border-b border-border p-3">
          <h2 class="text-xs font-medium text-muted-foreground">Preview</h2>
          {#if previewing}
            <p class="mt-2 text-xs text-muted-foreground">Loading…</p>
          {:else if preview}
            <pre
              class="mt-2 max-h-48 overflow-auto rounded bg-muted/50 p-2 text-[11px] leading-4">{preview.content}</pre>
          {:else}
            <p class="mt-2 text-xs text-muted-foreground">Select a skill to preview.</p>
          {/if}
        </div>

        <div class="border-b border-border p-3">
          <h2 class="text-xs font-medium text-muted-foreground">
            Install targets ({selectedTargets.length})
          </h2>
          {#if targets.length === 0}
            <p class="mt-2 text-xs text-muted-foreground">
              No writable workspace providers. Import a directory workspace first.
            </p>
          {:else}
            <ul class="mt-2 space-y-1">
              {#each targets as target (target.target.workspaceId + ":" + target.target.providerId)}
                <li>
                  <label class="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={isTargetSelected(target.target)}
                      onchange={() => toggleTarget(target.target)}
                      class="h-3.5 w-3.5"
                    />
                    <span class="truncate">{target.label}</span>
                  </label>
                </li>
              {/each}
            </ul>
          {/if}
          <div class="mt-2 flex gap-2">
            <button
              type="button"
              disabled={installing ||
                installableSelected.length === 0 ||
                selectedTargets.length === 0}
              onclick={() => runInstall(true)}
              class="h-7 rounded-md border border-border px-2 text-[11px] hover:bg-muted/50 disabled:opacity-50"
            >
              Dry-run
            </button>
            <button
              type="button"
              disabled={installing ||
                installableSelected.length === 0 ||
                selectedTargets.length === 0}
              onclick={() => runInstall(false)}
              class="h-7 rounded-md bg-primary px-3 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {installing ? "Installing…" : "Install"}
            </button>
          </div>
          {#if installError && !sessionExpired}
            <p class="mt-2 break-words text-xs text-destructive">{installError.message}</p>
          {/if}
        </div>

        {#if installResult?.kind === "preview"}
          <div class="p-3 text-xs">
            <h2 class="font-medium text-muted-foreground">Dry-run preview</h2>
            <p class="mt-1">
              {installResult.totalInstalls} install(s) planned across {installResult.destinations
                .length} destination(s).
            </p>
          </div>
        {/if}

        {#if installSummary}
          <div class="p-3 text-xs">
            <h2 class="font-medium text-muted-foreground">
              Installed {installSummary.installed} · overwritten {installSummary.overwritten} · skipped
              {installSummary.skipped} · failed {installSummary.failed}
            </h2>
            {#if installedEntries.length > 0}
              <div class="mt-2 space-y-1">
                {#each installedEntries as entry (entry.target.workspaceId + ":" + entry.target.providerId + ":" + entry.skillId)}
                  <div
                    class="flex items-center justify-between gap-2 rounded border border-border px-2 py-1"
                  >
                    <span class="truncate">
                      {entry.skill} → {entry.target.workspaceId}/{entry.target.providerId}
                    </span>
                    <button
                      type="button"
                      class="shrink-0 rounded bg-primary/10 px-2 py-0.5 text-[10px] text-primary hover:bg-primary/20"
                      onclick={() =>
                        viewInWorkspaces(
                          entry.target.workspaceId,
                          entry.target.providerId,
                          entry.skillId,
                        )}
                    >
                      View in Workspaces
                    </button>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      </section>
    </div>
  {/if}
</div>
