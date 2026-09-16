<!--
  用户原始需求 [2026-09-08]：「我们可以简单理解成，我们在 skill creator 的右侧
  嵌入了一个聊天对话框。」——2026-09-12 redesign §3.3：面板拆分为 AgentHeader /
  TranscriptView / ComposerCard 后，AgentPanel 收敛为容器（drawer 编排 + 数据
  接线），行渲染器与 header 语义见对应组件。——2026-09-13 R17-C：面板常驻挂载
  （开关=收起不销毁，开合不清草稿）；≥720px 宽度可拖拽（320–720px，左缘拖柄，
  sessionStorage 持久）；<720px 抽屉全屏覆盖（收起 translate 退场）。
  正交意图：
  1. shell 级右栏 drawer：≥720px 常驻侧栏（宽度 = agentPanel.width，inline CSS
     var + 媒体断点消费），<720px 单屏覆盖；跨 tab 存活（挂载于 +layout，状态
     在 module store）。Esc 收起（模态打开时让位）；面板级 drop 分流；首次打开
     惰性加载配置；首屏种子注入；resize 拖拽（pointer 捕获
     + window move/up，拖拽中禁 body 选择并关闭 width 过渡保跟手）。
     R17-A：草稿按 sessionId 分轨，挂载/开合不重置（清轨点在 store 侧收窄为
     显式新建与发送成功）。
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
    setAgentPanelWidth,
  } from "$lib/stores/agent.svelte";
  import { connectionState } from "$lib/stores/connection.svelte";
  import { agentComposer } from "$lib/stores/agent-composer.svelte";
  import AgentHeader from "./AgentHeader.svelte";
  import TranscriptView from "./TranscriptView.svelte";
  import DropOverlay from "./DropOverlay.svelte";
  import TodoDock from "./TodoDock.svelte";
  import ComposerCard from "./ComposerCard.svelte";

  // R17-A：不再有挂载重置 effect——草稿按 sessionId 分轨，清轨点收窄为显式新建
  // 与发送成功（均在 store 侧：agent.svelte 挂接）；面板开合/重挂载不清草稿，
  // 与 R17-C「开关=收起不销毁」语义对齐。

  // 惰性加载配置投影（model chip 消费）：面板常驻挂载后以 open 为闸——首次
  // 打开且 view 缺失时补拉（未打开不发 RPC；断线重连由 open 重开驱动）。
  // 走查 P1 修复（2026-09-16）：连接建立前不开闸——requireRpc 未连接时同步抛错
  // 会让 loading/error 在同一 effect 帧内写回，effect_update_depth_exceeded 无限环
  // 杀死整个 app 响应性；status 入依赖后，连接建立/重连本身驱动补拉。
  $effect(() => {
    if (
      agentPanel.open &&
      connectionState.status === "connected" &&
      agentRuntimeConfig.view === null &&
      !agentRuntimeConfig.loading
    ) {
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

  // R17-C 宽屏 resize：左缘拖柄 pointer 序列。宽度经 setAgentPanelWidth clamp
  // + 持久；拖拽中 body 禁选择 + col-resize 光标；resizing 态摘除 width 过渡
  // （否则拖柄滞后跟手）。
  let resizing = $state(false);
  let resizeStartX = 0;
  let resizeStartWidth = 0;

  function startResize(event: PointerEvent): void {
    if (event.button !== 0) return;
    resizing = true;
    resizeStartX = event.clientX;
    resizeStartWidth = agentPanel.width;
    // 指针捕获：移出面板/窗口后 move/up 仍送达本元素（instanceof 兼作 null 收窄）。
    const target = event.currentTarget;
    if (target instanceof HTMLElement) target.setPointerCapture(event.pointerId);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }

  function endResize(): void {
    if (!resizing) return;
    resizing = false;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  }
</script>

<svelte:window
  onkeydown={(event) => {
    // 有模态（设置面/ContextMeter popover 等）打开时 Esc 归模态所有，不连带收起面板。
    if (event.key === "Escape" && agentPanel.open && !document.querySelector("[role='dialog']")) {
      setAgentPanelOpen(false);
    }
  }}
  onpointermove={(event) => {
    if (resizing) setAgentPanelWidth(resizeStartWidth + (resizeStartX - event.clientX));
  }}
  onpointerup={endResize}
  onpointercancel={endResize}
/>

<aside
  class="relative flex h-full w-full flex-col bg-background min-[720px]:w-(--agent-panel-width) min-[720px]:overflow-hidden duration-150 ease-in-out {resizing
    ? ''
    : 'min-[720px]:transition-[width,border-color] max-[720px]:transition-[transform,visibility]'} {agentPanel.open
    ? 'border-l border-border'
    : 'border-l-0 max-[720px]:translate-x-full max-[720px]:invisible'}"
  style="--agent-panel-width: {agentPanel.open ? agentPanel.width : 0}px"
  aria-label="Agent panel"
>
  <!-- W2：document 级拖放（覆盖层 + 全窗落点）接管附件拖放；面板级 ondrop 移除。 -->
  <DropOverlay />
  <!-- 左缘拖柄（仅 ≥720px；窄屏抽屉无侧栏宽度语义）：6px col-resize 命中区，
       hover 高亮。 -->
  <div
    class="absolute inset-y-0 left-0 z-10 hidden w-1.5 cursor-col-resize touch-none select-none hover:bg-primary/30 min-[720px]:block"
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize agent panel"
    onpointerdown={startResize}
  ></div>

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
