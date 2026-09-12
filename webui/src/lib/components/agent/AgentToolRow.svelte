<!--
  用户原始需求 [2026-09-12]（redesign §3.2 ToolRow / §4.1）：「一次调用一行
  （call+result 合并，现状两行推倒）。折叠态：[分型 icon] displayName · 摘要；
  运行中（call 已到无 result）= 摘要 .sweep。摘要分型：bash → args.description
  || command 首行；read/write/edit → cwd 相对化路径；其他 → 首个字符串参数截
  64ch。展开态分型卡（terminal/diff/read/image/通用 IN-OUT）」。
  正交意图：
  1. 合并工具行：DisclosureRow 语法 + toolCallId 关联的 call/result 单行视图
     （phase: calling/done/error；错误 = 名后红点 + 展开首行错误）。
  2. 分型展开卡：bash terminal / read·write·edit 文件窗（diff 行 +绿 -红 着色，
     纯展示层启发式）/ image JSON / 通用 IN-OUT 双滚动盒（各 max-h 150px，
     sticky 标签）；摘要按 argsText 前缀渐进解析（tool-args-delta 流式期间
     逐步变长）。
  3. 既有增值链路保留：proposed 结果 → AgentProposalCard（task 4.4）；uiCard
     引用 → AgentCard（task 4.2）。三面 payload 消费（args/result/uiCard）经
     module 侧最小 Zod schema safeParse 收窄，失败退化为纯文本渲染；2026-09-12
     codex R2 阻塞 3：content-block 候选（toolUiCardRefOf）、error envelope
     （projectToolErrorLine）、todo 摘要（todoSummaryOf）三处旁路 cast 一并收窄
     为共享投影纯函数，畸形子投影退化空/纯文本。
  妥协声明：cwd 相对化不可得（浏览器无 cwd 事实）——路径按原文截断展示。
