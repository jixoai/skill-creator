/**
 * 用户原始需求 [2026-07-27]：「Creator 编辑 tab 左右分栏……草稿存组件级 $state。」
 * 正交意图：
 *   [1] Creator 草稿的纯数据形状与构造器（不依赖 svelte 运行时，可单测）。
 *   [2] 草稿 → SkillFrontmatter 的投影（必填字段覆盖、未知字段透传）。
 *   [3] new 模式草稿结构化校验（creator-editor-polish Ch5；字段级错误文案）。
 * 妥协声明：无。context 生命周期（provide/use）留在 creator-editor.svelte.ts。
 */
import { SkillDirectoryNameSchema } from "$shared/contracts/creator.js";
import { ProviderIdSchema, WorkspaceIdSchema } from "$shared/contracts/workspaces.js";
import type { SkillFrontmatter, WorkspaceProviderTarget } from "../types";
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

/** new 模式草稿的字段级校验结果（null = 该字段通过）。 */
export interface NewDraftErrors {
  directoryName: string | null;
  name: string | null;
  description: string | null;
}

const NEW_DRAFT_CLEAN: NewDraftErrors = {
  directoryName: null,
  name: null,
  description: null,
};

/**
 * new 模式草稿结构化校验（creator-editor-polish Ch5）：directoryName 规则 +
 * name/description 修剪后非空；edit 模式恒通过（revision 语义由服务端契约约束）。
 */
export function validateNewDraft(draft: CreatorDraft): NewDraftErrors {
  if (draft.mode !== "new") return NEW_DRAFT_CLEAN;
  return {
    directoryName: SkillDirectoryNameSchema.safeParse(draft.directoryName).success
      ? null
      : "Use lowercase letters, numbers, and hyphens.",
    name: draft.name.trim().length > 0 ? null : "Name is required.",
    description: draft.description.trim().length > 0 ? null : "Description is required.",
  };
}

/** 任一字段未过 → true（Save 禁用联动）。 */
export function hasNewDraftErrors(errors: NewDraftErrors): boolean {
  return errors.directoryName !== null || errors.name !== null || errors.description !== null;
}
