<!--
  用户原始需求 [2026-09-12]（redesign §3.4 末段）：「SlashMenu：稿文以 `/` 开头
  且光标在首行时，于 composer 上方锚定浮现（绝对定位列表，非新依赖）……↑↓
  导航 + Enter 执行 + Esc 关闭；结构开放供后续命令注册」。
  修订 [2026-09-12]（R14-B 5）：「Chat 输入框中要支持 `$` 来激发输入补全，从而
  输入 skill」——通用化 SlashMenu 的浮现/键盘语法为 TriggerMenu（"/" 命令与
  "$" skill 引用并排两实例；SlashMenu 保留命令注册表外壳）。
  正交意图：
    [1] 浮现语法（纯函数投影）：query = 稿文首行且以 trigger 开头；候选 value
        （含 trigger 前缀）对 query 做 startsWith 前缀匹配——候选行一旦离开
        前缀（如补全后的尾随空格/后续语句），菜单自然收起，无需显式关闭。
    [2] 键盘先占：↑↓ 循环移动、Enter 选中（onSelect 回调 value）、Esc 对当前
        稿文一次性驳回（稿文再变化即重新浮现）；经 bind:this 暴露
        handleKeydown 供 composer textarea 先行消费（返回 true = 已消费，含
        stopPropagation，Esc 不冒泡收起面板）。entries 为空且提供 emptyMessage
        时显示占位文案（Enter 仍先占不发送半成品，方向键交还光标移动）。
  妥协声明：无独立焦点管理（键盘留在 textarea；条目为原生 button 点击执行，
  hover 仅 CSS 高亮不改变键盘选中）。
-->
<script module lang="ts">
  /** 补全候选条目：value = 完整 token（含 trigger 前缀，如 `/compact`）。 */
  export interface MenuEntry {
    value: string;
    description?: string;
    /** 分组标题（W3：命令/技能统一菜单的 roster 分组；缺省 = 无组头）。 */
    group?: string;
  }
</script>

