<!--
  用户原始需求 [2026-09-08]（tasks 4.2）：「ui:// MCP Apps 卡片……均含应用内跳转意图」。
  正交意图：
  1. 沙箱 iframe 渲染：agent.card.get 代理拉取 ui:// HTML，sandbox="allow-scripts"
     （脚本启用以支撑 resize/导航 postMessage；无 allow-same-origin —— 不透明源，
     不能触 parent DOM/storage，无 top-navigation/popups）+ srcdoc 呈现；
     不可信文本的转义在 server 模板层。
  2. postMessage 导航/高度：卡片按钮 → ui/navigate 意图 → host 翻译为 shell 路由；
     卡片 ui/resize 广播内容高度，host 夹取后收敛 iframe（消除固定高度空白）。
  妥协声明：无。
-->
<script lang="ts">
  import { goto } from "$app/navigation";
  import { requireRpc } from "$lib/stores/connection.svelte";

  let {
    resourceUri,
    title,
  }: {
    resourceUri: string;
    title: string;
  } = $props();

  let html = $state<string | null>(null);
  let failed = $state(false);
  // 卡片内容高度（px）：收到 ui/resize 前用 h-44 兜底，避免空白/截断。
  let frameHeight = $state<number | null>(null);
  // 卡片 iframe 元素引用：onMessage 按 event.source === contentWindow 过滤——
  // 所有 AgentCard 共享 window message 事件，不过滤会互相覆盖高度。
  let frameEl = $state<HTMLIFrameElement | null>(null);

  $effect(() => {
    const uri = resourceUri;
    html = null;
    failed = false;
    requireRpc()
      .agent.card.get({ uri })
      .then((result) => {
        if (result.html === null) {
          failed = true;
          return;
        }
        html = result.html;
      })
      .catch(() => {
        failed = true;
      });
  });

  function onMessage(event: MessageEvent): void {
    const data = event.data as
      | { source?: string; type?: string; intent?: string; height?: unknown }
      | undefined;
    if (typeof data !== "object" || data === null || data.source !== "skill-creator-card") return;
    if (frameEl === null || event.source !== frameEl.contentWindow) return;
    if (
      data.type === "ui/navigate" &&
      typeof data.intent === "string" &&
      data.intent.startsWith("/") &&
      !data.intent.startsWith("//")
    ) {
      void goto(data.intent);
      return;
    }
    if (data.type === "ui/resize") {
      const height = Number(data.height);
      if (Number.isFinite(height) && height > 0) {
        frameHeight = Math.min(400, Math.max(40, Math.ceil(height)));
      }
    }
  }

  /**
   * srcdoc 只经此 action 以 property 同步落地：Svelte 模板对动态 srcdoc 走延迟
   * template_effect 挂载，该路径下沙箱脚本不执行（实测）；同步 property 赋值
   * （对齐 createElement+appendChild 可行路径）稳定启用卡片脚本。
   */
  function replaySrcdoc(el: HTMLIFrameElement, doc: string) {
    el.srcdoc = doc;
    return {
      update(next: string): void {
        el.srcdoc = next;
      },
    };
  }
</script>

<svelte:window onmessage={onMessage} />

<div class="my-1 overflow-hidden rounded-lg border border-border" data-card-uri={resourceUri}>
  {#if html !== null}
    <iframe
      bind:this={frameEl}
      {title}
      sandbox="allow-scripts"
      use:replaySrcdoc={html}
      class="w-full border-0 bg-transparent {frameHeight === null ? 'h-44' : ''}"
      style={frameHeight !== null ? `height:${frameHeight}px` : undefined}
    ></iframe>
  {:else if failed}
    <div class="px-3 py-2 text-[11px] text-muted-foreground">Card unavailable: {title}</div>
  {:else}
    <div class="px-3 py-2 text-[11px] text-muted-foreground" role="status">Loading card…</div>
  {/if}
</div>
