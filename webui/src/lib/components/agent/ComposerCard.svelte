<!--
  用户原始需求 [2026-09-12]（redesign §3.4）：「composer 成为 dsh 式卡片
  （rounded-[22px]，纵排：附件条 → textarea → 工具行）。工具行左：模式 chip +
  📎 + 📄；右：model chip + ContextMeter + 34px 圆形主按钮（发送↑/停止■形态机）」。
  修订 [2026-09-12]（PRODUCT_MODEL §5 / codex R1 阻塞 2）：model chip 升级为
  DropdownMenu 按路由分组热切活动模型——只写 settings.model 运行时字段，路由
  配置仍以 Settings→Model 为唯一真源（菜单底部保留跳转入口）。
  修订 [2026-09-12]（codex R2）：模式 chip 由原生 select 改为同族 DropdownMenu
  （design §3.4 `General ▾` 规格）；SlashMenu 落地（§3.4 末段，defer 解除）。
  修订 [2026-09-12]（R12-B 6/8）：New Session 态的显示模式 = agentSession.pendingMode
  （与空态模式卡同一数据源，双向同步，默认 General）；chip 在无会话时只改选择，
  不再 eager 建会话——首条消息发出时才创建（textarea/附件/发送在空态可用）。
  修订 [2026-09-12]（R14-B 3/4/5）：textarea focus 轮廓显式 reset（UA :focus
  outline 穿透，agent-flow.css `.msg-body` 作者源规则兜底）；附件按钮语义化
  （image/file-up 图标 + 语义 tooltip/aria-label，替代 paperclip/file 混淆）；
  `$` 前缀激发 skill 名补全（SkillMenu，与 SlashMenu 同 TriggerMenu 语法）。
  修订 [2026-09-13]（R17-A）：提交点不再清草稿——草稿按 sessionId 分轨，
  发送成功由 sendAgentPrompt 清当前轨（失败留在原轨可重试）；草稿随会话
  切换换轨（store 侧），本组件对 bind 的 facade 不变。
  修订 [2026-09-14]（R18 用户裁决）：附件按钮唤醒 **native** file-picker——
  daemon 子进程 @xmorse/rfd sync pickFiles（真实路径直返，无 web 弹层）；
  粘贴/drop 的本地 File 通道保留（无真实路径，base64 wire）。
  正交意图：
  1. 输入卡：附件条（图片缩略/文件 chip，与 UserMessage 附件同视觉语言）、
     自动长高 textarea（1 行 44px → 4 行 160px 封顶内滚；Enter 发送 /
     Shift+Enter 换行 / paste 图片沿用）+ SlashMenu/SkillMenu 键盘先占与
     首行光标判定（`$name ` 补全插入 = 替换光标前 token + 尾随空格）。
  2. 工具行：模式 chip（DropdownMenu 列 DSH_AGENT_MODES、当前项打勾；running
     置灰 + title「Switch after the current turn ends」；无会话 = 只更新
     pendingMode（R12：首条消息惰性建会话））、model chip（agentRuntimeConfig 投影 + effort 点 + 悬空 amber；
     DropdownMenu 按 routes 分组列模型、当前项打勾、选中走
     updateAgentSettings({model}) 只写 model 字段保留 reasoningEffort、running
     整菜单禁用）、ContextMeter（§3.4）、主按钮形态机（空稿禁用 → 发送↑ →
     running 空稿停止■ → running 有稿置灰）。
  妥协声明：SlashMenu 命令注册表当前仅 /compact（结构开放，见 SlashMenu 模块）。
