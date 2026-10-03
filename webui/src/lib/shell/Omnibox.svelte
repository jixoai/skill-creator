<!-- Shell address field, shared command surface, and page-owned action slot. -->
<script lang="ts">
  import { page } from "$app/state";
  import { tick } from "svelte";
  import IconArrowLeft from "@lucide/svelte/icons/arrow-left";
  import IconArrowRight from "@lucide/svelte/icons/arrow-right";
  import IconChevronDown from "@lucide/svelte/icons/chevron-down";
  import IconCommand from "@lucide/svelte/icons/command";
  import IconMenu from "@lucide/svelte/icons/menu";
  import IconMoon from "@lucide/svelte/icons/moon";
  import IconPanelRight from "@lucide/svelte/icons/panel-right";
  import IconSearch from "@lucide/svelte/icons/search";
  import IconSettings from "@lucide/svelte/icons/settings";
  import IconSun from "@lucide/svelte/icons/sun";
  import IconTerminal from "@lucide/svelte/icons/terminal";
  import IconMessage from "@lucide/svelte/icons/message-square";
  import { executeShellCommand, filterShellCommands, SHELL_COMMANDS } from "./commands.js";
  import {
    formatOmniboxUrl,
    historyAvailability,
    omniboxShortcut,
    parseOmniboxInput,
    rankPathCompletions,
    type PathCompletion,
  } from "./omnibox.js";
  import { SHELL_PAGE_ACTIONS, type ShellPageAction } from "./page-actions.js";
  import { canonicalizeShellLocation, resolveShellRoute } from "./route-hygiene.js";
  import { tabIdForPath } from "./tab-session.js";
  import {
    activateTabAndNavigate,
    navigateTab,
    navigateTabHistory,
    tabSession,
  } from "./tab-session.svelte.js";
  import { appearanceTheme, setAppearanceTheme } from "./appearance.svelte.js";
  import { getConnectionGeneration, getRpc } from "$lib/stores/connection.svelte";
  import { openSkillSearchConfig } from "$lib/stores/skills.svelte";
  import { agentPanel, setAgentPanelOpen } from "$lib/stores/agent.svelte";
  import { workspaceState } from "$lib/stores/workspaces.svelte";
  import { t } from "$lib/i18n";
  import type { SkillSearchResult } from "$lib/types";

  let { onToggleNavigation }: { onToggleNavigation?: () => void } = $props();

  type Completion =
    | { readonly kind: "path"; readonly key: string; readonly label: string; readonly path: string }
    | {
        readonly kind: "workspace";
        readonly key: string;
        readonly label: string;
        readonly workspaceId: string;
        readonly path: string;
      }
    | {
        readonly kind: "skill";
        readonly key: string;
        readonly label: string;
        readonly path: string;
      }
    | {
        readonly kind: "command";
        readonly key: string;
        readonly label: string;
        readonly commandId: string;
      };

  const pageKind = $derived(
    resolveShellRoute(page.url.pathname, page.url.search)?.app.pageKind ?? null,
  );
  const currentPath = $derived(`${page.url.pathname}${page.url.search}`);
  const activeStack = $derived(tabSession.navigation.stacks[tabSession.navigation.activeId]);
  const history = $derived(historyAvailability(activeStack));
  const availablePageActions = $derived(pageKind === null ? [] : SHELL_PAGE_ACTIONS[pageKind]);
  const theme = $derived(appearanceTheme());

  let editing = $state(false);
  let input = $state("");
  let inputElement = $state<HTMLInputElement | null>(null);
  let focusedIndex = $state(0);
  let completions = $state<Completion[]>([]);
  let invalid = $state(false);
  let overflowOpen = $state(false);
  let searchSequence = 0;
  let focusRequest = 0;

  const commandMode = $derived(/^>(?:\s|$)/.test(input.trimStart()));
  const visibleCommands = $derived(filterShellCommands(input.trim().replace(/^>\s?/, "")));
  const pathSuggestions = $derived.by(() => {
    const workspaceId = currentWorkspaceId();
    const paths: PathCompletion[] = [
      { path: `/w/${encodeURIComponent(workspaceId)}/skills`, label: "Skills" },
      { path: `/w/${encodeURIComponent(workspaceId)}/creator`, label: "Creator" },
      { path: `/w/${encodeURIComponent(workspaceId)}/wiki`, label: "Wiki" },
      { path: `/w/${encodeURIComponent(workspaceId)}/evaluating`, label: "Evaluating" },
      { path: "/agent", label: "Agent" },
      { path: "/settings", label: "Settings" },
    ];
    return paths;
  });

  $effect(() => {
    if (!editing || commandMode) {
      completions = [];
      focusedIndex = 0;
      return;
    }
    const query = input.trim();
    if (query.length === 0) {
      completions = [];
      return;
    }

    const sequence = ++searchSequence;
    const normalized = normalizeCompletionQuery(query);
    const routeQuery = normalized.startsWith("/") ? normalized : "";
    const routes = (routeQuery ? rankPathCompletions(routeQuery, pathSuggestions) : [])
      .slice(0, 6)
      .map((item) => ({
        kind: "path" as const,
        key: `path:${item.path}`,
        label: `${item.label} · ${item.path}`,
        path: item.path,
      }));
    const workspaceMatches = workspaceState.workspaces
      .filter((workspace) =>
        workspace.label.toLocaleLowerCase().startsWith(query.toLocaleLowerCase()),
      )
      .slice(0, 6)
      .map((workspace) => ({
        kind: "workspace" as const,
        key: `workspace:${workspace.id}`,
        label: workspace.label,
        workspaceId: workspace.id,
        path: workspacePath(workspace.id),
      }));
    completions = [...routes, ...workspaceMatches];
    focusedIndex = 0;

    const searchQuery = query.replace(/^skill\s+/i, "").trim();
    if (searchQuery.length < 2 || normalized.startsWith("/")) return;
    const connectionGeneration = getConnectionGeneration();
    const timer = setTimeout(() => {
      const rpc = getRpc();
      if (!rpc) return;
      void rpc.skills.search({ query: searchQuery, limit: 8 }).then(
        ({ results }) => {
          if (sequence !== searchSequence || connectionGeneration !== getConnectionGeneration())
            return;
          const skills = skillCompletions(results);
          completions = [...routes, ...workspaceMatches, ...skills];
        },
        () => {
          if (sequence === searchSequence && connectionGeneration === getConnectionGeneration()) {
            completions = [...routes, ...workspaceMatches];
          }
        },
      );
    }, 150);
    return () => clearTimeout(timer);
  });

  function currentWorkspaceId(): string {
    const tabId = tabSession.navigation.activeId;
    return tabId.startsWith("ws_") ? tabId : "~";
  }

  function workspacePath(workspaceId: string): string {
    const workspace = workspaceState.workspaces.find((entry) => entry.id === workspaceId);
    const provider =
      workspace?.providers.find((entry) => entry.skillCount > 0) ?? workspace?.providers[0];
    const base = `/w/${encodeURIComponent(workspaceId)}/skills`;
    return provider ? `${base}?provider=${encodeURIComponent(provider.id)}` : base;
  }

  function skillCompletions(results: readonly SkillSearchResult[]): Completion[] {
    const rows: Completion[] = [];
    for (const result of results.slice(0, 8)) {
      const installations = [...result.installations].sort(
        (left, right) =>
          Number(right.workspaceId === currentWorkspaceId()) -
          Number(left.workspaceId === currentWorkspaceId()),
      );
      for (const installation of installations) {
        const query = new URLSearchParams({ provider: installation.providerId, skill: result.id });
        rows.push({
          kind: "skill",
          key: `skill:${installation.workspaceId}:${installation.providerId}:${result.id}`,
          label: `${result.name} · ${installation.workspaceId}/${installation.providerId}`,
          path: `/w/${encodeURIComponent(installation.workspaceId)}/skills?${query.toString()}`,
        });
        if (rows.length >= 8) return rows;
      }
    }
    return rows;
  }

  function normalizeCompletionQuery(query: string): string {
    const trimmed = query.trim();
    if (!trimmed.toLowerCase().startsWith("skill-creator://")) return trimmed;
    const parsed = parseOmniboxInput(trimmed);
    return parsed.kind === "path" ? parsed.path : trimmed.slice("skill-creator://".length);
  }

  function beginEditing(): void {
    editing = true;
    invalid = false;
    input = currentPath;
    focusRequest += 1;
    const request = focusRequest;
    void tick().then(() => {
      if (!editing || request !== focusRequest || !inputElement) return;
      inputElement.focus();
      inputElement.select();
    });
  }

  function stopEditing(): void {
    editing = false;
    invalid = false;
    searchSequence += 1;
    input = "";
    completions = [];
  }

  function navigate(path: string): void {
    stopEditing();
    navigateTab(path);
  }

  function navigateLocalPath(path: string): void {
    const source = new URL(path, "https://skill-creator.invalid");
    const canonical = canonicalizeShellLocation(source.pathname, source.search);
    const destination = new URL(canonical, "https://skill-creator.invalid");
    const match = resolveShellRoute(destination.pathname, destination.search);
    const targetTab = tabIdForPath(destination.pathname);
    if (
      match?.result.kind !== "matched" ||
      (targetTab?.startsWith("ws_") &&
        !workspaceState.workspaces.some((item) => item.id === targetTab))
    ) {
      rejectInput();
      return;
    }
    navigate(canonical);
  }

  function choose(completion: Completion): void {
    if (completion.kind === "workspace") {
      stopEditing();
      activateTabAndNavigate(completion.workspaceId, completion.path);
      return;
    }
    if (completion.kind === "command") {
      const command = SHELL_COMMANDS.find((item) => item.id === completion.commandId);
      if (!command) return;
      stopEditing();
      executeShellCommand(command, {
        navigate: (path) => navigateTab(path),
        openSearchConfig: () => void openSkillSearchConfig(),
      });
      return;
    }
    navigateLocalPath(completion.path);
  }

  function submit(): void {
    if (commandMode) {
      const command = visibleCommands[focusedIndex] ?? visibleCommands[0];
      if (!command) return rejectInput();
      choose({ kind: "command", key: command.id, label: command.label, commandId: command.id });
      return;
    }
    const completion = completions[focusedIndex];
    if (completion) {
      choose(completion);
      return;
    }
    const parsed = parseOmniboxInput(input);
    if (parsed.kind === "path") navigateLocalPath(parsed.path);
    else rejectInput();
  }

  function rejectInput(): void {
    invalid = true;
    setTimeout(() => (invalid = false), 360);
  }

  function handleInputKeydown(event: KeyboardEvent): void {
    const count = commandMode ? visibleCommands.length : completions.length;
    if (event.key === "ArrowDown" && count > 0) {
      event.preventDefault();
      focusedIndex = (focusedIndex + 1) % count;
    } else if (event.key === "ArrowUp" && count > 0) {
      event.preventDefault();
      focusedIndex = (focusedIndex - 1 + count) % count;
    } else if (event.key === "Enter") {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      stopEditing();
    }
  }

  function runAction(action: ShellPageAction): void {
    overflowOpen = false;
    if (action.id === "agent-panel") {
      setAgentPanelOpen(!agentPanel.open);
      return;
    }
    if (action.id === "terminal" || action.id === "right-panel") {
      const agentToolbar = document.querySelector<HTMLElement>(
        '[data-agent-page="true"] > div:first-child',
      );
      const label = t(
        action.id === "terminal" ? "agentPage.toggleTerminal" : "agentPage.toggleRightPanel",
      );
      [...(agentToolbar?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
        .find((button) => button.getAttribute("aria-label") === label)
        ?.click();
      return;
    }
    const next = theme === "dark" ? "light" : "dark";
    setAppearanceTheme(next);
  }

  function focusOmnibox(): void {
    if (editing) {
      inputElement?.focus();
      inputElement?.select();
    } else {
      beginEditing();
    }
  }

  $effect(() => {
    const handler = (event: KeyboardEvent) => {
      const shortcut = omniboxShortcut(event);
      if (!shortcut) return;
      if (shortcut === "focus") {
        event.preventDefault();
        focusOmnibox();
      } else if (shortcut === "back") {
        event.preventDefault();
        navigateTabHistory(-1);
      } else {
        event.preventDefault();
        navigateTabHistory(1);
      }
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  });

  const commandCompletions = $derived(
    visibleCommands.map((command) => ({
      kind: "command" as const,
      key: command.id,
      label: command.label,
      commandId: command.id,
    })),
  );
  const shownCompletions = $derived(commandMode ? commandCompletions : completions);
</script>

<div
  class="relative z-20 flex h-9 shrink-0 items-center gap-1 border-b border-border bg-background px-2"
  data-omnibox-row="true"
>
  {#if pageKind === "workspace"}
    <button
      type="button"
      class="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground min-[720px]:hidden"
      aria-label="Open workspace navigation"
      title="Workspace navigation"
      onclick={() => onToggleNavigation?.()}><IconMenu class="h-4 w-4" /></button
    >
  {/if}
  <button
    type="button"
    class="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-35"
    aria-label="Back in this tab"
    aria-keyshortcuts="Meta+["
    title="Back in this tab (⌘[)"
    disabled={!history.back}
    onclick={() => navigateTabHistory(-1)}><IconArrowLeft class="h-3.5 w-3.5" /></button
  >
  <button
    type="button"
    class="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-35"
    aria-label="Forward in this tab"
    aria-keyshortcuts="Meta+]"
    title="Forward in this tab (⌘])"
    disabled={!history.forward}
    onclick={() => navigateTabHistory(1)}><IconArrowRight class="h-3.5 w-3.5" /></button
  >

  <div class="relative min-w-0 flex-1">
    {#if editing}
      <!-- 编辑态：type="text" 是品牌焦点环的前置条件——@tailwindcss/forms 的 base
           只枚举 :not([type]) 与特定 type，typeless input 会拿到插件注入的
           blue-600 :focus 环/边框（走查实测 RGB(37,99,235)）。显式 type=text
           脱离插件面，焦点态由 wrapper 的品牌 token（primary/50 边框 +
           primary/40 ring）承载。 -->
      <div
        class="flex h-7 items-center gap-1 rounded border border-border bg-background px-2 {invalid
          ? 'omnibox-invalid'
          : 'focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/40'}"
      >
        {#if commandMode}<IconCommand
            class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
          />{:else}<IconSearch class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />{/if}
        <input
          bind:this={inputElement}
          bind:value={input}
          type="text"
          role="combobox"
          class="h-full min-w-0 flex-1 bg-transparent font-mono text-xs outline-none placeholder:text-muted-foreground"
          aria-label="Address and command input"
          aria-autocomplete="list"
          aria-expanded={shownCompletions.length > 0}
          aria-controls="omnibox-completions"
          placeholder="Search pages, workspaces and skills; use > for commands"
          onkeydown={handleInputKeydown}
          onblur={() => {
            if (input.trim().length === 0) stopEditing();
          }}
        />
        <span class="hidden shrink-0 text-[10px] text-muted-foreground sm:inline">Enter</span>
      </div>
      {#if shownCompletions.length > 0}
        <div
          id="omnibox-completions"
          class="absolute top-8 left-0 z-[90] max-h-72 w-full min-w-64 overflow-y-auto rounded border border-border bg-popover p-1 shadow-lg"
          role="listbox"
          aria-label={commandMode ? "Commands" : "Suggestions"}
        >
          {#each shownCompletions as completion, index (completion.key)}
            <button
              type="button"
              role="option"
              aria-selected={index === focusedIndex}
              class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs {index ===
              focusedIndex
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
              onclick={() => choose(completion)}
              onmouseenter={() => (focusedIndex = index)}
            >
              {#if completion.kind === "command"}<IconCommand
                  class="h-3.5 w-3.5 shrink-0"
                />{:else if completion.kind === "workspace"}<IconMenu
                  class="h-3.5 w-3.5 shrink-0"
                />{:else if completion.kind === "skill"}<IconSearch
                  class="h-3.5 w-3.5 shrink-0"
                />{:else}<IconArrowRight class="h-3.5 w-3.5 shrink-0" />{/if}
              <span class="min-w-0 flex-1 truncate">{completion.label}</span>
            </button>
          {/each}
        </div>
      {/if}
    {:else}
      <button
        type="button"
        class="flex h-7 w-full min-w-0 items-center gap-2 rounded border border-transparent px-2 text-left hover:border-border hover:bg-muted/40"
        aria-label="Edit address"
        title={formatOmniboxUrl(currentPath)}
        onclick={beginEditing}
      >
        <span class="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
          >{formatOmniboxUrl(currentPath)}</span
        >
        <span class="hidden shrink-0 text-[10px] text-muted-foreground sm:inline">⌘L</span>
      </button>
    {/if}
  </div>

  <div class="flex shrink-0 items-center gap-0.5">
    <button
      type="button"
      class="hidden h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground min-[720px]:flex"
      aria-label="Open settings"
      title="Settings"
      onclick={() => navigateTab("/settings")}><IconSettings class="h-4 w-4" /></button
    >
    {#each availablePageActions as action (action.id)}
      <button
        type="button"
        class="hidden h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground min-[720px]:flex"
        aria-label={action.label}
        title={action.label}
        aria-pressed={action.id === "agent-panel" ? agentPanel.open : undefined}
        onclick={() => runAction(action)}
      >
        {#if action.id === "agent-panel"}<IconMessage
            class="h-4 w-4"
          />{:else if action.id === "terminal"}<IconTerminal
            class="h-4 w-4"
          />{:else if action.id === "right-panel"}<IconPanelRight
            class="h-4 w-4"
          />{:else if theme === "dark"}<IconMoon class="h-4 w-4" />{:else}<IconSun
            class="h-4 w-4"
          />{/if}
      </button>
    {/each}
    {#if availablePageActions.length > 0}
      <div class="relative min-[720px]:hidden" data-omnibox-overflow="true">
        <button
          type="button"
          class="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground min-[720px]:hidden"
          aria-label="More page actions"
          aria-expanded={overflowOpen}
          title="More page actions"
          onclick={() => (overflowOpen = !overflowOpen)}><IconChevronDown class="h-4 w-4" /></button
        >
        {#if overflowOpen}
          <div
            class="absolute right-0 top-8 z-[90] w-48 rounded border border-border bg-popover p-1 shadow-lg"
          >
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-muted"
              onclick={() => navigate("/settings")}
            >
              <IconSettings class="h-4 w-4" />
              Settings
            </button>
            {#each availablePageActions as action (action.id)}
              <button
                type="button"
                class="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-muted"
                onclick={() => runAction(action)}
              >
                {#if action.id === "agent-panel"}<IconMessage
                    class="h-4 w-4"
                  />{:else if action.id === "terminal"}<IconTerminal
                    class="h-4 w-4"
                  />{:else if action.id === "right-panel"}<IconPanelRight
                    class="h-4 w-4"
                  />{:else}<IconSun class="h-4 w-4" />{/if}
                {action.label}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  :global([data-agent-page="true"] > div:first-child > button:nth-of-type(3)),
  :global([data-agent-page="true"] > div:first-child > button:nth-of-type(4)) {
    display: none !important;
  }

  @keyframes omnibox-shake {
    0%,
    100% {
      transform: translateX(0);
    }
    25% {
      transform: translateX(-3px);
    }
    75% {
      transform: translateX(3px);
    }
  }
  .omnibox-invalid {
    animation: omnibox-shake 180ms ease-in-out 2;
    border-color: var(--destructive);
  }
  @media (prefers-reduced-motion: reduce) {
    .omnibox-invalid {
      animation: none;
    }
  }
</style>
