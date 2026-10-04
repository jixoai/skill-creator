<!--
  用户原始需求 [2026-07-27]：「扫描实例 Tab：复用现有 scan + preview + install 流程，
  视图状态来自 URL。」
  迁移修订 [2026-10-03]（skills-dashboard 1.5）：apps/repository → apps/workspaces；
  路由迁 /w/:wsId/skills/repos/scan/:sourceId（pinned-clone → preview/install 状态机
  原样）；安装目标按当前 tab wsId 预填（Imported 才可选；Global 只读空态引导）；
  文案出生即 i18n（C 类面）。
  修订 [2026-10-04]（workspace-page-polish V4）：安装目标默认仅列当前 tab ws 的
  providers；其他 ws 收进「Show other workspaces」折叠区（保留跨 ws 多选能力，
  但页面不再默认露出其他 ws 清单——页内跨 ws 切换器痕迹收敛）。
  修订 [2026-10-04]（workspace-page-polish 批评处置 P1-3）：工具栏 flex-wrap
  动作成组（Discover 任何面板宽度完整）；列表行描述 clamp 2 行 + 行高 ≤64px +
  全文进 preview（Tailwind .block 覆盖 .line-clamp-* 的 -webkit-box 是折叠
  根因，clamp 元素禁配 block）；preview pre-wrap 换行 + 预览头 name/description
  + 列表行 previewed 高亮双向对应。
  修订 [2026-10-04]（workspace-page-polish 2.2 处置批）：P1-1 安装确认步
  （选中目标 >10 时 Install 先过对话框，列计数与目标名；Dry-run 不设闸）；
  P2-3 选中真相本地 Set 化（连续 toggle 读旧 page.url.search 互相覆盖的竞态
  根治——URL 降级为单向投影）；P2-4 容器 <692px 单列栈（阈值与 dashboard
  网格降档同源，不再 50/50 截断 label）；P2-10 scanning 骨架行替换裸文本。
  正交意图：
    1. 从 URL path param sourceId 解析源 gitUrl（curated 静态目录或 user 源 RPC list），
       首扫自动触发。
    2. 选中技能编码到 URL ?selected=rsk_1,rsk_2（视图状态真相源，刷新可恢复）；
       安装目标走组件 $state 表单（当前 wsId 预填）。
    3. scan session daemon-owned：浏览器按需拉取 repository.scan / preview / install RPC，
       不缓存跨渲染周期。
  妥协声明：targets 表单提交时直接走 install RPC（短列表用 $state；超 URL 长度的方案
  见设计 D5，当前以组件 $state 表单为主，刷新可恢复 selected，targets 需重选）。
