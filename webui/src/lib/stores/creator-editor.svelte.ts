/**
 * 用户原始需求 [2026-07-27]：「Creator 编辑 tab 左右分栏……右侧子视图」。
 * 正交意图：
 *   [1] 把 Creator 编辑会话的草稿状态以 Svelte context 暴露给子视图，使 File 子视图写入
 *       与 Preview 子视图渲染共享同一份可响应草稿。
 *   [2] 草稿归属：草稿存组件级 $state（不写 localStorage、不写 daemon），仅在当前编辑 Tab 内有效。
 * 妥协声明：草稿只承载 SkillFrontmatterSchema 必填字段（name/description）+ body；未知 frontmatter
 * 字段在保存时由 File 子视图透传，不进入草稿表单。纯数据形状与构造器在 creator-draft.ts。
 */
import { getContext, hasContext, setContext } from "svelte";
import type { SkillDocument, WorkspaceProviderTarget } from "../types";
import type { CreatorDraft } from "./creator-draft";

export type { CreatorDraft } from "./creator-draft";
export { draftToFrontmatter, editDraft, emptyDraft, placeholderDraft } from "./creator-draft";

/** Creator 编辑会话上下文值（持有一个响应式 draft 与一组 mutator）。 */
export interface CreatorEditorContext {
  /** 当前草稿（响应式 $state 对象）。 */
  readonly draft: CreatorDraft;
  /** 用加载的 SkillDocument 重置草稿（edit 模式）。 */
  hydrateFromDocument(document: SkillDocument): void;
  /** 保存成功后更新 revision（避免下次保存触发 CONFLICT）。 */
  advanceRevision(revision: string): void;
}

const CREATOR_EDITOR_KEY = Symbol("skill-creator:creator-editor");

/**
 * 创建并下发一个 Creator 编辑会话上下文。
 * 由 CreatorWorkspace 在挂载时调用一次；子视图通过 `useCreatorEditor()` 消费。
 */
export function provideCreatorEditor(initial: CreatorDraft): CreatorEditorContext {
  const draft = $state<CreatorDraft>(initial);
  const context: CreatorEditorContext = {
    get draft() {
      return draft;
    },
    hydrateFromDocument(document) {
      draft.skillId = document.skillId;
      draft.name = String(document.frontmatter.name ?? "");
      draft.description = String(document.frontmatter.description ?? "");
      draft.body = document.body;
      draft.revision = document.revision;
      draft.directoryName = document.directoryName;
      const { name: _name, description: _desc, ...rest } = document.frontmatter;
      void _name;
      void _desc;
      draft.extraFrontmatter = rest;
    },
    advanceRevision(revision) {
      draft.revision = revision;
    },
  };
  setContext(CREATOR_EDITOR_KEY, context);
  return context;
}

/** 消费当前 Creator 编辑会话上下文；必须在 CreatorWorkspace 内调用。 */
export function useCreatorEditor(): CreatorEditorContext {
  if (!hasContext(CREATOR_EDITOR_KEY)) {
    throw new Error("[creator-editor] useCreatorEditor 必须在 <CreatorWorkspace> 内调用");
  }
  return getContext<CreatorEditorContext>(CREATOR_EDITOR_KEY);
}

// ---------------------------------------------------------------------------
// 3.1c：跨卸载草稿缓存 + 身份级 hydration 标记。
// 草稿仍由 route identity 拥有（保存/冲突/删除语义不变）；缓存只把同一 JS realm
// 内该 identity 的草稿生命周期延长到组件卸载之后——island 关闭→重开（与官方
// session 往返）或子视图往返不丢 dirty draft，也不重置已 hydrate 的 baseline。
// ---------------------------------------------------------------------------

/** 草稿身份键：mode + Workspace Provider 目标 +（edit 时）skillId。 */
export function creatorDraftKey(
  target: WorkspaceProviderTarget | null,
  mode: "edit" | "new",
  skillId: string | null,
): string | null {
  if (!target) return null;
  return `${mode}:${target.workspaceId}/${target.providerId}${skillId === null ? "" : `/${skillId}`}`;
}

const cachedDrafts = new Map<string, CreatorDraft>();
const hydratedIdentities = new Set<string>();

/** 快照拷贝：$state proxy 不跨卸载复用，缓存只存普通对象。 */
export function snapshotCreatorDraft(draft: CreatorDraft): CreatorDraft {
  return {
    ...draft,
    target: { ...draft.target },
    extraFrontmatter: { ...draft.extraFrontmatter },
  };
}

export function cacheCreatorDraft(key: string, draft: CreatorDraft): void {
  cachedDrafts.set(key, snapshotCreatorDraft(draft));
}

/** 取出缓存草稿（返回独立快照；无缓存返回 null）。 */
export function takeCachedCreatorDraft(key: string): CreatorDraft | null {
  const cached = cachedDrafts.get(key);
  return cached === undefined ? null : snapshotCreatorDraft(cached);
}

export function dropCachedCreatorDraft(key: string): void {
  cachedDrafts.delete(key);
}

/** 标记某身份已从服务器拉取过文档：同一身份只自动 hydrate 一次。 */
export function markDraftHydrated(key: string): void {
  hydratedIdentities.add(key);
}

export function isDraftHydrated(key: string): boolean {
  return hydratedIdentities.has(key);
}

/** 显式重载（conflict 恢复 / 手动 Retry）清除标记，允许重新拉取。 */
export function resetDraftHydration(key: string): void {
  hydratedIdentities.delete(key);
}
