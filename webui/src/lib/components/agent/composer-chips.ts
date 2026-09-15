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

/** 镜像层渲染段：plain 文本、引用芯片（文本逐字一致）或技能装饰段（C3）。 */
export type PaintSegment =
  | { kind: "plain"; text: string }
  | { kind: "chip"; text: string; reference: ComposerReference }
  | { kind: "skill"; text: string; name: string };

/**
 * 绘制 span 投影：引用出现区间与技能装饰区间（互斥前缀面，重叠防御性丢弃
 * 后者）以文本序切分 text。
 */
export function paintSegments(
  text: string,
  occurrences: readonly ChipOccurrence[],
  skillSpans: readonly SkillChipSpan[] = [],
): PaintSegment[] {
  type Mark = { start: number; end: number; segment: PaintSegment };
  const marks: Mark[] = [
    ...[...occurrences]
      .sort((a, b) => a.start - b.start)
      .map((occurrence) => ({
        start: occurrence.start,
        end: occurrence.end,
        segment: {
          kind: "chip",
          text: text.slice(occurrence.start, occurrence.end),
          reference: occurrence.reference,
        } as PaintSegment,
      })),
    ...[...skillSpans]
      .sort((a, b) => a.start - b.start)
      .map((span) => ({
        start: span.start,
        end: span.end,
        segment: {
          kind: "skill",
          text: text.slice(span.start, span.end),
          name: span.name,
        } as PaintSegment,
      })),
  ].sort((a, b) => a.start - b.start);
  const segments: PaintSegment[] = [];
  let cursor = 0;
  for (const mark of marks) {
    if (mark.start < cursor) continue; // 防御：区间重叠（不应发生）时丢弃后者
    if (mark.start > cursor) {
      segments.push({ kind: "plain", text: text.slice(cursor, mark.start) });
    }
    segments.push(mark.segment);
    cursor = mark.end;
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

/** 技能词法装饰 span（C3：官方 TextRefNode 的文本基座适配——仅样式无交互）。 */
export interface SkillChipSpan {
  start: number;
  end: number;
  /** 命中的技能名（不含 "/"）。 */
  name: string;
}

/**
 * 技能 token 扫描（C3）：`/name` 命中 skills 目录名集即装饰。边界 = 起点在
 * 行首/空白后，终点后是文末/空白（`/namez` 不装饰 `/name`）；命令（不在技能
 * 目录内的 `/compact` 等）天然不装饰；`//`、`://` 转义不命中（token 前必须
 * 是空白/行首）。
 */
export function findSkillTokens(text: string, skillNames: readonly string[]): SkillChipSpan[] {
  if (skillNames.length === 0) return [];
  const names = [...new Set(skillNames)].sort((a, b) => b.length - a.length);
  const spans: SkillChipSpan[] = [];
  let index = 0;
  while (index < text.length) {
    if (!atTokenBoundary(text, index) || text[index] !== "/") {
      index += 1;
      continue;
    }
    const name = names.find(
      (candidate) =>
        text.startsWith(`/${candidate}`, index) &&
        (index + candidate.length + 1 === text.length ||
          /\s/.test(text[index + candidate.length + 1] ?? "")),
    );
    if (name === undefined) {
      index += 1;
      continue;
    }
    spans.push({ start: index, end: index + name.length + 1, name });
    index += name.length + 1;
  }
  return spans;
}