-->
<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { useParams, useSearch, goById } from "$lib/shell";
  import { t } from "$lib/i18n";
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
  import { WorkspaceIdSchema } from "$shared/contracts/workspaces.js";
  import type { WorkspaceId } from "$shared/contracts/workspaces.js";

  const getParams = useParams<{ wsId: string; sourceId: string }>();
  const getSearch = useSearch<{ selected?: string; skill?: string }>();

  const rawWsId = $derived(getParams?.()?.wsId);
  const sourceId = $derived(getParams?.()?.sourceId);
  // wsId 经 manifest zod schema 校验（match 阶段）；这里安全解析为 branded 类型。
  const wsId = $derived.by(() => {
    const parsed = WorkspaceIdSchema.safeParse(rawWsId);
    return parsed.success ? (parsed.data as WorkspaceId) : null;
  });

  // 源解析：优先 curated 静态目录，回退到 user 源 RPC list。
  const curatedHit = $derived(sourceId ? curatedSourceEntry(sourceId) : undefined);
  const userHit = $derived(
    sourceId ? repositorySourcesState.user.find((entry) => entry.id === sourceId) : undefined,
  );
  const sourceLabel = $derived(
    curatedHit?.label ?? userHit?.label ?? sourceId ?? t("reposScan.sourceFallback"),
  );
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

  // ?selected= 投影（刷新/恢复面）。
  const selectedParam = $derived(getSearch?.()?.selected ?? "");
  // 选中真相 = 本地 Set（2.2 处置批 P2-3）：旧实现每次 toggle 从 page.url.search
  // 重建参数，goto 未落地前第二个 toggle 会丢掉第一个的变更（互相覆盖）。URL 降级
  // 为单向投影：写入一律序列化本地 Set；投影值集合（projected）落地回声不重放
  // （乱序落地安全）；未投影过的参数变化（挂载种子/真外部导航）才重放真相。
  // 写入均 replaceState（不产历史条目），故 mounted 生命周期内不存在「回退到
  // 已投影值」的外部导航路径。
  let selectedTruth = $state<Set<string>>(new Set());
  const projectedSelections = new Set<string>();
  $effect(() => {
    const param = selectedParam;
    if (projectedSelections.has(param)) return;
    selectedTruth = new Set(
      param
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    );
  });
  const selectedIds = $derived(selectedTruth);

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

  // 安装目标分区（V4）：当前 tab ws 默认露出；其他 ws 折叠（跨 ws 安装走展开区）。
  const onGlobalTab = $derived(wsId === null || wsId === ("~" as const));
  const currentTabTargets = $derived(
    onGlobalTab ? [] : targets.filter((entry) => entry.target.workspaceId === wsId),
  );
  const otherTabTargets = $derived(
    onGlobalTab ? targets : targets.filter((entry) => entry.target.workspaceId !== wsId),
  );
  let showOtherTargets = $state(false);

  // 安装目标预填（skills-dashboard 1.5）：当前 tab 是 Imported ws → 预勾选其全部
  // 可写 provider（一次 latch；用户此后可自由增删）；Global tab → 不预填 + 引导。
  let prefilled = false;
  $effect(() => {
    if (prefilled || targets.length === 0) return;
    prefilled = true;
    const current = wsId;
    if (!current || current === ("~" as const)) return;
    selectedTargets = targets
      .filter((entry) => entry.target.workspaceId === current)
      .map((entry) => entry.target);
  });

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

  function scanPath(params: URLSearchParams): string {
    const qs = params.toString();
    return `/w/${wsId}/skills/repos/scan/${encodeURIComponent(sourceId ?? "")}${qs ? `?${qs}` : ""}`;
  }

  function toggleSelected(skill: RemoteSkill): void {
    const next = new Set(selectedTruth);
    if (next.has(skill.id)) next.delete(skill.id);
    else next.add(skill.id);
    writeSelected(next);
  }

  /** 以本地选中真相覆写 search 的 selected 键（P2-3 单向投影；其余键保留）。 */
  function projectSelected(search: URLSearchParams): void {
    const value = [...selectedTruth].join(",");
    if (value) search.set("selected", value);
    else search.delete("selected");
    projectedSelections.add(value);
  }

  function writeSelected(ids: Set<string>): void {
    selectedTruth = ids;
    const search = new URLSearchParams(page.url.search);
    projectSelected(search);
    void goto(scanPath(search), { replaceState: true });
  }

  function selectSkillForPreview(skill: RemoteSkill): void {
    const search = new URLSearchParams(page.url.search);
    projectSelected(search);
    search.set("skill", skill.id);
    void goto(scanPath(search), { replaceState: true });
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

  // 安装确认步（2.2 处置批 P1-1）：选中目标超过阈值时 Install 先过对话框（列
  // 计数与目标名）——破坏性批量写入前的最后一道人闸。Dry-run 不设闸（无写入）。
  // ExpectedInstallTarget 全链验证（canonical/非 symlink/containment）在 daemon
  // 侧原样，本闸只拦「人没意识到规模」的误确认。
  const INSTALL_CONFIRM_TARGETS_THRESHOLD = 10;
  const selectedTargetEntries = $derived(
    targets.filter((entry) =>
      selectedTargets.some(
        (selected) =>
          selected.workspaceId === entry.target.workspaceId &&
          selected.providerId === entry.target.providerId,
      ),
    ),
  );
  const needsInstallConfirm = $derived(
    selectedTargetEntries.length > INSTALL_CONFIRM_TARGETS_THRESHOLD,
  );
  let installConfirmOpen = $state(false);

  /** Install 入口：超阈值先开确认对话框，否则直跑。 */
  function requestInstall(): void {
    if (installing) return;
    if (needsInstallConfirm) {
      installConfirmOpen = true;
      return;
    }
    void runInstall(false);
  }

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

  function viewInDashboard(workspaceId: string, providerId: string, skillId: string): void {
    goById(
      "workspaces.provider",
      { wsId: workspaceId, providerId },
      { skill: skillId, view: "detail" },
    );
  }
</script>

<div class="scan-root flex h-full flex-col overflow-hidden">
  <!-- 工具栏防截断（批评处置 P1-3a）：flex-wrap + 动作成组——行宽不足时动作组
       整体换行（组内再自换行），任何面板宽度下按钮完整，不再被 Agent 面板
       边缘拦腰切断；标题块 basis-56 保证换行前保有最小可读宽度。 -->
  <header
    class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3"
  >
    <div class="min-w-0 flex-1 basis-56">
      <h1 class="truncate text-sm font-semibold">{sourceLabel}</h1>
      {#if gitUrl}
        <p class="truncate font-mono text-[11px] text-muted-foreground">{gitUrl}</p>
      {/if}
    </div>
    <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
      {#if scan}
        <span class="shrink-0 text-[11px] text-muted-foreground" data-testid="scan-meta">
          {t("reposScan.meta", { count: scan.skills.length, commit: scan.commit.slice(0, 12) })}
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
          placeholder={t("reposScan.refPlaceholder")}
          title={t("reposScan.refTitle")}
          aria-label={t("reposScan.refTitle")}
          class="h-7 w-28 rounded-md border border-input bg-input/20 px-2 font-mono text-[11px] outline-none placeholder:text-muted-foreground focus-visible:border-ring"
        />
        <button
          type="submit"
          disabled={scanning || !gitUrl}
          class="h-7 rounded-md border border-border px-2 text-[11px] transition-colors hover:bg-muted/50 disabled:opacity-50"
        >
          {scanning ? t("reposScan.scanning") : t("reposScan.rescan")}
        </button>
      </form>
      <button
        type="button"
        onclick={() => goto(`/w/${wsId}/skills?screen=repos`)}
        class="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted/50"
      >
        {t("reposScan.discover")}
      </button>
    </div>
  </header>

  {#if sessionExpired}
    <div
      class="flex shrink-0 items-center gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs"
      role="alert"
      data-testid="session-expired"
    >
      <span class="min-w-0 flex-1">
        <span class="font-medium">{t("reposScan.expiredTitle")}</span>
        <span class="text-muted-foreground">{t("reposScan.expiredBody")}</span>
      </span>
      <button
        type="button"
        disabled={scanning || !gitUrl}
        onclick={() => gitUrl && void runScan(gitUrl, scanRef)}
        class="h-7 shrink-0 rounded-md border border-border bg-background px-3 text-[11px] font-medium transition-colors hover:bg-muted/50 disabled:opacity-50"
      >
        {t("reposScan.rescan")}
      </button>
    </div>
  {/if}
  {#if scanning}
    <!-- scanning 骨架行（2.2 处置批 P2-10）：替换裸文本——行形态与结果列表同构
         （checkbox 位 + 名称条 + 描述条），role=status 保留屏幕阅读器语义。 -->
    <div class="p-4" role="status" aria-label={t("reposScan.scanning")} data-testid="scan-skeleton">
      {#each { length: 6 } as _, i (i)}
        <div class="mb-2.5 flex items-start gap-2">
          <div class="mt-0.5 h-3.5 w-3.5 shrink-0 animate-pulse rounded-sm bg-muted/60"></div>
          <div class="min-w-0 flex-1 space-y-1.5">
            <div class="h-3.5 w-2/5 animate-pulse rounded bg-muted/60"></div>
            <div class="h-3 w-4/5 animate-pulse rounded bg-muted/60"></div>
          </div>
        </div>
      {/each}
    </div>
  {:else if scanError}
    <p class="px-4 py-8 text-center text-xs text-destructive">{scanError.message}</p>
    {#if gitUrl}
      <div class="px-4 text-center">
        <button
          type="button"
          onclick={() => runScan(gitUrl)}
          class="rounded-md border border-border px-3 py-1 text-xs hover:bg-muted/50"
        >
          {t("reposScan.retryScan")}
        </button>
      </div>
    {/if}
  {:else if !scan}
    <p class="px-4 py-8 text-center text-xs text-muted-foreground">{t("reposScan.noScan")}</p>
  {:else if scan.skills.length === 0}
    <p class="px-4 py-8 text-center text-xs text-muted-foreground">
      {t("reposScan.noSkills")}
    </p>
  {:else}
    <!-- 窄容器单列栈（2.2 处置批 P2-4）：容器查询阈值 692px 与 dashboard 网格
         降档同源——Agent 面板开启/窄窗下不再 50/50 截断 label（列表上、预览+安装
         下）。样式见文件尾 <style>。 -->
    <div class="scan-split flex min-h-0 flex-1">
      <!-- 左：技能列表（多选） -->
      <section class="scan-list flex w-1/2 min-w-0 min-h-0 flex-col border-r border-border">
        <header
          class="flex shrink-0 items-center justify-between px-3 py-2 text-xs text-muted-foreground"
        >
          <span data-testid="selected-count"
            >{t("reposScan.selectedCount", { count: selectedIds.size })}</span
          >
          {#if selectedIds.size > 0}
            <button
              type="button"
              class="hover:text-foreground"
              onclick={() => writeSelected(new Set())}
            >
              {t("reposScan.clear")}
            </button>
          {/if}
        </header>
        <div class="min-h-0 flex-1 overflow-y-auto">
          {#each scan.skills as skill (skill.id)}
            {@const previewed = previewSkillParam === skill.id}
            <button
              type="button"
              class="flex w-full items-start gap-2 border-b border-border/70 px-3 py-1.5 text-left transition-colors
                {previewed
                ? 'bg-accent ring-1 ring-ring ring-inset'
                : selectedIds.has(skill.id)
                  ? 'bg-accent'
                  : 'hover:bg-accent/60'}"
              aria-pressed={selectedIds.has(skill.id)}
              aria-current={previewed ? "true" : undefined}
              data-previewed={previewed || undefined}
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
                aria-label={t("reposScan.selectSkillAria")}
              />
              <span class="min-w-0 flex-1">
                <!-- 行高 ≤64px（批评处置 P1-3b）：leading-snug + leading-4 + py-1.5 ≈ 64px；
                     描述 clamp 2 行，全文进 preview 面板。clamp 元素禁配 block——
                     Tailwind 输出序 .block 在 .line-clamp-* 之后，display:block 会
                     覆盖 -webkit-box 使 line-clamp 失效（desk 走查 40 行折叠根因）。 -->
                <span class="block truncate text-[13px] font-medium leading-snug text-foreground">
                  {skill.name}
                </span>
                <span class="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                  {skill.description || t("reposScan.noDescription")}
                </span>
                {#if !skill.installable}
                  <span
                    class="mt-0.5 line-clamp-1 text-[10px] leading-3 text-amber-600 dark:text-amber-400"
                    title={skill.issues.join(" ") || t("reposScan.notInstallable")}
                  >
                    {skill.issues.join(" ") || t("reposScan.notInstallable")}
                  </span>
                {/if}
              </span>
            </button>
          {/each}
        </div>
      </section>

      <!-- 右：预览 + 安装表单 + 结果 -->
      <section class="scan-side flex w-1/2 min-w-0 min-h-0 flex-col overflow-y-auto">
        <div class="border-b border-border p-3">
          <h2 class="text-xs font-medium text-muted-foreground">{t("reposScan.preview")}</h2>
          {#if previewing}
            <p class="mt-2 text-xs text-muted-foreground">{t("reposScan.previewLoading")}</p>
          {:else if preview}
            <!-- 预览头（批评处置 P1-3b/c）：列表行描述 clamp 后全文在此呈现；
                 name 让面板自证当前预览对象（与列表行 previewed 高亮双向对应）。 -->
            <div class="mt-2 min-w-0" data-testid="scan-preview-head">
              <p class="truncate text-[13px] font-medium text-foreground">{preview.skill.name}</p>
              <p class="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                {preview.skill.description || t("reposScan.noDescription")}
              </p>
            </div>
            <p class="mt-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("reposScan.previewRaw")}
            </p>
            <!-- pre-wrap + break-words（批评处置 P1-3c）：窄面板（Agent 面板开启）
                 下不再字符级硬切；纵向上限保留内滚。 -->
            <pre
              class="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-2 text-[11px] leading-4"
              data-testid="scan-preview-content">{preview.content}</pre>
          {:else}
            <p class="mt-2 text-xs text-muted-foreground">{t("reposScan.previewEmpty")}</p>
          {/if}
        </div>

        <div class="border-b border-border p-3">
          <h2 class="text-xs font-medium text-muted-foreground">
            {t("reposScan.installTargets", { count: selectedTargets.length })}
          </h2>
          {#if wsId === ("~" as const)}
            <!-- Global tab：安装目标只读引导（写入闸在 Imported ws——AGENTS §2 约束 2）。 -->
            <p class="mt-2 text-xs text-muted-foreground" data-testid="global-target-hint">
              {t("reposScan.globalHint")}
            </p>
          {/if}
          {#if targets.length === 0}
            <p class="mt-2 text-xs text-muted-foreground">{t("reposScan.noTargets")}</p>
          {:else}
            {#snippet targetRow(target: (typeof targets)[number])}
              <li>
                <label class="flex min-h-7 items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={isTargetSelected(target.target)}
                    onchange={() => toggleTarget(target.target)}
                    class="h-3.5 w-3.5"
                  />
                  <span class="truncate">{target.label}</span>
                </label>
              </li>
            {/snippet}
            {#if currentTabTargets.length > 0}
              <ul class="mt-2 space-y-1" data-testid="current-tab-targets">
                {#each currentTabTargets as target (target.target.workspaceId + ":" + target.target.providerId)}
                  {@render targetRow(target)}
                {/each}
              </ul>
            {/if}
            {#if otherTabTargets.length > 0}
              <div class="mt-2">
                <button
                  type="button"
                  class="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  aria-expanded={showOtherTargets}
                  data-testid="other-workspaces-toggle"
                  onclick={() => (showOtherTargets = !showOtherTargets)}
                >
                  {showOtherTargets
                    ? t("reposScan.hideOtherWorkspaces")
                    : t("reposScan.showOtherWorkspaces", { count: otherTabTargets.length })}
                </button>
                {#if showOtherTargets}
                  <ul class="mt-1 space-y-1" data-testid="other-workspace-targets">
                    {#each otherTabTargets as target (target.target.workspaceId + ":" + target.target.providerId)}
                      {@render targetRow(target)}
                    {/each}
                  </ul>
                {/if}
              </div>
            {/if}
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
              {t("reposScan.dryRun")}
            </button>
            <button
              type="button"
              disabled={installing ||
                installableSelected.length === 0 ||
                selectedTargets.length === 0}
              onclick={() => requestInstall()}
              class="h-7 rounded-md bg-primary px-3 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {installing ? t("reposScan.installing") : t("reposScan.install")}
            </button>
          </div>
          {#if installError && !sessionExpired}
            <p class="mt-2 break-words text-xs text-destructive">{installError.message}</p>
          {/if}
        </div>

        {#if installResult?.kind === "preview"}
          <div class="p-3 text-xs">
            <h2 class="font-medium text-muted-foreground">{t("reposScan.dryRunTitle")}</h2>
            <p class="mt-1">
              {t("reposScan.dryRunBody", {
                installs: installResult.totalInstalls,
                destinations: installResult.destinations.length,
              })}
            </p>
          </div>
        {/if}

        {#if installSummary}
          <div class="p-3 text-xs" data-testid="install-summary">
            <h2 class="font-medium text-muted-foreground">
              {t("reposScan.summary", {
                installed: installSummary.installed,
                overwritten: installSummary.overwritten,
                skipped: installSummary.skipped,
                failed: installSummary.failed,
              })}
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
                        viewInDashboard(
                          entry.target.workspaceId,
                          entry.target.providerId,
                          entry.skillId,
                        )}
                    >
                      {t("reposScan.viewInDashboard")}
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

{#if installConfirmOpen}
  <!-- 安装确认步（2.2 处置批 P1-1）：目标 >10 时 Install 先过人闸——列计数与
       目标名，确认后才发 install RPC（写入侧安全验证链原样）。 -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    role="dialog"
    aria-modal="true"
    aria-label={t("reposScan.confirmTitle")}
    data-testid="install-confirm"
  >
    <div class="w-full max-w-md rounded-lg border border-border bg-background p-4 shadow-lg">
      <h2 class="text-sm font-semibold">{t("reposScan.confirmTitle")}</h2>
      <p class="mt-1 text-xs text-muted-foreground">
        {t("reposScan.confirmBody", {
          skills: installableSelected.length,
          targets: selectedTargetEntries.length,
        })}
      </p>
      <ul class="mt-2 max-h-48 space-y-1 overflow-y-auto">
        {#each selectedTargetEntries as entry (entry.target.workspaceId + ":" + entry.target.providerId)}
          <li class="truncate rounded border border-border px-2 py-1 text-xs" title={entry.label}>
            {entry.label}
          </li>
        {/each}
      </ul>
      <div class="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onclick={() => (installConfirmOpen = false)}
          class="h-9 rounded-md border border-border px-3 text-xs hover:bg-muted/50"
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          disabled={installing}
          onclick={() => {
            installConfirmOpen = false;
            void runInstall(false);
          }}
          class="h-9 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {t("reposScan.install")}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* 窄容器单列栈（2.2 处置批 P2-4）：自持匿名容器（本页为独立子路由，不在
     dashboard 命名容器内）；阈值 692px 与 SkillsDashboard 网格降档同源——
     两源阈值一致性由 repository-scan-css 契约测试钉死。 */
  .scan-root {
    container-type: inline-size;
  }
  @container (width < 692px) {
    .scan-split {
      flex-direction: column;
    }
    .scan-list {
      width: 100%;
      flex: 1 1 0;
      border-right: 0;
      border-bottom: 1px solid var(--border, #e5e7eb);
    }
    .scan-side {
      width: 100%;
      flex: 1 1 0;
    }
  }
</style>
