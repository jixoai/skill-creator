<!--
  用户原始需求 [2026-09-12]（redesign §3.4）：「composer 成为 dsh 式卡片
  （rounded-[22px]，纵排：附件条 → textarea → 工具行）。工具行左：模式 chip +
  📎 + 📄；右：model chip + ContextMeter + 34px 圆形主按钮（发送↑/停止■形态机）」。
  修订 [2026-09-12]（PRODUCT_MODEL §5 / codex R1 阻塞 2）：model chip 升级为
  DropdownMenu 按路由分组热切活动模型——只写 settings.model 运行时字段，路由
  配置仍以 Settings→Model 为唯一真源（菜单底部保留跳转入口）。
  修订 [2026-09-12]（codex R2）：模式 chip 由原生 select 改为同族 DropdownMenu
  （design §3.4 `General ▾` 规格）；SlashMenu 落地（§3.4 末段，defer 解除）。
  正交意图：
  1. 输入卡：附件条（图片缩略/文件 chip，与 UserMessage 附件同视觉语言）、
     自动长高 textarea（1 行 44px → 4 行 160px 封顶内滚；Enter 发送 /
     Shift+Enter 换行 / paste 图片沿用）+ SlashMenu 键盘先占与首行光标判定。
  2. 工具行：模式 chip（DropdownMenu 列 DSH_AGENT_MODES、当前项打勾；running
     置灰 + title「Switch after the current turn ends」；无会话 = 以该模式建会
     话）、model chip（agentRuntimeConfig 投影 + effort 点 + 悬空 amber；
     DropdownMenu 按 routes 分组列模型、当前项打勾、选中走
     updateAgentSettings({model}) 只写 model 字段保留 reasoningEffort、running
     整菜单禁用）、ContextMeter（§3.4）、主按钮形态机（空稿禁用 → 发送↑ →
     running 空稿停止■ → running 有稿置灰）。
  妥协声明：SlashMenu 命令注册表当前仅 /compact（结构开放，见 SlashMenu 模块）。
-->
<script module lang="ts">
  import { getRpc } from "$lib/stores/connection.svelte";

  /**
   * 目录 label 缓存（模块级）：菜单组头显示名 = catalog label ?? provider id
   * （与 RouteTabContent 的 label 解析同构）。面板反复开合不重复拉取；未连接/
   * 失败不缓存（下次挂起重试），label 自然回退 provider id。
   */
  let catalogLabelsPromise: Promise<Record<string, string>> | null = null;

  function fetchCatalogLabels(): Promise<Record<string, string>> {
    if (catalogLabelsPromise !== null) return catalogLabelsPromise;
    const rpc = getRpc();
    if (!rpc) return Promise.resolve({});
    catalogLabelsPromise = rpc.agent.models
      .catalog({})
      .then((result) =>
        Object.fromEntries(result.providers.map((entry) => [entry.provider, entry.label])),
      )
      .catch(() => {
        catalogLabelsPromise = null;
        return {} as Record<string, string>;
      });
    return catalogLabelsPromise;
  }
</script>