-->
<script module lang="ts">
  import { getRpc } from "$lib/stores/connection.svelte";
  import { avatarHue } from "$lib/components/settings/route-icon.js";

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
  import IconImage from "@lucide/svelte/icons/image";
  import IconPlus from "@lucide/svelte/icons/plus";
  import IconFileUp from "@lucide/svelte/icons/file-up";
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
    addPickedComposerDocs,
    addPickedComposerImages,
    attachmentReads,
    clearComposerEdit,
  } from "$lib/stores/agent-composer.svelte";
  import {
    agentRuntimeConfig,
    agentSession,
    agentSessionsList,
    cancelAgentSession,
    sendAgentPrompt,
    setAgentSessionMode,
    updateAgentSettings,
    pickAgentFiles,
    hydratePickedImagePreviews,
  } from "$lib/stores/agent.svelte";
  import { connectionState } from "$lib/stores/connection.svelte";
  import {
    composerPlaceholder,
    containsChipPlaceholders,
    enterIsComposing,
    sanitizeComposerText,
  } from "./composer-keymap.js";
  import {
    claimOnSpace,
    claimSurvives,
    stripClaimedToken,
    type TriggerClaim,
  } from "./composer-trigger.js";
  import { INPUT_TAKING_TOKENS } from "./SlashMenu.svelte";
  import { openSettings } from "$lib/stores/settings-ui.svelte";
  import { showToast } from "$lib/toast.svelte";
  import { DSH_AGENT_MODES, type DshAgentMode } from "$shared/contracts/dsh-runtime.js";
  import ContextMeter from "./ContextMeter.svelte";
  import SlashMenu from "./SlashMenu.svelte";

  let textareaEl = $state<HTMLTextAreaElement | null>(null);
  /** SlashMenu 实例（W3 统一 `/` 触发：命令 + 技能单实例）；卡片根 relative，
   * 菜单锚定卡上方。 */
  let slashMenu = $state<{ handleKeydown: (event: KeyboardEvent) => boolean } | null>(null);
  /** 光标是否在首行（SlashMenu 锚定条件）。 */
  let caretOnFirstLine = $state(true);

  /** W3 claim 态（input-taking 命令；首版目录无此类命令，机器就绪）：draft
   *  前缀保持 claim 存活——退格删掉 token 即退出；Space 落 claim（官方
   *  matchSpace 同步裁决）。claimed 态压制 `/` 触发菜单。 */
  let claim = $state<TriggerClaim | null>(null);
  $effect(() => {
    void agentComposer.text;
    claim =
      claimSurvives(claim, agentComposer.text) ??
      claimOnSpace(agentComposer.text, INPUT_TAKING_TOKENS);
  });

  /** W3 `+` 编程式启动器：无 query 全量展开统一菜单（官方 + 按钮同语义）。 */
  let launcherOpen = $state(false);

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

  /** 主按钮形态机（§3.4）：running 空稿 → 停止；running 有稿 → 置灰；否则发送。 */
  const primaryMode = $derived.by(() => {
    if (running && !hasDraft) return "stop" as const;
    if (running) return "wait" as const;
    return "send" as const;
  });

  /** 显示态模式（R12-B 6）：会话内 = agentSession.mode；New Session 态 =
   * pendingMode——空态模式卡与 chip 双向同步的唯一数据源。 */
  const activeMode = $derived(
    agentSession.sessionId ? agentSession.mode : agentSession.pendingMode,
  );

  const modeLabel = $derived(DSH_AGENT_MODES.find((entry) => entry.id === activeMode)?.label);

  /** 占位符链（W1）：owner（编辑态）> disconnected > unavailable > mode > 默认；
   *  连接态来自 shell 级 connection store（断线时输入面给出人话提示）。 */
  const placeholder = $derived(
    composerPlaceholder({
      owner: editing ? "Edit your message — sending will resend it as a new message" : null,
      disconnected: connectionState.status === "disconnected",
      unavailable: agentSession.error !== null && agentSession.sessionId === null,
      modeLabel: modeLabel ?? null,
    }),
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
      const label = catalogLabels[route.provider] ?? route.provider;
      return {
        provider: route.provider,
        label,
        // R7 8.2：组头字母 chip 统一走 route.iconLetter ?? 首字母 + iconColor。
        letter: route.iconLetter ?? label.slice(0, 1).toUpperCase(),
        color: route.iconColor ?? `hsl(${avatarHue(route.provider)} 55% 45%)`,
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
    // W3：input-taking 命令的 claim token 在提交点剥离（官方 argsAfter 同法；
    //  首版目录无此类命令——strip 是 passthrough，机器就绪）。
    const text = stripClaimedToken(agentComposer.text.trim(), claim).trim();
    if (
      text.length === 0 &&
      agentComposer.images.length === 0 &&
      agentComposer.files.length === 0
    ) {
      return;
    }
    if (agentSession.sending) return;
    // W2 发送门控（官方 still-uploading 语义的适配面）：附件 base64 读入进行
    // 中时保持提交（读入完成即可重发），草稿与附件原样保留。
    if (attachmentReads.pending > 0) {
      showToast("Attachments are still being read — try again in a moment.");
      return;
    }
    // R17-A：提交点不清草稿——发送成功由 sendAgentPrompt 清当前轨（清轨点收窄）；
    // 发送失败草稿留在当前会话轨，可直接修改重试。
    awaitingSendClear = true;
    void sendAgentPrompt(text, agentComposer.images, agentComposer.files);
  }

  /** 撤销纪律（W1，官方 undo-cut-after-send 的 textarea 等价）：发送成功清轨时
   *  递增 sendEpoch 重建 textarea 元素——原生 undo 栈随之丢弃，Cmd+Z 不能
   *  复活已发送内容；发送失败草稿保留（epoch 不动，undo 语义不受影响）。 */
  let sendEpoch = $state(0);
  let awaitingSendClear = false;
  $effect(() => {
    if (!awaitingSendClear) return;
    if (agentComposer.text === "") {
      awaitingSendClear = false;
      sendEpoch += 1;
    }
  });

  /** 取消编辑：退出 editing 态并清空回填文本（append-only 语义下不撤回原消息）。 */
  function cancelEdit(): void {
    if (agentComposer.editing !== null) agentComposer.text = "";
    clearComposerEdit();
  }

  let picking = $state(false);

  /**
   * R18 用户裁决：「在后端（nodejs）这边，唤醒 native 级别的 file-picker」——
   * 附件按钮直调 agent.files.pickFiles（daemon 子进程 sync 对话框），
   * 返回真实路径后进对应附件通道（数量守卫在 store）。取消静默；失败在
   * store 层 toast（2.0.1：失败必须可感知）。
   */
  async function openPicker(target: "image" | "file"): Promise<void> {
    if (picking) return;
    picking = true;
    try {
      const result = await pickAgentFiles(target);
      if (result === null || result.paths.length === 0) return;
      // name 从真实路径派生 basename（codex R18 P1：UI chip/移除按钮/live 回显
      // 都需要可读文件名；path 可能以 / 结尾的场景先剥再取）。
      const picks = result.paths.map((path) => ({
        path,
        // 跨平台 basename：正斜杠/反斜杠都取末段（Windows 路径含 \\）。
        name: path.split(/[\\/]/).filter(Boolean).pop() ?? path,
      }));
      if (target === "image") {
        addPickedComposerImages(picks);
        // 缩略回填（2026-09-15 修复）：不阻塞选择返回——chip 先落图标占位，
        // daemon jSquash 缩略到达后逐条升级为真实缩略图。
        void hydratePickedImagePreviews(picks);
      } else {
        addPickedComposerDocs(picks);
      }
    } finally {
      picking = false;
    }
  }

  /** 模式切换（R12-B 6/8）：无会话 = 预选待建模式（pendingMode，与空态卡同步），
   * 不建会话——创建只发生在首条消息；有会话 = setMode（running 拒绝沿用）。 */
  function onModeChange(mode: DshAgentMode): void {
    if (!agentSession.sessionId) {
      agentSession.pendingMode = mode;
      return;
    }
    void setAgentSessionMode(mode);
  }

  /** SlashMenu 命令执行（§3.4）：以命令文本发送（丢弃查询草稿与附件，不进入
   *  对话正文）；`+` 启动器随选关闭。 */
  function executeSlashCommand(command: string): void {
    launcherOpen = false;
    if (agentSession.sending) return;
    agentComposer.text = "";
    agentComposer.images = [];
    agentComposer.files = [];
    clearComposerEdit();
    void sendAgentPrompt(command);
  }

  /** 技能选中（W3：`/name ` 纯文本落点，官方 ui-skill 同法）：替换稿文
   *  [0, 光标) 的未完成 token；尾随空格让 query 脱离所有候选，菜单自然收起。 */
  function insertSkillToken(token: string): void {
    launcherOpen = false;
    const el = textareaEl;
    const caret = Math.min(
      el?.selectionStart ?? agentComposer.text.length,
      agentComposer.text.length,
    );
    agentComposer.text = `${token} ${agentComposer.text.slice(caret)}`;
    const next = Math.min(token.length + 1, agentComposer.text.length);
    // bind:value 的 DOM 写入在 flush 后生效，光标在下一帧对齐 token + 空格之后。
    requestAnimationFrame(() => {
      el?.setSelectionRange(next, next);
      caretOnFirstLine = caretOnFirstLineNow();
    });
  }

  function onKeydown(event: KeyboardEvent): void {
    // SlashMenu（W3 统一实例：命令 + 技能）先占导航/执行/驳回键；其
    // handleKeydown 内部已 stopPropagation，Esc 不会冒泡到 AgentPanel 的
    // window 级面板收起。
    if (slashMenu?.handleKeydown(event)) return;
    if (event.key === "Enter" && !event.shiftKey) {
      // W1（composer-capability-parity）：IME 合成语境的 Enter 不提交不断行
      // （isComposing + keyCode 229 + compositionend 后 10ms 宽限——中文输入
      // 的确认 Enter 曾被误提交，官方 keymap 同判定序）；长按 repeat 不连发。
      if (event.repeat) {
        event.preventDefault();
        return;
      }
      if (enterIsComposing(event, lastCompositionEndAt)) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      submit();
    }
  }

  /** IME 合成窗口（W1）：compositionend 时间戳——Safari 的收尾 keydown 晚于
   *  compositionend，10ms 宽限内 Enter 仍视为合成中。 */
  let lastCompositionEndAt: number | null = null;
  let composing = $state(false);

  function onCompositionStart(): void {
    composing = true;
  }

  function onCompositionEnd(): void {
    composing = false;
    lastCompositionEndAt = Date.now();
  }

  /** 光标移动（无稿文变化）路径的首行判定同步（click/arrow/select）。 */
  function syncCaret(): void {
    caretOnFirstLine = caretOnFirstLineNow();
  }

  function onPaste(event: ClipboardEvent): void {
    const files = [...(event.clipboardData?.files ?? [])];
    if (files.length > 0) {
      event.preventDefault();
      // W1：粘贴文件项统一路由（官方 keymap 语义；守卫沿用 store 双通道）。
      const images = files.filter((file) => file.type.startsWith("image/"));
      const docs = files.filter((file) => !file.type.startsWith("image/"));
      if (images.length > 0) void addComposerImages(images);
      if (docs.length > 0) void addComposerDocs(docs);
      return;
    }
    // 文本粘贴消毒（W1）：含芯片占位字符（U+E100–E11D/U+FFFC）时手工插入
    // 消毒文本，外部文本不得伪造芯片身份。
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (containsChipPlaceholders(text)) {
      event.preventDefault();
      insertSanitizedText(sanitizeComposerText(text));
    }
  }

  /** 消毒文本在光标处插入（覆盖选区；官方 PASTE 语义的 textarea 等价）。 */
  function insertSanitizedText(text: string): void {
    const el = textareaEl;
    if (!el) {
      agentComposer.text = sanitizeComposerText(agentComposer.text + text);
      return;
    }
    const start = el.selectionStart ?? agentComposer.text.length;
    const end = el.selectionEnd ?? start;
    agentComposer.text = agentComposer.text.slice(0, start) + text + agentComposer.text.slice(end);
    const caret = start + text.length;
    requestAnimationFrame(() => el?.setSelectionRange(caret, caret));
  }
</script>

<div
  class="relative mx-3 mb-3 flex shrink-0 flex-col rounded-[22px] border border-border bg-card shadow-sm"
>
  <SlashMenu
    text={agentComposer.text}
    {caretOnFirstLine}
    onExecute={executeSlashCommand}
    onInsertSkill={insertSkillToken}
    suppress={claim !== null}
    forcedOpen={launcherOpen}
    onForceClose={() => (launcherOpen = false)}
    bind:this={slashMenu}
  />
  {#if agentComposer.files.length > 0 || agentComposer.images.length > 0}
    <!-- 附件条：与转录 UserMessage 附件行同视觉语言（56×56 缩略 / 文件 chip）；
         path 通道无缩略（webp/gif）时以图标 tile 占位（R17-B）。 -->
    <div class="flex flex-wrap gap-1.5 px-3 pt-3" aria-label="Pending attachments">
      {#each agentComposer.images as attachment, index (index)}
        <div class="group relative h-14 w-14 overflow-hidden rounded-lg border border-border">
          {#if attachment.preview}
            <img
              src={attachment.preview}
              alt={attachment.name ?? "image"}
              class="h-full w-full object-cover"
            />
          {:else}
            <div
              class="flex h-full w-full items-center justify-center bg-muted/40"
              title={attachment.path ?? attachment.name ?? "image"}
            >
              <IconImage class="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            </div>
          {/if}
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
  <!-- New Session 态（R12-B 8）输入可用：首条消息即会话创建向量，不再按
       sessionId 禁用。{#key sendEpoch}：发送成功清轨时重建元素丢弃原生 undo
       栈（W1 undo-cut-after-send）。 -->
  {#key sendEpoch}
    <textarea
      bind:this={textareaEl}
      rows={1}
      maxlength={20000}
      {placeholder}
      bind:value={agentComposer.text}
      onkeydown={onKeydown}
      onkeyup={syncCaret}
      onclick={syncCaret}
      onselect={syncCaret}
      onpaste={onPaste}
      oncompositionstart={onCompositionStart}
      oncompositionend={onCompositionEnd}
      data-composer-composing={composing ? "true" : undefined}
      class="msg-body max-h-40 w-full resize-none border-0 bg-transparent px-3.5 py-2.5 outline-none focus:outline-none focus-visible:ring-0 placeholder:text-muted-foreground disabled:opacity-50"
      aria-label="Message"></textarea>
  {/key}
  <div class="flex h-11 items-center gap-1 px-2.5">
    <!-- 左簇：模式 chip + 图片 + 文件 -->
    <DropdownMenu.DropdownMenu bind:open={modeMenuOpen}>
      <DropdownMenu.Trigger
        class="flex h-7 max-w-[130px] items-center gap-1.5 rounded-full border border-border px-2.5 text-[11px] text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        title={running
          ? "Switch after the current turn ends"
          : agentSession.sessionId
            ? "Switch this session's mode"
            : "Pick the mode for your next session"}
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
              data-mode-active={activeMode === entry.id ? "true" : undefined}
              class="gap-1.5"
              onclick={() => onModeChange(entry.id)}
            >
              <span class="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                {#if activeMode === entry.id}
                  <IconCheck class="h-3 w-3" aria-hidden="true" />
                {/if}
              </span>
              <span class="truncate">{entry.label}</span>
            </DropdownMenu.Item>
          {/each}
        </DropdownMenu.Content>
      {/if}
    </DropdownMenu.DropdownMenu>
    <button
      type="button"
      class="relative flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors after:absolute after:-inset-1.5 after:content-[''] hover:bg-muted hover:text-foreground disabled:opacity-50"
      title="Commands and skills"
      aria-label="Commands and skills"
      aria-expanded={launcherOpen}
      onclick={() => {
        // W3 `+` 编程式启动器：无 query 全量展开；再点切换关闭（官方同语义）。
        launcherOpen = !launcherOpen;
        textareaEl?.focus();
      }}
    >
      <IconPlus class="h-4 w-4" />
    </button>
    <button
      type="button"
      class="relative flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors after:absolute after:-inset-1.5 after:content-[''] hover:bg-muted hover:text-foreground disabled:opacity-50"
      title="Attach images (paste or pick, ≤4 MiB each)"
      aria-label="Attach images (paste or pick, ≤4 MiB each)"
      onclick={() => void openPicker("image")}
    >
      <IconImage class="h-4 w-4" />
    </button>
    <button
      type="button"
      class="relative flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors after:absolute after:-inset-1.5 after:content-[''] hover:bg-muted hover:text-foreground disabled:opacity-50"
      title="Attach files (text inlined, binary as refs, ≤512 KiB each)"
      aria-label="Attach files (text inlined, binary as refs, ≤512 KiB each)"
      onclick={() => void openPicker("file")}
    >
      <IconFileUp class="h-4 w-4" />
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
              <DropdownMenu.GroupHeading
                class="flex items-center gap-1.5 px-2 py-1 text-[10px] font-medium"
              >
                <span
                  class="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded text-[8px] font-semibold text-white"
                  style="background: {group.color}"
                  aria-hidden="true"
                >
                  {group.letter}
                </span>
                <span class="truncate">{group.label}</span>
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
      disabled={primaryMode !== "stop" && (!hasDraft || agentSession.sending)}
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
