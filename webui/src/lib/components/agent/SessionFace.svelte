<!--
  会话呈现面（skills-agent-page 1.4：session-face 组件族）。
  用户原始需求 [2026-10-03]（design §1/§3）：「中部 Chat（transcript + composer）」
  「同一 session 可被 Agent 页与 Panel 同时打开」——本组件是 AgentPanel 竖向
  编排（§3.1 骨架：TranscriptView → 错误条 → TodoDock → edit-mode 注记条 →
  ComposerCard）的抽出体，AgentPanel（workspace attach 面板）与 SkillsAgentPage
  （Agent 页中部）双消费同一份，不拷贝两份（波 3 creator-agent-chat 的复用面）。
  正交意图：
    1. 面编排：转录流/错误条/TodoDock/编辑注记/composer 的竖向组合 + 面级
       DropOverlay（document 级拖放；tab 制下两呈现面不同时在 DOM，无双重挂载）。
    2. 面内注入：focusComposer 句柄经 props 下发 TranscriptView——编辑回填聚焦
       本面 composer（不再全局 DOM 查询 aside[data-agent-panel]；props 注入是
       session-face 组件族对外接口，波 3 creator-agent-chat 复用同一面）。
    3. 配置惰性加载（model chip 数据面）：连接建立且本面在场时补拉一次；
       seed（agentPanel.seed）一次性消费（text 预填 + reference 注册）。
  妥协声明：无（各分片语义在子组件内自持；数据面 = agent.svelte 单例 store）。
-->
<script lang="ts">
  import IconX from "@lucide/svelte/icons/x";
  import {
    agentPanel,
    agentSession,
    loadAgentSettings,
    agentRuntimeConfig,
  } from "$lib/stores/agent.svelte";
  import { connectionState } from "$lib/stores/connection.svelte";
  import { agentComposer, addComposerReference } from "$lib/stores/agent-composer.svelte";
  import { t } from "$lib/i18n";
  import TranscriptView from "./TranscriptView.svelte";
  import DropOverlay from "./DropOverlay.svelte";
  import TodoDock from "./TodoDock.svelte";
  import ComposerCard from "./ComposerCard.svelte";

  let {
    onOpenFilePreview,
    onOpenBashOutput,
  }: {
    onOpenFilePreview?: (path: string) => void;
    onOpenBashOutput?: () => void;
  } = $props();

  let root = $state<HTMLElement | null>(null);

  /** 面内 composer 聚焦句柄（TranscriptView 编辑回填的落点）。 */
  function focusComposer(): void {
    root?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
  }

  // 惰性加载配置投影（model chip 消费）：本面在场且连接建立后补拉（未连接不发
  // RPC；走查 P1 修复语义平移——requireRpc 未连接同步抛错会让 loading/error 在
  // 同一 effect 帧写回触发无限环，status 入依赖后连接建立/重连驱动补拉）。
  // 每连接一次性：失败不重试（重连重新武装）——view===null && !loading 双假态
  // 在持久失败下会无限重触发。
  let autoLoadedSettings = false;
  $effect(() => {
    if (connectionState.status !== "connected") {
      autoLoadedSettings = false;
      return;
    }
    if (autoLoadedSettings || agentRuntimeConfig.view !== null || agentRuntimeConfig.loading) {
      return;
    }
    autoLoadedSettings = true;
    void loadAgentSettings();
  });

  // composer 种子（creator-test-session A2/A′2）：面挂载即一次性消费——文本填入
  // （不覆盖已有草稿）+ 引用经 addComposerReference 注册（registry 唯一写者）。
  // 不自动发送；会话由首条消息惰性创建，种子无需等待 sessionId。
  $effect(() => {
    if (agentPanel.seed) {
      const seed = agentPanel.seed;
      agentPanel.seed = null;
      if (agentComposer.text.length === 0) agentComposer.text = seed.text;
      if (seed.reference !== undefined && agentComposer.text.includes(seed.reference.token)) {
        addComposerReference(seed.reference);
      }
    }
  });
</script>

<DropOverlay />

<div bind:this={root} class="flex h-full min-h-0 flex-1 flex-col" data-session-face="true">
  <TranscriptView {focusComposer} {onOpenFilePreview} {onOpenBashOutput} />

  {#if agentSession.promptError ?? agentSession.error}
    <div
      class="border-t border-destructive/30 bg-destructive/8 px-3 py-1.5 text-xs text-destructive"
      role="alert"
    >
      {agentSession.promptError ?? agentSession.error}
    </div>
  {/if}

  {#if agentSession.sessionId && agentSession.todos.length > 0}
    <TodoDock todos={agentSession.todos} />
  {/if}

  {#if agentComposer.editing !== null}
    <!-- edit-mode 注记条（§3.4/§4.3）：amber tint；发送/取消退出。 -->
    <div
      class="mx-3 mb-1.5 flex h-7 shrink-0 items-center justify-between gap-2 rounded-lg bg-amber-500/10 px-2.5 text-[11px] text-amber-700 dark:text-amber-400"
      role="status"
    >
      <span class="truncate"> {t("agentPanel.editingNote")} </span>
      <button
        type="button"
        class="relative shrink-0 rounded p-0.5 text-amber-700/80 after:absolute after:-inset-1.5 after:content-[''] hover:text-amber-700 dark:text-amber-400/80 dark:hover:text-amber-400"
        title={t("agentPanel.cancelEdit")}
        aria-label={t("agentPanel.cancelEdit")}
        onclick={() => {
          if (agentComposer.editing !== null) agentComposer.text = "";
          agentComposer.editing = null;
        }}
      >
        <IconX class="h-3 w-3" />
      </button>
    </div>
  {/if}

  <ComposerCard />
</div>