<script lang="ts">
  let {
    trigger,
    entries,
    text,
    caretOnFirstLine,
    menuLabel,
    dataSlot,
    emptyMessage,
    sourceLabel,
    suppress = false,
    forcedOpen = false,
    onForceClose,
    onSelect,
  }: {
    /** 触发字符（W3 起统一 "/"：命令 + 技能）。 */
    trigger: string;
    /** 候选注册表（结构开放，由实例外壳持有）。 */
    entries: readonly MenuEntry[];
    /** 当前草稿全文（查询 = 首行，多行草稿只以首行为查询）。 */
    text: string;
    /** 光标是否在首行（锚定条件，由 composer 按真实 selectionStart 同步）。 */
    caretOnFirstLine: boolean;
    /** 浮现列表的 aria-label。 */
    menuLabel: string;
    /** data-slot 语义/测试锚（slash-menu / skill-menu）。 */
    dataSlot: string;
    /** entries 为空时的占位文案（undefined = 无候选即隐藏菜单）。 */
    emptyMessage?: string;
    /** 数据源副标题（$ 菜单显示当前加载的 provider，绑定可追溯）。 */
    sourceLabel?: string;
    /** W3 claim 压制：claimed 态下触发符菜单不浮现（官方 guard tier）。 */
    suppress?: boolean;
    /** W3 `+` 编程式启动：true = 无 query 也全量展开（空 query 显示全目录）。 */
    forcedOpen?: boolean;
    /** forcedOpen 的受控关闭（`+` 再点切换）。 */
    onForceClose?: () => void;
    /** 选中候选：以完整 value 交回调用方（发送命令 / 插入 token 由外壳决定）。 */
    onSelect: (value: string) => void;
  } = $props();

  /** Esc 驳回的稿文快照：稿文再变化即重新浮现。 */
  let dismissedText = $state<string | null>(null);
  let selectedIndex = $state(0);

  const query = $derived(text.startsWith(trigger) ? (text.split("\n", 1)[0] ?? "") : "");
  /** forcedOpen 的空 query 语义：全目录（官方空 query 分区展示）。 */
  const effectiveQuery = $derived(forcedOpen && query.length === 0 ? trigger : query);
  const matches = $derived(
    effectiveQuery.length > 0
      ? entries.filter((entry) => entry.value.startsWith(effectiveQuery))
      : [],
  );
  /** 空注册表占位（如当前 Workspace 无 skill）：菜单保留但无可选项。 */
  const showEmpty = $derived(entries.length === 0 && emptyMessage !== undefined);
  const open = $derived(
    !suppress &&
      caretOnFirstLine &&
      dismissedText !== text &&
      ((forcedOpen && (matches.length > 0 || showEmpty)) ||
        (query.length > 0 && (matches.length > 0 || showEmpty))),
  );
  /** 选中索引（matches 收缩时收敛到上界内）。 */
  const selected = $derived(Math.min(selectedIndex, Math.max(0, matches.length - 1)));
  /** 分组投序：按 entries 声明序渲染组头（组切换处落组头行）。 */
  const grouped = $derived(
    matches.map((entry, index) => ({
      entry,
      index,
      header: entry.group !== undefined && entry.group !== matches[index - 1]?.group,
    })),
  );

  function consume(event: KeyboardEvent): void {
    event.preventDefault();
    // 已消费的键不再冒泡：Esc 不得再触发 AgentPanel 的 window 级面板收起。
    event.stopPropagation();
  }

  /**
   * 键盘先占（composer textarea 的 onkeydown 最先调用）：返回 true = 已消费，
   * 调用方必须跳过后续处理（Enter 普通提交等）。
   */
  export function handleKeydown(event: KeyboardEvent): boolean {
    if (!open) return false;
    if (event.key === "Escape") {
      consume(event);
      dismissedText = text;
      onForceClose?.();
      return true;
    }
    if (matches.length === 0) {
      // 空态占位：Enter 先占（不把半成品当消息发送）；方向键交还光标移动。
      if (event.key === "Enter") {
        consume(event);
        return true;
      }
      return false;
    }
    if (event.key === "ArrowDown") {
      consume(event);
      selectedIndex = (selected + 1) % matches.length;
      return true;
    }
    if (event.key === "ArrowUp") {
      consume(event);
      selectedIndex = (selected - 1 + matches.length) % matches.length;
      return true;
    }
    if (event.key === "Enter" || (event.key === "Tab" && forcedOpen)) {
      // W3：forcedOpen 态 Tab 也选中（官方 `+` 启动器的列表盒语义）；常规态
      // Tab 交还（既有键盘面不变）。
      consume(event);
      const entry = matches[selected];
      if (entry) {
        onSelect(entry.value);
        onForceClose?.();
      }
      return true;
    }
    return false;
  }
</script>

{#if open}
  <!-- 绝对定位列表（§0 护栏：不引入新的菜单原语），锚定 composer 卡上方；
       键盘留在 textarea（handleKeydown 先占），条目本身是原生 button 可点执行。 -->
  <ul
    data-slot={dataSlot}
    class="absolute bottom-full left-3 z-20 mb-1.5 max-h-64 w-72 overflow-y-auto rounded-lg border border-border bg-popover py-1 shadow-md"
    aria-label={menuLabel}
  >
    {#if sourceLabel}
      <div class="px-2.5 pt-1 text-[10px] text-muted-foreground" data-menu-source="true">
        {sourceLabel}
      </div>
    {/if}
    {#if matches.length === 0}
      <li class="cursor-default px-2.5 py-1.5 text-[11px] text-muted-foreground">
        {emptyMessage}
      </li>
    {:else}
      {#each grouped as item (item.entry.value)}
        {#if item.header && item.entry.group}
          <li
            class="px-2.5 pt-1.5 pb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
            data-menu-group={item.entry.group}
          >
            {item.entry.group}
          </li>
        {/if}
        <li>
          <button
            type="button"
            class="flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left text-[11px] {item.index ===
            selected
              ? 'bg-accent text-accent-foreground'
              : 'text-foreground'} hover:bg-accent/50"
            aria-current={item.index === selected ? "true" : undefined}
            onclick={() => {
              onSelect(item.entry.value);
              onForceClose?.();
            }}
          >
            <span class="shrink-0 font-medium">{item.entry.value}</span>
            {#if item.entry.description}
              <span class="truncate text-muted-foreground">{item.entry.description}</span>
            {/if}
          </button>
        </li>
      {/each}
    {/if}
  </ul>
{/if}
