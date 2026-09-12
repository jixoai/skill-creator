<!--
  用户原始需求 [2026-09-12]（redesign §3.4 末段）：「SlashMenu：稿文以 `/` 开头
  且光标在首行时，于 composer 上方锚定浮现（绝对定位列表，非新依赖）：当前命令
  `/compact`（执行并发送）；↑↓ 导航 + Enter 执行 + Esc 关闭；结构开放供后续命令
  注册」——codex R2 解除 defer，本轮落地。
  正交意图：
    [1] 命令注册表（module 级数组，开放扩展）：以稿文首行做前缀匹配。
    [2] 键盘导航：↑↓ 循环移动、Enter 执行（onExecute 回调命令文本）、Esc 对当前
        稿文一次性驳回；经 bind:this 暴露 handleKeydown 供 composer textarea
        先行消费（返回 true = 已消费，含 stopPropagation，Esc 不冒泡收起面板）。
  妥协声明：无独立焦点管理（键盘留在 textarea；条目为原生 button 点击执行，
  hover 仅 CSS 高亮不改变键盘选中）。
-->
<script module lang="ts">
  /** 斜杠命令条目（后续命令在 SLASH_COMMANDS 注册表追加即可）。 */
  export interface SlashCommand {
    command: string;
    description: string;
  }

  export const SLASH_COMMANDS: readonly SlashCommand[] = [
    { command: "/compact", description: "Summarize the transcript to reclaim context" },
  ];
</script>

<script lang="ts">
  let {
    text,
    caretOnFirstLine,
    onExecute,
  }: {
    /** 当前草稿全文（查询 = 首行，多行草稿只以首行为查询）。 */
    text: string;
    /** 光标是否在首行（锚定条件，由 composer 按真实 selectionStart 同步）。 */
    caretOnFirstLine: boolean;
    /** 执行命令：以命令文本发送。 */
    onExecute: (command: string) => void;
  } = $props();

  /** Esc 驳回的稿文快照：稿文再变化即重新浮现。 */
  let dismissedText = $state<string | null>(null);
  let selectedIndex = $state(0);

  const query = $derived(text.startsWith("/") ? (text.split("\n", 1)[0] ?? "") : "");
  const matches = $derived(
    query.length > 0 ? SLASH_COMMANDS.filter((entry) => entry.command.startsWith(query)) : [],
  );
  /** 选中索引（matches 收缩时收敛到上界内）。 */
  const selected = $derived(Math.min(selectedIndex, Math.max(0, matches.length - 1)));
  const open = $derived(matches.length > 0 && caretOnFirstLine && dismissedText !== text);

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
    if (!open || matches.length === 0) return false;
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
    if (event.key === "Enter") {
      consume(event);
      const entry = matches[selected];
      if (entry) onExecute(entry.command);
      return true;
    }
    if (event.key === "Escape") {
      consume(event);
      dismissedText = text;
      return true;
    }
    return false;
  }
</script>

{#if open}
  <!-- 绝对定位列表（§0 护栏：不引入新的菜单原语），锚定 composer 卡上方；
       键盘留在 textarea（handleKeydown 先占），条目本身是原生 button 可点执行。 -->
  <ul
    data-slot="slash-menu"
    class="absolute bottom-full left-3 z-20 mb-1.5 w-72 overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-md"
    aria-label="Slash commands"
  >
    {#each matches as entry, index (entry.command)}
      <li>
        <button
          type="button"
          class="flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left text-[11px] {index ===
          selected
            ? 'bg-accent text-accent-foreground'
            : 'text-foreground'} hover:bg-accent/50"
          aria-current={index === selected ? "true" : undefined}
          onclick={() => onExecute(entry.command)}
        >
          <span class="shrink-0 font-medium">{entry.command}</span>
          <span class="truncate text-muted-foreground">{entry.description}</span>
        </button>
      </li>
    {/each}
  </ul>
{/if}
