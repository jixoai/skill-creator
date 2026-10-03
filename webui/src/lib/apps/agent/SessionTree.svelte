<!--
  Agent 页左栏树（skills-agent-page 1.3）：workspaces+sessions 分组 + 续聊 + 新建。
  用户原始需求 [2026-10-03]（design §1/§2）：「左栏：workspaces+sessions 树（分组
  /续聊/新建；subagent 仅作父会话节点下帧事件投影，不改 list 过滤语义——r2
  裁决）」——分组键 = summary.target.workspaceId（server-owned 直投影，零新
  RPC）；无 target 旧会话归「Unassigned（只读）」组。
  正交意图：
    [1] 分组树：workspace 组（恒在——新建入口）+ 未命中 registry 的归属组 +
        Unassigned 组（有会话才出现）；组内 createdAt 降序。
    [2] 会话行：显示名 + 状态点 + 活动高亮；点击续聊（selectAgentSession——
        帧流重放由 store 承载）；Unassigned 行带只读徽标。
    [3] 新建（带 target 选择）：组头 + 展开目标选择（当前 ws 预选；可跨 ws；
        可无 target）——不 eager 建会话，只进空态（首条消息惰性创建，R12-B）。
  妥协声明：原生 select 目标选择器（与 AgentHeader 会话 select 同妥协族）。
-->
<script lang="ts">
  import IconChevronRight from "@lucide/svelte/icons/chevron-right";
  import IconPlus from "@lucide/svelte/icons/plus";
  import IconRefresh from "@lucide/svelte/icons/refresh-cw";
  import { t } from "$lib/i18n";
  import {
    agentSession,
    agentSessionsList,
    beginNewAgentSession,
    loadAgentSessions,
    selectAgentSession,
  } from "$lib/stores/agent.svelte";
  import { connectionState } from "$lib/stores/connection.svelte";
  import { workspaceState } from "$lib/stores/workspaces.svelte";
  import type { AgentSessionTarget } from "$shared/contracts/agent.js";
  import {
    UNASSIGNED_GROUP_KEY,
    groupSessionsByTarget,
    sessionDisplayName,
    sessionIsUnassigned,
  } from "./session-tree.js";

  // 连接建立后拉会话列表（未连接不发 RPC——requireRpc 同步 throw 会逃逸 $effect）。
  // 每连接一次性自动拉取：失败不重试（刷新钮/重连重新武装）。
  let autoLoadedList = false;
  $effect(() => {
    if (connectionState.status !== "connected") {
      autoLoadedList = false;
      return;
    }
    if (autoLoadedList || agentSessionsList.loaded || agentSessionsList.loading) return;
    autoLoadedList = true;
    void loadAgentSessions();
  });

  const groups = $derived(
    groupSessionsByTarget(agentSessionsList.sessions, workspaceState.workspaces),
  );

  /** 展开态（组 key → bool；缺省 true——全部展开）。 */
  let collapsed = $state<Record<string, boolean>>({});

  function toggleGroup(key: string): void {
    collapsed = { ...collapsed, [key]: !collapsed[key] };
  }

  /** 新建目标选择器：pickerGroup = 展开的组；newSessionPicker = 选中的目标值。 */
  let pickerGroup = $state<string | null>(null);
  let newSessionPicker = $state<string>("");

  /** 目标选项值域：workspace id 或 ""（无 target——只读会话）。 */
  const targetOptions = $derived([
    ...workspaceState.workspaces.map((workspace) => ({
      value: workspace.id as string,
      label: workspace.label,
    })),
    { value: "", label: t("agentTree.noTargetOption") },
  ]);

  function openPicker(key: string): void {
    pickerGroup = key;
    newSessionPicker = key === UNASSIGNED_GROUP_KEY ? "" : key;
  }

  function startNewSession(): void {
    const choice = newSessionPicker;
    newSessionPicker = "";
    pickerGroup = null;
    if (choice === "") {
      beginNewAgentSession();
      return;
    }
    const workspace = workspaceState.workspaces.find((item) => item.id === choice);
    if (!workspace) return;
    const target: AgentSessionTarget = { workspaceId: workspace.id };
    // cwd = Imported ws root（bash 落点）；Global/未知 = 缺省（daemon home）。
    const cwd = workspace.kind === "directory" ? workspace.path : undefined;
    beginNewAgentSession(cwd === undefined ? { target } : { target, cwd });
  }

  function groupLabel(key: string, workspaceLabel: string | undefined): string {
    if (key === UNASSIGNED_GROUP_KEY) return t("agentTree.unassignedGroup");
    return workspaceLabel ?? key;
  }

  function statusDotClass(session: (typeof agentSessionsList.sessions)[number]): string {
    if (session.status === "running") return "bg-primary";
    if (session.status === "disposed") return "bg-muted-foreground/40";
    return "bg-muted-foreground";
  }
</script>