-->
<script module lang="ts">
  import { z } from "zod";

  /**
   * 工具 payload 三面的最小消费 schema（2026-09-12 codex 阻塞 5：外部输入
   * unknown→safeParse，禁直读 cast）。args = 宽松 record；result = 字符串 /
   * content-blocks / record 三态；uiCard 只认现有消费字段。失败一律退纯文本。
   */
  const ToolArgsRecordSchema = z.record(z.string(), z.unknown());
  const ToolResultTextSchema = z.union([
    z.string(),
    z
      .object({
        content: z.array(z.object({ text: z.string().optional() }).loose()).optional(),
      })
      .loose(),
    z.record(z.string(), z.unknown()),
  ]);
  const ToolProposalResultSchema = z.object({
    kind: z.literal("proposed"),
    proposalId: z.string().min(1),
    capability: z.string().optional(),
    status: z.string().optional(),
  });
  const ToolUiCardRefSchema = z.object({
    uiCard: z.object({
      resourceUri: z.string().min(1),
      title: z.string().optional(),
    }),
  });
  /** result.content 的 blocks envelope（uiCard 内嵌候选提取面）。 */
  const ToolResultContentSchema = z.object({
    content: z.array(z.unknown()).optional(),
  });
  /** 单个 content block 的最小消费面：text 字符串（畸形 block 逐条丢弃）。 */
  const ToolContentBlockTextSchema = z.object({ text: z.string().optional() });
  /** todo 摘要条目消费面：status 字符串（计数用，其余字段忽略）。 */
  const TodoStatusEntrySchema = z.object({ status: z.string().optional() });
  /** tool-result 错误 envelope 消费面：非空 error 字符串。 */
  const ToolErrorEnvelopeSchema = z.object({ error: z.string().min(1).optional() });

  /**
   * argsText 的渐进解析：完整 JSON 直接 parse + Zod 收窄（非宽松对象 → null，
   * 退纯文本）；流式前缀（末串未闭合）按已知键名正则提取——已到手即展示，
   * 字符串闭合后自然变长（§4.1 渐进语义；正则逻辑与 2026-09-12 版保持一致）。
   */
  export function parseToolArgsRecord(
    argsText: string | undefined,
  ): Record<string, unknown> | null {
    if (argsText === undefined || argsText.length === 0) return null;
    try {
      const parsed: unknown = JSON.parse(argsText);
      const checked = ToolArgsRecordSchema.safeParse(parsed);
      return checked.success ? checked.data : null;
    } catch {
      const out: Record<string, unknown> = {};
      for (const key of [
        "command",
        "description",
        "file_path",
        "path",
        "pattern",
        "url",
        "query",
      ]) {
        const closed = argsText.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
        const open = closed ?? argsText.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\.)*)$`));
        if (open) out[key] = open[1];
      }
      return Object.keys(out).length > 0 ? out : null;
    }
  }

  /**
   * result 的文本投影：字符串直书；content blocks 拼接 text；其余（含 schema
   * 不兼容形状）JSON 化兜底——纯文本渲染永不因畸形 payload 缺席。
   */
  export function projectToolResultText(result: unknown): string {
    if (result === undefined) return "";
    const checked = ToolResultTextSchema.safeParse(result);
    if (checked.success) {
      const value = checked.data;
      if (typeof value === "string") return value;
      if (Array.isArray(value.content)) {
        const parts: string[] = [];
        for (const block of value.content) {
          if (typeof block.text === "string") parts.push(block.text);
        }
        if (parts.length > 0) return parts.join("\n");
      }
    }
    try {
      return JSON.stringify(result, null, 2) ?? "";
    } catch {
      return String(result);
    }
  }

  /** propose 结果的收窄投影：kind "proposed" + proposalId；否则 null。 */
  export function parseToolProposalResult(
    result: unknown,
    fallbackCapability: string,
  ): { proposalId: string; capability: string; status: string } | null {
    if (result === undefined) return null;
    const checked = ToolProposalResultSchema.safeParse(result);
    if (!checked.success) return null;
    return {
      proposalId: checked.data.proposalId,
      capability: checked.data.capability ?? fallbackCapability,
      status: checked.data.status ?? "pending",
    };
  }

  /**
   * tool-result 的 uiCard 引用（task 4.2 保留）：payload 直书或 content[].text
   * 内嵌 JSON 两处都尝试（投影修复后 payload 已是解析对象）；content blocks 与
   * JSON 内形状均经 safeParse 收窄（codex R2 阻塞 3：不再旁路 cast），畸形
   * block 逐条丢弃、不中则继续尝试下一候选。
   */
  export function toolUiCardRefOf(result: unknown): { resourceUri: string; title: string } | null {
    if (result === undefined) return null;
    const candidates: unknown[] = [result];
    const envelope = ToolResultContentSchema.safeParse(result);
    if (envelope.success && envelope.data.content !== undefined) {
      for (const block of envelope.data.content) {
        const parsed = ToolContentBlockTextSchema.safeParse(block);
        if (parsed.success && typeof parsed.data.text === "string") {
          candidates.push(parsed.data.text);
        }
      }
    }
    for (const candidate of candidates) {
      if (typeof candidate !== "string") continue;
      try {
        const parsed: unknown = JSON.parse(candidate);
        const checked = ToolUiCardRefSchema.safeParse(parsed);
        if (checked.success) {
          return {
            resourceUri: checked.data.uiCard.resourceUri,
            title: checked.data.uiCard.title ?? "Card",
          };
        }
      } catch {
        // 非 JSON 文本：跳过。
      }
    }
    return null;
  }

  /**
   * todo 摘要投影（codex R2 阻塞 3）：todos 数组 → `N todos · M done`；total =
   * 数组长度事实（畸形条目计入 total），done 只计经 schema 收窄的
   * status === "completed" 条目。非数组（含畸形 args.todos）→ null，退回通用
   * 摘要路径；畸形数据绝不进分类计数。
   */
  export function todoSummaryOf(todos: unknown): string | null {
    if (!Array.isArray(todos)) return null;
    let done = 0;
    for (const entry of todos) {
      const parsed = TodoStatusEntrySchema.safeParse(entry);
      if (parsed.success && parsed.data.status === "completed") done += 1;
    }
    const total = todos.length;
    return `${total} todo${total === 1 ? "" : "s"} · ${done} done`;
  }

  /**
   * 错误首行投影（codex R2 阻塞 3）：error envelope 经 safeParse 收窄，命中取
   * error 首行（与收窄前一致，可为空串）；否则回退结果文本首行截 80ch。畸形
   * result 永不进入 DOM 文本。
   */
  export function projectToolErrorLine(result: unknown, fallbackText: string): string {
    const envelope = ToolErrorEnvelopeSchema.safeParse(result);
    if (envelope.success && envelope.data.error !== undefined) {
      return (envelope.data.error.split("\n", 1)[0] ?? "").trim();
    }
    const line = (fallbackText.split("\n", 1)[0] ?? "").trim();
    return line.length > 80 ? `${line.slice(0, 80)}…` : line;
  }

  /**
   * diff 行着色（PM 修复 4，纯展示启发式）：^[-+](?![-+]) 命中的行以 10%
   * emerald（+）/ rose（-）底色渲染；+++/--- 头与普通行不着色。文本仍走
   * Svelte 插值（无 innerHTML）。
   */
  export function diffLineClass(line: string): string {
    if (/^\+(?![-+])/.test(line)) return "bg-emerald-500/10";
    if (/^-(?![-+])/.test(line)) return "bg-rose-500/10";
    return "";
  }
</script>

<script lang="ts">
  import IconTerminal from "@lucide/svelte/icons/terminal";
  import IconFileText from "@lucide/svelte/icons/file-text";
  import IconImage from "@lucide/svelte/icons/image";
  import IconWrench from "@lucide/svelte/icons/wrench";
  import type { Component } from "svelte";
  import DisclosureRow from "./DisclosureRow.svelte";
  import AgentCard from "./AgentCard.svelte";
  import AgentProposalCard from "./AgentProposalCard.svelte";

  let {
    toolName,
    argsText,
    result,
    phase,
    running = false,
    startedAt,
    endedAt,
  }: {
    toolName: string;
    argsText?: string;
    result?: unknown;
    phase: "calling" | "done" | "error";
    /** turn 运行中且本行尚无 result（父层以会话 status 合成）。 */
    running?: boolean;
    startedAt?: string;
    endedAt?: string;
  } = $props();

  let expanded = $state(false);

  /** 展示名去掉 MCP 命名空间前缀；完整名保留在 title 供悬停。 */
  const displayName = $derived(toolName.replace(/^mcp__[^_]+__/, ""));

  /** 分型：bash / file（read·write·edit 等）/ image / generic。 */
  type ToolKind = "bash" | "file" | "image" | "generic";
  const kind = $derived.by((): ToolKind => {
    const name = toolName.toLowerCase();
    if (name.includes("bash") || name.includes("shell") || name.includes("terminal")) {
      return "bash";
    }
    if (/read|write|edit|file|glob|grep/.test(name)) return "file";
    if (name.includes("image")) return "image";
    return "generic";
  });

  const kindIcon = $derived.by((): Component<{ class?: string }> =>
    kind === "bash"
      ? IconTerminal
      : kind === "file"
        ? IconFileText
        : kind === "image"
          ? IconImage
          : IconWrench,
  );

  const argsRecord = $derived(parseToolArgsRecord(argsText));

  const stringArg = (value: unknown): string => (typeof value === "string" ? value : "");

  function firstLine(text: string): string {
    const line = text.split("\n", 1)[0] ?? "";
    return line.trim();
  }

  /** 折叠摘要分型（§3.2）：bash description/命令首行；文件路径；首串参截 64ch。 */
  const summary = $derived.by(() => {
    const args = argsRecord;
    if (kind === "bash") {
      const described = stringArg(args?.description);
      if (described.length > 0) return described;
      const command = stringArg(args?.command);
      if (command.length > 0) return firstLine(command);
      return "";
    }
    if (kind === "file") {
      const path = stringArg(args?.file_path) || stringArg(args?.path);
      if (path.length > 0) return path;
    }
    const todoSummary = todoSummaryOf(args?.todos);
    if (todoSummary !== null) return todoSummary;
    if (args !== null) {
      for (const value of Object.values(args)) {
        if (typeof value === "string" && value.length > 0) {
          return value.length > 64 ? `${value.slice(0, 64)}…` : value;
        }
      }
      const compact = (() => {
        try {
          return JSON.stringify(args);
        } catch {
          return "";
        }
      })();
      if (compact.length > 0) return compact.length > 64 ? `${compact.slice(0, 64)}…` : compact;
    }
    return "";
  });

  const resultText = $derived(projectToolResultText(result));

  /** 错误首行：error envelope 经 safeParse 收窄（畸形退结果文本首行截 80ch）。 */
  const errorLine = $derived.by(() => {
    if (phase !== "error") return "";
    return projectToolErrorLine(result, resultText);
  });

  /** propose 结果（task 4.4 保留）：kind "proposed" 的 mutation proposal 待审批卡。 */
  const proposed = $derived(parseToolProposalResult(result, toolName));

  const uiCard = $derived(toolUiCardRefOf(result));

  const argsPretty = $derived.by(() => {
    if (argsText === undefined || argsText.length === 0) return "";
    try {
      const parsed: unknown = JSON.parse(argsText);
      return JSON.stringify(parsed, null, 2) ?? argsText;
    } catch {
      return argsText;
    }
  });

  /** 文件卡内容（resultText 优先，缺省回退参数 JSON）的按行拆分（diff 着色）。 */
  const fileCardLines = $derived.by(() =>
    (resultText.length > 0 ? resultText : argsPretty).split("\n"),
  );

  /** 卡头条的运行时长（endedAt - startedAt，秒一位小数）。 */
  const elapsedLabel = $derived.by(() => {
    if (startedAt === undefined || endedAt === undefined) return "";
    const ms = Date.parse(endedAt) - Date.parse(startedAt);
    if (!Number.isFinite(ms) || ms < 0) return "";
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  });

  const headerLabel = $derived.by(() => {
    const parts = [displayName];
    if (elapsedLabel) parts.push(elapsedLabel);
    if (phase === "error") parts.push("error");
    return parts.join(" · ");
  });
</script>

<div class="flow-item">
  {#if proposed}
    <AgentProposalCard
      proposalId={proposed.proposalId}
      capability={proposed.capability}
      input={result}
      status={proposed.status}
    />
  {:else if uiCard}
    <AgentCard resourceUri={uiCard.resourceUri} title={uiCard.title} />
  {/if}
  <DisclosureRow
    icon={kindIcon}
    title={displayName}
    {summary}
    open={expanded}
    running={running && phase === "calling"}
    error={phase === "error"}
    onToggle={() => (expanded = !expanded)}
  />
  {#if expanded}
    {#if phase === "error" && errorLine.length > 0}
      <div class="mt-1 rounded-lg bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
        {errorLine}
      </div>
    {/if}
    {#if kind === "bash"}
      <!-- 终端分型卡：暗底 pre + 头条 bash · duration -->
      {@const command = stringArg(argsRecord?.command)}
      <div class="tool-card mt-1 overflow-hidden border-border bg-[#0c1016] text-zinc-200">
        <div class="flex items-center justify-between px-2 py-1 text-[10px] text-zinc-400">
          <span>{headerLabel}</span>
          {#if running && phase === "calling"}<span class="sweep px-1">running</span>{/if}
        </div>
        <pre
          class="max-h-[260px] overflow-auto border-t border-white/10 px-2 py-1.5 whitespace-pre-wrap">{command.length >
          0
            ? `$ ${command}${resultText.length > 0 ? `\n\n${resultText}` : ""}`
            : resultText}</pre>
      </div>
    {:else if kind === "file"}
      <!-- 文件分型卡：路径头条 + 文本窗（diff 行 +绿/-红 着色，按行 span 插值）。 -->
      <div class="tool-card mt-1 overflow-hidden">
        <div class="truncate border-b border-border px-2 py-1 text-[10px] text-muted-foreground">
          {stringArg(argsRecord?.file_path) || stringArg(argsRecord?.path) || headerLabel}
        </div>
        <div class="max-h-[150px] overflow-auto px-2 py-1.5 whitespace-pre-wrap">
          {#each fileCardLines as line, index (index)}
            <span class={diffLineClass(line)}
              >{line}{index < fileCardLines.length - 1 ? "\n" : ""}</span
            >
          {/each}
        </div>
      </div>
    {:else if kind === "image"}
      <!-- 图片分型卡：payload JSON（引用/元数据，不含字节） -->
      <div class="tool-card mt-1 overflow-hidden">
        <div class="border-b border-border px-2 py-1 text-[10px] text-muted-foreground">
          {headerLabel}
        </div>
        <pre class="max-h-[150px] overflow-auto px-2 py-1.5 whitespace-pre-wrap">{argsPretty ||
            resultText}</pre>
      </div>
    {:else}
      <!-- 通用 IN-OUT 卡：双 sticky 标签滚动盒（各 max-h 150px） -->
      <div class="mt-1 space-y-1">
        {#if argsPretty.length > 0}
          <div class="tool-card max-h-[150px] overflow-auto">
            <div class="sticky top-0 bg-muted px-2 py-1 text-[10px] text-muted-foreground">
              Input
            </div>
            <pre class="px-2 py-1.5 whitespace-pre-wrap">{argsPretty}</pre>
          </div>
        {/if}
        {#if resultText.length > 0}
          <div class="tool-card max-h-[150px] overflow-auto">
            <div class="sticky top-0 bg-muted px-2 py-1 text-[10px] text-muted-foreground">
              Output
            </div>
            <pre class="px-2 py-1.5 whitespace-pre-wrap">{resultText}</pre>
          </div>
        {:else if phase === "calling"}
          <div class="tool-card sweep px-2 py-1.5 text-muted-foreground">running…</div>
        {/if}
      </div>
    {/if}
  {/if}
</div>
