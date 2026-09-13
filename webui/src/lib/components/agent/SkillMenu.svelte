<!--
  用户原始需求 [2026-09-12]（R14-B 5）：「Chat 输入框中要支持 `$` 来激发输入
  补全，从而输入 skill」——稿文以 `$` 开头且光标在首行时浮现候选（语法与 "/"
  SlashMenu 同源，见 TriggerMenu），选中把 `$name ` 插回稿文（消息内嵌 skill
  引用；内核/模型侧消费由后续轮次处理，本轮只做输入补全）。
  正交意图：
    [1] "$" 实例外壳：候选 = skills store 已加载的当前 Workspace Provider 技能
        列表（面板上下文无 workspace 选择，故不另发 RPC）；空列表显示
        "No skills in the current workspace" 占位（TriggerMenu emptyMessage）。
  妥协声明：无（交互语法与渲染见 TriggerMenu 模块）。
-->
<script lang="ts">
  import TriggerMenu, { type MenuEntry } from "./TriggerMenu.svelte";
  import { skillsState } from "$lib/stores/skills.svelte";

  let {
    text,
    caretOnFirstLine,
    onInsert,
  }: {
    /** 当前草稿全文（查询 = 首行，多行草稿只以首行为查询）。 */
    text: string;
    /** 光标是否在首行（锚定条件，由 composer 按真实 selectionStart 同步）。 */
    caretOnFirstLine: boolean;
    /** 选中补全：把完整 `$name` token 交回 composer 插入（含尾随空格）。 */
    onInsert: (token: string) => void;
  } = $props();

  const entries = $derived(
    skillsState.skills.map((skill): MenuEntry => ({
      value: `$${skill.name}`,
      ...(skill.description.length > 0 ? { description: skill.description } : {}),
    })),
  );

  /** 来源副标题（R15 codex）：面板无 workspace 选择，候选沿用最近一次加载的
   * Provider——来源显式标注，绑定可追溯；未加载时给出引导文案。 */
  const sourceLabel = $derived(
    skillsState.target
      ? `from provider: ${skillsState.target.providerId}`
      : "Open a Workspace provider to load skills",
  );

  let menu = $state<{ handleKeydown: (event: KeyboardEvent) => boolean } | null>(null);

  /** 键盘先占透传（composer 经 bind:this 调用；语义见 TriggerMenu）。 */
  export function handleKeydown(event: KeyboardEvent): boolean {
    return menu?.handleKeydown(event) ?? false;
  }
</script>

<TriggerMenu
  trigger="$"
  {entries}
  {text}
  {caretOnFirstLine}
  menuLabel="Skill references"
  {sourceLabel}
  dataSlot="skill-menu"
  emptyMessage="No skills in the current workspace"
  onSelect={onInsert}
  bind:this={menu}
/>
