<!--
  用户原始需求 [2026-09-08]：「我们可以简单理解成，我们在 skill creator 的右侧
  嵌入了一个聊天对话框。」——2026-09-12 redesign §3.3：面板拆分为 AgentHeader /
  TranscriptView / ComposerCard 后，AgentPanel 收敛为容器（drawer 编排 + 数据
  接线），行渲染器与 header 语义见对应组件。
  正交意图：
  1. shell 级右栏 drawer：≥720px 常驻侧栏（w-[440px]），<720px 单屏覆盖；
     跨 tab 存活（挂载于 +layout，状态在 module store）。Esc 收起（模态打开时
     让位）；面板级 drop 分流；挂载重置草稿 + 惰性加载配置；首屏种子注入。
  2. 面板纵向编排：TranscriptView → 错误条 → TodoDock → edit-mode 注记条 →
     ComposerCard（§3.1 骨架顺序）。
  妥协声明：无（各分片语义在子组件内自持）。
-->
<script lang="ts">
  import IconX from "@lucide/svelte/icons/x";
  import {
    agentPanel,
    agentSession,
    loadAgentSettings,
    agentRuntimeConfig,
    setAgentPanelOpen,
  } from "$lib/stores/agent.svelte";
  import {
    agentComposer,
    handleComposerDrop,
    resetComposer,
  } from "$lib/stores/agent-composer.svelte";
  import AgentHeader from "./AgentHeader.svelte";
  import TranscriptView from "./TranscriptView.svelte";
  import TodoDock from "./TodoDock.svelte";
  import ComposerCard from "./ComposerCard.svelte";

  // 挂载即重置草稿（一次性；对齐旧组件态生命周期）。resetComposer 不读任何响应
  // 依赖，本 effect 只在挂载时运行——model 热切/凭据更新/settings reload 引起的
  // view/loading 变化不得重放清空用户草稿（codex R2 阻塞 5）。
  $effect(() => {
    resetComposer();
  });

  // 惰性加载配置投影（model chip 消费）：view 缺失且非加载中时补拉；与草稿重置
  // 分属两个 effect，配置更新只重跑本 effect，不触碰 composer。
  $effect(() => {
    if (agentRuntimeConfig.view === null && !agentRuntimeConfig.loading) {
      void loadAgentSettings();
    }
  });

  // 首屏行动的 composer 种子：面板挂载即一次性填入（不自动发送；R12-B 8 后
  // startAgentAction 不再 eager 建会话——会话由首条消息惰性创建，种子无需等待
  // sessionId）。
  $effect(() => {
    if (agentPanel.seedPrompt) {
      const seed = agentPanel.seedPrompt;
      agentPanel.seedPrompt = null;
      if (agentComposer.text.length === 0) agentComposer.text = seed;
    }
  });
</script>

<svelte:window
  onkeydown={(event) => {
    // 有模态（设置面/ContextMeter popover 等）打开时 Esc 归模态所有，不连带收起面板。
    if (event.key === "Escape" && agentPanel.open && !document.querySelector("[role='dialog']")) {
      setAgentPanelOpen(false);
    }
  }}
/>

<aside
  class="flex h-full w-full flex-col border-l border-border bg-background min-[720px]:w-[440px]"
  aria-label="Agent panel"
  ondragover={(event) => event.preventDefault()}
  ondrop={handleComposerDrop}
>
  <AgentHeader />

  <TranscriptView />

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
      <span class="truncate"> Editing — resending keeps your full history (append-only) </span>
      <button
        type="button"
        class="shrink-0 rounded p-0.5 text-amber-700/80 hover:text-amber-700 dark:text-amber-400/80 dark:hover:text-amber-400"
        title="Cancel edit"
        aria-label="Cancel edit"
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
</aside>
