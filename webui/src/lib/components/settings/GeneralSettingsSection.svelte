<!--
  设置面 General 分区（add-agent-settings-modes 迭代；2026-09-30
  shell-settings-ui：新增 Appearance 偏好）。
  正交意图：
  1. daemon 连接状态投影（连接/断开/重连中可见；断开时给出恢复提示）。
  2. Appearance（设备偏好，localStorage 单源）：主题三选（Light/Dark/System，
     .dark 类立即生效）+ 侧栏默认折叠开关。
-->
<script lang="ts">
  import { connectionState } from "$lib/store.svelte";
  import {
    appearanceSidebarCollapsed,
    appearanceTheme,
    setAppearanceTheme,
    toggleAppearanceSidebar,
  } from "$lib/shell/appearance.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Switch } from "$lib/components/ui/switch";
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

  const theme = $derived(appearanceTheme());
  const sidebarCollapsed = $derived(appearanceSidebarCollapsed());

  const THEME_OPTIONS = [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
    { value: "system", label: "System" },
  ] as const;
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
        The panel reconnects automatically; keep the daemon running via the tray or the <code
          class="rounded bg-muted px-1 font-mono">skill-creator start</code
        > command.
      </p>
    {/if}
  </section>

  <section class="space-y-1.5" aria-label="Appearance">
    <span class="text-[11px] font-medium text-muted-foreground">Appearance</span>

    <div
      class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background/60 p-2.5"
    >
      <div>
        <p class="text-xs font-medium">Theme</p>
        <p class="text-[10px] text-muted-foreground">
          System follows your OS color scheme; applies immediately.
        </p>
      </div>
      <!-- 走查 #4：行级 flex-wrap 让分段控件在窄内容区（Agent 面板开启）整组换行，
           控件自身 max-w-full + flex-wrap 兜底更窄场景——System 段不再被
           overflow-hidden 裁切；未选中段显式 bg-transparent，仅选中态上底色。 -->
      <div
        class="inline-flex max-w-full flex-wrap overflow-hidden rounded-md border border-border"
        role="group"
        aria-label="Theme preference"
      >
        {#each THEME_OPTIONS as option (option.value)}
          <Button
            variant="ghost"
            size="sm"
            class="h-7 rounded-none px-2.5 text-xs {theme === option.value
              ? 'bg-accent text-primary'
              : 'bg-transparent text-muted-foreground'}"
            aria-pressed={theme === option.value}
            onclick={() => setAppearanceTheme(option.value)}
          >
            {option.label}
          </Button>
        {/each}
      </div>
    </div>

    <div
      class="flex items-center justify-between rounded-md border border-border bg-background/60 p-2.5"
    >
      <div>
        <p class="text-xs font-medium">Collapse sidebar by default</p>
        <p class="text-[10px] text-muted-foreground">
          Icon-only rail; expand anytime from the sidebar's bottom toggle.
        </p>
      </div>
      <Switch
        checked={sidebarCollapsed}
        onCheckedChange={() => toggleAppearanceSidebar()}
        aria-label="Collapse sidebar by default"
      />
    </div>
  </section>
</div>
