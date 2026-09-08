<!--
  全局设置面（add-agent-settings-modes 迭代）：shell 级 Dialog，list-detail 结构
  （左分区导航 + 右详情），参考 DSH webui settings shell；入口 = 侧栏底部齿轮。
  用户原始需求 [2026-09-09]：「设置面板应该是全局的……入口在左侧导航栏的左下角。
  打开后也应该是一个 list-detail 的结构，方便分类管理设置。」
  正交意图：
  1. 开合与分区路由（settingsUi store；Esc/点击遮罩关闭由 Dialog 原生承担）。
  2. 打开时拉一次 agent settings 投影（Model/Agent 分区共享同一视图）。
-->
<script lang="ts">
  import * as Dialog from "$lib/components/ui/dialog";
  import IconSettings2 from "@lucide/svelte/icons/settings-2";
  import IconCpu from "@lucide/svelte/icons/cpu";
  import IconBot from "@lucide/svelte/icons/bot";
  import { loadAgentSettings } from "$lib/stores/agent.svelte";
  import { settingsUi, type SettingsSectionId } from "$lib/stores/settings-ui.svelte";
  import AgentSettingsSection from "./AgentSettingsSection.svelte";
  import GeneralSettingsSection from "./GeneralSettingsSection.svelte";
  import ModelSettingsSection from "./ModelSettingsSection.svelte";

  const sections: ReadonlyArray<{
    id: SettingsSectionId;
    label: string;
    icon: typeof IconCpu;
  }> = [
    { id: "general", label: "General", icon: IconSettings2 },
    { id: "model", label: "Model", icon: IconCpu },
    { id: "agent", label: "Agent", icon: IconBot },
  ];

  let open = $state(false);
  $effect(() => {
    settingsUi.open = open;
  });
  $effect(() => {
    if (settingsUi.open) open = true;
  });
  // 打开即拉取最新投影（Model/Agent 分区共享；失败面由各分区自行呈现）。
  $effect(() => {
    if (open) void loadAgentSettings();
  });
</script>

<Dialog.Root bind:open>
  <Dialog.Content
    class="grid h-[min(560px,85vh)] grid-cols-[176px_1fr] gap-0 overflow-hidden p-0 sm:max-w-3xl"
  >
    <div class="flex min-h-0 flex-col border-r border-border bg-muted/30">
      <Dialog.Title class="px-3 pt-2.5 pb-2 text-xs font-medium text-foreground">
        Settings
      </Dialog.Title>
      <nav class="flex flex-col gap-0.5 p-2" aria-label="Settings sections">
        {#each sections as section (section.id)}
          {@const Icon = section.icon}
          <button
            class="flex h-8 items-center gap-2 rounded-md px-2 text-xs transition-colors {settingsUi.section ===
            section.id
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
            aria-current={settingsUi.section === section.id ? "true" : undefined}
            onclick={() => (settingsUi.section = section.id)}
          >
            <Icon class="h-3.5 w-3.5" />
            {section.label}
          </button>
        {/each}
      </nav>
    </div>
    <div class="min-w-0 overflow-y-auto p-4">
      {#if settingsUi.section === "general"}
        <GeneralSettingsSection />
      {:else if settingsUi.section === "model"}
        <ModelSettingsSection />
      {:else}
        <AgentSettingsSection />
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>
