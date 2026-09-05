<!--
  用户原始需求 [2026-07-27]：「左侧 ACP 对话面板：连接 agent、发送 prompt、渲染文本回复」。
  正交意图：
  1. agent 选择器：调 rpc.acp.agents.list 探测本机 ACP-capable agent。
  2. 连接：rpc.acp.session.open → sessionId → 打开 /ws/acp/<sessionId>?token=<webToken>。
  3. 收发：浏览器 → agent 方向发送 session/prompt JSON-RPC；agent → 浏览器方向渲染 agent_message_chunk 文本片段。
  4. 断开：unmount 或主动 disconnect 调 rpc.acp.session.close（幂等）。
  视图状态：会话/连接状态 → 组件 $state；agent 子进程状态 → daemon-owned（浏览器仅渲染 WS 推送）。
  妥协声明：仅实现最小 ACP 文本流（connect/send prompt/render text/disconnect），不实现完整 ACP spec
    （tool 调用、权限请求、cancel 等）——daemon 已做 fs 方法安全门，其余帧浏览器原样消费文本。
-->
<script lang="ts">
  import { readWebToken } from "$lib/rpc-client";
  import { requireRpc } from "$lib/store.svelte";
  import { createRequestGenerationGate } from "$lib/stores/request-generation";
  import { getConnectionGeneration } from "$lib/store.svelte";
  import { showToast } from "$lib/toast.svelte";
  import { Button } from "$lib/components/ui/button";
  import IconLoader from "@lucide/svelte/icons/loader-circle";
  import IconPlug from "@lucide/svelte/icons/plug";
  import IconPower from "@lucide/svelte/icons/power";
  import IconSend from "@lucide/svelte/icons/send";
  import IconBot from "@lucide/svelte/icons/bot";
  import IconUser from "@lucide/svelte/icons/user";
  import type { AcpAgentInfo, AcpSessionId } from "$shared/contracts/acp.js";
  import type { WorkspaceProviderTarget } from "$lib/types";

  const { target }: { target: WorkspaceProviderTarget } = $props();

  const connectRequests = createRequestGenerationGate(getConnectionGeneration);

  // agent 探测 + 选择。
  let agents = $state<AcpAgentInfo[]>([]);
  let agentError = $state<string | null>(null);
  let agentsLoading = $state(false);
  let selectedAgentId = $state<string>("");

  // 会话与连接状态。
  let sessionId = $state<AcpSessionId | null>(null);
  let connecting = $state(false);
  let connectionError = $state<string | null>(null);
  let wsState = $state<"idle" | "open" | "closed">("idle");

  // 对话消息（仅渲染，不持久化）。
  interface ChatMessage {
    id: string;
    role: "user" | "agent";
    text: string;
  }
  let messages = $state<ChatMessage[]>([]);
  let pendingAgentText = $state("");
  let promptInput = $state("");
  let sending = $state(false);

  let websocket: WebSocket | null = null;
  /** pending prompt 的 JSON-RPC id，用于关联 result/error 帧。 */
  let pendingId: string | number | null = null;
  /** WS 接收缓冲（ACP 为换行分隔 JSON）。 */
  let wsBuffer = "";

  // 挂载时探测 agent。
  $effect(() => {
    void loadAgents();
  });

  // 卸载/切 target 时主动断开。
  $effect(() => {
    return () => {
      cleanupSocket();
      if (sessionId) {
        void closeSession(sessionId);
      }
    };
  });

  async function loadAgents(): Promise<void> {
    const request = connectRequests.issue();
    agentsLoading = true;
    agentError = null;
    try {
      const result = await requireRpc().acp.agents.list({});
      if (!request.isCurrent()) return;
      agents = result.agents;
      const firstAvailable = result.agents.find((agent) => agent.available);
      if (firstAvailable && !selectedAgentId) {
        selectedAgentId = firstAvailable.id;
      }
    } catch (err) {
      if (!request.isCurrent()) return;
      agentError = err instanceof Error ? err.message : String(err);
    } finally {
      if (request.isLatest()) agentsLoading = false;
    }
  }

  const availableAgents = $derived(agents.filter((agent) => agent.available));
  const connected = $derived(sessionId !== null && wsState === "open");

  async function handleConnect(): Promise<void> {
    if (connecting || connected) return;
    // 从已探测的 agent 列表里取出带 branded id 的条目（避免 string → branded 的 cast）。
    const agent = availableAgents.find((a) => a.id === selectedAgentId);
    if (!agent) {
      showToast("Select an agent first.");
      return;
    }
    const request = connectRequests.issue();
    connecting = true;
    connectionError = null;
    try {
      const open = await requireRpc().acp.session.open({
        agentId: agent.id,
        target,
      });
      if (!request.isCurrent()) {
        // 超时落败：立刻关掉这条 session，避免泄漏子进程。
        void closeSession(open.sessionId);
        return;
      }
      sessionId = open.sessionId;
      openWebSocket(open.sessionId);
    } catch (err) {
      if (!request.isCurrent()) return;
      connectionError = err instanceof Error ? err.message : String(err);
      sessionId = null;
    } finally {
      if (request.isLatest()) connecting = false;
    }
  }

  function openWebSocket(id: AcpSessionId): void {
    const token = readWebToken();
    if (typeof window === "undefined") return;
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const port = window.location.port || (window.location.protocol === "https:" ? "443" : "80");
    const url = `${proto}//${window.location.hostname}:${port}/ws/acp/${encodeURIComponent(
      id,
    )}?token=${encodeURIComponent(token)}`;
    const socket = new WebSocket(url);
    websocket = socket;
    wsBuffer = "";
    socket.onopen = () => {
      if (websocket !== socket) return;
      wsState = "open";
    };
    socket.onmessage = (event) => {
      if (websocket !== socket) return;
      handleWsData(typeof event.data === "string" ? event.data : "");
    };
    socket.onclose = () => {
      if (websocket !== socket) return;
      wsState = "closed";
      websocket = null;
      // 把未完成的 agent 流落盘为一条消息。
      flushPendingAgentText();
    };
    socket.onerror = () => {
      if (websocket !== socket) return;
      connectionError = "Agent connection failed.";
    };
  }

  function handleWsData(raw: string): void {
    if (!raw) return;
    wsBuffer += raw;
    const lines = wsBuffer.split("\n");
    wsBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) handleFrame(trimmed);
    }
  }

  /** 把一帧 JSON-RPC 收窄为可消费结构。 */
  interface JsonRpcFrame {
    jsonrpc?: unknown;
    id?: string | number | null;
    method?: unknown;
    params?: unknown;
    result?: unknown;
    error?: { message?: unknown; code?: unknown } | null;
  }

  function parseFrame(raw: string): JsonRpcFrame | null {
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
    if (typeof value !== "object" || value === null) return null;
    return value as JsonRpcFrame;
  }

  function handleFrame(raw: string): void {
    const frame = parseFrame(raw);
    if (!frame) return;
    // 错误响应：结束 pending prompt。
    if (frame.error) {
      flushPendingAgentText();
      sending = false;
      const message =
        typeof frame.error?.message === "string" ? frame.error.message : "Agent returned an error.";
      showToast(message);
      return;
    }
    // 成功响应：pending prompt 的 result 帧到达，结束本轮发送状态。
    if (frame.result !== undefined && (frame.id !== undefined || pendingId !== null)) {
      if (pendingId !== null && (frame.id === pendingId || frame.id === undefined)) {
        flushPendingAgentText();
        sending = false;
        pendingId = null;
      }
      return;
    }
    // 通知 / 请求：按 method 提取文本片段。
    const method = typeof frame.method === "string" ? frame.method : "";
    const text = extractText(method, frame.params);
    if (text) {
      pendingAgentText += text;
    }
  }

  /** 从 session/update 等通知 params 中尽力抽取 agent 文本片段。 */
  function extractText(method: string, params: unknown): string {
    if (typeof params !== "object" || params === null) return "";
    const record = params as Record<string, unknown>;
    // 常见 ACP 事件命名：session/update、notify/event 等，内嵌 update.content 或 content_part。
    // 这里只做文本提取，方法名仅用于诊断。
    void method;
    return (
      pickText(record.content) ??
      pickText(record.update) ??
      pickText(record.params) ??
      pickText(record.text) ??
      ""
    );
  }

  /** 递归地在候选对象里寻找 text/part 字段，拼接为字符串。 */
  function pickText(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
      let acc = "";
      for (const item of value) {
        const piece = pickText(item);
        if (piece) acc += piece;
      }
      return acc || null;
    }
    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (typeof record.text === "string") return record.text;
      if (typeof record.content === "string") return record.content;
      if (Array.isArray(record.content)) return pickText(record.content);
      if (Array.isArray(record.parts)) return pickText(record.parts);
      // 兼容 agent_message_chunk 风格 { delta: { text } } / { chunk: { text } }。
      if (record.delta && typeof record.delta === "object") return pickText(record.delta);
      if (record.chunk && typeof record.chunk === "object") return pickText(record.chunk);
      return null;
    }
    return null;
  }

  /** 把累积的 agent 文本片段落盘为一条消息。 */
  function flushPendingAgentText(): void {
    if (pendingAgentText.length === 0) return;
    const text = pendingAgentText;
    pendingAgentText = "";
    messages.push({ id: cryptoId(), role: "agent", text });
  }

  function cryptoId(): string {
    return globalThis.crypto.randomUUID();
  }

  async function handleSend(): Promise<void> {
    const text = promptInput.trim();
    if (!text || sending || !connected || !sessionId) return;
    messages.push({ id: cryptoId(), role: "user", text });
    promptInput = "";
    sending = true;
    pendingId = nextRpcId();
    const frame = {
      jsonrpc: "2.0" as const,
      id: pendingId,
      method: "session/prompt",
      params: { prompt: text },
    };
    try {
      websocket?.send(JSON.stringify(frame));
    } catch (err) {
      sending = false;
      pendingId = null;
      showToast(err instanceof Error ? err.message : "Failed to send prompt.");
    }
  }

  let rpcCounter = 0;
  function nextRpcId(): number {
    rpcCounter += 1;
    return rpcCounter;
  }

  async function handleDisconnect(): Promise<void> {
    cleanupSocket();
    if (sessionId) {
      const id = sessionId;
      sessionId = null;
      wsState = "idle";
      await closeSession(id);
    }
  }

  function cleanupSocket(): void {
    if (websocket) {
      websocket.onopen = null;
      websocket.onmessage = null;
      websocket.onclose = null;
      websocket.onerror = null;
      try {
        websocket.close();
      } catch {
        // 忽略重复关闭。
      }
      websocket = null;
    }
    flushPendingAgentText();
    wsBuffer = "";
  }

  async function closeSession(id: AcpSessionId): Promise<void> {
    try {
      await requireRpc().acp.session.close({ sessionId: id });
    } catch {
      // session 已不存在 / daemon 不可达：静默（幂等语义）。
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  }
</script>

<div class="flex h-full flex-col">
  <!-- 头部：agent 选择 + 连接控制 -->
  <div class="shrink-0 space-y-2 border-b border-border px-3 py-2">
    <div class="flex items-center gap-1.5">
      <IconBot class="h-3.5 w-3.5 text-muted-foreground" />
      <span class="text-xs font-medium">AI Conversation</span>
    </div>
    {#if agentError}
      <p class="text-[11px] text-destructive">{agentError}</p>
    {:else if agentsLoading}
      <div class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <IconLoader class="h-3 w-3 animate-spin" /> Detecting agents…
      </div>
    {:else}
      <div class="flex items-center gap-1.5">
        <select
          bind:value={selectedAgentId}
          disabled={connected}
          class="h-7 flex-1 rounded-md border border-input bg-input/20 px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50"
        >
          {#if availableAgents.length === 0}
            <option value="">No agents installed</option>
          {:else}
            {#each availableAgents as agent (agent.id)}
              <option value={agent.id}>{agent.label} ({agent.vendor})</option>
            {/each}
          {/if}
        </select>
        {#if !connected}
          <Button
            size="sm"
            class="h-7 gap-1.5"
            onclick={handleConnect}
            disabled={connecting || availableAgents.length === 0}
          >
            {#if connecting}<IconLoader class="h-3.5 w-3.5 animate-spin" />{:else}<IconPlug
                class="h-3.5 w-3.5"
              />{/if}
            Connect
          </Button>
        {:else}
          <Button variant="outline" size="sm" class="h-7 gap-1.5" onclick={handleDisconnect}>
            <IconPower class="h-3.5 w-3.5" />
            Disconnect
          </Button>
        {/if}
      </div>
      {#if connectionError}
        <p class="text-[11px] text-destructive">{connectionError}</p>
      {/if}
    {/if}
  </div>

  <!-- 消息列表 -->
  <div class="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
    {#if !connected && messages.length === 0}
      <div
        class="flex h-full flex-col items-center justify-center gap-2 text-center text-xs text-muted-foreground"
      >
        <IconBot class="h-6 w-6 opacity-50" />
        <p>Connect an AI agent to write this skill.</p>
        <p class="text-muted-foreground/60">Prompts are sent over the daemon ACP bridge.</p>
      </div>
    {:else}
      {#each messages as message (message.id)}
        <div class="flex gap-2 {message.role === 'user' ? 'flex-row-reverse' : ''}">
          <div
            class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full {message.role ===
            'user'
              ? 'bg-primary/10 text-primary'
              : 'bg-muted text-muted-foreground'}"
          >
            {#if message.role === "user"}
              <IconUser class="h-3 w-3" />
            {:else}
              <IconBot class="h-3 w-3" />
            {/if}
          </div>
          <div
            class="max-w-[85%] whitespace-pre-wrap break-words rounded-md px-2 py-1 text-xs leading-5 {message.role ===
            'user'
              ? 'bg-primary/10 text-foreground'
              : 'bg-muted/40 text-foreground'}"
          >
            {message.text}
          </div>
        </div>
      {/each}
      {#if pendingAgentText}
        <div class="flex gap-2">
          <div
            class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
          >
            <IconBot class="h-3 w-3" />
          </div>
          <div
            class="max-w-[85%] whitespace-pre-wrap break-words rounded-md bg-muted/40 px-2 py-1 text-xs leading-5"
          >
            {pendingAgentText}<span class="animate-pulse">▍</span>
          </div>
        </div>
      {/if}
    {/if}
  </div>

  <!-- 输入区 -->
  <div class="shrink-0 border-t border-border p-2">
    <textarea
      bind:value={promptInput}
      onkeydown={onKeydown}
      rows="2"
      disabled={!connected}
      placeholder={connected
        ? "Send a prompt (Enter to send, Shift+Enter for newline)"
        : "Connect an agent to send prompts"}
      class="w-full resize-y rounded-md border border-input bg-input/20 px-2 py-1 text-xs leading-5 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50"
    ></textarea>
    <div class="mt-1 flex justify-end">
      <Button
        size="sm"
        class="h-7 gap-1.5"
        onclick={handleSend}
        disabled={!connected || sending || promptInput.trim().length === 0}
      >
        {#if sending}<IconLoader class="h-3.5 w-3.5 animate-spin" />{:else}<IconSend
            class="h-3.5 w-3.5"
          />{/if}
        Send
      </Button>
    </div>
  </div>
</div>
