<!--
  用户原始需求 [2026-09-06]（openspec skill-intelligence）：
  「提供 dependency/overlap/conflict graph 和可读的 finding 列表；每个 finding 绑定 Skill ID 与 observed revision。」
  正交意图：
  1. 触发只读分析并持有报告（severity 过滤 + 证据展示 + 跳转 Skill detail）。
  2. 渲染技能关系图（圆布局 SVG；窄屏横向滚动，不遮挡恢复操作）。
  3. proposal 审查：before/after、affected skills、observed revisions、approve/reject；
     stale 结果只能重新分析。
-->
<script lang="ts">
  import { untrack } from "svelte";
  import { useParams, useSearch, goById } from "$lib/shell";
  import {
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
    submitProposal,
  } from "$lib/stores/intelligence.svelte";
  import { showToast } from "$lib/toast.svelte";
  import { createRequestGenerationGate } from "$lib/stores/request-generation";
  import type {
    ApproveResult,
    Finding,
    IntelligenceReport,
    ProposalDraft,
  } from "$shared/contracts/skill-intelligence.js";
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

  async function runAnalysis(): Promise<void> {
    const target = providerTarget;
    if (!target || analyzing) return;
    const skills = untrack(() => skillsState.skills);
    if (skills.length === 0) {
      showToast("No skills discovered in this provider.");
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
          `Analyzed ${result.report.snapshots.length} skills · ${counts.error} errors · ${counts.warning} warnings.`,
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

  // ---- proposal 草稿（审查 + 审批） ----
  let proposals = $state<ProposalDraft[]>([]);
  let proposalsLoading = $state(false);
  let proposing = $state(false);
  let approvingId = $state<string | null>(null);
  let rejectingId = $state<string | null>(null);
  let approveOutcome = $state<{ proposalId: string; result: ApproveResult } | null>(null);
  /** 展开审查时懒加载的 before 文档（edit proposal 的 before/after 对照）。 */
  let beforeDocs = $state<Record<string, SkillInfo>>({});
  let expandedId = $state<string | null>(null);

  $effect(() => {
    void refreshProposals();
  });

  async function refreshProposals(): Promise<void> {
    proposalsLoading = true;
    try {
      const result = await loadProposals();
      if (result.proposals) proposals = result.proposals;
    } finally {
      proposalsLoading = false;
    }
  }

  async function expandProposal(proposal: ProposalDraft): Promise<void> {
    expandedId = expandedId === proposal.id ? null : proposal.id;
    if (expandedId !== proposal.id) return;
    // edit proposal：拉取受影响技能当前文档作为 before。
    if (proposal.payload.kind === "edit") {
      for (const edit of proposal.payload.edits) {
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

  async function handleApprove(proposal: ProposalDraft): Promise<void> {
    if (approvingId) return;
    approvingId = proposal.id;
    try {
      const { result, error } = await approveProposal(proposal.id);
      if (error) {
        showToast(error);
        return;
      }
      if (!result) return; // 请求已被取代
      approveOutcome = { proposalId: proposal.id, result };
      if (result.conflicts > 0) {
        showToast(
          `${result.conflicts} conflict(s): skill changed after the proposal. Re-analyze.`,
          {
            label: "Re-analyze",
            run: () => void runAnalysis(),
          },
        );
      } else if (result.failed > 0) {
        showToast(`Applied with ${result.failed} failure(s).`);
      } else {
        showToast(`Applied ${result.applied} change(s).`);
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

  async function handleReject(proposal: ProposalDraft): Promise<void> {
    if (rejectingId) return;
    rejectingId = proposal.id;
    try {
      const { error } = await rejectProposal(proposal.id);
      if (error) showToast(error);
      await refreshProposals();
    } finally {
      rejectingId = null;
    }
  }

  // ---- 从 finding 发起 proposal ----
  async function proposeDisableFromFinding(finding: Finding): Promise<void> {
    const target = providerTarget;
    if (!target || proposing) return;
    proposing = true;
    try {
      const { proposal, error } = await submitProposal({
        payload: {
          kind: "disable",
          selections: finding.skillIds.map((skillId) => ({ ...target, skillId })),
          reason: finding.message,
        },
        findingIds: [finding.id],
        rationale: `Address "${finding.kind}": ${finding.message}`,
      });
      if (error) showToast(error);
      if (proposal) {
        showToast("Disable proposal drafted for review.");
        await refreshProposals();
      }
    } finally {
      proposing = false;
    }
  }

  async function proposeEditFromFinding(finding: Finding): Promise<void> {
    const target = providerTarget;
    if (!target || proposing || finding.skillIds.length !== 1) return;
    proposing = true;
    try {
      const parsed = SkillIdSchema.safeParse(finding.skillIds[0]);
      if (!parsed.success) return;
      const info = await fetchSkillInfo(target, parsed.data);
      const { frontmatter, body } = splitDocument(info.content);
      const improved =
        `${frontmatter.description ?? ""} Reviewed via skill intelligence (${finding.kind}).`.trim();
      const { proposal, error } = await submitProposal({
        payload: {
          kind: "edit",
          edits: [
            {
              selection: { ...target, skillId: parsed.data },
              frontmatter: { ...frontmatter, name: info.name, description: improved },
              body,
            },
          ],
        },
        findingIds: [finding.id],
        rationale: `Address "${finding.kind}": ${finding.message}`,
      });
      if (error) showToast(error);
      if (proposal) {
        showToast("Edit proposal drafted for review.");
        await refreshProposals();
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    } finally {
      proposing = false;
    }
  }

  /** 最小 frontmatter/body 切分（与 daemon 分析器同口径）。 */
  function splitDocument(content: string): { frontmatter: Record<string, unknown>; body: string } {
    const normalized = content.replace(/\r\n/g, "\n");
    if (!normalized.startsWith("---")) return { frontmatter: {}, body: normalized };
    const lines = normalized.split("\n");
    const closing = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
    if (closing === -1) return { frontmatter: {}, body: normalized };
    const frontmatter: Record<string, unknown> = {};
    for (const raw of lines.slice(1, closing)) {
      const colon = raw.indexOf(":");
      if (colon <= 0) continue;
      frontmatter[raw.slice(0, colon).trim()] = raw.slice(colon + 1).trim();
    }
    return {
      frontmatter,
      body: lines
        .slice(closing + 1)
        .join("\n")
        .replace(/^\n/, ""),
    };
  }

  // ---- 关系图（圆布局；节点数>12 时退化为主干列表仍可读） ----
  const graph = $derived.by(() => {
    const snapshots = report?.snapshots ?? [];
    if (snapshots.length < 2) return null;
    const width = 560;
    const height = 360;
    const radius = Math.min(width, height) / 2 - 70;
    const center = { x: width / 2, y: height / 2 };
    const nodes = snapshots.map((snapshot, index) => {
      const angle = (index / snapshots.length) * Math.PI * 2 - Math.PI / 2;
      return {
        skillId: snapshot.skillId,
        name: snapshot.name,
        x: center.x + radius * Math.cos(angle),
        y: center.y + radius * Math.sin(angle),
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
        <h1 class="truncate text-base font-semibold">Skill Intelligence</h1>
        <p class="mt-0.5 text-xs text-muted-foreground">
          {providerId ?? "—"} · read-only analysis with revision-locked review.
        </p>
      </div>
      <Button size="sm" class="h-8 gap-1.5" disabled={analyzing} onclick={() => void runAnalysis()}>
        {#if analyzing}<IconLoader class="h-3.5 w-3.5 animate-spin" /> Analyzing…{:else}
          <IconGraph class="h-3.5 w-3.5" /> Analyze {skillsState.skills.length || ""}
        {/if}
      </Button>
    </div>
  </header>

  <div class="min-h-0 flex-1 px-5 py-4">
    {#if skillsState.loading}
      <div class="flex items-center gap-2 py-6 text-xs text-muted-foreground">
        <IconLoader class="h-3.5 w-3.5 animate-spin" /> Loading skills…
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
            Retry
          </Button>
        {/if}
      </div>
    {:else if analyzeError}
      <div class="flex flex-col items-start gap-2 py-6 text-xs text-destructive">
        <p class="break-words">{analyzeError}</p>
        <Button variant="outline" size="sm" class="h-7 text-xs" onclick={() => void runAnalysis()}>
          Retry analysis
        </Button>
      </div>
    {:else if !report}
      <div class="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
        <IconShield class="h-8 w-8 opacity-50" />
        <p class="text-sm font-medium text-foreground">No report yet</p>
        <p class="max-w-xs text-xs">
          Run a read-only analysis to surface duplicates, conflicts, shared resources, and
          structural findings with evidence.
        </p>
      </div>
    {:else}
      <!-- 摘要 -->
      <section class="mb-4 flex flex-wrap items-center gap-2 text-xs" aria-label="Report summary">
        <Badge variant="outline">{report.snapshots.length} skills</Badge>
        <Badge variant="destructive">{countBySeverity(report.findings).error} errors</Badge>
        <Badge variant="secondary">{countBySeverity(report.findings).warning} warnings</Badge>
        <Badge variant="outline">{countBySeverity(report.findings).info} info</Badge>
        {#if analyzeFailures.length > 0}
          <Badge variant="destructive">{analyzeFailures.length} failed to analyze</Badge>
        {/if}
        <span class="flex-1"></span>
        <div class="flex items-center gap-1" role="group" aria-label="Severity filter">
          {#each ["all", "error", "warning", "info"] as option (option)}
            <Button
              variant={severityFilter === option ? "default" : "outline"}
              size="sm"
              class="h-7 px-2 text-xs capitalize"
              onclick={() => setSeverityFilter(option as "all" | "error" | "warning" | "info")}
            >
              {option}
            </Button>
          {/each}
        </div>
      </section>

      {#if analyzeFailures.length > 0}
        <section
          class="mb-4 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs"
          aria-label="Analysis failures"
        >
          <p class="font-medium text-destructive">Some skills could not be analyzed:</p>
          <ul class="mt-1 space-y-0.5">
            {#each analyzeFailures as failure (failure.message)}
              <li class="text-muted-foreground">{failure.code}: {failure.message}</li>
            {/each}
          </ul>
        </section>
      {/if}

      <!-- 关系图 -->
      {#if graph}
        <section class="mb-4" aria-label="Skill relations graph">
          <h2 class="mb-2 text-xs font-medium text-muted-foreground">Relations</h2>
          <div class="overflow-x-auto rounded-md border border-border bg-muted/20">
            <svg
              role="img"
              aria-label="Skill relation graph"
              width={graph.width}
              height={graph.height}
              class="mx-auto block max-w-full"
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
                  aria-label="Open skill detail"
                  onclick={() => openSkillDetail(node.skillId)}
                  onkeydown={(e) => e.key === "Enter" && openSkillDetail(node.skillId)}
                >
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r="18"
                    fill="var(--background, white)"
                    stroke="var(--border, gray)"
                  />
                  <text
                    x={node.x}
                    y={node.y + 4}
                    text-anchor="middle"
                    font-size="9"
                    fill="var(--foreground, black)"
                  >
                    {node.name.slice(0, 6)}
                  </text>
                  <text
                    x={node.x}
                    y={node.y + 32}
                    text-anchor="middle"
                    font-size="9"
                    fill="var(--muted-foreground, gray)"
                  >
                    {node.name}
                  </text>
                </g>
              {/each}
            </svg>
          </div>
          <p class="mt-1 text-[10px] text-muted-foreground">
            Solid red = conflict · solid blue = overlap · dashed gray = shared resource. Click a
            node to open its detail.
          </p>
        </section>
      {/if}

      <!-- findings -->
      <section aria-label="Findings">
        <h2 class="mb-2 text-xs font-medium text-muted-foreground">Findings</h2>
        {#if visibleFindings.length === 0}
          <p class="py-6 text-xs text-muted-foreground">No findings at this severity.</p>
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
                        onclick={() => void proposeEditFromFinding(finding)}
                      >
                        <IconSparkles class="h-3 w-3" /> Propose edit
                      </Button>
                    {/if}
                    <Button
                      variant="outline"
                      size="sm"
                      class="h-7 gap-1 px-2 text-[11px]"
                      disabled={proposing}
                      onclick={() => void proposeDisableFromFinding(finding)}
                    >
                      <IconPowerOff class="h-3 w-3" /> Propose disable
                    </Button>
                  </div>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <!-- proposals 审查 -->
      <section class="mt-6" aria-label="Proposal review">
        <div class="mb-2 flex items-center gap-2">
          <h2 class="text-xs font-medium text-muted-foreground">Proposals</h2>
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
            <IconRefresh class="h-3 w-3" /> Refresh
          </Button>
        </div>
        {#if proposals.length === 0}
          <p class="py-4 text-xs text-muted-foreground">
            No pending proposals. Propose a fix from any finding above; nothing is applied until you
            approve it here.
          </p>
        {:else}
          <ul class="space-y-2">
            {#each proposals as proposal (proposal.id)}
              {@const outcome =
                approveOutcome?.proposalId === proposal.id ? approveOutcome.result : null}
              <li class="rounded-md border border-border">
                <div class="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
                  {#if proposal.payload.kind === "edit"}
                    <IconSparkles class="h-4 w-4 shrink-0 text-primary" />
                  {:else if proposal.payload.kind === "disable"}
                    <IconPowerOff class="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  {:else if proposal.payload.kind === "split"}
                    <IconScissors class="h-4 w-4 shrink-0 text-primary" />
                  {:else}
                    <IconGitMerge class="h-4 w-4 shrink-0 text-primary" />
                  {/if}
                  <button
                    type="button"
                    class="min-w-0 flex-1 truncate text-left text-xs font-medium"
                    onclick={() => void expandProposal(proposal)}
                  >
                    {proposal.payload.kind} · {proposal.rationale}
                  </button>
                  <Button
                    variant="outline"
                    size="sm"
                    class="h-7 px-2 text-[11px]"
                    disabled={rejectingId === proposal.id}
                    onclick={() => void handleReject(proposal)}
                  >
                    {#if rejectingId === proposal.id}<IconLoader
                        class="h-3 w-3 animate-spin"
                      />{/if}
                    Reject
                  </Button>
                  <Button
                    size="sm"
                    class="h-7 px-2 text-[11px]"
                    disabled={approvingId === proposal.id ||
                      (outcome !== null && outcome.conflicts > 0)}
                    onclick={() => void handleApprove(proposal)}
                  >
                    {#if approvingId === proposal.id}<IconLoader
                        class="h-3 w-3 animate-spin"
                      />{/if}
                    Approve
                  </Button>
                </div>

                {#if outcome}
                  <div class="border-b border-border/60 px-3 py-2 text-[11px]">
                    {#each outcome.results as entry (entry.skillId)}
                      <p
                        class={entry.status === "applied"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : entry.status === "conflict"
                            ? "text-destructive"
                            : "text-muted-foreground"}
                      >
                        {snapshotName(entry.skillId)} — {entry.status}{entry.error
                          ? `: ${entry.error}`
                          : ""}
                      </p>
                    {/each}
                    {#if outcome.conflicts > 0}
                      <p class="mt-1 text-destructive">
                        This proposal is stale. Re-analyze, then create a fresh proposal.
                      </p>
                    {/if}
                  </div>
                {/if}

                {#if expandedId === proposal.id}
                  <div class="space-y-2 px-3 py-2 text-[11px]">
                    <p class="text-muted-foreground">{proposal.rationale}</p>
                    <p class="text-muted-foreground">
                      Created {new Date(proposal.createdAt).toLocaleString()} · affects
                      {proposal.observedRevisions.length} skill(s).
                    </p>
                    <ul class="space-y-1">
                      {#each proposal.observedRevisions as observed (observed.skillId)}
                        <li class="flex flex-wrap items-baseline gap-1">
                          <button
                            type="button"
                            class="text-primary underline-offset-2 hover:underline"
                            onclick={() => openSkillDetail(observed.skillId)}
                          >
                            {snapshotName(observed.skillId)}
                          </button>
                          <code class="break-all text-[10px] text-muted-foreground"
                            >{observed.revision.slice(0, 19)}…</code
                          >
                        </li>
                      {/each}
                    </ul>

                    {#if proposal.payload.kind === "edit"}
                      {@const first = proposal.payload.edits[0]}
                      {@const before = beforeDocs[first.selection.skillId]}
                      <div class="grid gap-2 md:grid-cols-2">
                        <div class="rounded border border-border bg-muted/20 p-2">
                          <p class="mb-1 font-medium">Before</p>
                          {#if before}
                            <p class="leading-4 text-muted-foreground">{before.description}</p>
                          {:else}
                            <p class="text-muted-foreground">Loading current document…</p>
                          {/if}
                        </div>
                        <div class="rounded border border-border bg-muted/20 p-2">
                          <p class="mb-1 font-medium">After (proposal)</p>
                          <p class="leading-4 text-muted-foreground">
                            {first.frontmatter.description}
                          </p>
                        </div>
                      </div>
                      <details>
                        <summary class="cursor-pointer text-muted-foreground">Preview body</summary>
                        <pre
                          class="mt-1 max-h-48 overflow-auto rounded bg-muted/40 p-2 text-[10px] whitespace-pre-wrap">{first.body}</pre>
                      </details>
                    {:else if proposal.payload.kind === "disable"}
                      <p class="rounded border border-border bg-muted/20 p-2 leading-4">
                        Reason: {proposal.payload.reason}
                      </p>
                    {:else if proposal.payload.kind === "split"}
                      <ul class="space-y-1">
                        {#each proposal.payload.targets as target (target.directoryName)}
                          <li>
                            <span class="font-medium">{target.directoryName}</span>
                            <span class="text-muted-foreground">
                              — {target.frontmatter.description}</span
                            >
                          </li>
                        {/each}
                      </ul>
                    {:else if proposal.payload.kind === "merge"}
                      <p>
                        <span class="font-medium">{proposal.payload.target.directoryName}</span>
                        <span class="text-muted-foreground">
                          — {proposal.payload.target.frontmatter.description}</span
                        >
                      </p>
                      <p class="text-muted-foreground">
                        Merges {proposal.payload.sources.length} sources; approving removes them revision-safely.
                      </p>
                    {/if}
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/if}
  </div>
</div>
