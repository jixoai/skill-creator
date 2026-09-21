<!--
  用户原始需求 [2026-09-05]：「用户可以导入 Workspace，浏览 Provider 和 Skill……Remove 只删除 registry entry，不删除目录。」
  修订 [2026-09-18]（用户走查）：删除「同内容技能」整屏区块——同源信息改为
  ProviderView 技能行上的小角标（symlink 式标识），不再占据首页版面。
  正交意图：
  1. Skill locations 索引：Global（~）与 Imported Workspace 分组、availability、skill count、Provider 入口。
  2. 导入（共享全局对话框）与移除（仅 registry entry，confirm + busy 锁 + toast 终态）。
  3. 加载 / 空 / 更新中 / 失败四态可区分。
-->
<script lang="ts">
  import {
    loadWorkspaces,
    removeWorkspace,
    workspaceEntryPath,
    workspaceState,
  } from "$lib/store.svelte";
  import {
    agentSessionsList,
    loadAgentSessions,
    selectAgentSession,
    setAgentPanelOpen,
    startAgentAction,
  } from "$lib/stores/agent.svelte";
  import IconPen from "@lucide/svelte/icons/pen-line";
  import IconHeart from "@lucide/svelte/icons/heart-pulse";
  import IconCompass from "@lucide/svelte/icons/compass";
  import IconMessage from "@lucide/svelte/icons/message-square";
  import { requestImportWorkspace } from "$lib/stores/import-workspace.svelte";
  import { showToast } from "$lib/toast.svelte";
  import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { goto } from "$app/navigation";
  import IconGlobe from "@lucide/svelte/icons/globe";
  import IconFolder from "@lucide/svelte/icons/folder";
  import IconRefresh from "@lucide/svelte/icons/refresh-cw";
  import IconPlus from "@lucide/svelte/icons/folder-plus";
  import IconTrash from "@lucide/svelte/icons/trash-2";
  import IconAlert from "@lucide/svelte/icons/triangle-alert";
  import IconLoader from "@lucide/svelte/icons/loader-circle";
  import IconBoxes from "@lucide/svelte/icons/boxes";
  import IconWiki from "@lucide/svelte/icons/book-open";
  import type { ImportedWorkspace, Workspace, WorkspaceProvider } from "$lib/types";

  /** wiki 视图路径（Global id "~" 在 URL path 段编码为 %7E）。 */
  function wikiPath(wsId: string): string {
    return `/workspaces/wiki/${wsId === "~" ? "%7E" : wsId}`;
  }

  const globalWorkspaces = $derived(workspaceState.workspaces.filter((ws) => ws.kind === "global"));
  const importedWorkspaces = $derived(
    workspaceState.workspaces.filter((ws) => ws.kind === "directory"),
  );
  const hasContent = $derived(workspaceState.workspaces.length > 0);
  // 「更新中」= 已有数据时的再加载；初次加载（无数据）显示骨架屏。
  const updating = $derived(workspaceState.loading && hasContent);

  let removing = $state<ImportedWorkspace | null>(null);
  let removeOpen = $state(false);
  let removeBusy = $state(false);

  // 挂载各发一次（perf-firstscreen B-1：拆分 effect——单一 effect 读
  // agentSessionsList 会在 loaded/loading 翻转时重跑并重复 loadWorkspaces，
  // 首屏把 1.76s 的列表 RPC 放大 3-4 倍）。
  $effect(() => {
    void loadWorkspaces();
  });
  $effect(() => {
    // 首屏 Continue 区需要会话列表（面板未打开时也要有数据）。
    if (!agentSessionsList.loaded && !agentSessionsList.loading) void loadAgentSessions();
  });

  /** 库快照：跨全部 workspace 的技能/位置/导入目录总数。 */
  const librarySnapshot = $derived.by(() => {
    let skills = 0;
    let providers = 0;
    for (const ws of workspaceState.workspaces) {
      for (const provider of ws.providers) {
        providers += 1;
        skills += provider.skillCount ?? 0;
      }
    }
    return {
      skills,
      providers,
      imported: workspaceState.workspaces.filter((ws) => ws.kind === "directory").length,
    };
  });

  /** 最近会话（取最新 3 个；点击即回面板续聊）。 */
  const recentSessions = $derived(agentSessionsList.sessions.slice(0, 3));

  function resumeSession(sessionId: string): void {
    selectAgentSession(sessionId);
    setAgentPanelOpen(true);
  }

  function relativeTime(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(ms)) return "";
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  /** 请求移除一个导入 workspace（confirm 对话框打开；Cancel 关闭即取消）。 */
  function requestRemove(ws: ImportedWorkspace): void {
    removing = ws;
    removeOpen = true;
  }

  $effect(() => {
    if (!removeOpen) removing = null;
  });

  async function refresh(): Promise<void> {
    await loadWorkspaces();
  }

  function providerPath(ws: Workspace, provider: WorkspaceProvider): string {
    // Global Workspace id "~" 在 URL path 中编码为 %7E（SvelteKit 客户端路由不接受裸 ~）。
    const wsSegment = ws.id === "~" ? "%7E" : ws.id;
    return `/workspaces/${wsSegment}/${provider.id}`;
  }

  async function confirmRemove(): Promise<void> {
    const workspace = removing;
    if (!workspace) return;
    removeBusy = true;
    try {
      const removed = await removeWorkspace(workspace.id);
      if (removed) {
        removeOpen = false;
        showToast(`Removed ${workspace.label}. Files remain on disk.`);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    } finally {
      removeBusy = false;
    }
  }
</script>

<div class="flex h-full flex-col overflow-y-auto p-5">
  <header class="flex shrink-0 items-start justify-between gap-3 border-b border-border pb-4">
    <div>
      <h1 class="text-lg font-semibold">Workspaces</h1>
      <p class="mt-0.5 text-xs text-muted-foreground">
        Your skill library, agent sessions, and quick ways to put both to work.
      </p>
    </div>
    <div class="flex shrink-0 items-center gap-1.5">
      <Button
        variant="ghost"
        size="icon"
        class="h-9 w-9"
        title="Refresh workspaces"
        aria-label="Refresh workspaces"
        disabled={workspaceState.loading}
        onclick={() => void refresh()}
      >
        {#if workspaceState.loading}
          <IconLoader class="h-4 w-4 animate-spin" />
        {:else}
          <IconRefresh class="h-4 w-4" />
        {/if}
      </Button>
      <Button size="sm" onclick={() => requestImportWorkspace()}>
        <IconPlus class="h-4 w-4" />
        Import
      </Button>
    </div>
  </header>

  <div class="mx-auto mt-5 w-full max-w-5xl space-y-6">
    <!-- 快速行动：回答「这个软件能帮我什么」——每个动作直达一个具体行为。 -->
    <section aria-label="Quick actions" class="grid grid-cols-1 gap-2 min-[560px]:grid-cols-2">
      <button
        class="flex items-start gap-2.5 rounded-lg border border-border bg-background p-3 text-left transition-colors hover:border-foreground/20 hover:bg-muted/50"
        onclick={() =>
          startAgentAction("create", "I want to create a new skill. It should help me ")}
      >
        <IconPen class="mt-0.5 h-4 w-4 shrink-0 text-foreground/70" />
        <span class="min-w-0">
          <span class="block text-sm font-medium">Create a skill</span>
          <span class="block text-xs text-muted-foreground">
            Describe the task; the agent drafts the SKILL.md with best practices.
          </span>
        </span>
      </button>
      <button
        class="flex items-start gap-2.5 rounded-lg border border-border bg-background p-3 text-left transition-colors hover:border-foreground/20 hover:bg-muted/50"
        onclick={() =>
          startAgentAction(
            "manage",
            "Audit my skill library: find duplicates, vague descriptions, and stale skills, then propose concrete fixes.",
          )}
      >
        <IconHeart class="mt-0.5 h-4 w-4 shrink-0 text-foreground/70" />
        <span class="min-w-0">
          <span class="block text-sm font-medium">Health check my library</span>
          <span class="block text-xs text-muted-foreground">
            Duplicates, vague descriptions, stale skills — with proposed fixes.
          </span>
        </span>
      </button>
      <button
        class="flex items-start gap-2.5 rounded-lg border border-border bg-background p-3 text-left transition-colors hover:border-foreground/20 hover:bg-muted/50"
        onclick={() => void goto("/repository")}
      >
        <IconCompass class="mt-0.5 h-4 w-4 shrink-0 text-foreground/70" />
        <span class="min-w-0">
          <span class="block text-sm font-medium">Explore skill sources</span>
          <span class="block text-xs text-muted-foreground">
            Discover curated Git sources and analyze candidate skills.
          </span>
        </span>
      </button>
      <button
        class="flex items-start gap-2.5 rounded-lg border border-border bg-background p-3 text-left transition-colors hover:border-foreground/20 hover:bg-muted/50"
        onclick={() =>
          document.getElementById("library-index")?.scrollIntoView({ behavior: "smooth" })}
      >
        <IconBoxes class="mt-0.5 h-4 w-4 shrink-0 text-foreground/70" />
        <span class="min-w-0">
          <span class="block text-sm font-medium">Browse the library</span>
          <span class="block text-xs text-muted-foreground">
            {librarySnapshot.skills} skills across {librarySnapshot.providers} agent locations.
          </span>
        </span>
      </button>
    </section>

    <!-- Continue：最近 agent 会话一键续聊。 -->
    {#if recentSessions.length > 0}
      <section aria-label="Recent agent sessions" class="space-y-1.5">
        <h2 class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Continue</h2>
        <div class="divide-y divide-border rounded-lg border border-border">
          {#each recentSessions as session (session.sessionId)}
            <button
              class="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50"
              onclick={() => resumeSession(session.sessionId)}
            >
              <IconMessage class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span class="min-w-0 flex-1 truncate text-xs">
                {session.title || "Untitled session"}
              </span>
              <span class="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {session.mode}
              </span>
              <span class="shrink-0 text-xs text-muted-foreground">
                {relativeTime(session.createdAt)}
              </span>
            </button>
          {/each}
        </div>
      </section>
    {/if}

    <div id="library-index" class="space-y-6">
      {#if workspaceState.error}
        <div
          class="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4"
          role="alert"
        >
          <IconAlert class="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-destructive">Couldn't load workspaces</p>
            <p class="mt-1 break-words text-xs text-destructive/90">{workspaceState.error}</p>
          </div>
          <Button variant="outline" size="sm" onclick={() => void refresh()}>Retry</Button>
        </div>
      {:else if workspaceState.loading && !hasContent}
        <div class="space-y-3" aria-label="Loading workspaces">
          <div class="h-24 animate-pulse rounded-lg border border-border bg-muted/50"></div>
          <div class="h-24 animate-pulse rounded-lg border border-border bg-muted/50"></div>
        </div>
      {:else if !hasContent}
        <div class="rounded-lg border border-dashed border-border p-8 text-center">
          <IconFolder class="mx-auto h-8 w-8 text-muted-foreground" />
          <p class="mt-3 text-sm font-medium">No skill locations yet</p>
          <p class="mt-1 text-xs text-muted-foreground">
            Import a directory to manage its skills, or browse the global agent locations.
          </p>
          <Button class="mt-4" size="sm" onclick={() => requestImportWorkspace()}>
            <IconPlus class="h-4 w-4" />
            Import workspace
          </Button>
        </div>
      {:else}
        {#if updating}
          <p class="flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <IconLoader class="h-3.5 w-3.5 animate-spin" /> Updating…
          </p>
        {/if}

        {#each globalWorkspaces as ws (ws.id)}
          {@const target = ws.available ? ws : null}
          <section class="rounded-lg border border-border">
            <div class="flex items-center gap-2.5 border-b border-border px-4 py-3">
              <IconGlobe class="h-4 w-4 shrink-0 text-primary" />
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <h2 class="truncate text-sm font-medium">{ws.label}</h2>
                  <Badge variant="secondary" class="text-xs">~ global</Badge>
                </div>
                <p class="mt-0.5 text-xs text-muted-foreground">
                  {ws.skillCount} skill{ws.skillCount === 1 ? "" : "s"} across {ws.providers.length}
                  agent location{ws.providers.length === 1 ? "" : "s"}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                class="h-9 w-9 shrink-0"
                title="Open the global wiki"
                aria-label="Open the global wiki"
                onclick={() => void goto(wikiPath(ws.id))}
              >
                <IconWiki class="h-4 w-4" />
              </Button>
            </div>
            <ul class="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2">
              {#each ws.providers as provider (provider.id)}
                <li>
                  <button
                    class="flex min-h-11 w-full items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2 text-left transition-colors hover:bg-muted/70 disabled:pointer-events-none disabled:opacity-50"
                    disabled={!target || !provider.available}
                    title={provider.path ?? provider.label}
                    onclick={() => target && void goto(providerPath(ws, provider))}
                  >
                    <span class="min-w-0">
                      <span class="block truncate text-xs font-medium">{provider.label}</span>
                      {#if !provider.available}
                        <span class="text-xs text-muted-foreground">Not found on disk</span>
                      {:else if provider.path}
                        <span class="block truncate font-mono text-xs text-muted-foreground">
                          {provider.path}
                        </span>
                      {/if}
                    </span>
                    <Badge variant="secondary" class="shrink-0 tabular-nums">
                      {provider.skillCount}
                    </Badge>
                  </button>
                </li>
              {/each}
            </ul>
          </section>
        {/each}

        {#if importedWorkspaces.length > 0}
          <section>
            <h2 class="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Imported workspaces
            </h2>
            <ul class="space-y-2">
              {#each importedWorkspaces as ws (ws.id)}
                {@const removable = ws.kind === "directory" ? ws : null}
                <li
                  class="rounded-lg border border-border transition-colors {ws.available
                    ? 'hover:border-foreground/20'
                    : 'border-destructive/40'}"
                >
                  <div class="flex items-center gap-2.5 px-4 py-3">
                    <button
                      class="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 text-left"
                      disabled={!ws.available}
                      onclick={() => ws.available && void goto(workspaceEntryPath(ws))}
                    >
                      <IconFolder
                        class="h-4 w-4 shrink-0 {ws.available
                          ? 'text-primary'
                          : 'text-destructive'}"
                      />
                      <span class="min-w-0 flex-1">
                        <span class="flex items-center gap-2">
                          <span class="truncate text-sm font-medium">{ws.label}</span>
                          {#if !ws.available}
                            <Badge variant="destructive" class="text-xs">
                              <IconAlert class="h-3 w-3" /> Missing
                            </Badge>
                          {/if}
                        </span>
                        <span class="mt-0.5 block truncate font-mono text-xs text-muted-foreground">
                          {ws.path}
                        </span>
                      </span>
                      <Badge variant="secondary" class="shrink-0 tabular-nums">
                        {ws.skillCount}
                      </Badge>
                    </button>
                    {#if removable}
                      <Button
                        variant="ghost"
                        size="icon"
                        class="h-11 w-11 shrink-0 text-muted-foreground hover:text-foreground"
                        title={`Open the wiki for ${ws.label}`}
                        aria-label={`Open the wiki for ${ws.label}`}
                        disabled={!ws.available}
                        onclick={() => ws.available && void goto(wikiPath(ws.id))}
                      >
                        <IconWiki class="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        class="h-11 w-11 shrink-0 text-muted-foreground hover:text-destructive"
                        title={`Remove ${ws.label} registration`}
                        aria-label={`Remove ${ws.label}`}
                        onclick={() => requestRemove(removable)}
                      >
                        <IconTrash class="h-4 w-4" />
                      </Button>
                    {/if}
                  </div>
                  {#if ws.providers.length > 0}
                    <ul
                      class="flex flex-wrap gap-1.5 border-t border-border/60 px-4 py-2.5"
                      aria-label="Providers in {ws.label}"
                    >
                      {#each ws.providers as provider (provider.id)}
                        <li>
                          <button
                            class="flex min-h-9 items-center gap-1.5 rounded-full border border-border/60 px-2.5 py-1 text-xs transition-colors hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-50"
                            disabled={!ws.available || !provider.available}
                            onclick={() => ws.available && void goto(providerPath(ws, provider))}
                          >
                            {provider.label}
                            <span class="tabular-nums text-muted-foreground">
                              {provider.skillCount}
                            </span>
                          </button>
                        </li>
                      {/each}
                    </ul>
                  {/if}
                </li>
              {/each}
            </ul>
          </section>
        {/if}
      {/if}
    </div>
  </div>
</div>

<ConfirmDialog
  bind:open={removeOpen}
  title="Remove workspace registration"
  description={removing
    ? `Remove ${removing.label} from Skill Creator? Its files stay on disk; only the registration is deleted.`
    : ""}
  confirmLabel="Remove"
  busy={removeBusy}
  onConfirm={() => void confirmRemove()}
/>
