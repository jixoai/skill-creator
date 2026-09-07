/**
 * MCP Apps 卡片（dsh-kernel-rebase task 4.2；SEP-1865 形态）。
 *
 * 用户原始需求 [2026-09-08]：「如果你能通过 MCP-apps 提供一些交互卡片，这样你就
 * 可以去做一些应用内的跳转或者信息的卡片化，体验上会好很多。」
 *
 * 正交意图：
 *   [1] 四类卡片模板：skill 信息 / finding（校验发现）/ proposal / 安装更新
 *       结果；均携带应用内跳转意图（postMessage `ui/navigate`，host 翻译为
 *       shell 路由）。
 *   [2] 不可信文本强制 HTML escape：SKILL.md frontmatter / finding 内容等以
 *       文本插入模板——沙箱防逃逸不防内容注入，转义是内容层的责任。
 *   [3] ui:// 资源注册表：tool result `_meta.ui.resourceUri` 引用；资源本体由
 *       daemon 内存注册表供给（agent.card.get 代理；有界 LRU）。
 * 妥协声明：无——卡片 HTML 由 server 生成（模型不产 HTML；「智能在模型，渲染在
 *   host」）。
 */

/** 第一期卡片类型（闭合集合）。 */
export type UiCardType = "skill-info" | "finding" | "proposal" | "install-result";

/** 卡片数据（结构化字段；值均为不可信文本，模板层强制转义）。 */
export interface UiCardData {
  type: UiCardType;
  title: string;
  /** 有序字段表（label/value 成对渲染）。 */
  fields: Array<{ label: string; value: string }>;
  /** 应用内跳转意图（shell 路由 path；host 翻译）。 */
  nav?: { label: string; path: string };
}

/** HTML 文本转义（内容注入防线；对 <>&"' 全量转义）。 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const CARD_CSS = `
  :root { color-scheme: light dark; }
  body { margin: 0; font: 12px/1.5 -apple-system, "SF Pro Text", system-ui, sans-serif; }
  .card { border: 1px solid rgba(125,125,125,.35); border-radius: 10px; padding: 10px 12px; }
  .card h1 { font-size: 12px; margin: 0 0 6px; font-weight: 600; }
  .card .tag { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; opacity: .7; }
  .row { display: flex; gap: 8px; padding: 2px 0; }
  .row .label { min-width: 84px; opacity: .65; }
  .row .value { word-break: break-all; }
  button { margin-top: 8px; font: inherit; padding: 3px 10px; border-radius: 6px;
           border: 1px solid rgba(125,125,125,.4); background: transparent; cursor: pointer; }
  button:hover { background: rgba(125,125,125,.12); }
`;

/** 生成卡片 HTML（沙箱 iframe 渲染；跳转经 postMessage，无外部请求）。 */
export function buildCardHtml(card: UiCardData): string {
  const rows = card.fields
    .map(
      (field) =>
        `<div class="row"><span class="label">${escapeHtml(field.label)}</span><span class="value">${escapeHtml(field.value)}</span></div>`,
    )
    .join("");
  const nav = card.nav
    ? `<button type="button" data-nav="${escapeHtml(card.nav.path)}">${escapeHtml(card.nav.label)}</button>`
    : "";
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>${CARD_CSS}</style></head>
<body><div class="card" data-card-type="${escapeHtml(card.type)}">
<div class="tag">${escapeHtml(card.type)}</div>
<h1>${escapeHtml(card.title)}</h1>
${rows}
${nav}
</div>
<script>
  document.addEventListener("click", (event) => {
    const target = event.target.closest("button[data-nav]");
    if (!target) return;
    parent.postMessage({ source: "skill-creator-card", type: "ui/navigate", intent: target.dataset.nav }, "*");
  });
</script>
</body></html>`;
}

/** ui:// 卡片资源注册表（uri → HTML；有界 FIFO，daemon 生命周期）。 */
export class UiCardRegistry {
  private readonly entries = new Map<string, string>();
  constructor(private readonly capacity = 64) {}

  /** 注册一张卡并返回其 ui:// 资源 URI。 */
  register(card: UiCardData): string {
    const uri = `ui://card/${card.type}/${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    this.entries.set(uri, buildCardHtml(card));
    if (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    return uri;
  }

  get(uri: string): string | null {
    return this.entries.get(uri) ?? null;
  }
}

/** capability 结果 → 卡片投影（未知形状返回 null；字段文本均为不可信输入）。 */
export function uiCardForCapability(capabilityName: string, result: unknown): UiCardData | null {
  if (typeof result !== "object" || result === null) return null;
  const payload = result as { kind?: string; value?: unknown };
  if (payload.kind !== "ok") return null;
  const value = payload.value;
  if (typeof value !== "object" || value === null) return null;

  switch (capabilityName) {
    case "skills.info": {
      const info = value as {
        skillId?: string;
        name?: string;
        description?: string;
        directoryName?: string;
        disabled?: boolean;
        revision?: string;
      };
      if (typeof info.skillId !== "string") return null;
      return {
        type: "skill-info",
        title: info.name ?? info.directoryName ?? info.skillId,
        fields: [
          { label: "Directory", value: info.directoryName ?? "-" },
          { label: "Revision", value: (info.revision ?? "-").slice(0, 16) },
          { label: "State", value: info.disabled ? "disabled" : "enabled" },
          { label: "Description", value: info.description ?? "-" },
        ],
        nav: { label: "Open in Workspaces", path: "/workspaces" },
      };
    }
    case "skills.validate": {
      const validation = value as {
        success?: boolean;
        name?: string;
        errors?: string[];
        warnings?: string[];
      };
      const findings = [
        ...(validation.errors ?? []).map((message) => ({ label: "error", value: message })),
        ...(validation.warnings ?? []).map((message) => ({ label: "warning", value: message })),
      ];
      return {
        type: "finding",
        title: `${validation.name ?? "Skill"} — ${validation.success ? "valid" : "invalid"}`,
        fields: findings.slice(0, 8),
        nav: { label: "Open in Workspaces", path: "/workspaces" },
      };
    }
    case "skills.update.check": {
      const check = value as {
        results?: Array<{ name?: string; status?: string }>;
      };
      const entries = (check.results ?? []).filter(
        (entry) => entry.status === "outdated" || entry.status === "failed",
      );
      if (entries.length === 0) return null;
      return {
        type: "install-result",
        title: `Updates available — ${entries.length} skill(s)`,
        fields: entries.slice(0, 8).map((entry) => ({
          label: entry.name ?? "-",
          value: entry.status ?? "-",
        })),
        nav: { label: "Open update view", path: "/workspaces" },
      };
    }
    case "repository.install": {
      const summary = value as {
        kind?: string;
        installed?: number;
        overwritten?: number;
        skipped?: number;
        failed?: number;
      };
      if (summary.kind !== "result") return null;
      return {
        type: "install-result",
        title: "Install result",
        fields: [
          { label: "Installed", value: String(summary.installed ?? 0) },
          { label: "Overwritten", value: String(summary.overwritten ?? 0) },
          { label: "Skipped", value: String(summary.skipped ?? 0) },
          { label: "Failed", value: String(summary.failed ?? 0) },
        ],
        nav: { label: "Review in Workspaces", path: "/workspaces" },
      };
    }
    default:
      return null;
  }
}
