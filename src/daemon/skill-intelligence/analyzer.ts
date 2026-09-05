/**
 * 用户原始需求 [2026-09-06]（openspec skill-intelligence）：
 * 「分析器不能把相似文本直接判定为冲突；冲突必须有可解释证据。」
 * 正交意图：
 *   [1] 从文档内容提取结构快照（triggers / 引用路径 / 校验投影），纯字符串运算。
 *   [2] 产出单技能与多技能 finding，每条带证据片段与 observed revisions。
 *   [3] 从 findings 推导技能关系边（overlap / conflict / shared-resource）。
 * 妥协声明：frontmatter 解析使用最小 YAML 子集（与 webui splitSkillContent 同口径），
 * 不引入 daemon 侧第二套完整 YAML 链；creator.save 仍是唯一权威解析写入方。
 */

/** 分析器输入：一个已读取的技能文档（调用方负责读取与 revision 计算）。 */
export interface AnalyzedDocument {
  workspaceId: string;
  providerId: string;
  skillId: string;
  name: string;
  directoryName: string;
  disabled: boolean;
  revision: string;
  content: string;
}

/** 分析器产出的单技能快照（与 contracts SkillSnapshot 对齐，由 service 组装 revision 锁定）。 */
export interface ExtractedSnapshot {
  workspaceId: string;
  providerId: string;
  skillId: string;
  name: string;
  directoryName: string;
  disabled: boolean;
  revision: string;
  bodyLength: number;
  triggers: string[];
  referencedPaths: string[];
  validation: { success: boolean; errors: string[]; warnings: string[] };
}

/** 纯分析器产出的 finding（id 由本模块确定性派生）。 */
export interface AnalyzerFinding {
  id: string;
  kind:
    | "duplicate-name"
    | "duplicate-trigger"
    | "overlapping-responsibility"
    | "mutually-exclusive-rules"
    | "shared-resource-path"
    | "missing-description"
    | "empty-body"
    | "wide-trigger-surface"
    | "validation-error"
    | "validation-warning";
  severity: "info" | "warning" | "error";
  message: string;
  skillIds: string[];
  observedRevisions: Record<string, string>;
  evidence: { label: string; snippet: string }[];
}

/** 分析器产出的关系边。 */
export interface AnalyzerEdge {
  kind: "overlap" | "conflict" | "shared-resource";
  skillIds: [string, string];
  findingIds: string[];
}

/** 完整纯分析结果。 */
export interface AnalyzerResult {
  snapshots: ExtractedSnapshot[];
  findings: AnalyzerFinding[];
  edges: AnalyzerEdge[];
}

/** 拆分 frontmatter 与正文（最小 YAML 子集，与 webui 口径一致）。 */
function splitDocument(content: string): {
  frontmatter: Record<string, string | boolean | null>;
  body: string;
} {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---")) return { frontmatter: {}, body: normalized };
  const lines = normalized.split("\n");
  if (lines[0]!.trim() !== "---") return { frontmatter: {}, body: normalized };
  const closing = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closing === -1) return { frontmatter: {}, body: normalized };
  const frontmatter: Record<string, string | boolean | null> = {};
  for (const raw of lines.slice(1, closing)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    frontmatter[key] = parseScalar(value);
  }
  return {
    frontmatter,
    body: lines
      .slice(closing + 1)
      .join("\n")
      .replace(/^\n/, ""),
  };
}

/** 解析标量：布尔/空值原样，其余去引号。 */
function parseScalar(raw: string): string | boolean | null {
  if (raw === "") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null" || raw === "~") return null;
  const first = raw[0];
  const last = raw[raw.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return raw.slice(1, -1);
  }
  return raw;
}

/** 从 frontmatter allowed-tools（逗号或空白分隔）提取触发词集合。 */
function extractTriggers(frontmatter: Record<string, string | boolean | null>): string[] {
  const raw = frontmatter["allowed-tools"];
  if (typeof raw !== "string" || raw.trim() === "") return [];
  const tokens = raw
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  return [...new Set(tokens)];
}