<div class="flex h-full flex-col" data-agent-tree="true">
  <div class="flex h-9 shrink-0 items-center justify-between gap-1 border-b border-border px-2">
    <span class="px-1 text-xs font-medium text-muted-foreground">{t("agentTree.header")}</span>
    <button
      type="button"
      class="relative flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-muted hover:text-foreground"
      title={t("agentTree.refresh")}
      aria-label={t("agentTree.refresh")}
      onclick={() => void loadAgentSessions()}
    >
      <IconRefresh class="h-3.5 w-3.5" />
    </button>
  </div>

  <nav class="min-h-0 flex-1 overflow-y-auto p-1" aria-label={t("agentTree.header")}>
    {#if agentSessionsList.loading && !agentSessionsList.loaded}
      <div class="px-2 py-3 text-xs text-muted-foreground" role="status">
        {t("agentTree.loading")}
      </div>
    {:else if agentSessionsList.error}
      <div class="px-2 py-3 text-xs text-destructive" role="alert">{agentSessionsList.error}</div>
    {:else if groups.length === 0}
      <div class="px-2 py-3 text-xs text-muted-foreground">{t("agentTree.empty")}</div>
    {/if}

    {#each groups as group (group.key)}
      {@const isCollapsed = collapsed[group.key] ?? false}
      <div class="mb-0.5">
        <div class="group/head flex h-7 items-center gap-0.5 rounded pr-1 hover:bg-muted/50">
          <button
            type="button"
            class="relative flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground after:absolute after:-inset-1 after:content-[''] hover:bg-muted"
            aria-expanded={!isCollapsed}
            aria-label={t("agentTree.toggleGroup", {
              group: groupLabel(group.key, group.workspace?.label),
            })}
            onclick={() => toggleGroup(group.key)}
          >
            <IconChevronRight
              class="h-3.5 w-3.5 transition-transform {isCollapsed ? '' : 'rotate-90'}"
            />
          </button>
          <button
            type="button"
            class="min-w-0 flex-1 truncate text-left text-[11px] font-medium text-foreground/80"
            onclick={() => toggleGroup(group.key)}
          >
            {groupLabel(group.key, group.workspace?.label)}
            {#if group.sessions.length > 0}
              <span class="ml-1 text-muted-foreground">{group.sessions.length}</span>
            {/if}
            {#if group.key === UNASSIGNED_GROUP_KEY}
              <span class="ml-1 rounded bg-muted px-1 text-[9px] uppercase text-muted-foreground">
                {t("agentTree.readOnlyTag")}
              </span>
            {/if}
          </button>
          <!-- 新建（带 target 选择）：Unassigned 组不提供（无归属会话无需入口；跨组可从任意 ws 组建）。 -->
          {#if group.key !== UNASSIGNED_GROUP_KEY}
            <button
              type="button"
              class="relative flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 opacity-0 transition-opacity after:absolute after:-inset-1 after:content-[''] group-hover/head:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100"
              title={t("agentTree.newSession")}
              aria-label={t("agentTree.newSession")}
              onclick={() => openPicker(group.key)}
            >
              <IconPlus class="h-3.5 w-3.5" />
            </button>
          {/if}
        </div>

        {#if pickerGroup === group.key}
          <!-- 目标选择行：当前组 ws 预选；可跨 ws 或无 target。 -->
          <div
            class="mx-2 mb-1 flex items-center gap-1 rounded-md border border-border bg-muted/30 p-1"
          >
            <select
              class="h-6 min-w-0 flex-1 rounded border border-border bg-transparent px-1 text-[11px]"
              aria-label={t("agentTree.targetAria")}
              value={newSessionPicker}
              onchange={(event) => {
                newSessionPicker = event.currentTarget.value;
              }}
            >
              {#each targetOptions as option (option.value)}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
            <button
              type="button"
              class="relative rounded bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground after:absolute after:-inset-1 after:content-[''] hover:bg-primary/90"
              onclick={startNewSession}
            >
              {t("agentTree.start")}
            </button>
            <button
              type="button"
              class="relative rounded px-1 py-0.5 text-[11px] text-muted-foreground after:absolute after:-inset-1 after:content-[''] hover:text-foreground"
              onclick={() => {
                pickerGroup = null;
                newSessionPicker = "";
              }}
            >
              {t("agentTree.cancel")}
            </button>
          </div>
        {/if}

        {#if !isCollapsed}
          {#each group.sessions as session (session.sessionId)}
            <button
              type="button"
              class="flex h-7 w-full items-center gap-1.5 rounded pr-2 pl-6 text-left text-xs transition-colors {agentSession.sessionId ===
              session.sessionId
                ? 'bg-primary/10 text-primary'
                : 'text-foreground/80 hover:bg-muted'}"
              aria-current={agentSession.sessionId === session.sessionId ? "true" : undefined}
              title="{sessionDisplayName(session)} ({session.status})"
              onclick={() => selectAgentSession(session.sessionId)}
            >
              <span
                class="h-1.5 w-1.5 shrink-0 rounded-full {statusDotClass(session)}"
                aria-hidden="true"
              ></span>
              <span class="min-w-0 flex-1 truncate">{sessionDisplayName(session)}</span>
              {#if sessionIsUnassigned(session)}
                <span
                  class="shrink-0 rounded bg-muted px-1 text-[9px] text-muted-foreground"
                  title={t("agentTree.unassignedHint")}
                >
                  {t("agentTree.readOnlyTag")}
                </span>
              {/if}
            </button>
          {/each}
        {/if}
      </div>
    {/each}
  </nav>
</div>
