<!--
  用户原始需求 [2026-10-06]（skills-tabs-redesign 批 3，design.md Δ2 定稿 + fuse2
  硬性裁决 2）：「detail = 轻量 CodeEditor——左文件树（目录折叠、当前高亮、
  ?file= 深链）+ 中内容查看器（SKILL.md 默认、frontmatter 独立身份源块、代码
  等宽+行号、filebar 路径 + 语言 tag + statusbar 只读契约）」。
  正交意图：
  1. 数据面：skills.files（树）与 skills.fileRead（内容）组件级 request-generation
     gate（latest-request-wins；身份/文件变化即重取——daemon 每次调用重解析，
     客户端不缓存树/内容跨渲染周期）。
  2. 树语义：服务端前序 DFS 展平序即渲染序（不重建嵌套）；目录折叠 = 祖先
     展开集过滤；conflict 非激活身份文件标 disabled；TOO_LARGE 截断提示。
  3. 查看器语义：.md 渲染正文（renderSkillBody sanitize）+ frontmatter 独立
     身份源块（仅身份文档标注）；非 md 等宽 + 行号 + 悬停行高亮；BINARY/
     NOT_FOUND/INVALID_PATH typed 错误投影为有限状态（不解析字符串）。
  4. 窄屏（page 容器 <692px，与批 2 单列降档同源阈值）：树降级横向 chips
     （h-11 ≥44px 命中）、内容单列；宽屏 = 树列 + 查看器双栏。
  只读纪律：零写 RPC；statusbar 恒示「只读 — 编辑入口在 Creator」。
