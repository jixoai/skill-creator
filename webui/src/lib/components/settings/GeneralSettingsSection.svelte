<!--
  设置面 General 分区（add-agent-settings-modes 迭代）。
  正交意图：
  1. daemon 连接状态投影（连接/断开/重连中可见；断开时给出恢复提示）。
-->
<script lang="ts">
  import { connectionState } from "$lib/store.svelte";
  import IconPlug from "@lucide/svelte/icons/plug-zap";
  import IconUnplug from "@lucide/svelte/icons/plug";

  const statusLabel = $derived.by(() => {
    switch (connectionState.status) {
      case "connected":
        return "Connected";
      case "connecting":
        return "Connecting…";
      case "disconnected":
        return "Disconnected";
      default:
        return "Idle";
    }
  });
</script>

<div class="space-y-4">
  <div>
    <h3 class="text-sm font-medium">General</h3>
    <p class="mt-0.5 text-[11px] text-muted-foreground">
      Shell-level state of this Skill Creator instance.
    </p>
  </div>

  <section class="space-y-1.5" aria-label="Daemon connection">
    <span class="text-[11px] font-medium text-muted-foreground">Daemon connection</span>
    <div class="flex items-center gap-2 rounded-md border border-border bg-background/60 p-2.5">
      {#if connectionState.status === "connected"}
        <IconPlug class="h-4 w-4 text-primary" />
      {:else}
        <IconUnplug
          class="h-4 w-4 {connectionState.status === 'disconnected'
            ? 'text-destructive'
            : 'text-muted-foreground'}"
        />
      {/if}
      <span
        class="text-xs {connectionState.status === 'connected'
          ? 'text-primary'
          : connectionState.status === 'disconnected'
            ? 'text-destructive'
            : 'text-muted-foreground'}"
      >
        {statusLabel}
      </span>
    </div>
    {#if connectionState.status === "disconnected"}
      <p class="text-[10px] text-destructive" role="alert">{connectionState.error}</p>
    {:else}
      <p class="text-[10px] text-muted-foreground">
        The panel reconnects automatically; keep the daemon running via the tray or
        <code class="rounded bg-muted px-1 font-mono">skill-creator start</code>.
      </p>
    {/if}
  </section>
</div>
