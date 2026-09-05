/**
 * 用户原始需求 [2026-07-27]：「Creator 编辑 tab 左右分栏……右侧子视图」。
 * 正交意图：
 *   [1] 把 Creator 编辑会话的草稿状态（frontmatter name/description + body + revision）以 Svelte context
 *       暴露给子视图，使 File 子视图写入与 Preview 子视图渲染共享同一份可响应草稿。
 *   [2] 草稿归属：草稿存组件级 $state（不写 localStorage、不写 daemon），仅在当前编辑 Tab 内有效。
 * 妥协声明：草稿只承载 SkillFrontmatterSchema 必填字段（name/description）+ body；未知 frontmatter
 *   字段在保存时由 File 子视图透传，不进入草稿表单。
 */
import { getContext, hasContext, setContext } from "svelte";
import { ProviderIdSchema, WorkspaceIdSchema } from "$shared/contracts/workspaces.js";
import type { SkillDocument, SkillFrontmatter, WorkspaceProviderTarget } from "../types";
import type { SkillId } from "../types";

/** Creator 编辑会话草稿。 */
export interface CreatorDraft {
  /** 编辑模式：edit 为已存在技能，new 为新建。 */
  mode: "edit" | "new";
  /** Workspace Provider 目标（agent cwd 与 RPC target）。 */
  target: WorkspaceProviderTarget;
  /** 已存在技能的不透明 id；new 模式为 null。 */
  skillId: SkillId | null;
  /** 草稿 name（frontmatter 必填）。 */
  name: string;
  /** 草稿 description（frontmatter 必填）。 */
  description: string;
  /** 草稿 markdown 正文（已剥离 frontmatter）。 */
  body: string;
  /** 已加载文档的 revision（edit 模式保存时作为 expectedRevision）；new 模式为 null。 */
  revision: string | null;
  /** 透传的未知 frontmatter 字段（保存时回写）。 */
  extraFrontmatter: Record<string, unknown>;
  /** 新建模式下的目录名草稿。 */
  directoryName: string;
}

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

/** 构造一个空白草稿（new 模式）。 */
export function emptyDraft(target: WorkspaceProviderTarget, directoryName = ""): CreatorDraft {
  return {
    mode: "new",
    target,
    skillId: null,
    name: "",
    description: "",
    body: "",
    revision: null,
    extraFrontmatter: {},
    directoryName,
  };
}

/** 一个合法但无意义的默认 Workspace Provider 目标（占位草稿用）。 */
const PLACEHOLDER_TARGET: WorkspaceProviderTarget = {
  workspaceId: WorkspaceIdSchema.parse("~"),
  providerId: ProviderIdSchema.parse("user"),
};

/**
 * 构造一个占位草稿：所有身份字段为合法但无意义的初值，仅用于 `provideCreatorEditor`
 * 初始化 context；调用方随后通过 `$effect` 把真实派生草稿同步进去。
 */
export function placeholderDraft(): CreatorDraft {
  return {
    mode: "new",
    target: PLACEHOLDER_TARGET,
    skillId: null,
    name: "",
    description: "",
    body: "",
    revision: null,
    extraFrontmatter: {},
    directoryName: "",
  };
}

/** 构造一个 edit 模式草稿占位（实际值由 loadSkillDoc 后 hydrate 填充）。 */
export function editDraft(target: WorkspaceProviderTarget, skillId: SkillId): CreatorDraft {
  return {
    mode: "edit",
    target,
    skillId,
    name: "",
    description: "",
    body: "",
    revision: null,
    extraFrontmatter: {},
    directoryName: "",
  };
}

/** 把草稿投影为 SkillFrontmatter（合并必填字段与透传未知字段）。 */
export function draftToFrontmatter(draft: CreatorDraft): SkillFrontmatter {
  return {
    ...draft.extraFrontmatter,
    name: draft.name,
    description: draft.description,
  };
}