-->
<script lang="ts">
  import { ORPCError } from "@orpc/client";
  import { getConnectionGeneration, requireRpc } from "$lib/store.svelte";
  import { formatSize } from "$lib/format";
  import { splitSkillContent, renderSkillBody } from "$lib/render-skill-md";
  import { createRequestGenerationGate } from "$lib/stores/request-generation";
  import { t } from "$lib/i18n";
  import type { SkillId, SkillInfo } from "$shared/contracts/skills.js";
  import type { SkillFileEntry, SkillFilesResult } from "$shared/contracts/skill-files.js";
  import type { WorkspaceProviderTarget } from "$shared/contracts/workspaces.js";
  import {
    isIdentityDocument,
    isMarkdownDocument,
    languageLabelFor,
  } from "./skill-file-language.js";
  import IconBinary from "@lucide/svelte/icons/file-warning";
  import IconChevron from "@lucide/svelte/icons/chevron-right";
  import IconFile from "@lucide/svelte/icons/file-text";
  import IconFolder from "@lucide/svelte/icons/folder";
  import IconFolderOpen from "@lucide/svelte/icons/folder-open";
  import IconLoader from "@lucide/svelte/icons/loader-circle";
  import IconSearchX from "@lucide/svelte/icons/search-x";

  let {
    target,
    skillId,
    info,
    initialFile = "",
  }: {
    target: WorkspaceProviderTarget;
    skillId: SkillId;
    info: SkillInfo;
    /** `?from=` 的 file 键深链（parseListStateParam 已收窄）；"" = 无深链。 */
    initialFile?: string;
  } = $props();

  // ---- 文件树（skills.files；身份变化即重取） ----

  const treeRequests = createRequestGenerationGate(getConnectionGeneration);
  let entries = $state<SkillFileEntry[] | null>(null);
  let treeLoading = $state(true);
  let treeError = $state<string | null>(null);
  let treeTruncated = $state(false);
  /** 目录折叠态：展开目录路径集（默认全展开——树一眼可见，折叠是用户选择）。 */
  let expanded = $state<ReadonlySet<string>>(new Set());

  $effect(() => {
    const currentTarget = target;
    const currentSkillId = skillId;
    void (async () => {
      const request = treeRequests.issue();
      treeError = null;
      try {
        const result: SkillFilesResult = await requireRpc().skills.files({
          workspaceId: currentTarget.workspaceId,
          providerId: currentTarget.providerId,
          skillId: currentSkillId,
        });
        if (!request.isCurrent()) return;
        entries = result.entries;
        treeTruncated = result.truncationReason === "TOO_LARGE";
        expanded = new Set(
          result.entries.filter((entry) => entry.kind === "dir").map((entry) => entry.path),
        );
      } catch (error) {
        if (!request.isCurrent()) return;
        entries = null;
        treeTruncated = false;
        treeError = error instanceof Error ? error.message : String(error);
      } finally {
        if (request.isLatest()) treeLoading = false;
      }
    })();
  });

  function toggleDir(dirPath: string): void {
    const next = new Set(expanded);
    if (next.has(dirPath)) next.delete(dirPath);
    else next.add(dirPath);
    expanded = next;
  }

  /** 条目可见性：全部祖先目录都在展开集内（前序扁平序渲染，不建嵌套）。 */
  function isVisible(entry: SkillFileEntry): boolean {
    const segments = entry.path.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      if (!expanded.has(segments.slice(0, index).join("/"))) return false;
    }
    return true;
  }

  function depthOf(entry: SkillFileEntry): number {
    return entry.path.split("/").length;
  }

  function baseName(entry: SkillFileEntry): string {
    return entry.path.split("/").pop() ?? entry.path;
  }

  // ---- 选中文件与内容（skills.fileRead） ----

  /** 显式选择优先；缺省 = from= 的 file 深链；再缺省 = 激活身份源文档。 */
  let selected = $state<string | null>(null);
  const defaultFile = $derived(info.disabled ? ".SKILL.md" : "SKILL.md");
  const activeFile = $derived(selected ?? (initialFile !== "" ? initialFile : defaultFile));

  const contentRequests = createRequestGenerationGate(getConnectionGeneration);
  type ContentState =
    | { kind: "loading" }
    | { kind: "binary" }
    | { kind: "failed"; message: string }
    | { kind: "loaded"; content: string; size: number; truncated: boolean };
  let content = $state<ContentState>({ kind: "loading" });

  $effect(() => {
    const currentTarget = target;
    const currentSkillId = skillId;
    const filePath = activeFile;
    void (async () => {
      const request = contentRequests.issue();
      content = { kind: "loading" };
      try {
        const read = await requireRpc().skills.fileRead({
          workspaceId: currentTarget.workspaceId,
          providerId: currentTarget.providerId,
          skillId: currentSkillId,
          path: filePath,
        });
        if (!request.isCurrent()) return;
        content = { kind: "loaded", ...read };
      } catch (error) {
        if (!request.isCurrent()) return;
        // typed 错误有限投影（客户端不解析字符串消息）。
        if (error instanceof ORPCError && error.code === "BINARY") {
          content = { kind: "binary" };
        } else {
          content = {
            kind: "failed",
            message: error instanceof Error ? error.message : String(error),
          };
        }
      }
    })();
  });

  const activeEntry = $derived(
    entries?.find((entry) => entry.kind === "file" && entry.path === activeFile) ?? null,
  );

  /** 行视图（非 md 文本）：尾随换行不产空行（"a\nb\n" = 2 行）。 */
  const codeLines = $derived.by(() => {
    if (content.kind !== "loaded" || isMarkdownDocument(activeFile)) return [];
    let text = content.content;
    if (text.endsWith("\n")) text = text.slice(0, -1);
    return text.length === 0 ? [] : text.split("\n");
  });

  const identitySplit = $derived.by(() => {
    if (content.kind !== "loaded" || !isMarkdownDocument(activeFile)) return null;
    const split = splitSkillContent(content.content);
    return Object.keys(split.frontmatter).length > 0 ? split : null;
  });
  const markdownBody = $derived(identitySplit ? renderSkillBody(identitySplit.body) : "");
  const plainBody = $derived.by(() => {
    if (content.kind !== "loaded" || !isMarkdownDocument(activeFile) || identitySplit) return "";
    return renderSkillBody(content.content);
  });

  const statusParts = $derived.by(() => {
    if (content.kind !== "loaded") return [];
    const parts = [languageLabelFor(activeFile), formatSize(content.size)];
    if (codeLines.length > 0) {
      parts.push(t("skillsWorkspace.skillDetail.linesCount", { count: codeLines.length }));
    }
    if (content.truncated) parts.push(t("skillsWorkspace.skillDetail.truncatedNote"));
    return parts;
  });

  const fileEntries = $derived((entries ?? []).filter((entry) => entry.kind === "file"));
