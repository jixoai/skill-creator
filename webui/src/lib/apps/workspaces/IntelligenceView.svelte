<!--
  用户原始需求 [2026-09-06]（openspec skill-intelligence）：
  「提供 dependency/overlap/conflict graph 和可读的 finding 列表；每个 finding 绑定 Skill ID 与 observed revision。」
  修订 [2026-10-02]（ux-polish-walkthrough-residue #6）：密集图（>24 节点）标签
  互叠——默认只渲染 hover 节点的标签，稀疏图照旧全显。
  修订 [2026-10-02]（e2e 审批面缺口）：Proposals 区数据源切到统一审批面
  agent.proposals.list——mcp:（外部 MCP client 的 mutation proposal）与 si:
  草稿双源同列；approve/reject 经 agent.proposals.*（前缀路由），外部 proposal
  不再只靠 agent 面板卡片审批。
  正交意图：
  1. 触发只读分析并持有报告（severity 过滤 + 证据展示 + 跳转 Skill detail）。
  2. 渲染技能关系图（圆布局 SVG；窄屏横向滚动，不遮挡恢复操作）。
  3. proposal 审查（统一面）：来源/能力角标 + 状态、before/after、affected
     skills、observed revisions、approve/reject（前缀路由）；stale 结果只能
     重新分析。