<script lang="ts">
  import IconPaperclip from "@lucide/svelte/icons/paperclip";
  import IconFile from "@lucide/svelte/icons/file";
  import IconSend from "@lucide/svelte/icons/arrow-up";
  import IconStop from "@lucide/svelte/icons/square";
  import IconChevronDown from "@lucide/svelte/icons/chevron-down";
  import IconCheck from "@lucide/svelte/icons/check";
  import IconX from "@lucide/svelte/icons/x";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import {
    agentComposer,
    addComposerDocs,
    addComposerImages,
    clearComposerEdit,
  } from "$lib/stores/agent-composer.svelte";
  import {
    agentRuntimeConfig,
    agentSession,
    cancelAgentSession,
    createAgentSession,
    sendAgentPrompt,
    setAgentSessionMode,
    updateAgentSettings,
  } from "$lib/stores/agent.svelte";
  import { openSettings } from "$lib/stores/settings-ui.svelte";
  import { showToast } from "$lib/toast.svelte";
  import { DSH_AGENT_MODES, type DshAgentMode } from "$shared/contracts/dsh-runtime.js";
  import ContextMeter from "./ContextMeter.svelte";
  import SlashMenu from "./SlashMenu.svelte";

  let fileInput = $state<HTMLInputElement | null>(null);
  let docInput = $state<HTMLInputElement | null>(null);
  let textareaEl = $state<HTMLTextAreaElement | null>(null);
  /** SlashMenu 实例（textarea 键盘先占）；卡片根 relative，菜单锚定卡上方。 */
  let slashMenu = $state<{ handleKeydown: (event: KeyboardEvent) => boolean } | null>(null);
  /** 光标是否在首行（SlashMenu 锚定条件）。 */
  let caretOnFirstLine = $state(true);

  /** 自动长高：内容驱动，44px（1 行）→ 160px（4 行）封顶内滚。 */
  $effect(() => {
    void agentComposer.text;
    const el = textareaEl;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(160, Math.max(44, el.scrollHeight))}px`;
  });

  /** 首行光标判定（SlashMenu 锚定条件）：稿文变化（含 seed/edit 程序回填）后按
   * 真实 selectionStart 重算（bind:value 的 DOM 写入先于 effect 生效）；纯光标
   * 移动（click/arrow/select）由事件处理器同步同一函数。 */
  $effect(() => {
    void agentComposer.text;
    caretOnFirstLine = caretOnFirstLineNow();
  });

  function caretOnFirstLineNow(): boolean {
    return !agentComposer.text.slice(0, textareaEl?.selectionStart ?? 0).includes("\n");
  }

  const running = $derived(agentSession.status === "running");
  const hasDraft = $derived(
    agentComposer.text.trim().length > 0 ||
      agentComposer.images.length > 0 ||
      agentComposer.files.length > 0,
  );
  const editing = $derived(agentComposer.editing !== null);

  const placeholder = $derived(
    editing
      ? "Edit your message — sending will resend it as a new message"
      : agentSession.sessionId
        ? "Message the agent…"
        : "Pick a mode to start…",
  );

  /** 主按钮形态机（§3.4）：running 空稿 → 停止；running 有稿 → 置灰；否则发送。 */
  const primaryMode = $derived.by(() => {
    if (running && !hasDraft) return "stop" as const;
    if (running) return "wait" as const;
    return "send" as const;
  });

  const modeLabel = $derived(
    DSH_AGENT_MODES.find((entry) => entry.id === agentSession.mode)?.label,
  );

  /** model chip 投影：provider · model + effort 点；活动路由悬空于 Routes 外 = amber。 */
  const modelChip = $derived.by(() => {
    const view = agentRuntimeConfig.view;
    if (!view) return null;
    const model = view.settings.model;
    const dangling = !view.settings.modelRoutes.some((route) => route.provider === model.provider);
    return { label: `${model.provider} · ${model.model}`, effort: model.reasoningEffort, dangling };
  });

  /** 菜单数据：routes 分组（组头 = catalog label ?? provider id）+ 模型清单。 */
  let catalogLabels = $state<Record<string, string>>({});
  let modelMenuOpen = $state(false);
  let modeMenuOpen = $state(false);

  $effect(() => {
    void fetchCatalogLabels().then((labels) => (catalogLabels = labels));
  });

  const routeGroups = $derived.by(() => {
    const view = agentRuntimeConfig.view;
    if (!view) return [];
    const active = view.settings.model;
    return view.settings.modelRoutes.map((route) => {
      const ids = route.models.map((entry) => entry.id);
      // 活动模型可能不在该路由清单内（env 注入等）——仍列出以供对号与切换。
      if (active.provider === route.provider && !ids.includes(active.model)) {
        ids.unshift(active.model);
      }
      return {
        provider: route.provider,
        label: catalogLabels[route.provider] ?? route.provider,
        models: ids,
      };
    });
  });

  function isModelActive(provider: string, model: string): boolean {
    const view = agentRuntimeConfig.view;
    return (
      view !== null &&
      view.settings.model.provider === provider &&
      view.settings.model.model === model
    );
  }

  /**
   * 热切活动模型（PRODUCT_MODEL §5）：只写 settings.model 运行时字段（保留
   * reasoningEffort），绝不触碰路由字段——路由配置唯一真源仍是 Settings→Model。
   */
  async function selectModel(provider: string, model: string): Promise<void> {
    const effort = agentRuntimeConfig.view?.settings.model.reasoningEffort;
    const result = await updateAgentSettings({
      model: {
        provider,
        model,
        ...(effort !== undefined && effort.length > 0 ? { reasoningEffort: effort } : {}),
      },
    });
    if (!result) return;
    if (result.outcome === "rejected") {
      showToast(`${result.code}: ${result.detail}`);
      return;
    }
    if (result.outcome === "error") {
      showToast(result.message);
      return;
    }
    showToast(`Active model → ${provider} · ${model}`);
  }

  function submit(): void {
    const text = agentComposer.text.trim();
    if (
      text.length === 0 &&
      agentComposer.images.length === 0 &&
      agentComposer.files.length === 0
    ) {
      return;
    }
    if (agentSession.sending) return;
    const images = agentComposer.images;
    const files = agentComposer.files;
    agentComposer.text = "";
    agentComposer.images = [];
    agentComposer.files = [];
    clearComposerEdit();
    void sendAgentPrompt(text, images, files);
  }

  /** 取消编辑：退出 editing 态并清空回填文本（append-only 语义下不撤回原消息）。 */
  function cancelEdit(): void {
    if (agentComposer.editing !== null) agentComposer.text = "";
    clearComposerEdit();
  }

  /** 模式切换：无会话 = 以该模式建会话（空态卡等价第二入口）；running 拒绝。 */
  function onModeChange(mode: DshAgentMode): void {
    if (!agentSession.sessionId) {
      void createAgentSession(undefined, mode);
      return;
    }
    void setAgentSessionMode(mode);
  }

  /** SlashMenu 执行（§3.4）：以命令文本发送（丢弃查询草稿与附件，不进入对话正文）。 */
  function executeSlashCommand(command: string): void {
    if (agentSession.sending) return;
    agentComposer.text = "";
    agentComposer.images = [];
    agentComposer.files = [];
    clearComposerEdit();
    void sendAgentPrompt(command);
  }

  function onKeydown(event: KeyboardEvent): void {
    // SlashMenu 先占导航/执行/驳回键（打开时）；其 handleKeydown 内部已
    // stopPropagation，Esc 不会冒泡到 AgentPanel 的 window 级面板收起。
    if (slashMenu?.handleKeydown(event)) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  /** 光标移动（无稿文变化）路径的首行判定同步（click/arrow/select）。 */
  function syncCaret(): void {
    caretOnFirstLine = caretOnFirstLineNow();
  }

  function onPaste(event: ClipboardEvent): void {
    const files = [...(event.clipboardData?.files ?? [])].filter((file) =>
      file.type.startsWith("image/"),
    );
    if (files.length > 0) {
      event.preventDefault();
      void addComposerImages(files);
    }
  }
</script>

<div
  class="relative mx-3 mb-3 flex shrink-0 flex-col rounded-[22px] border border-border bg-card shadow-sm"
>
  <SlashMenu
    text={agentComposer.text}
    {caretOnFirstLine}
    onExecute={executeSlashCommand}
    bind:this={slashMenu}
  />
  {#if agentComposer.files.length > 0 || agentComposer.images.length > 0}
    <!-- 附件条：与转录 UserMessage 附件行同视觉语言（56×56 缩略 / 文件 chip）。 -->
    <div class="flex flex-wrap gap-1.5 px-3 pt-3" aria-label="Pending attachments">
      {#each agentComposer.images as attachment, index (index)}
        <div class="group relative h-14 w-14 overflow-hidden rounded-lg border border-border">
          <img
            src={attachment.preview}
            alt={attachment.name ?? "image"}
            class="h-full w-full object-cover"
          />
          <button
            type="button"
            class="absolute top-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-background/80 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
            aria-label="Remove attachment"
            onclick={() =>
              (agentComposer.images = agentComposer.images.filter((_, i) => i !== index))}
          >
            <IconX class="h-2.5 w-2.5" />
          </button>
        </div>
      {/each}
      {#each agentComposer.files as file, index (index)}
        <span
          class="flex items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[10px]"
        >
          📄 {file.name}
          <button
            type="button"
            class="text-muted-foreground hover:text-destructive"
            aria-label="Remove file {file.name}"
            onclick={() =>
              (agentComposer.files = agentComposer.files.filter((_, i) => i !== index))}
          >
            ×
          </button>
        </span>
      {/each}
    </div>
  {/if}
  <textarea
    bind:this={textareaEl}
    rows={1}
    maxlength={20000}
    {placeholder}
    disabled={!agentSession.sessionId}
    bind:value={agentComposer.text}
    onkeydown={onKeydown}
    onkeyup={syncCaret}
    onclick={syncCaret}
    onselect={syncCaret}
    onpaste={onPaste}
    class="msg-body max-h-40 w-full resize-none bg-transparent px-3.5 py-2.5 outline-none placeholder:text-muted-foreground disabled:opacity-50"
    aria-label="Message"></textarea>
  <div class="flex h-11 items-center gap-1 px-2.5">
    <!-- 左簇：模式 chip + 图片 + 文件 -->
    <DropdownMenu.DropdownMenu bind:open={modeMenuOpen}>
      <DropdownMenu.Trigger
        class="flex h-7 max-w-[130px] items-center gap-1.5 rounded-full border border-border px-2.5 text-[11px] text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        title={running
          ? "Switch after the current turn ends"
          : agentSession.sessionId
            ? "Switch this session's mode"
            : "Start a session in this mode"}
        aria-label="Session mode"
        disabled={running}
        onkeydown={(event) => {
          // 鼠标打开的 bits-ui 菜单焦点留在 trigger：Esc 在此（target 层）先占，
          // 阻断冒泡到 AgentPanel 的 window-Escape，并受控收起菜单。
          if (event.key === "Escape" && modeMenuOpen) {
            event.stopPropagation();
            modeMenuOpen = false;
          }
        }}
      >
        <span class="truncate">{modeLabel ?? "Mode"}</span>
        <IconChevronDown class="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <!-- Content 仅在本菜单 open 时挂载（bits-ui 本就如此；显式门控让菜单内容
           的存在与 modeMenuOpen 同步——测试桩的开合态是共享单例，无门控时模式
           菜单内容会先于 model 菜单落 DOM，干扰既有 model chip 组件测试）。 -->
      {#if modeMenuOpen}
        <DropdownMenu.Content
          align="start"
          class="max-h-72 w-44 overflow-y-auto"
          onkeydown={(event) => {
            // 菜单打开时 Esc 归菜单所有（与 model chip 同语义）：阻止冒泡到
            // AgentPanel 的 window-Escape，并显式落 open=false 走受控关闭。
            if (event.key === "Escape") {
              event.stopPropagation();
              modeMenuOpen = false;
            }
          }}
        >
          {#each DSH_AGENT_MODES as entry (entry.id)}
            <DropdownMenu.Item
              data-mode-active={agentSession.mode === entry.id ? "true" : undefined}
              class="gap-1.5"
              onclick={() => onModeChange(entry.id)}
            >
              <span class="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                {#if agentSession.mode === entry.id}
                  <IconCheck class="h-3 w-3" aria-hidden="true" />
                {/if}
              </span>
              <span class="truncate">{entry.label}</span>
            </DropdownMenu.Item>
          {/each}
        </DropdownMenu.Content>
      {/if}
    </DropdownMenu.DropdownMenu>
    <input
      bind:this={fileInput}
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif"
      multiple
      class="hidden"
      aria-label="Attach images"
      onchange={(event) => {
        if (event.currentTarget.files) void addComposerImages(event.currentTarget.files);
        event.currentTarget.value = "";
      }}
    />
    <button
      type="button"
      class="relative flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors after:absolute after:-inset-1.5 after:content-[''] hover:bg-muted hover:text-foreground disabled:opacity-50"
      title="Attach images (or paste / drop)"
      aria-label="Attach images"
      disabled={!agentSession.sessionId}
      onclick={() => fileInput?.click()}
    >
      <IconPaperclip class="h-4 w-4" />
    </button>
    <input
      bind:this={docInput}
      type="file"
      multiple
      class="hidden"
      aria-label="Attach files"
      onchange={(event) => {
        if (event.currentTarget.files) void addComposerDocs(event.currentTarget.files);
        event.currentTarget.value = "";
      }}
    />
    <button
      type="button"
      class="relative flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors after:absolute after:-inset-1.5 after:content-[''] hover:bg-muted hover:text-foreground disabled:opacity-50"
      title="Attach a file (text, config, data — ≤512KiB)"
      aria-label="Attach file"
      disabled={!agentSession.sessionId}
      onclick={() => docInput?.click()}
    >
      <IconFile class="h-4 w-4" />
    </button>
    <div class="flex-1"></div>
    <!-- 右簇：model chip + ContextMeter + 主按钮 -->
    {#if modelChip}
      <DropdownMenu.DropdownMenu bind:open={modelMenuOpen}>
        <DropdownMenu.Trigger
          class="flex h-7 max-w-[150px] items-center gap-1.5 rounded-full border px-2.5 text-[11px] transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 {modelChip.dangling
            ? 'border-amber-500/60 text-amber-600 dark:text-amber-400'
            : 'border-border text-muted-foreground hover:text-foreground'}"
          title={running
            ? "Switch after the current turn ends"
            : "Switch the active model — route configuration lives in Settings → Model"}
          aria-label="Switch active model"
          disabled={running}
          onkeydown={(event) => {
            // 同模式 chip：Esc 在 trigger（target 层）先占，不冒泡收起整个面板。
            if (event.key === "Escape" && modelMenuOpen) {
              event.stopPropagation();
              modelMenuOpen = false;
            }
          }}
        >
          <span class="truncate">{modelChip.label}</span>
          {#if modelChip.effort}
            <span
              class="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
              title={`Reasoning effort: ${modelChip.effort}`}
            ></span>
          {/if}
          <IconChevronDown class="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content
          align="end"
          class="max-h-72 w-56 overflow-y-auto"
          onkeydown={(event) => {
            // 菜单打开时 Esc 归菜单所有：阻止冒泡到 AgentPanel 的 window-Escape
            //（否则一次 Esc 连带收起整个面板；ContextMeter popover 用 role=dialog
            // 达成同一语义，菜单 role=menu 只能在此拦截）。stopPropagation 同时
            // 挡掉 bits-ui 的 bubble 层关闭——故显式落 open=false 走受控关闭。
            if (event.key === "Escape") {
              event.stopPropagation();
              modelMenuOpen = false;
            }
          }}
        >
          {#if modelChip.dangling}
            <DropdownMenu.Label
              data-dangling="true"
              class="px-2 py-1.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
            >
              {modelChip.label} — outside Routes
            </DropdownMenu.Label>
            <DropdownMenu.Separator />
          {/if}
          {#each routeGroups as group (group.provider)}
            <DropdownMenu.Group>
              <DropdownMenu.GroupHeading class="px-2 py-1 text-[10px] font-medium">
                {group.label}
              </DropdownMenu.GroupHeading>
              {#each group.models as id (id)}
                <DropdownMenu.Item
                  data-model-active={isModelActive(group.provider, id) ? "true" : undefined}
                  class="gap-1.5"
                  onclick={() => void selectModel(group.provider, id)}
                >
                  <span class="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                    {#if isModelActive(group.provider, id)}
                      <IconCheck class="h-3 w-3" aria-hidden="true" />
                    {/if}
                  </span>
                  <span class="truncate">{id}</span>
                </DropdownMenu.Item>
              {/each}
            </DropdownMenu.Group>
            <DropdownMenu.Separator />
          {/each}
          <DropdownMenu.Item onclick={() => openSettings("model")}>
            Open settings →
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.DropdownMenu>
    {/if}
    <ContextMeter />
    <button
      type="button"
      class="relative flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full transition-colors after:absolute after:-inset-0.5 after:content-[''] {primaryMode ===
      'stop'
        ? 'bg-destructive text-white hover:bg-destructive/90'
        : primaryMode === 'wait'
          ? 'bg-muted text-muted-foreground'
          : 'bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50'}"
      aria-label={primaryMode === "stop" ? "Cancel current activity" : "Send message"}
      title={primaryMode === "stop"
        ? "Cancel current activity"
        : primaryMode === "wait"
          ? "Wait for the current turn"
          : "Send (Enter)"}
      disabled={primaryMode !== "stop" &&
        (!agentSession.sessionId || !hasDraft || agentSession.sending)}
      onclick={() => (primaryMode === "stop" ? void cancelAgentSession() : submit())}
    >
      {#if primaryMode === "stop"}
        <IconStop class="h-3 w-3" />
      {:else}
        <IconSend class="h-4 w-4" />
      {/if}
    </button>
  </div>
</div>