/** 从正文提取相对路径引用（markdown 链接、反引号路径与裸相对目录提及）。 */
function extractReferencedPaths(body: string): string[] {
  const paths = new Set<string>();
  const patterns = [
    /\]\((\.{1,2}\/[^)\s]+)\)/g, // ](./x) / ](../x)
    /`(\.{1,2}\/[^`]+)`/g, // `./x`
    /(?<![\w./])(scripts|assets|files|references)\/([\w./-]+)/g, // scripts/x.sh
  ];
  for (const pattern of patterns) {
    for (const match of body.matchAll(pattern)) {
      const full = match[0].startsWith("]") || match[0].startsWith("`") ? match[1]! : match[0];
      const normalized = full.replace(/^\.\//, "");
      if (normalized.length > 0) paths.add(normalized);
    }
  }
  return [...paths];
}

/** 停用词最小集合，用于 description 重叠度比较。 */
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "use",
  "using",
  "when",
  "with",
  "you",
  "your",
  "skill",
  "skills",
  "agent",
  "claude",
]);

/** 提取小写化的有效词元。 */
function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

/** 相互排斥规则的确定性证据：共享触发词上出现 always/never 类反向指令。 */
const OPPOSING_MARKERS = /\b(always|must|never|do not|don't|forbid)\b/i;

/** finding ID：对稳定字段做 FNV-1a 16-hex 派生（确定性，便于测试与去重）。 */
function findingId(kind: string, skillIds: string[]): string {
  const basis = `${kind}|${[...skillIds].sort().join(",")}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < basis.length; i += 1) {
    hash ^= basis.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fn_${hash.toString(16).padStart(8, "0")}${hash.toString(16).padStart(8, "0")}`;
}

/** 截取证据片段（单行化，超长折叠）。 */
function snippet(text: string, max = 120): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}