-->
<script lang="ts">
  import { untrack } from "svelte";
  import { useParams, useSearch, goById } from "$lib/shell";
  import {
    connectionState,
    getConnectionGeneration,
    loadSkills,
    skillsState,
    fetchSkillInfo,
  } from "$lib/store.svelte";
  import {
    analyzeSkills,
    approveProposal,
    loadProposals,
    rejectProposal,
  } from "$lib/stores/intelligence.svelte";
  import { seedFindingPropose } from "$lib/stores/agent.svelte";
  import {
    FINDING_PROPOSE_TEMPLATES,
    type FindingProposeAction,
  } from "$lib/apps/workspaces/finding-propose-templates.js";
  import { showToast } from "$lib/toast.svelte";
  import { t } from "$lib/i18n";
  import { createRequestGenerationGate } from "$lib/stores/request-generation";
  import type {
    AnalyzeFailure,
    Finding,
    IntelligenceReport,
    ProposalPayload,
  } from "$shared/contracts/skill-intelligence.js";
  import { ProposalPayloadSchema } from "$shared/contracts/skill-intelligence.js";
  import type { UnifiedProposalView } from "$shared/contracts/agent.js";
  import { SkillIdSchema, type SkillInfo } from "$shared/contracts/skills.js";
  import { WorkspaceIdSchema, ProviderIdSchema } from "$shared/contracts/workspaces.js";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import IconAlert from "@lucide/svelte/icons/triangle-alert";
  import IconGitMerge from "@lucide/svelte/icons/git-merge";
  import IconGraph from "@lucide/svelte/icons/network";
  import IconInfo from "@lucide/svelte/icons/info";
  import IconLoader from "@lucide/svelte/icons/loader-circle";
  import IconPowerOff from "@lucide/svelte/icons/power-off";
  import IconRefresh from "@lucide/svelte/icons/refresh-cw";
  import IconScissors from "@lucide/svelte/icons/scissors";
  import IconShield from "@lucide/svelte/icons/shield-alert";
  import IconSparkles from "@lucide/svelte/icons/sparkles";

  type IntelligenceSearch = { severity?: "all" | "error" | "warning" | "info" };

  /** severity 过滤按钮的显示词典 key（URL/query 仍用枚举原文；显示层可双语）。 */
  const SEVERITY_LABEL_KEYS = {
    all: "intelligence.severityAll",
    error: "intelligence.severityError",
    warning: "intelligence.severityWarning",
    info: "intelligence.severityInfo",
  } as const;

  const getParams = useParams<{ wsId: string; providerId: string }>();
  const getSearch = useSearch<IntelligenceSearch>();

  const wsId = $derived.by(() => getParams?.()?.wsId);
  const providerId = $derived.by(() => getParams?.()?.providerId);
  const search = $derived.by(() => getSearch?.() ?? {});
  const severityFilter = $derived(search.severity ?? "all");

  const providerTarget = $derived.by(() => {
    if (!wsId || !providerId) return null;
    const ws = WorkspaceIdSchema.safeParse(wsId);
    const prov = ProviderIdSchema.safeParse(providerId);
    if (!ws.success || !prov.success) return null;
    return { workspaceId: ws.data, providerId: prov.data };
  });

  // ---- 报告（组件持有；重新分析替换） ----
  let report = $state<IntelligenceReport | null>(null);
  let analyzeFailures = $state<{ code: string; message: string }[]>([]);
  let analyzing = $state(false);
  let analyzeError = $state<string | null>(null);
  const analyzeGate = createRequestGenerationGate(getConnectionGeneration);

  $effect(() => {
    if (providerTarget) void loadSkills(providerTarget);
  });

  // 挂载竞态补救（WS5 走查小项 8；与 ProviderView 同族）：Global 深链首帧
  // WS 未就绪时 loadSkills 落 error 态（"daemon is not connected"），此前只能
  // 手动 Retry——连接转 ready 自动重发；proposal 首载失败同理。
  let lastConnectionStatus = $state(connectionState.status);
  $effect(() => {
    const status = connectionState.status;
    const was = untrack(() => lastConnectionStatus);
    lastConnectionStatus = status;
    if (was === "connected" || status !== "connected") return;
    const retryTarget = untrack(() => providerTarget);
    if (
      retryTarget !== null &&
      untrack(() => skillsState.error) !== null &&
      untrack(() => skillsState.skills.length) === 0
    ) {
      void loadSkills(retryTarget);
    }
    if (untrack(() => proposalsError) !== null) void refreshProposals();
  });

  async function runAnalysis(): Promise<void> {
    const target = providerTarget;
    if (!target || analyzing) return;
    const skills = untrack(() => skillsState.skills);
    if (skills.length === 0) {
      showToast(t("intelligence.toastNoSkills"));
      return;
    }
    analyzing = true;
    analyzeError = null;
    try {
      const result = await analyzeSkills(skills.map((skill) => ({ ...target, skillId: skill.id })));
      if (!result.report && !result.error) return; // 请求已被取代
      report = result.report;
      analyzeFailures = result.failures;
      analyzeError = result.error;
      if (result.report) {
        const counts = countBySeverity(result.report.findings);
        showToast(
          t("intelligence.toastAnalyzed", {
            skills: result.report.snapshots.length,
            errors: counts.error,
            warnings: counts.warning,
          }),
        );
      }
    } finally {
      analyzing = false;
    }
  }

  function countBySeverity(findings: Finding[]): { error: number; warning: number; info: number } {
    return {
      error: findings.filter((finding) => finding.severity === "error").length,
      warning: findings.filter((finding) => finding.severity === "warning").length,
      info: findings.filter((finding) => finding.severity === "info").length,
    };
  }

  const visibleFindings = $derived.by(() => {
    if (!report) return [];
    if (severityFilter === "all") return report.findings;
    return report.findings.filter((finding) => finding.severity === severityFilter);
  });

  function setSeverityFilter(next: "all" | "error" | "warning" | "info"): void {
    if (!wsId || !providerId) return;
    goById(
      "workspaces.intelligence",
      { wsId, providerId },
      { severity: next === "all" ? undefined : next },
      "REPLACE",
    );
  }

  const snapshotName = $derived.by(() => {
    const map = new Map<string, string>();
    for (const snapshot of report?.snapshots ?? []) {
      map.set(snapshot.skillId, snapshot.name);
    }
    return (skillId: string): string => map.get(skillId) ?? skillId;
  });

  function openSkillDetail(skillId: string): void {
    if (!wsId || !providerId) return;
    goById("workspaces.provider", { wsId, providerId }, { skill: skillId, view: "detail" });
  }

  // ---- proposal 审查（统一审批面：mcp: + si: 双源） ----
  let proposals = $state<UnifiedProposalView[]>([]);
  let proposalsLoading = $state(false);
  let proposalsError = $state<string | null>(null);
  let proposing = $state(false);
  let approvingId = $state<string | null>(null);
  let rejectingId = $state<string | null>(null);
  let approveOutcome = $state<{ proposalId: string; view: UnifiedProposalView } | null>(null);
  /** 展开审查时懒加载的 before 文档（edit proposal 的 before/after 对照）。 */
  let beforeDocs = $state<Record<string, SkillInfo>>({});
  let expandedId = $state<string | null>(null);

  /**
   * si 草稿的 payload 收窄（外部输入法则：统一面 payload 是 unknown——mcp 行
   * 是 capability input，只有 skill-intelligence 源可按四类 payload 判别联合
   * safeParse；解析失败按无 si 详情渲染，绝不含 payload 直读）。
   */
  function siPayloadOf(proposal: UnifiedProposalView): ProposalPayload | null {
    if (proposal.source !== "skill-intelligence") return null;
    const parsed = ProposalPayloadSchema.safeParse(proposal.payload);
    return parsed.success ? parsed.data : null;
  }

  /** 受影响技能（targets 多源优先；单源回落 target）。 */
  function affectedOf(
    proposal: UnifiedProposalView,
  ): Array<{ workspaceId: string; providerId: string; skillId: string }> {
    if (proposal.targets !== undefined) return proposal.targets;
    return proposal.target === null ? [] : [proposal.target];
  }

  /** 与受影响技能对齐的 observed revisions。 */
  function revisionsOf(proposal: UnifiedProposalView): string[] {
    if (proposal.observedRevisions !== undefined) return proposal.observedRevisions;
    return proposal.observedRevision === null ? [] : [proposal.observedRevision];
  }

  /** mcp 行的载荷预览（不可信文本只经插值转义，不入模板）。 */
  function payloadPreview(proposal: UnifiedProposalView): string {
    try {
      return JSON.stringify(proposal.payload, null, 2) ?? "—";
    } catch {
      return String(proposal.payload);
    }
  }

  /** 行标题：si 草稿 = rationale 摘要（finding.summary）；mcp = capability 名。 */
  function titleOf(proposal: UnifiedProposalView): string {
    return proposal.source === "skill-intelligence"
      ? (proposal.finding?.summary ?? t("intelligence.siDraftFallback"))
      : (proposal.capability ?? proposal.kind);
  }

  $effect(() => {
    void refreshProposals();
  });

  async function refreshProposals(): Promise<void> {
    proposalsLoading = true;
    try {
      const result = await loadProposals();
      if (result.proposals) {
        proposals = result.proposals;
        proposalsError = null;
      } else if (result.error) {
        proposalsError = result.error;
      }
    } finally {
      proposalsLoading = false;
    }
  }

  async function expandProposal(proposal: UnifiedProposalView): Promise<void> {
    expandedId = expandedId === proposal.id ? null : proposal.id;
    if (expandedId !== proposal.id) return;
    // edit proposal：拉取受影响技能当前文档作为 before。
    const siPayload = siPayloadOf(proposal);
    if (siPayload?.kind === "edit") {
      for (const edit of siPayload.edits) {
        const parsed = SkillIdSchema.safeParse(edit.selection.skillId);
        if (!parsed.success) continue;
        try {
          const info = await fetchSkillInfo(edit.selection, parsed.data);
          beforeDocs = { ...beforeDocs, [edit.selection.skillId]: info };
        } catch {
          // before 拉取失败不阻塞审查；显示 revision 锁即可。
        }
      }
    }
  }

  async function handleApprove(proposal: UnifiedProposalView): Promise<void> {
    if (approvingId || proposal.status !== "pending") return;
    approvingId = proposal.id;
    try {
      const { proposal: decided, error } = await approveProposal(proposal.id);
      if (error) {
        showToast(error);
        return;
      }
      if (!decided) return; // 请求已被取代
      approveOutcome = { proposalId: proposal.id, view: decided };
      if (decided.status === "rejected" && decided.rejectCause === "stale") {
        showToast(t("intelligence.staleProposal"), {
          label: t("intelligence.reAnalyze"),
          run: () => void runAnalysis(),
        });
      } else if (decided.status === "failed") {
        showToast(
          decided.result?.error
            ? t("intelligence.toastProposalFailed", { error: decided.result.error })
            : t("intelligence.toastProposalFailedPlain"),
        );
      } else if (decided.status === "executed") {
        showToast(t("intelligence.toastApplied"));
      } else {
        showToast(t("intelligence.toastDecided", { status: decided.status }));
      }
      await refreshProposals();
      await loadSkillsRefresh();
    } finally {
      approvingId = null;
    }
  }

  async function loadSkillsRefresh(): Promise<void> {
    const target = providerTarget;
    if (target) await loadSkills(target);
  }

  async function handleReject(proposal: UnifiedProposalView): Promise<void> {
    if (rejectingId || proposal.status !== "pending") return;
    rejectingId = proposal.id;
    try {
      const { error } = await rejectProposal(proposal.id);
      if (error) showToast(error);
      await refreshProposals();
    } finally {
      rejectingId = null;
    }
  }

  // ---- 从 finding 经 agent 发起 proposal（Ch4：直连表单退役；四动作一律
  // intelligence_propose_* 工具调用产生，面板 seed 携带 finding 上下文）----
  function seedFindingProposeAction(action: FindingProposeAction, finding: Finding): void {
    const target = providerTarget;
    if (!target || proposing) return;
    const primaryId = SkillIdSchema.safeParse(finding.skillIds[0]);
    if (!primaryId.success) return;
    const observed = report?.snapshots.find((snapshot) => snapshot.skillId === primaryId.data);
    if (!observed) return;
    const template = FINDING_PROPOSE_TEMPLATES[action];
    seedFindingPropose({
      action,
      text: template.render({
        skillName: observed.name,
        findingId: finding.id,
        observedRevision: observed.revision,
      }),
      skill: { ...target, skillId: primaryId.data },
      skillName: observed.name,
      findingId: finding.id,
      observedRevision: observed.revision,
      templateId: template.id,
      templateVersion: template.version,
    });
  }

  // ---- 关系图（椭圆布局铺满画布宽度；窄屏靠容器横向滚动保持可读） ----
  // 走查 #6：密集图（>DENSE_LABEL_THRESHOLD 节点）标签互叠——默认只渲染 hover
  // 节点的标签（稀疏图照旧全显；全名恒有 <title> 提示兜底）。
  const DENSE_LABEL_THRESHOLD = 24;
  let hoveredSkillId = $state<string | null>(null);
  const graphDense = $derived.by(() => (report?.snapshots.length ?? 0) > DENSE_LABEL_THRESHOLD);
  // 图注后缀（前导空格在字符串内，绕开 Svelte 块边界空白折叠）。
  const graphCaptionSuffix = $derived(graphDense ? ` ${t("intelligence.graphDenseHint")}` : "");
  const graph = $derived.by(() => {
    const snapshots = report?.snapshots ?? [];
    if (snapshots.length < 2) return null;
    const width = Math.min(1600, Math.max(560, snapshots.length * 72));
    const height = snapshots.length > 14 ? 420 : 360;
    const rx = width / 2 - 70;
    const ry = height / 2 - 70;
    const center = { x: width / 2, y: height / 2 };
    const nodes = snapshots.map((snapshot, index) => {
      const angle = (index / snapshots.length) * Math.PI * 2 - Math.PI / 2;
      return {
        skillId: snapshot.skillId,
        name: snapshot.name,
        label: snapshot.name.length > 14 ? `${snapshot.name.slice(0, 13)}…` : snapshot.name,
        // 标签在椭圆上下交替，避免相邻节点同名标签互相叠压。
        labelDy: index % 2 === 0 ? 32 : -26,
        x: center.x + rx * Math.cos(angle),
        y: center.y + ry * Math.sin(angle),
      };
    });
    const indexOf = new Map(nodes.map((node, index) => [node.skillId, index]));
    const edges = (report?.edges ?? [])
      .map((edge) => {
        const left = indexOf.get(edge.skillIds[0]);
        const right = indexOf.get(edge.skillIds[1]);
        if (left === undefined || right === undefined) return null;
        return { kind: edge.kind, from: nodes[left]!, to: nodes[right]! };
      })
      .filter((edge): edge is NonNullable<typeof edge> => edge !== null);
    return { width, height, nodes, edges };
  });

  const severityBadgeVariant: Record<Finding["severity"], "destructive" | "secondary" | "outline"> =
    {
      error: "destructive",
      warning: "secondary",
      info: "outline",
    };
