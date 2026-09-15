/**
 * Composer 键位与文本卫生（openspec composer-capability-parity W1）。
 *
 * 用户指示 [2026-09-15]：「我们的 Agent Chat 输入框的能力，最好 100% 复刻官方
 * webui 的输入框能力的实现。」本模块是官方 InputBar keymap 语义的可测内核。
 *
 * 正交意图：
 *   [1] IME 守卫：合成中的 Enter 不提交不断行（isComposing + keyCode 229 +
 *       compositionend 后 10ms 窗口——Safari 关键事件晚于 compositionend）。
 *   [2] 粘贴文本消毒：剥离官方芯片占位字符（U+E100–E11D、U+FFFC）——外部
 *       文本不得伪造芯片。
 *   [3] 占位符优先级链：owner > disconnected > unavailable > mode > default。
 */

/** compositionend 后的 Enter 宽限期（官方 keymap.ts 同值：Safari 时序补偿）。 */
export const COMPOSITION_GRACE_MS = 10;

/** 官方芯片占位字符区段（detectText 投影的 PUA 区 + 对象替换字符）。 */
const CHIP_PLACEHOLDER_PATTERN = /[\uE100-\uE11D\uFFFC]/g;
/** 检测专用非全局形态（全局 .test 的 lastIndex 状态跨调用泄漏——第二次检测
 *  会从上次匹配位之后起搜而漏检；检测必须无状态）。 */
const CHIP_PLACEHOLDER_DETECT = /[\uE100-\uE11D\uFFFC]/;

/**
 * Enter 是否处于 IME 合成语境（不提交、不断行）。
 * 判定顺序与官方一致：isComposing → legacy keyCode 229 → 近期 compositionend。
 */
export function enterIsComposing(
  event: { isComposing: boolean; keyCode?: number },
  lastCompositionEndAt: number | null,
  now: number = Date.now(),
): boolean {
  if (event.isComposing) return true;
  if (event.keyCode === 229) return true;
  if (lastCompositionEndAt !== null && now - lastCompositionEndAt < COMPOSITION_GRACE_MS) {
    return true;
  }
  return false;
}

/** 粘贴/回填文本消毒：剥离芯片占位字符（外部文本不可伪造芯片身份）。 */
export function sanitizeComposerText(text: string): string {
  return text.replace(CHIP_PLACEHOLDER_PATTERN, "");
}

/** 文本是否含芯片占位字符（决定 paste 是否需要手工插入消毒文本）。 */
export function containsChipPlaceholders(text: string): boolean {
  return CHIP_PLACEHOLDER_DETECT.test(text);
}

/** 占位符链输入。 */
export interface ComposerPlaceholderInput {
  /** 拥有者覆盖（编辑态等）。 */
  owner?: string | null;
  /** 连接断开（面板 disconnected 横幅之外的输入面表达）。 */
  disconnected?: boolean;
  /** 会话/内核不可用。 */
  unavailable?: boolean;
  /** 当前模式短名（New Session 待建模式）。 */
  modeLabel?: string | null;
}

/** 占位符优先级链（官方 InputBar placeholder 链的产品化裁剪）。 */
export function composerPlaceholder(input: ComposerPlaceholderInput): string {
  if (input.owner !== undefined && input.owner !== null && input.owner.length > 0) {
    return input.owner;
  }
  if (input.disconnected) return "Reconnecting…";
  if (input.unavailable) return "Agent unavailable";
  if (input.modeLabel) return `Message the ${input.modeLabel.toLowerCase()} agent…`;
  return "Message the agent…";
}
