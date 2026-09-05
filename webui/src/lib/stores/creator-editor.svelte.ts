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
import type { SkillDocument } from "../types";
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
