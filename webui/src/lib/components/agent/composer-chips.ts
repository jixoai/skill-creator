/**
 * Composer 芯片绘制与消费的纯函数面（composer-references C1）。
 *
 * 用户原始需求 [2026-09-16]：「继续完善遗留工作。完成 1/2/3」——其中 1 =
 * `@` 引用芯片。官方 Lexical 芯片在本产品适配为 textarea 镜像绘制层：文本
 * 模型不变（token = `@name` 纯文本），芯片视觉 = 底层同度量镜像层上的
 * 底色 span；原子性 = 退格整删（见 atomicChipBeforeCaret）。
 *
 * 正交意图：
 *   [1] token ↔ 引用的有序出现消费：registry 按拾取序持有引用；同一 token 的
 *       多个引用按文中出现序逐一配对——token 被编辑掉 = 该引用失效（不绘制、
 *       提交时剪除），不复活。
 *   [2] 绘制 span 投影：text → segments（plain | chip）供镜像层渲染；芯片
 *       span 不得带 padding/border（会移动布局破坏 1:1 度量镜像），只用底色
 *       与圆角（box-decoration-break: clone 处理跨行片段）。
 *   [3] 原子退格判定：光标紧邻芯片 token 尾部时 Backspace 整删 token。
 * 妥协声明：无（token 边界 = 起点须为行首/空白；终点不限——尾部粘连文本时
 *   仍按起点边界匹配，近似官方原子芯片，差异已记录于 change design）。
 */

/** 一条草稿引用（registry 项；target 对 file 是绝对路径、对 session 是会话 id）。 */
export interface ComposerReference {
  uid: number;
  kind: "file" | "session";
  /** 文中 token（含 "@" 前缀，不含尾随空格），如 `@api.md`。 */
  token: string;
  target: string;
  /** chip/菜单显示名（file basename / session 标题）。 */
  label: string;
}

/** 一次成功消费的出现：引用 + 文中区间 [start, end)。 */
export interface ChipOccurrence {
  reference: ComposerReference;
  start: number;
  end: number;
}

/** token 起点边界：行首或空白之后（`email@x.md` 不得成芯片）。 */
function atTokenBoundary(text: string, index: number): boolean {
  return index === 0 || /\s/.test(text[index - 1] ?? "");
}

/**
 * 有序出现消费：按文中出现序输出成功配对的引用区间。同一 token 的引用按
 * registry 序排队，每个出现消费队首；无出现的引用被剪除（token 已不存在）。
 */
export function resolveChipOccurrences(
  text: string,
  references: readonly ComposerReference[],
): ChipOccurrence[] {
  const queues = new Map<string, ComposerReference[]>();
  for (const reference of references) {
    const queue = queues.get(reference.token) ?? [];
    queue.push(reference);
    queues.set(reference.token, queue);
  }
  const tokens = [...queues.keys()];
  const occurrences: ChipOccurrence[] = [];
  let index = 0;
  while (index < text.length) {
    if (!atTokenBoundary(text, index)) {
      index += 1;
      continue;
    }
    const matched = tokens.find((token) => text.startsWith(token, index));
    if (matched === undefined) {
      index += 1;
      continue;
    }
    const queue = queues.get(matched);
    const reference = queue?.shift();
    if (reference !== undefined) {
      occurrences.push({ reference, start: index, end: index + matched.length });
    }
    index += matched.length;
  }
  return occurrences;
}

/** 提交面：文中仍存在的引用（按出现序）——payload 形状由调用方映射。 */
export function activeDraftReferences(
  text: string,
  references: readonly ComposerReference[],
): ComposerReference[] {
  return resolveChipOccurrences(text, references).map((occurrence) => occurrence.reference);
}

/** 镜像层渲染段：plain 文本或芯片（芯片文本与原文逐字一致）。 */
export type PaintSegment =
  | { kind: "plain"; text: string }
  | { kind: "chip"; text: string; reference: ComposerReference };

/** 绘制 span 投影：occurrences 区间以文本序切分 text。 */
export function paintSegments(
  text: string,
  occurrences: readonly ChipOccurrence[],
): PaintSegment[] {
  const segments: PaintSegment[] = [];
  let cursor = 0;
  for (const occurrence of [...occurrences].sort((a, b) => a.start - b.start)) {
    if (occurrence.start < cursor) continue; // 防御：区间重叠（不应发生）时丢弃后者
    if (occurrence.start > cursor) {
      segments.push({ kind: "plain", text: text.slice(cursor, occurrence.start) });
    }
    segments.push({
      kind: "chip",
      text: text.slice(occurrence.start, occurrence.end),
      reference: occurrence.reference,
    });
    cursor = occurrence.end;
  }
  if (cursor < text.length) segments.push({ kind: "plain", text: text.slice(cursor) });
  return segments;
}

/** 原子退格判定：光标紧邻某芯片 token 尾部（end === caret）时返回该出现。 */
export function atomicChipBeforeCaret(
  text: string,
  caret: number,
  occurrences: readonly ChipOccurrence[],
): ChipOccurrence | null {
  return occurrences.find((occurrence) => occurrence.end === caret) ?? null;
}