</script>

<div class="flex h-full min-h-0 flex-col overflow-y-auto">
  <header class="shrink-0 border-b border-border px-5 py-4">
    <div class="flex flex-wrap items-center gap-3">
      <IconSparkles class="h-5 w-5 text-primary" />
      <div class="min-w-0 flex-1">
        <h1 class="truncate text-base font-semibold">{t("intelligence.title")}</h1>
        <p class="mt-0.5 text-xs text-muted-foreground">
          {t("intelligence.subtitle", { provider: providerId ?? "—" })}
        </p>
      </div>
      <Button size="sm" class="h-8 gap-1.5" disabled={analyzing} onclick={() => void runAnalysis()}>
        {#if analyzing}<IconLoader class="h-3.5 w-3.5 animate-spin" />
          {t("intelligence.analyzing")}{:else}
          <IconGraph class="h-3.5 w-3.5" />
          {t("intelligence.analyze", { count: skillsState.skills.length || "" })}
        {/if}
      </Button>
    </div>
  </header>

  <div class="min-h-0 flex-1 px-5 py-4">
    {#if skillsState.loading}
      <div class="flex items-center gap-2 py-6 text-xs text-muted-foreground">
        <IconLoader class="h-3.5 w-3.5 animate-spin" />
        {t("intelligence.loadingSkills")}
      </div>
    {:else if skillsState.error}
      <div class="flex flex-col items-start gap-2 py-6 text-xs text-destructive">
        <p class="break-words">{skillsState.error}</p>
        {#if providerTarget}
          <Button
            variant="outline"
            size="sm"
            class="h-7 text-xs"
            onclick={() => void loadSkills(providerTarget)}
          >
            {t("common.retry")}
          </Button>
        {/if}
      </div>
    {:else if analyzeError}
      <div class="flex flex-col items-start gap-2 py-6 text-xs text-destructive">
        <p class="break-words">{analyzeError}</p>
        <Button variant="outline" size="sm" class="h-7 text-xs" onclick={() => void runAnalysis()}>
          {t("intelligence.retryAnalysis")}
        </Button>
      </div>
    {:else if !report}
      <div class="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
        <IconShield class="h-8 w-8 opacity-50" />
        <p class="text-sm font-medium text-foreground">{t("intelligence.noReportTitle")}</p>
        <p class="max-w-xs text-xs">
          {t("intelligence.noReportBody")}
        </p>
      </div>
    {:else}
      {@const severityCounts = countBySeverity(report.findings)}
      <!-- 摘要 -->
      <section
        class="mb-4 flex flex-wrap items-center gap-2 text-xs"
        aria-label={t("intelligence.summaryAria")}
      >
        <Badge variant="outline"
          >{t("intelligence.skillsCount", { count: report.snapshots.length })}</Badge
        >
        <!-- 零值计数用中性色（WS5 走查小项 6）：0 errors 不制造告警红。 -->
        <Badge variant={severityCounts.error > 0 ? "destructive" : "secondary"}>
          {t("intelligence.errorsCount", { count: severityCounts.error })}</Badge
        >
        <Badge variant="secondary">
          {t("intelligence.warningsCount", { count: severityCounts.warning })}</Badge
        >
        <Badge variant="outline"
          >{t("intelligence.infoCount", { count: severityCounts.info })}</Badge
        >
        {#if analyzeFailures.length > 0}
          <Badge variant="destructive">
            {t("intelligence.failedCount", { count: analyzeFailures.length })}</Badge
          >
        {/if}
        <span class="flex-1"></span>
        <div
          class="flex items-center gap-1"
          role="group"
          aria-label={t("intelligence.severityFilterAria")}
        >
          {#each Object.entries(SEVERITY_LABEL_KEYS) as [option, labelKey] (option)}
            <Button
              variant={severityFilter === option ? "default" : "outline"}
              size="sm"
              class="h-7 px-2 text-xs capitalize"
              onclick={() => setSeverityFilter(option as "all" | "error" | "warning" | "info")}
            >
              {t(labelKey)}
            </Button>
          {/each}
        </div>
      </section>

      {#if analyzeFailures.length > 0}
        <section
          class="mb-4 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs"
          aria-label={t("intelligence.failuresAria")}
        >
          <p class="font-medium text-destructive">{t("intelligence.someFailed")}</p>
          <ul class="mt-1 space-y-0.5">
            {#each analyzeFailures as failure (failure.message)}
              <li class="text-muted-foreground">{failure.code}: {failure.message}</li>
            {/each}
          </ul>
        </section>
      {/if}

      <!-- 关系图 -->
      {#if graph}
        <section class="mb-4" aria-label={t("intelligence.relationsAria")}>
          <h2 class="mb-2 text-xs font-medium text-muted-foreground">
            {t("intelligence.relations")}
          </h2>
          <div class="overflow-x-auto rounded-md border border-border bg-muted/20">
            <svg
              role="img"
              aria-label={t("intelligence.graphAria")}
              width={graph.width}
              height={graph.height}
              class="mx-auto block"
            >
              {#each graph.edges as edge, index (index)}
                <line
                  x1={edge.from.x}
                  y1={edge.from.y}
                  x2={edge.to.x}
                  y2={edge.to.y}
                  stroke={edge.kind === "conflict"
                    ? "var(--destructive, crimson)"
                    : edge.kind === "overlap"
                      ? "var(--primary, steelblue)"
                      : "var(--muted-foreground, gray)"}
                  stroke-width={edge.kind === "conflict" ? 2 : 1.2}
                  stroke-dasharray={edge.kind === "shared-resource" ? "4 3" : undefined}
                />
              {/each}
              {#each graph.nodes as node (node.skillId)}
                <g
                  class="cursor-pointer"
                  role="button"
                  tabindex="0"
                  aria-label={t("intelligence.openDetailAria", { name: node.name })}
                  onclick={() => openSkillDetail(node.skillId)}
                  onkeydown={(e) => e.key === "Enter" && openSkillDetail(node.skillId)}
                  onpointerenter={() => (hoveredSkillId = node.skillId)}
                  onpointerleave={() => (hoveredSkillId = null)}
                >
                  <title>{node.name}</title>
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r="16"
                    fill="var(--background, white)"
                    stroke="var(--border, gray)"
                  />
                  {#if !graphDense || hoveredSkillId === node.skillId}
                    <text
                      x={node.x}
                      y={node.y + node.labelDy}
                      text-anchor="middle"
                      font-size="9"
                      fill="var(--foreground, black)"
                    >
                      {node.label}
                    </text>
                  {/if}
                </g>
              {/each}
            </svg>
          </div>
          <p class="mt-1 text-[10px] text-muted-foreground">
            {t("intelligence.graphLegend")}{graphCaptionSuffix}
          </p>
        </section>
      {/if}

      <!-- findings -->
      <section aria-label={t("intelligence.findingsAria")}>
        <h2 class="mb-2 text-xs font-medium text-muted-foreground">
          {t("intelligence.findings")}
        </h2>
        {#if visibleFindings.length === 0}
          <p class="py-6 text-xs text-muted-foreground">{t("intelligence.noFindings")}</p>
        {:else}
          <ul class="space-y-2">
            {#each visibleFindings as finding (finding.id)}
              <li class="rounded-md border border-border">
                <div class="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
                  {#if finding.severity === "error"}
                    <IconAlert class="h-4 w-4 shrink-0 text-destructive" />
                  {:else if finding.severity === "warning"}
                    <IconShield class="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  {:else}
                    <IconInfo class="h-4 w-4 shrink-0 text-muted-foreground" />
                  {/if}
                  <span class="min-w-0 flex-1 text-xs">{finding.message}</span>
                  <Badge variant={severityBadgeVariant[finding.severity]} class="text-[10px]">
                    {finding.kind}
                  </Badge>
                </div>
                <div class="space-y-1.5 px-3 py-2">
                  <ul class="space-y-1">
                    {#each finding.evidence as item (item.label + item.snippet)}
                      <li class="text-[11px] leading-4">
                        <span class="font-medium text-muted-foreground">{item.label}:</span>
                        <code class="break-words rounded bg-muted/60 px-1 py-0.5 text-[10px]"
                          >{item.snippet}</code
                        >
                      </li>
                    {/each}
                  </ul>
                  <div class="flex flex-wrap items-center gap-1.5 pt-1">
                    {#each finding.skillIds as skillId (skillId)}
                      <button
                        type="button"
                        class="text-[11px] text-primary underline-offset-2 hover:underline"
                        onclick={() => openSkillDetail(skillId)}
                      >
                        {snapshotName(skillId)}
                      </button>
                    {/each}
                    <span class="flex-1"></span>
                    {#if finding.skillIds.length === 1 && finding.kind !== "duplicate-name"}
                      <Button
                        variant="outline"
                        size="sm"
                        class="h-7 gap-1 px-2 text-[11px]"
                        disabled={proposing}
                        onclick={() => seedFindingProposeAction("edit", finding)}
                      >
                        <IconSparkles class="h-3 w-3" />
                        {t("intelligence.askEdit")}
                      </Button>
                    {/if}
                    <Button
                      variant="outline"
                      size="sm"
                      class="h-7 gap-1 px-2 text-[11px]"
                      disabled={proposing}
                      onclick={() => seedFindingProposeAction("split", finding)}
                    >
                      <IconSparkles class="h-3 w-3" />
                      {t("intelligence.askSplit")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      class="h-7 gap-1 px-2 text-[11px]"
                      disabled={proposing}
                      onclick={() => seedFindingProposeAction("merge", finding)}
                    >
                      <IconSparkles class="h-3 w-3" />
                      {t("intelligence.askMerge")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      class="h-7 gap-1 px-2 text-[11px]"
                      disabled={proposing}
                      onclick={() => seedFindingProposeAction("disable", finding)}
                    >
                      <IconPowerOff class="h-3 w-3" />
                      {t("intelligence.askDisable")}
                    </Button>
                  </div>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/if}

    <!-- proposals 审查（统一审批面：mcp: + si: 双源） -->
    <section class="mt-6" aria-label={t("intelligence.proposalsAria")}>
      <div class="mb-2 flex items-center gap-2">
        <h2 class="text-xs font-medium text-muted-foreground">{t("intelligence.proposals")}</h2>
        {#if proposalsLoading}
          <IconLoader class="h-3 w-3 animate-spin text-muted-foreground" />
        {/if}
        <span class="flex-1"></span>
        <Button
          variant="ghost"
          size="sm"
          class="h-7 gap-1 px-2 text-xs"
          onclick={() => void refreshProposals()}
        >
          <IconRefresh class="h-3 w-3" />
          {t("intelligence.refresh")}
        </Button>
      </div>
      {#if proposals.length === 0}
        <p class="py-4 text-xs text-muted-foreground">
          {t("intelligence.noProposals")}
        </p>
      {:else}
        <ul class="space-y-2">
          {#each proposals as proposal (proposal.id)}
            {@const siPayload = siPayloadOf(proposal)}
            {@const outcome =
              approveOutcome?.proposalId === proposal.id ? approveOutcome.view : null}
            {@const pending = proposal.status === "pending"}
            <li class="rounded-md border border-border">
              <div class="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
                {#if siPayload?.kind === "edit"}
                  <IconSparkles class="h-4 w-4 shrink-0 text-primary" />
                {:else if siPayload?.kind === "disable"}
                  <IconPowerOff class="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                {:else if siPayload?.kind === "split"}
                  <IconScissors class="h-4 w-4 shrink-0 text-primary" />
                {:else if siPayload?.kind === "merge"}
                  <IconGitMerge class="h-4 w-4 shrink-0 text-primary" />
                {:else}
                  <IconShield class="h-4 w-4 shrink-0 text-muted-foreground" />
                {/if}
                <button
                  type="button"
                  class="min-w-0 flex-1 truncate text-left text-xs font-medium"
                  onclick={() => void expandProposal(proposal)}
                >
                  {proposal.kind} · {titleOf(proposal)}
                </button>
                <!-- 来源角标：mcp 行显示 capability；si 行显示草稿来源。 -->
                <Badge
                  variant={proposal.source === "mcp" ? "secondary" : "outline"}
                  class="text-[10px]"
                >
                  {proposal.source === "mcp"
                    ? (proposal.capability ?? proposal.kind)
                    : t("intelligence.siDraft")}
                </Badge>
                {#if !pending}
                  <Badge variant="outline" class="text-[10px]">
                    {proposal.status}{proposal.rejectCause === "stale"
                      ? ` · ${t("evaluating.staleTag")}`
                      : ""}
                  </Badge>
                {/if}
                <Button
                  variant="outline"
                  size="sm"
                  class="h-7 px-2 text-[11px]"
                  disabled={!pending || rejectingId === proposal.id}
                  onclick={() => void handleReject(proposal)}
                >
                  {#if rejectingId === proposal.id}<IconLoader class="h-3 w-3 animate-spin" />{/if}
                  {t("intelligence.reject")}
                </Button>
                <Button
                  size="sm"
                  class="h-7 px-2 text-[11px]"
                  disabled={!pending || approvingId === proposal.id}
                  onclick={() => void handleApprove(proposal)}
                >
                  {#if approvingId === proposal.id}<IconLoader class="h-3 w-3 animate-spin" />{/if}
                  {t("intelligence.approve")}
                </Button>
              </div>

              {#if outcome}
                <div class="border-b border-border/60 px-3 py-2 text-[11px]">
                  <p
                    class={outcome.status === "executed"
                      ? "text-emerald-600 dark:text-emerald-400"
                      : outcome.status === "failed"
                        ? "text-destructive"
                        : "text-muted-foreground"}
                  >
                    {outcome.status}{outcome.result?.error ? `: ${outcome.result.error}` : ""}
                  </p>
                  {#if outcome.status === "rejected" && outcome.rejectCause === "stale"}
                    <p class="mt-1 text-destructive">
                      {t("intelligence.staleProposal")}
                    </p>
                  {/if}
                </div>
              {/if}

              {#if expandedId === proposal.id}
                <div class="space-y-2 px-3 py-2 text-[11px]">
                  <p class="text-muted-foreground">{titleOf(proposal)}</p>
                  <p class="text-muted-foreground">
                    {t("intelligence.createdLine", {
                      time: new Date(proposal.createdAt).toLocaleString(),
                      origin: proposal.origin,
                    })}
                  </p>
                  {#if siPayload !== null}
                    {@const affected = affectedOf(proposal)}
                    {@const revisions = revisionsOf(proposal)}
                    <p class="text-muted-foreground">
                      {t("intelligence.affects", { count: affected.length })}
                    </p>
                    <ul class="space-y-1">
                      {#each affected as selection, index (selection.skillId)}
                        <li class="flex flex-wrap items-baseline gap-1">
                          <button
                            type="button"
                            class="text-primary underline-offset-2 hover:underline"
                            onclick={() => openSkillDetail(selection.skillId)}
                          >
                            {snapshotName(selection.skillId)}
                          </button>
                          {#if revisions[index] !== undefined}
                            <code class="break-all text-[10px] text-muted-foreground"
                              >{revisions[index]!.slice(0, 19)}…</code
                            >
                          {/if}
                        </li>
                      {/each}
                    </ul>

                    {#if siPayload.kind === "edit"}
                      {@const first = siPayload.edits[0]}
                      {@const before = first ? beforeDocs[first.selection.skillId] : undefined}
                      <div class="grid gap-2 md:grid-cols-2">
                        <div class="rounded border border-border bg-muted/20 p-2">
                          <p class="mb-1 font-medium">{t("intelligence.before")}</p>
                          {#if before}
                            <p class="leading-4 text-muted-foreground">{before.description}</p>
                          {:else}
                            <p class="text-muted-foreground">
                              {t("intelligence.loadingDocument")}
                            </p>
                          {/if}
                        </div>
                        <div class="rounded border border-border bg-muted/20 p-2">
                          <p class="mb-1 font-medium">{t("intelligence.after")}</p>
                          <p class="leading-4 text-muted-foreground">
                            {first?.frontmatter.description}
                          </p>
                        </div>
                      </div>
                      {#if first}
                        <details>
                          <summary class="cursor-pointer text-muted-foreground"
                            >{t("intelligence.previewBody")}</summary
                          >
                          <pre
                            class="mt-1 max-h-48 overflow-auto rounded bg-muted/40 p-2 text-[10px] whitespace-pre-wrap">{first.body}</pre>
                        </details>
                      {/if}
                    {:else if siPayload.kind === "disable"}
                      <p class="rounded border border-border bg-muted/20 p-2 leading-4">
                        {t("intelligence.reason", { reason: siPayload.reason })}
                      </p>
                    {:else if siPayload.kind === "split"}
                      <ul class="space-y-1">
                        {#each siPayload.targets as target (target.directoryName)}
                          <li>
                            <span class="font-medium">{target.directoryName}</span>
                            <span class="text-muted-foreground">
                              — {target.frontmatter.description}</span
                            >
                          </li>
                        {/each}
                      </ul>
                    {:else if siPayload.kind === "merge"}
                      <p>
                        <span class="font-medium">{siPayload.target.directoryName}</span>
                        <span class="text-muted-foreground">
                          — {siPayload.target.frontmatter.description}</span
                        >
                      </p>
                      <p class="text-muted-foreground">
                        {t("intelligence.mergeSources", { count: siPayload.sources.length })}
                      </p>
                    {/if}
                  {:else}
                    <!-- mcp 行：capability input 的只读预览（不可信文本只经插值转义）。 -->
                    <pre
                      class="max-h-48 overflow-auto rounded bg-muted/40 p-2 text-[10px] whitespace-pre-wrap">{payloadPreview(
                        proposal,
                      )}</pre>
                  {/if}
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>
</div>
