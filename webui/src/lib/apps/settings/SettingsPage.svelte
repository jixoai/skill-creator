<!--
  设置页面面板（settings-panel-zcode-source：Settings 从 shell Dialog 退役为标准页面）。
  用户原始需求 [2026-09-09]：「打开后也应该是一个 list-detail 的结构，方便分类
  管理设置。」
  用户原始需求 [2026-09-25]（Owner 裁决）：「目前的 settings 是一个 Dialog，放弃
  Dialog，改成标准的页面面板。」
  正交意图：
  1. list-detail 骨架平移（原 SettingsDialog）：左分区导航 + 右内容容器；
     分区 = /settings/:section 路由参数（URL 即状态，可刷新恢复），/settings
     默认 General。
  2. 挂载即拉一次 agent settings 投影（Model/Agent 分区共享同一视图）。
  滚动所有权法则（skill-refs-and-platform-fixes C2 裁决）原样保留：Model 分区自管
  唯一纵滚（tab 内容容器，R16 裁决），右栏 overflow-hidden 只供高度链；其余分区
  右栏即唯一纵滚所有者（不用负边距逃逸——overflow-y 的隐式 overflow-x:auto 会让
  逃逸子块宽出触发横向滚动条）。
-->
<script lang="ts">
  import { goto } from "$app/navigation";
  import { useParams } from "$lib/shell";
  import { loadAgentSettings } from "$lib/stores/agent.svelte";
  import { SETTINGS_SECTION_IDS, type SettingsSectionId } from "$lib/stores/settings-ui.svelte";
  import AgentSettingsSection from "$lib/components/settings/AgentSettingsSection.svelte";
  import GeneralSettingsSection from "$lib/components/settings/GeneralSettingsSection.svelte";
  import ModelSettingsSection from "$lib/components/settings/ModelSettingsSection.svelte";
  import SessionsSettingsSection from "$lib/components/settings/SessionsSettingsSection.svelte";
  import IconSettings2 from "@lucide/svelte/icons/settings-2";
  import IconCpu from "@lucide/svelte/icons/cpu";
  import IconBot from "@lucide/svelte/icons/bot";
  import IconHistory from "@lucide/svelte/icons/history";

  const sections: ReadonlyArray<{
    id: SettingsSectionId;
    label: string;
    icon: typeof IconCpu;
  }> = [
    { id: "general", label: "General", icon: IconSettings2 },
    { id: "model", label: "Model", icon: IconCpu },
    { id: "agent", label: "Agent", icon: IconBot },
    { id: "sessions", label: "Sessions", icon: IconHistory },
  ];

  // shell 路由 params（section 子路由经 zod enum 收窄；home 路由无 params → 默认 general）。
  const getParams = useParams<{ section?: string }>();
  const section = $derived.by(() => {
    const raw = getParams?.()?.section;
    return SETTINGS_SECTION_IDS.includes(raw as SettingsSectionId)
      ? (raw as SettingsSectionId)
      : "general";
  });

  // 进入页面拉取最新投影（Model/Agent 分区共享；失败面由各分区自行呈现）。
  $effect(() => {
    void loadAgentSettings();
  });

  function switchSection(id: SettingsSectionId): void {
    void goto(`/settings/${id}`);
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  <header
    class="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 pb-4 pt-5"
  >
    <div>
      <h1 class="text-lg font-semibold">Settings</h1>
      <p class="mt-0.5 text-xs text-muted-foreground">
        General, model routes, agent defaults, and session retention.
      </p>
    </div>
  </header>

  <div class="grid min-h-0 flex-1 grid-cols-[176px_1fr]">
    <div class="flex min-h-0 flex-col border-r border-border bg-muted/30">
      <nav class="flex flex-col gap-0.5 p-2" aria-label="Settings sections">
        {#each sections as item (item.id)}
          {@const Icon = item.icon}
          <button
            class="flex h-8 items-center gap-2 rounded-md px-2 text-xs transition-colors {section ===
            item.id
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
            aria-label={item.label}
            aria-current={section === item.id ? "true" : undefined}
            onclick={() => switchSection(item.id)}
          >
            <Icon class="h-3.5 w-3.5" />
            {item.label}
          </button>
        {/each}
      </nav>
    </div>
    <div class="min-w-0 p-4 {section === 'model' ? 'overflow-hidden' : 'overflow-y-auto'}">
      {#if section === "general"}
        <GeneralSettingsSection />
      {:else if section === "model"}
        <ModelSettingsSection />
      {:else if section === "sessions"}
        <SessionsSettingsSection />
      {:else}
        <AgentSettingsSection />
      {/if}
    </div>
  </div>
</div>
