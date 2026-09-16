<!--
  用户原始需求 [2026-09-12]（redesign §3.4 末段）：「SlashMenu：稿文以 `/` 开头
  且光标在首行时，于 composer 上方锚定浮现……结构开放供后续命令注册」。
  修订 [2026-09-16]（composer-capability-parity W3，官方 ui-commands/ui-skill
  统一 `/` 触发）：技能引用从 `$` 迁至 `/`——单一 TriggerMenu 实例承载两组
  候选（Commands 在前、Skills 随后，官方 roster 序）；命令选中即执行发送，
  技能选中把 `/name ` 纯文本落回稿文（官方落点同法：plain text + 服务端注入
  决定论，不做客户端芯片）。
  修订 [2026-09-16]（skill-refs C1）：`/` 保持命令/技能触发语义；技能「引用」
  语义由 `$` 触发的 SkillMenu 承担（跨 Workspace + 模糊搜索）——两个触发符
  并存，语义正交（触发 vs 引用）。
  正交意图：
    [1] 斜杠命令注册表（module 级数组，开放扩展）。
    [2] 统一候选装配：命令组 + skills store 技能组（`/` 前缀）+ 来源副标题。
  妥协声明：无（交互语法与渲染见 TriggerMenu 模块）。
-->
<script module lang="ts">
  /** 斜杠命令条目（后续命令在 SLASH_COMMANDS 注册表追加即可）。 */
  export interface SlashCommand {
    command: string;
    description: string;
    /** 命令类别（W3）：action = 选中即执行发送；input-taking = claim 后带参
     *  提交（claim 机见 composer-trigger；首版目录无此类命令，结构就绪）。 */
    kind?: "action" | "input-taking";
  }

  export const SLASH_COMMANDS: readonly SlashCommand[] = [
    { command: "/compact", description: "Summarize the transcript to reclaim context" },
    // W4：忙碌 Enter 偏好（客户端命令——选中即本地生效，不发送）。
    { command: "/queue", description: "While busy, Enter queues after the current turn" },
    { command: "/steer", description: "While busy, Enter steers the current turn" },
  ];

  /** input-taking 命令 token 集（含尾随空格；claim 机的命令目录）。 */
  export const INPUT_TAKING_TOKENS: readonly string[] = SLASH_COMMANDS.filter(
    (command) => command.kind === "input-taking",
  ).map((command) => `${command.command} `);
</script>

<script lang="ts">
  import TriggerMenu, { type MenuEntry } from "./TriggerMenu.svelte";
  import { slashQuery } from "./composer-trigger.js";
  import { skillsState } from "$lib/stores/skills.svelte";

  let {
    text,
    caretOnFirstLine,
    onExecute,
    onInsertSkill,
    suppress = false,
    forcedOpen = false,
    onForceClose,
  }: {
    /** 当前草稿全文（查询 = 首行，多行草稿只以首行为查询）。 */
    text: string;
    /** 光标是否在首行（锚定条件，由 composer 按真实 selectionStart 同步）。 */
    caretOnFirstLine: boolean;
    /** 执行命令：以命令文本发送。 */
    onExecute: (command: string) => void;
    /** 技能选中：把 `/name ` token 交回 composer 插入（含尾随空格）。 */
    onInsertSkill: (token: string) => void;
    /** W3 claim 压制（composer 的 claim 态透传）。 */
    suppress?: boolean;
    /** W3 `+` 启动器受控开合。 */
    forcedOpen?: boolean;
    onForceClose?: () => void;
  } = $props();

  /** 统一候选（roster 序：Commands 组在前，Skills 组随后）。 */
  const entries = $derived.by(() => {
    const commandEntries: MenuEntry[] = SLASH_COMMANDS.map((entry) => ({
      value: entry.command,
      group: "Commands",
      ...(entry.description.length > 0 ? { description: entry.description } : {}),
    }));
    const skillEntries: MenuEntry[] = skillsState.skills.map((skill) => ({
      value: `/${skill.name}`,
      group: "Skills",
      ...(skill.description.length > 0 ? { description: skill.description } : {}),
    }));
    return [...commandEntries, ...skillEntries];
  });

  /** 来源副标题：技能候选沿用最近一次加载的 Provider——来源显式标注。 */
  const sourceLabel = $derived(
    skillsState.target
      ? `skills from provider: ${skillsState.target.providerId}`
      : "Open a Workspace provider to load skills",
  );

  /** URL 剔除（W3，官方 carve-outs）：`//` 协议相对或 `://` scheme 的首行
   *  不激发触发菜单——与 claim 压制共同构成 suppress 面。 */
  const carvedOut = $derived(
    text.startsWith("/") && slashQuery(text.split("\n", 1)[0] ?? "") === "",
  );

  let menu = $state<{ handleKeydown: (event: KeyboardEvent) => boolean } | null>(null);

  /** 键盘先占透传（composer 经 bind:this 调用；语义见 TriggerMenu）。 */
  export function handleKeydown(event: KeyboardEvent): boolean {
    return menu?.handleKeydown(event) ?? false;
  }

  /** 选中路由：命中命令注册表 → 执行；其余（技能）→ 纯文本插入。 */
  function onSelect(value: string): void {
    if (SLASH_COMMANDS.some((command) => command.command === value)) {
      onExecute(value);
      return;
    }
    onInsertSkill(value);
  }
</script>

<TriggerMenu
  trigger="/"
  {entries}
  {text}
  {caretOnFirstLine}
  suppress={suppress || carvedOut}
  {forcedOpen}
  {onForceClose}
  menuLabel="Slash commands and skills"
  {sourceLabel}
  dataSlot="slash-menu"
  emptyMessage="No matching command or skill"
  {onSelect}
  bind:this={menu}
/>
