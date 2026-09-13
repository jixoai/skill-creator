<!--
  用户原始需求 [2026-09-12]（redesign §3.4 末段）：「SlashMenu：稿文以 `/` 开头
  且光标在首行时，于 composer 上方锚定浮现（绝对定位列表，非新依赖）：当前命令
  `/compact`（执行并发送）；↑↓ 导航 + Enter 执行 + Esc 关闭；结构开放供后续命令
  注册」——codex R2 解除 defer，本轮落地。
  修订 [2026-09-12]（R14-B 5）：浮现/键盘语法通用化为 TriggerMenu（`$` skill
  引用补全同语法并排实例）；本组件收敛为 "/" 实例的外壳——命令注册表 +
  TriggerMenu 装配，无独立交互逻辑。
  正交意图：
    [1] 斜杠命令注册表（module 级数组，开放扩展：后续命令在此追加即可）。
  妥协声明：无（交互语法与渲染见 TriggerMenu 模块）。
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
  import TriggerMenu, { type MenuEntry } from "./TriggerMenu.svelte";

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

  const entries: readonly MenuEntry[] = SLASH_COMMANDS.map((entry) => ({
    value: entry.command,
    ...(entry.description.length > 0 ? { description: entry.description } : {}),
  }));

  let menu = $state<{ handleKeydown: (event: KeyboardEvent) => boolean } | null>(null);

  /** 键盘先占透传（composer 经 bind:this 调用；语义见 TriggerMenu）。 */
  export function handleKeydown(event: KeyboardEvent): boolean {
    return menu?.handleKeydown(event) ?? false;
  }
</script>

<TriggerMenu
  trigger="/"
  {entries}
  {text}
  {caretOnFirstLine}
  menuLabel="Slash commands"
  dataSlot="slash-menu"
  onSelect={onExecute}
  bind:this={menu}
/>
