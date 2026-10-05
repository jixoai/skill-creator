<!--
  Agent session navigation (skills-agent-page-zcode-parity 1.1/1.2).
  ZCode WorkspaceSidebar.tsx:1023-1065 switches organization modes;
  TaskListItem.tsx:352-359/513-535 exposes hover/focus and keyboard behavior;
  TaskListItemContextMenu.tsx:61-180 provides the row context menu.
  Product mapping: this source owns Agent sessions, not ZCode Tasks. Workspace and
  created-time Timeline are representable; task groups, pin/archive, and Automations
  have no matching server model or route and are intentionally not fabricated here.
-->
<script lang="ts">
  import IconCalendarClock from "@lucide/svelte/icons/calendar-clock";
  import IconChevronRight from "@lucide/svelte/icons/chevron-right";
  import IconCopy from "@lucide/svelte/icons/copy";
  import IconFolder from "@lucide/svelte/icons/folder";
  import IconMoreHorizontal from "@lucide/svelte/icons/more-horizontal";
  import IconPlus from "@lucide/svelte/icons/plus";
  import IconRefresh from "@lucide/svelte/icons/refresh-cw";
  import IconSearch from "@lucide/svelte/icons/search";
  import { t } from "$lib/i18n";
  import {
    agentSession,
    agentSessionsList,
    beginNewAgentSession,
    loadAgentSessions,
    selectAgentSession,
  } from "$lib/stores/agent.svelte";
  import { workspaceState } from "$lib/stores/workspaces.svelte";
  import type { AgentSessionSummary, AgentSessionTarget } from "$shared/contracts/agent.js";
  import {
    UNASSIGNED_GROUP_KEY,
    filterSessionSummaries,
    groupSessionsByCreatedAt,
    groupSessionsByTarget,
    sessionDisplayName,
    sessionIsUnassigned,
    type SessionTimelineBucket,
  } from "./session-tree.js";

  let navElement: HTMLElement | null = $state(null);
  let menuElement: HTMLDivElement | null = $state(null);
  let menuTrigger: HTMLButtonElement | null = $state(null);
  let organization = $state<"workspace" | "timeline">("workspace");
  let query = $state("");
  let collapsed = $state<Record<string, boolean>>({});
  let openMenu = $state<{ sessionId: string; top: number; left: number } | null>(null);
  let announcement = $state("");

  $effect(() => {
    if (openMenu === null || menuElement === null) return;
    menuElement.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  });

  $effect(() => {
    if (openMenu === null) return;
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuElement?.contains(target) || menuTrigger?.contains(target)) return;
      openMenu = null;
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      openMenu = null;
      menuTrigger?.focus();
    };
    globalThis.addEventListener("pointerdown", closeOnOutsidePointer);
    globalThis.addEventListener("keydown", closeOnEscape);
    return () => {
      globalThis.removeEventListener("pointerdown", closeOnOutsidePointer);
      globalThis.removeEventListener("keydown", closeOnEscape);
    };
  });

  const matchingSessions = $derived(
    filterSessionSummaries(agentSessionsList.sessions, workspaceState.workspaces, query),
  );
  const workspaceGroups = $derived(
    groupSessionsByTarget(matchingSessions, workspaceState.workspaces),
  );
  const timelineGroups = $derived(groupSessionsByCreatedAt(matchingSessions));
  const timelineLabels = $derived<Record<SessionTimelineBucket, string>>({
    today: t("agentTree.timelineToday"),
    yesterday: t("agentTree.timelineYesterday"),
    "last-week": t("agentTree.timelineLastWeek"),
    older: t("agentTree.timelineOlder"),
    unknown: t("agentTree.timelineUnknown"),
  });

  function toggleGroup(key: string): void {
    collapsed = { ...collapsed, [key]: !collapsed[key] };
  }

  function isGroupCollapsed(key: string): boolean {
    return collapsed[key] ?? false;
  }

  function sessionById(sessionId: string): AgentSessionSummary | undefined {
    return agentSessionsList.sessions.find((session) => session.sessionId === sessionId);
  }

  function openSession(session: AgentSessionSummary): void {
    selectAgentSession(session.sessionId);
  }

  function openNewSession(target?: AgentSessionTarget): void {
    if (target === undefined) {
      beginNewAgentSession();
      return;
    }
    const workspace = workspaceState.workspaces.find((item) => item.id === target.workspaceId);
    const cwd = workspace?.kind === "directory" ? workspace.path : undefined;
    beginNewAgentSession(cwd === undefined ? { target } : { target, cwd });
  }

  function groupLabel(key: string, label: string | undefined): string {
    if (key === UNASSIGNED_GROUP_KEY) return t("agentTree.unassignedGroup");
    return label ?? key;
  }

  function statusDotClass(session: AgentSessionSummary): string {
    if (session.status === "running") return "bg-primary";
    if (session.status === "disposed") return "bg-muted-foreground/40";
    return "bg-muted-foreground";
  }

  function createdDate(session: AgentSessionSummary): string {
    const date = new Date(session.createdAt);
    return Number.isNaN(date.getTime())
      ? t("agentTree.dateUnknown")
      : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function focusSessionByOffset(
    current: HTMLButtonElement,
    offset: number | "first" | "last",
  ): void {
    const rows = [
      ...(navElement?.querySelectorAll<HTMLButtonElement>("[data-agent-session-row]") ?? []),
    ];
    if (rows.length === 0) return;
    const currentIndex = rows.indexOf(current);
    const nextIndex =
      offset === "first" ? 0 : offset === "last" ? rows.length - 1 : currentIndex + offset;
    rows[Math.min(rows.length - 1, Math.max(0, nextIndex))]?.focus();
  }

  function handleSessionKeydown(event: KeyboardEvent): void {
    const row = event.currentTarget;
    if (!(row instanceof HTMLButtonElement)) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusSessionByOffset(row, event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusSessionByOffset(row, event.key === "Home" ? "first" : "last");
    } else if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      showMenuForSession(event, row.dataset.sessionId ?? "", row);
    }
  }

  function showMenuForSession(
    event: MouseEvent | KeyboardEvent,
    sessionId: string,
    trigger: HTMLButtonElement,
  ): void {
    event.preventDefault();
    const bounds = trigger.getBoundingClientRect();
    const x = event instanceof MouseEvent && event.clientX > 0 ? event.clientX : bounds.right;
    const y = event instanceof MouseEvent && event.clientY > 0 ? event.clientY : bounds.bottom;
    menuTrigger = trigger;
    openMenu = {
      sessionId,
      top: Math.min(y, globalThis.innerHeight - 148),
      left: Math.min(x, globalThis.innerWidth - 224),
    };
  }

  function showMenuForRow(event: MouseEvent, sessionId: string): void {
    const row = event.currentTarget;
    if (!(row instanceof HTMLButtonElement)) return;
    const trigger = row
      .closest('[role="listitem"]')
      ?.querySelector<HTMLButtonElement>('[data-agent-session-menu-button="true"]');
    if (trigger) showMenuForSession(event, sessionId, trigger);
  }

  function handleMenuKeydown(event: KeyboardEvent): void {
    const key = event.key;
    if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Home" && key !== "End") return;
    const items = [
      ...(menuElement?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
    ];
    if (items.length === 0) return;
    const currentIndex = items.findIndex((item) => item === event.target);
    const nextIndex =
      key === "Home"
        ? 0
        : key === "End"
          ? items.length - 1
          : (currentIndex + (key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    event.preventDefault();
    items[nextIndex]?.focus();
  }

  async function copySessionId(sessionId: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(sessionId);
      announcement = t("agentTree.sessionCopied");
    } catch {
      announcement = t("agentTree.copyFailed");
    }
    openMenu = null;
  }

  function sessionWorkspaceLabel(session: AgentSessionSummary): string | null {
    const workspaceId = session.target?.workspaceId;
    if (workspaceId === undefined) return null;
    return (
      workspaceState.workspaces.find((workspace) => workspace.id === workspaceId)?.label ??
      workspaceId
    );
  }
</script>

<div class="flex h-full min-h-0 flex-col" data-agent-tree="true">
  <div class="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
    <span class="min-w-0 flex-1 truncate px-1 text-xs font-medium text-muted-foreground">
      {t("agentTree.header")}
    </span>
    <button
      type="button"
      class="relative flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      title={t("agentTree.newSession")}
      aria-label={t("agentTree.newSession")}
      onclick={() => openNewSession()}
    >
      <IconPlus class="h-3.5 w-3.5" />
    </button>
    <button
      type="button"
      class="relative flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      title={t("agentTree.refresh")}
      aria-label={t("agentTree.refresh")}
      onclick={() => void loadAgentSessions()}
    >
      <IconRefresh class="h-3.5 w-3.5" />
    </button>
  </div>

  <div class="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
    <button
      type="button"
      class="flex h-6 flex-1 items-center justify-center gap-1 rounded px-1.5 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring {organization ===
      'workspace'
        ? 'bg-muted text-foreground'
        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}"
      aria-pressed={organization === "workspace"}
      onclick={() => (organization = "workspace")}
    >
      <IconFolder class="h-3 w-3" aria-hidden="true" />
      {t("agentTree.organizationWorkspace")}
    </button>
    <button
      type="button"
      class="flex h-6 flex-1 items-center justify-center gap-1 rounded px-1.5 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring {organization ===
      'timeline'
        ? 'bg-muted text-foreground'
        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}"
      aria-pressed={organization === "timeline"}
      onclick={() => (organization = "timeline")}
    >
      <IconCalendarClock class="h-3 w-3" aria-hidden="true" />
      {t("agentTree.organizationTimeline")}
    </button>
  </div>

  <label class="relative flex shrink-0 items-center px-2 py-2">
    <IconSearch class="pointer-events-none absolute left-3.5 h-3.5 w-3.5 text-muted-foreground" />
    <input
      class="h-7 w-full rounded border border-border bg-background pl-7 pr-2 text-xs outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring"
      type="search"
      aria-label={t("agentTree.search")}
      placeholder={t("agentTree.searchPlaceholder")}
      bind:value={query}
    />
  </label>

  <nav
    bind:this={navElement}
    class="min-h-0 flex-1 overflow-y-auto p-1"
    aria-label={t("agentTree.header")}
    data-agent-session-navigation="true"
  >
    {#if agentSessionsList.loading && !agentSessionsList.loaded}
      <div class="px-2 py-3 text-xs text-muted-foreground" role="status">
        {t("agentTree.loading")}
      </div>
    {:else if agentSessionsList.error}
      <div class="px-2 py-3 text-xs text-destructive" role="alert">{agentSessionsList.error}</div>
    {:else if matchingSessions.length === 0}
      <div class="px-2 py-3 text-xs text-muted-foreground">
        {query.trim() ? t("agentTree.noSearchResults") : t("agentTree.empty")}
      </div>
    {:else if organization === "workspace"}
      {#each workspaceGroups as group (group.key)}
        {@const isCollapsed = isGroupCollapsed(group.key)}
        <section class="mb-1" aria-label={groupLabel(group.key, group.workspace?.label)}>
          <div class="group/head flex h-7 items-center gap-0.5 rounded pr-1 hover:bg-muted/50">
            <button
              type="button"
              class="relative flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground after:absolute after:-inset-1 after:content-[''] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-expanded={!isCollapsed}
              aria-label={t(isCollapsed ? "agentTree.expandGroup" : "agentTree.collapseGroup", {
                group: groupLabel(group.key, group.workspace?.label),
              })}
              onclick={() => toggleGroup(group.key)}
              onkeydown={(event) => {
                if (event.key === "ArrowLeft" && !isCollapsed) {
                  event.preventDefault();
                  toggleGroup(group.key);
                } else if (event.key === "ArrowRight" && isCollapsed) {
                  event.preventDefault();
                  toggleGroup(group.key);
                }
              }}
            >
              <IconChevronRight
                class="h-3.5 w-3.5 transition-transform {isCollapsed ? '' : 'rotate-90'}"
              />
            </button>
            <button
              type="button"
              class="min-w-0 flex-1 truncate text-left text-[11px] font-medium text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-expanded={!isCollapsed}
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
            {#if group.workspace !== null}
              <button
                type="button"
                class="relative flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 opacity-0 transition-opacity after:absolute after:-inset-1 after:content-[''] group-hover/head:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(hover:none)]:opacity-100"
                title={t("agentTree.newSession")}
                aria-label={t("agentTree.newSessionForWorkspace", {
                  workspace: group.workspace?.label ?? group.key,
                })}
                onclick={() => {
                  const workspace = group.workspace;
                  if (workspace !== null) openNewSession({ workspaceId: workspace.id });
                }}
              >
                <IconPlus class="h-3.5 w-3.5" />
              </button>
            {/if}
          </div>
          {#if !isCollapsed}
            <div role="list">
              {#each group.sessions as session (session.sessionId)}
                {@const selected = agentSession.sessionId === session.sessionId}
                <div
                  class="group/row relative mb-px flex min-w-0 items-center rounded pr-1 {selected
                    ? 'bg-primary/10 text-primary'
                    : 'text-foreground/80 hover:bg-muted'}"
                  role="listitem"
                >
                  <button
                    type="button"
                    class="flex h-11 min-w-0 flex-1 items-center gap-1.5 rounded pl-6 text-left focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-current={selected ? "true" : undefined}
                    aria-label="{sessionDisplayName(session)}, {session.status}, {session.mode}"
                    title="{sessionDisplayName(session)} ({session.status})"
                    data-agent-session-row="true"
                    data-session-id={session.sessionId}
                    onclick={() => openSession(session)}
                    oncontextmenu={(event) => showMenuForRow(event, session.sessionId)}
                    onkeydown={handleSessionKeydown}
                  >
                    <span
                      class="h-1.5 w-1.5 shrink-0 rounded-full {statusDotClass(session)}"
                      aria-hidden="true"
                    ></span>
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-xs">{sessionDisplayName(session)}</span>
                      <span
                        class="block truncate text-[10px] text-muted-foreground group-hover/row:hidden group-focus-within/row:hidden [@media(hover:none)]:block"
                      >
                        {session.status} · {session.mode} · {createdDate(session)}
                      </span>
                    </span>
                    {#if sessionIsUnassigned(session)}
                      <span
                        class="shrink-0 rounded bg-muted px-1 text-[9px] text-muted-foreground"
                        title={t("agentTree.unassignedHint")}
                      >
                        {t("agentTree.readOnlyTag")}
                      </span>
                    {/if}
                  </button>
                  <button
                    type="button"
                    class="relative flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity after:absolute after:-inset-1 after:content-[''] group-hover/row:opacity-100 group-focus-within/row:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(hover:none)]:opacity-100"
                    title={t("agentTree.moreActions")}
                    aria-label={t("agentTree.moreActionsForSession", {
                      session: sessionDisplayName(session),
                    })}
                    aria-haspopup="menu"
                    aria-expanded={openMenu?.sessionId === session.sessionId}
                    data-agent-session-menu-button="true"
                    onclick={(event) =>
                      showMenuForSession(event, session.sessionId, event.currentTarget)}
                    oncontextmenu={(event) =>
                      showMenuForSession(event, session.sessionId, event.currentTarget)}
                  >
                    <IconMoreHorizontal class="h-3.5 w-3.5" />
                  </button>
                </div>
              {/each}
            </div>
          {/if}
        </section>
      {/each}
    {:else}
      {#each timelineGroups as group (group.key)}
        {@const isCollapsed = isGroupCollapsed(group.key)}
        <section class="mb-1" aria-label={timelineLabels[group.key]}>
          <button
            type="button"
            class="flex h-7 w-full items-center gap-1 rounded px-1 text-left text-[11px] font-medium text-foreground/80 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-expanded={!isCollapsed}
            aria-label={t(isCollapsed ? "agentTree.expandGroup" : "agentTree.collapseGroup", {
              group: timelineLabels[group.key],
            })}
            onclick={() => toggleGroup(group.key)}
          >
            <IconChevronRight
              class="h-3.5 w-3.5 transition-transform {isCollapsed ? '' : 'rotate-90'}"
            />
            <span class="min-w-0 flex-1 truncate">{timelineLabels[group.key]}</span>
            <span class="text-muted-foreground">{group.sessions.length}</span>
          </button>
          {#if !isCollapsed}
            <div role="list">
              {#each group.sessions as session (session.sessionId)}
                {@const selected = agentSession.sessionId === session.sessionId}
                <div
                  class="group/row relative mb-px flex min-w-0 items-center rounded pr-1 {selected
                    ? 'bg-primary/10 text-primary'
                    : 'text-foreground/80 hover:bg-muted'}"
                  role="listitem"
                >
                  <button
                    type="button"
                    class="flex h-11 min-w-0 flex-1 items-center gap-1.5 rounded pl-6 text-left focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-current={selected ? "true" : undefined}
                    aria-label="{sessionDisplayName(session)}, {session.status}, {session.mode}"
                    title="{sessionDisplayName(session)} ({session.status})"
                    data-agent-session-row="true"
                    data-session-id={session.sessionId}
                    onclick={() => openSession(session)}
                    oncontextmenu={(event) => showMenuForRow(event, session.sessionId)}
                    onkeydown={handleSessionKeydown}
                  >
                    <span
                      class="h-1.5 w-1.5 shrink-0 rounded-full {statusDotClass(session)}"
                      aria-hidden="true"
                    ></span>
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-xs">{sessionDisplayName(session)}</span>
                      <span
                        class="block truncate text-[10px] text-muted-foreground group-hover/row:hidden group-focus-within/row:hidden [@media(hover:none)]:block"
                      >
                        {session.status} · {session.mode} · {createdDate(session)} · {sessionWorkspaceLabel(
                          session,
                        ) ?? t("agentTree.unassignedGroup")}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    class="relative flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity after:absolute after:-inset-1 after:content-[''] group-hover/row:opacity-100 group-focus-within/row:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(hover:none)]:opacity-100"
                    title={t("agentTree.moreActions")}
                    aria-label={t("agentTree.moreActionsForSession", {
                      session: sessionDisplayName(session),
                    })}
                    aria-haspopup="menu"
                    aria-expanded={openMenu?.sessionId === session.sessionId}
                    data-agent-session-menu-button="true"
                    onclick={(event) =>
                      showMenuForSession(event, session.sessionId, event.currentTarget)}
                    oncontextmenu={(event) =>
                      showMenuForSession(event, session.sessionId, event.currentTarget)}
                  >
                    <IconMoreHorizontal class="h-3.5 w-3.5" />
                  </button>
                </div>
              {/each}
            </div>
          {/if}
        </section>
      {/each}
    {/if}
  </nav>

  <div class="sr-only" role="status" aria-live="polite">{announcement}</div>
</div>

{#if openMenu}
  {@const session = sessionById(openMenu.sessionId)}
  {#if session}
    <div
      bind:this={menuElement}
      class="fixed z-10 min-w-52 rounded border border-border bg-popover p-1 text-popover-foreground shadow-lg"
      style="top: {openMenu.top}px; left: {openMenu.left}px"
      role="menu"
      tabindex="-1"
      aria-label={t("agentTree.contextMenuAria", { session: sessionDisplayName(session) })}
      data-agent-session-menu="true"
      onkeydown={handleMenuKeydown}
    >
      <button
        type="button"
        class="flex h-8 w-full items-center gap-2 rounded px-2 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        role="menuitem"
        onclick={() => {
          openSession(session);
          openMenu = null;
        }}
      >
        {t("agentTree.resumeSession")}
      </button>
      {#if session.target !== undefined && workspaceState.workspaces.some((workspace) => workspace.id === session.target?.workspaceId)}
        <button
          type="button"
          class="flex h-8 w-full items-center gap-2 rounded px-2 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          role="menuitem"
          onclick={() => {
            openNewSession(session.target);
            openMenu = null;
          }}
        >
          <IconPlus class="h-3.5 w-3.5" />
          {t("agentTree.newSessionInSameWorkspace")}
        </button>
      {/if}
      <button
        type="button"
        class="flex h-8 w-full items-center gap-2 rounded px-2 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        role="menuitem"
        onclick={() => void copySessionId(session.sessionId)}
      >
        <IconCopy class="h-3.5 w-3.5" />
        {t("agentTree.copySessionId")}
      </button>
    </div>
  {/if}
{/if}