</script>

<div class="detail-editor" data-testid="skill-detail-editor">
  {#if treeLoading && entries === null}
    <div
      class="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground"
      role="status"
    >
      <IconLoader class="h-4 w-4 animate-spin" />
      {t("skillDetail.loading")}
    </div>
  {:else if treeError}
    <p class="p-3 text-xs text-destructive" role="alert">{treeError}</p>
  {:else if entries}
    <!-- 窄屏：树降级横向 chips（文件项；h-11 ≥44px 命中）。 -->
    <div class="editor-chips" role="group" aria-label={t("skillsWorkspace.skillDetail.fileTree")}>
      {#each fileEntries as entry (entry.path)}
        <button
          type="button"
          aria-pressed={entry.path === activeFile}
          class="editor-chip"
          title={entry.path}
          data-testid="file-chip"
          onclick={() => (selected = entry.path)}
        >
          <span class="truncate">{baseName(entry)}</span>
          {#if entry.disabled}
            <span class="text-[10px] uppercase text-amber-600 dark:text-amber-400">
              {t("skillDetail.disabledBadge")}
            </span>
          {/if}
        </button>
      {/each}
    </div>

    <div class="editor-grid">
      <!-- 宽屏：文件树列（前序扁平序 + 祖先展开过滤 + 目录折叠）。 -->
      <nav class="editor-tree" aria-label={t("skillsWorkspace.skillDetail.fileTree")}>
        {#if treeTruncated}
          <p
            class="border-b border-border/60 px-2 py-1.5 text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400"
          >
            {t("skillsWorkspace.skillDetail.treeTruncated")}
          </p>
        {/if}
        {#if entries.length === 0}
          <p class="px-2 py-3 text-xs text-muted-foreground">
            {t("skillsWorkspace.skillDetail.fileTreeEmpty")}
          </p>
        {/if}
        {#each entries as entry (entry.path)}
          {#if isVisible(entry)}
            {#if entry.kind === "dir"}
              <button
                type="button"
                class="tree-row"
                style="padding-left: {(depthOf(entry) - 1) * 14 + 6}px"
                aria-expanded={expanded.has(entry.path)}
                data-testid="tree-dir"
                data-path={entry.path}
                onclick={() => toggleDir(entry.path)}
              >
                <span class="tree-chevron" class:rotated={expanded.has(entry.path)}>
                  <IconChevron class="h-3 w-3" aria-hidden="true" />
                </span>
                {#if expanded.has(entry.path)}
                  <IconFolderOpen
                    class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                {:else}
                  <IconFolder
                    class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                {/if}
                <span class="truncate">{baseName(entry)}</span>
              </button>
            {:else}
              <button
                type="button"
                class="tree-row"
                class:selected={entry.path === activeFile}
                style="padding-left: {(depthOf(entry) - 1) * 14 + 6}px"
                aria-current={entry.path === activeFile ? "true" : undefined}
                data-testid="tree-file"
                data-path={entry.path}
                onclick={() => (selected = entry.path)}
              >
                <IconFile class="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span class="min-w-0 flex-1 truncate text-left">{baseName(entry)}</span>
                {#if entry.disabled}
                  <span
                    class="shrink-0 text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400"
                    title={t("skillsWorkspace.skillDetail.conflictDisabledHint")}
                  >
                    {t("skillDetail.disabledBadge")}
                  </span>
                {/if}
              </button>
            {/if}
          {/if}
        {/each}
      </nav>

      <!-- 查看器：filebar + 内容 + statusbar（只读契约恒示）。 -->
      <section class="editor-viewer" aria-label={t("skillsWorkspace.skillDetail.viewerTitle")}>
        <div class="editor-filebar">
          <span class="min-w-0 flex-1 truncate font-mono text-[11px]" data-testid="filebar-path"
            >{activeFile}</span
          >
          {#if activeEntry?.disabled}
            <span
              class="shrink-0 text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400"
            >
              {t("skillDetail.disabledBadge")}
            </span>
          {/if}
          <span
            class="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
            data-testid="filebar-language"
          >
            {languageLabelFor(activeFile)}
          </span>
        </div>

        <div class="editor-content" data-testid="editor-content">
          {#if content.kind === "loading"}
            <div
              class="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground"
              role="status"
            >
              <IconLoader class="h-4 w-4 animate-spin" />
              {t("skillDetail.loading")}
            </div>
          {:else if content.kind === "binary"}
            <div class="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
              <IconBinary class="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              <p class="text-xs font-medium text-muted-foreground" data-testid="binary-state">
                {t("skillsWorkspace.skillDetail.binaryFile")}
              </p>
              <p class="break-all font-mono text-[11px] text-muted-foreground/70">{activeFile}</p>
            </div>
          {:else if content.kind === "failed"}
            <div class="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
              <IconSearchX class="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              <p class="text-xs font-medium text-destructive" data-testid="file-failed-state">
                {t("skillsWorkspace.skillDetail.fileReadFailed")}
              </p>
              <p class="max-w-md break-all font-mono text-[11px] text-muted-foreground/70">
                {content.message}
              </p>
            </div>
          {:else if identitySplit}
            <!-- frontmatter 独立身份源块（仅身份文档标注「身份源」）。 -->
            <div class="editor-prose">
              <div class="fm-block" data-testid="frontmatter-block">
                <p class="fm-source">{t("skillsWorkspace.skillDetail.frontmatterSource")}</p>
                <dl>
                  {#each Object.entries(identitySplit.frontmatter) as [key, value]}
                    <div class="fm-row">
                      <dt>{key}</dt>
                      <dd>{value === null ? "null" : String(value)}</dd>
                    </div>
                  {/each}
                </dl>
              </div>
              <div
                class="prose prose-sm max-w-none prose-pre:whitespace-pre-wrap prose-pre:break-words"
              >
                {@html markdownBody}
              </div>
            </div>
          {:else if plainBody}
            <div class="editor-prose">
              <div
                class="prose prose-sm max-w-none prose-pre:whitespace-pre-wrap prose-pre:break-words"
              >
                {@html plainBody}
              </div>
            </div>
          {:else if codeLines.length > 0}
            <!-- 代码视图：等宽 + 行号 + 悬停行高亮。 -->
            <pre class="code-view" data-testid="code-view"><code
                >{#each codeLines as line, index (index)}<span class="code-row"
                    ><span class="code-ln" aria-hidden="true">{index + 1}</span><span
                      class="code-text">{line}</span
                    ></span
                  >{/each}</code
              ></pre>
          {:else}
            <p class="p-4 text-xs text-muted-foreground">{t("skillDetail.emptyBody")}</p>
          {/if}
        </div>

        <div class="editor-statusbar" data-testid="editor-statusbar">
          <span class="min-w-0 truncate">
            {#if content.kind === "loaded"}{statusParts.join(" · ")}{/if}
          </span>
          <span class="shrink-0 text-muted-foreground/80">
            {t("skillsWorkspace.skillDetail.readonlyStatus")}
          </span>
        </div>
      </section>
    </div>
  {/if}
</div>

<style>
  .detail-editor {
    display: flex;
    height: 340px;
    min-height: 0;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 8px;
    background: var(--background, #fff);
  }
  /* 窄屏基线形态：单列（仅查看器；树列退场、chips 承担文件选择）。 */
  .editor-grid {
    display: grid;
    min-height: 0;
    flex: 1;
    grid-template-columns: minmax(0, 1fr);
  }
  /* 窄屏默认形态：树降级横向 chips（h-11 ≥44px 命中 + 横滚 + 边缘渐隐）。 */
  .editor-chips {
    display: flex;
    flex: none;
    gap: 6px;
    overflow-x: auto;
    scrollbar-width: none;
    padding: 8px;
    border-bottom: 1px solid var(--border, #e5e7eb);
    mask-image: linear-gradient(to right, black 92%, transparent);
  }
  .editor-chips::-webkit-scrollbar {
    display: none;
  }
  .editor-chip {
    display: inline-flex;
    min-height: 44px;
    max-width: 180px;
    flex: none;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 8px;
    padding: 0 12px;
    font-size: 12px;
  }
  .editor-chip[aria-pressed="true"] {
    border-color: var(--primary, #7c3aed);
    background: color-mix(in srgb, var(--primary, #7c3aed) 10%, transparent);
    font-weight: 500;
  }
  .editor-tree {
    display: none;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    border-right: 1px solid var(--border, #e5e7eb);
    padding: 4px 0;
  }
  /* 宽屏（page 容器 ≥692px，与批 2 两栏阈值共源）：树列 + 查看器双栏。 */
  @container skill-detail (min-width: 692px) {
    .detail-editor {
      height: 460px;
    }
    .editor-grid {
      grid-template-columns: minmax(140px, 200px) minmax(0, 1fr);
    }
    .editor-tree {
      display: block;
    }
    .editor-chips {
      display: none;
    }
  }
  .tree-row {
    display: flex;
    width: 100%;
    height: 28px;
    align-items: center;
    gap: 4px;
    padding-right: 8px;
    font-size: 12px;
    color: var(--muted-foreground, #6b7280);
    text-align: left;
  }
  .tree-row:hover {
    background: color-mix(in srgb, var(--foreground, #111827) 5%, transparent);
  }
  .tree-row.selected {
    background: color-mix(in srgb, var(--primary, #7c3aed) 12%, transparent);
    color: var(--foreground, #111827);
    font-weight: 500;
  }
  .tree-chevron {
    width: 12px;
    height: 12px;
    flex: none;
    transition: transform 120ms ease-out;
  }
  .tree-chevron.rotated {
    transform: rotate(90deg);
  }
  .editor-viewer {
    display: flex;
    min-height: 0;
    min-width: 0;
    flex-direction: column;
  }
  .editor-filebar {
    display: flex;
    flex: none;
    align-items: center;
    gap: 8px;
    border-bottom: 1px solid var(--border, #e5e7eb);
    padding: 6px 10px;
  }
  .editor-content {
    min-height: 0;
    flex: 1;
    overflow: auto;
    overscroll-behavior: contain;
  }
  .editor-prose {
    padding: 12px 14px;
  }
  .fm-block {
    margin-bottom: 12px;
    overflow: hidden;
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 8px;
  }
  .fm-source {
    display: flex;
    align-items: center;
    gap: 6px;
    border-bottom: 1px solid var(--border, #e5e7eb);
    background: color-mix(in srgb, var(--muted, #f3f4f6) 60%, transparent);
    padding: 4px 10px;
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--muted-foreground, #6b7280);
  }
  .fm-source::before {
    content: "";
    width: 6px;
    height: 6px;
    border-radius: 9999px;
    background: var(--primary, #7c3aed);
  }
  .fm-row {
    display: grid;
    grid-template-columns: 120px minmax(0, 1fr);
  }
  .fm-row + .fm-row {
    border-top: 1px solid var(--border, #e5e7eb);
  }
  .fm-row dt {
    padding: 4px 10px;
    font-size: 12px;
    font-weight: 500;
    color: var(--muted-foreground, #6b7280);
    background: color-mix(in srgb, var(--muted, #f3f4f6) 40%, transparent);
  }
  .fm-row dd {
    padding: 4px 10px;
    font-size: 12px;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }
  .code-view {
    margin: 0;
    padding: 8px 0;
    font-family: var(--mono, ui-monospace, monospace);
    font-size: 12px;
    line-height: 1.55;
  }
  .code-row {
    display: flex;
    min-width: max-content;
    padding: 0 12px 0 0;
  }
  .code-row:hover {
    background: color-mix(in srgb, var(--foreground, #111827) 5%, transparent);
  }
  .code-ln {
    flex: none;
    width: 40px;
    padding-right: 12px;
    text-align: right;
    color: color-mix(in srgb, var(--muted-foreground, #6b7280) 60%, transparent);
    user-select: none;
  }
  .code-text {
    white-space: pre;
  }
  .editor-statusbar {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    border-top: 1px solid var(--border, #e5e7eb);
    padding: 4px 10px;
    font-size: 10px;
    color: var(--muted-foreground, #6b7280);
  }
</style>
