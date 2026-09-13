<!--
  设置面 Sessions 分区（R14-C 2026-09-12）：专门的 Session 管理页。
  用户原始需求 [2026-09-12]：「要有专门的 Session 管理页面，并且要默认支持
  清理 30 天以外的 Session（可配置）。」
  正交意图：
  1. 会话列表：按日期倒序分组的持久/live 会话（标题/日期/模式/状态），逐行
     删除（ConfirmDialog；running 禁用）。
  2. 清理策略：sessionCleanupDays 数字输入（保存走 settings update；提示
     daemon 启动自动清理，默认 30 天）。
  3. Clean now：按输入天数立即清理，展示 deleted/kept 摘要。
-->
<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
  import IconTrash from "@lucide/svelte/icons/trash-2";
  import { DSH_AGENT_MODES } from "$shared/contracts/dsh-runtime.js";
  import type { AgentSessionSummary } from "$shared/contracts/agent.js";
  import {
    agentRuntimeConfig,
    agentSessionsList,
    cleanupAgentSessions,
    loadAgentSessions,
    loadAgentSettings,
    updateAgentSettings,
  } from "$lib/stores/agent.svelte";

  let cleanupDaysInput = $state(30);
  let daysDirty = $state(false);
  let savingDays = $state(false);
  let daysError = $state<string | null>(null);
  let rejection = $state<string | null>(null);
  let cleanSummary = $state<string | null>(null);
  let cleaning = $state(false);
  let confirmOpen = $state(false);
  let removeTarget = $state<AgentSessionSummary | null>(null);
  let removing = $state(false);
  /** 列表只按 mount 拉一次（避免 error 态的 effect 重触发循环）。 */
  let listRequested = false;

  $effect(() => {
    if (listRequested) return;
    listRequested = true;
    void loadAgentSessions();
  });
  // 输入框从视图播种；用户改过（dirty）后不再被视图覆盖。
  $effect(() => {
    const days = agentRuntimeConfig.view?.settings.session.sessionCleanupDays;
    if (days !== undefined && !daysDirty) cleanupDaysInput = days;
  });

  const groups = $derived.by(() => {
    const sorted = [...agentSessionsList.sessions].sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1,
    );
    const byDay = new Map<string, AgentSessionSummary[]>();
    for (const session of sorted) {
      const key = dateKey(session.createdAt);
      const bucket = byDay.get(key) ?? [];
      bucket.push(session);
      byDay.set(key, bucket);
    }
    return [...byDay.entries()];
  });

  /** ISO → 本地 YYYY-MM-DD（分组键；无效日期落 "Unknown date"）。 */
  function dateKey(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "Unknown date";
    const y = String(date.getFullYear()).padStart(4, "0");
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function timeOf(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  function modeLabel(mode: string): string {
    return DSH_AGENT_MODES.find((entry) => entry.id === mode)?.label ?? mode;
  }

  /** 输入框当前值的整数收窄（1-365；非法返回 null）。 */
  function parsedDays(): number | null {
    const value = Number(cleanupDaysInput);
    if (!Number.isInteger(value) || value < 1 || value > 365) return null;
    return value;
  }

  async function saveDays(): Promise<void> {
    const days = parsedDays();
    if (days === null) {
      daysError = "Retention must be a whole number of days between 1 and 365.";
      return;
    }
    daysError = null;
    savingDays = true;
    try {
      const result = await updateAgentSettings({ session: { sessionCleanupDays: days } });
      if (!result) return;
      if (result.outcome === "rejected") rejection = `${result.code}: ${result.detail}`;
      else if (result.outcome === "error") rejection = result.message;
      else {
        rejection = null;
        daysDirty = false;
      }
    } finally {
      savingDays = false;
    }
  }

  async function cleanNow(): Promise<void> {
    const days = parsedDays();
    if (days === null) {
      daysError = "Retention must be a whole number of days between 1 and 365.";
      return;
    }
    daysError = null;
    cleaning = true;
    cleanSummary = null;
    try {
      const result = await cleanupAgentSessions({ beforeDays: days });
      if (!result) return;
      if ("error" in result) {
        rejection = result.error;
        return;
      }
      rejection = null;
      cleanSummary = `Deleted ${result.deleted} session${result.deleted === 1 ? "" : "s"} · kept ${result.kept}`;
    } finally {
      cleaning = false;
    }
  }

  function requestRemove(session: AgentSessionSummary): void {
    removeTarget = session;
    confirmOpen = true;
  }

  async function confirmRemove(): Promise<void> {
    const target = removeTarget;
    if (!target) return;
    removing = true;
    try {
      const result = await cleanupAgentSessions({ sessionIds: [target.sessionId] });
      if (!result) return;
      if ("error" in result) {
        rejection = result.error;
        return;
      }
      rejection = null;
      if (result.deleted === 0) {
        rejection = `Session ${target.sessionId} was not removed (running or already gone).`;
      }
      confirmOpen = false;
    } finally {
      removing = false;
    }
  }
</script>

<div class="space-y-4">
  <div>
    <h3 class="text-sm font-medium">Sessions</h3>
    <p class="mt-0.5 text-[11px] text-muted-foreground">
      Manage agent panel sessions and transcript retention.
    </p>
  </div>

  <section class="space-y-1.5" aria-label="Cleanup policy">
    <span class="text-[11px] font-medium text-muted-foreground">Cleanup policy</span>
    <div class="flex items-end gap-1.5">
      <label class="flex-1 space-y-1">
        <span class="block text-[10px] text-muted-foreground">
          Delete transcripts older than (days)
        </span>
        <Input
          type="number"
          min={1}
          max={365}
          step={1}
          bind:value={cleanupDaysInput}
          oninput={() => (daysDirty = true)}
          disabled={savingDays}
          aria-label="Session retention days"
        />
      </label>
      <Button
        size="sm"
        class="h-8 px-2.5 text-xs"
        disabled={savingDays || !daysDirty || parsedDays() === null}
        onclick={() => void saveDays()}
      >
        {savingDays ? "Saving…" : "Save"}
      </Button>
    </div>
    <p class="text-[10px] text-muted-foreground">
      Sessions older than this are cleaned automatically when the daemon starts (default 30 days).
      Kernel-side session logs are not touched.
    </p>
    {#if daysError}
      <p class="text-[10px] text-destructive" role="alert">{daysError}</p>
    {/if}
  </section>

  <section class="space-y-1.5" aria-label="Session list">
    <div class="flex items-center justify-between">
      <span class="text-[11px] font-medium text-muted-foreground">Session list</span>
      <Button
        size="sm"
        variant="outline"
        class="h-7 px-2.5 text-xs"
        disabled={cleaning || parsedDays() === null}
        onclick={() => void cleanNow()}
      >
        {cleaning ? "Cleaning…" : "Clean now"}
      </Button>
    </div>
    {#if cleanSummary}
      <p class="text-[10px] text-primary" role="status">{cleanSummary}</p>
    {/if}

    {#if agentSessionsList.loading && !agentSessionsList.loaded}
      <div class="text-xs text-muted-foreground">Loading…</div>
    {:else if agentSessionsList.error}
      <div class="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span class="text-destructive" role="alert">{agentSessionsList.error}</span>
        <Button size="sm" class="h-7 px-2.5 text-xs" onclick={() => void loadAgentSessions()}>
          Retry
        </Button>
      </div>
    {:else if groups.length === 0}
      <p class="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
        No sessions yet. Sessions you start from the agent panel are listed here and can be reviewed
        or removed individually.
      </p>
    {:else}
      {#each groups as [day, sessions] (day)}
        <div class="space-y-1">
          <span class="text-[10px] font-medium text-muted-foreground">{day}</span>
          <ul class="space-y-1">
            {#each sessions as session (session.sessionId)}
              <li
                class="flex items-center gap-2 rounded-md border border-border bg-background/60 px-2.5 py-1.5"
              >
                <span
                  class="min-w-0 flex-1 truncate text-xs"
                  title={session.title || session.sessionId}
                >
                  {session.title || "Untitled session"}
                </span>
                <span class="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                  {timeOf(session.createdAt)}
                </span>
                <span
                  class="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                >
                  {modeLabel(session.mode)}
                </span>
                <span
                  class="shrink-0 text-[10px] {session.status === 'running'
                    ? 'text-primary'
                    : 'text-muted-foreground'}"
                >
                  {session.status}
                </span>
                {#if session.hasTranscript === false}
                  <span
                    class="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                    title="Kernel/steward session without a product transcript — managed by the kernel, not deletable here"
                    >kernel-only</span
                  >
                {/if}
                <Button
                  size="icon"
                  variant="ghost"
                  class="h-6 w-6 shrink-0"
                  aria-label="Delete session {session.title || session.sessionId}"
                  title={session.status === "running"
                    ? "Running sessions cannot be deleted"
                    : session.hasTranscript === false
                      ? "Kernel-only session — nothing to clean in the product layer"
                      : "Delete session"}
                  disabled={session.status === "running" ||
                    session.hasTranscript === false ||
                    removing}
                  onclick={() => requestRemove(session)}
                >
                  <IconTrash class="h-3.5 w-3.5" />
                </Button>
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    {/if}
  </section>

  {#if rejection}
    <div class="text-xs text-destructive" role="alert">{rejection}</div>
  {/if}
</div>

<ConfirmDialog
  bind:open={confirmOpen}
  title="Delete session"
  description="Delete the transcript of “{removeTarget?.title ||
    (removeTarget?.sessionId ?? '')}”? This cannot be undone."
  busy={removing}
  onConfirm={() => void confirmRemove()}
/>