/** 对一组已读取文档运行确定性分析；无文件系统、无网络、无副作用。 */
export function analyzeDocuments(documents: AnalyzedDocument[]): AnalyzerResult {
  const snapshots: ExtractedSnapshot[] = [];
  const findings: AnalyzerFinding[] = [];
  const edges = new Map<string, AnalyzerEdge>();

  const addEdge = (kind: AnalyzerEdge["kind"], pair: [string, string], findingIdToAdd: string) => {
    const key = `${kind}|${[...pair].sort().join(",")}`;
    const existing = edges.get(key);
    if (existing) {
      if (!existing.findingIds.includes(findingIdToAdd)) existing.findingIds.push(findingIdToAdd);
    } else {
      edges.set(key, { kind, skillIds: pair, findingIds: [findingIdToAdd] });
    }
  };

  for (const doc of documents) {
    const { frontmatter, body } = splitDocument(doc.content);
    const triggers = extractTriggers(frontmatter);
    const referencedPaths = extractReferencedPaths(body);
    const description = typeof frontmatter.description === "string" ? frontmatter.description : "";
    const errors: string[] = [];
    const warnings: string[] = [];
    if (typeof frontmatter.name !== "string" || frontmatter.name.trim() === "") {
      errors.push("frontmatter name is missing or empty");
    }
    if (description.trim() === "") errors.push("frontmatter description is missing or empty");
    snapshots.push({
      workspaceId: doc.workspaceId,
      providerId: doc.providerId,
      skillId: doc.skillId,
      name: doc.name,
      directoryName: doc.directoryName,
      disabled: doc.disabled,
      revision: doc.revision,
      bodyLength: body.length,
      triggers,
      referencedPaths,
      validation: { success: errors.length === 0, errors, warnings },
    });

    if (description.trim() === "") {
      findings.push({
        id: findingId("missing-description", [doc.skillId]),
        kind: "missing-description",
        severity: "warning",
        message: `Skill "${doc.name}" has no frontmatter description.`,
        skillIds: [doc.skillId],
        observedRevisions: { [doc.skillId]: doc.revision },
        evidence: [{ label: doc.directoryName, snippet: "frontmatter description is empty" }],
      });
    }
    if (body.trim() === "") {
      findings.push({
        id: findingId("empty-body", [doc.skillId]),
        kind: "empty-body",
        severity: "warning",
        message: `Skill "${doc.name}" has an empty body.`,
        skillIds: [doc.skillId],
        observedRevisions: { [doc.skillId]: doc.revision },
        evidence: [
          { label: doc.directoryName, snippet: "document body after frontmatter is empty" },
        ],
      });
    }
    if (triggers.some((trigger) => trigger === "*" || trigger.endsWith(":*"))) {
      findings.push({
        id: findingId("wide-trigger-surface", [doc.skillId]),
        kind: "wide-trigger-surface",
        severity: "info",
        message: `Skill "${doc.name}" declares a wildcard trigger and may compete for every prompt.`,
        skillIds: [doc.skillId],
        observedRevisions: { [doc.skillId]: doc.revision },
        evidence: [
          { label: "allowed-tools", snippet: triggers.filter((t) => t.includes("*")).join(", ") },
        ],
      });
    }
    if (errors.length > 0) {
      findings.push({
        id: findingId("validation-error", [doc.skillId]),
        kind: "validation-error",
        severity: "error",
        message: `Skill "${doc.name}" has structural validation errors.`,
        skillIds: [doc.skillId],
        observedRevisions: { [doc.skillId]: doc.revision },
        evidence: errors.map((error) => ({ label: doc.directoryName, snippet: error })),
      });
    }
  }

  // ---- 多技能关系分析（两两确定性比较；禁用技能之间不算冲突，但与启用技能算重叠背景） ----
  for (let i = 0; i < snapshots.length; i += 1) {
    for (let j = i + 1; j < snapshots.length; j += 1) {
      const left = snapshots[i]!;
      const right = snapshots[j]!;

      if (left.name === right.name) {
        const id = findingId("duplicate-name", [left.skillId, right.skillId]);
        findings.push({
          id,
          kind: "duplicate-name",
          severity: "error",
          message: `Two skills share the name "${left.name}".`,
          skillIds: [left.skillId, right.skillId],
          observedRevisions: {
            [left.skillId]: left.revision,
            [right.skillId]: right.revision,
          },
          evidence: [
            { label: left.directoryName, snippet: `name: ${left.name}` },
            { label: right.directoryName, snippet: `name: ${right.name}` },
          ],
        });
        addEdge("conflict", [left.skillId, right.skillId], id);
      }

      const sharedTriggers = left.triggers.filter((trigger) => right.triggers.includes(trigger));
      if (sharedTriggers.length > 0 && !left.disabled && !right.disabled) {
        const id = findingId("duplicate-trigger", [left.skillId, right.skillId]);
        findings.push({
          id,
          kind: "duplicate-trigger",
          severity: "warning",
          message: `Enabled skills share trigger tokens: ${sharedTriggers.join(", ")}.`,
          skillIds: [left.skillId, right.skillId],
          observedRevisions: {
            [left.skillId]: left.revision,
            [right.skillId]: right.revision,
          },
          evidence: [
            { label: `${left.directoryName} allowed-tools`, snippet: sharedTriggers.join(", ") },
            { label: `${right.directoryName} allowed-tools`, snippet: sharedTriggers.join(", ") },
          ],
        });
        addEdge("overlap", [left.skillId, right.skillId], id);
        // 共享触发词 + 双方都出现反向指令行 → 可解释的互斥规则证据。
        const leftOpposites = opposingLines(documents, left.skillId, sharedTriggers);
        const rightOpposites = opposingLines(documents, right.skillId, sharedTriggers);
        if (leftOpposites.length > 0 && rightOpposites.length > 0) {
          const mutexId = findingId("mutually-exclusive-rules", [left.skillId, right.skillId]);
          findings.push({
            id: mutexId,
            kind: "mutually-exclusive-rules",
            severity: "error",
            message: `Skills give opposing directives on shared triggers (${sharedTriggers.join(", ")}).`,
            skillIds: [left.skillId, right.skillId],
            observedRevisions: {
              [left.skillId]: left.revision,
              [right.skillId]: right.revision,
            },
            evidence: [
              { label: left.directoryName, snippet: leftOpposites[0]! },
              { label: right.directoryName, snippet: rightOpposites[0]! },
            ],
          });
          addEdge("conflict", [left.skillId, right.skillId], mutexId);
        }
      }

      const sharedPaths = left.referencedPaths.filter((path) =>
        right.referencedPaths.includes(path),
      );
      if (sharedPaths.length > 0) {
        const id = findingId("shared-resource-path", [left.skillId, right.skillId]);
        findings.push({
          id,
          kind: "shared-resource-path",
          severity: "info",
          message: `Skills reference the same resource paths: ${sharedPaths.join(", ")}.`,
          skillIds: [left.skillId, right.skillId],
          observedRevisions: {
            [left.skillId]: left.revision,
            [right.skillId]: right.revision,
          },
          evidence: sharedPaths.slice(0, 3).map((path) => ({
            label: "shared path",
            snippet: path,
          })),
        });
        addEdge("shared-resource", [left.skillId, right.skillId], id);
      }

      // 描述重叠只作为 info 级背景提示；不判定为冲突。
      const overlapScore = descriptionOverlap(documents, left.skillId, right.skillId);
      if (overlapScore.shared.length >= 4 && overlapScore.ratio >= 0.6) {
        const id = findingId("overlapping-responsibility", [left.skillId, right.skillId]);
        findings.push({
          id,
          kind: "overlapping-responsibility",
          severity: "info",
          message: `Descriptions overlap (${Math.round(overlapScore.ratio * 100)}% shared terms); review whether responsibilities should be split.`,
          skillIds: [left.skillId, right.skillId],
          observedRevisions: {
            [left.skillId]: left.revision,
            [right.skillId]: right.revision,
          },
          evidence: [
            { label: left.directoryName, snippet: descriptionOf(documents, left.skillId) },
            { label: right.directoryName, snippet: descriptionOf(documents, right.skillId) },
          ],
        });
        addEdge("overlap", [left.skillId, right.skillId], id);
      }
    }
  }

  const severityOrder = { error: 0, warning: 1, info: 2 } as const;
  findings.sort(
    (left, right) =>
      severityOrder[left.severity] - severityOrder[right.severity] ||
      left.kind.localeCompare(right.kind) ||
      left.id.localeCompare(right.id),
  );
  return { snapshots, findings, edges: [...edges.values()] };
}

