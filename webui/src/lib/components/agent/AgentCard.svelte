<!--
  用户原始需求 [2026-09-08]（tasks 4.2）：「ui:// MCP Apps 卡片……均含应用内跳转意图」。
  正交意图：
  1. 沙箱 iframe 渲染：agent.card.get 代理拉取 ui:// HTML，sandbox（无 allow-same-
     origin/allow-top-navigation）+ srcdoc 呈现；不可信文本的转义在 server 模板层。
  2. postMessage 导航：卡片按钮 → ui/navigate 意图 → host 翻译为 shell 路由。
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
      | { source?: string; type?: string; intent?: string }
      | undefined;
    if (
      typeof data === "object" &&
      data !== null &&
      data.source === "skill-creator-card" &&
      data.type === "ui/navigate" &&
      typeof data.intent === "string" &&
      data.intent.startsWith("/")
    ) {
      void goto(data.intent);
    }
  }
</script>

<svelte:window onmessage={onMessage} />

<div class="my-1 overflow-hidden rounded-lg border border-border" data-card-uri={resourceUri}>
  {#if html !== null}
    <iframe
      title={title}
      srcdoc={html}
      sandbox=""
      class="h-44 w-full border-0 bg-transparent"
      loading="lazy"
    ></iframe>
  {:else if failed}
    <div class="px-3 py-2 text-[11px] text-muted-foreground">Card unavailable: {title}</div>
  {:else}
    <div class="px-3 py-2 text-[11px] text-muted-foreground" role="status">Loading card…</div>
  {/if}
</div>