/** 取某技能正文中包含共享触发词且带反向指令标记的行。 */
function opposingLines(
  documents: AnalyzedDocument[],
  skillId: string,
  sharedTriggers: string[],
): string[] {
  const doc = documents.find((candidate) => candidate.skillId === skillId);
  if (!doc) return [];
  const { body } = splitDocument(doc.content);
  return body
    .split("\n")
    .filter(
      (line) =>
        OPPOSING_MARKERS.test(line) &&
        sharedTriggers.some((trigger) => line.toLowerCase().includes(trigger.toLowerCase())),
    )
    .map((line) => snippet(line))
    .slice(0, 3);
}

/** 取某技能的 description 原文。 */
function descriptionOf(documents: AnalyzedDocument[], skillId: string): string {
  const doc = documents.find((candidate) => candidate.skillId === skillId);
  if (!doc) return "";
  const { frontmatter } = splitDocument(doc.content);
  return typeof frontmatter.description === "string" ? frontmatter.description : "";
}

/** 计算两技能 description 的词元重叠率（Jaccard 于左侧并集口径）。 */
function descriptionOverlap(
  documents: AnalyzedDocument[],
  leftId: string,
  rightId: string,
): { shared: string[]; ratio: number } {
  const leftTokens = new Set(tokens(descriptionOf(documents, leftId)));
  const rightTokens = new Set(tokens(descriptionOf(documents, rightId)));
  if (leftTokens.size === 0 || rightTokens.size === 0) return { shared: [], ratio: 0 };
  const shared = [...leftTokens].filter((token) => rightTokens.has(token));
  const union = new Set([...leftTokens, ...rightTokens]);
  return { shared, ratio: shared.length / union.size };
}
