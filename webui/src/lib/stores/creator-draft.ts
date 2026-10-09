/**
 * 用户原始需求 [2026-07-27]：「Creator 编辑 tab 左右分栏……草稿存组件级 $state。」
 * 修订 [2026-10-09]（creator-skill-store 批 2）：new 模式全部落 origin store——
 * 草稿身份去 provider 化；store 编辑（mode="store"）以 directoryName 为身份，
 * load/save 走 creatorStore.*（revision 契约同币）。
 * 正交意图：
 *   [1] Creator 草稿的纯数据形状与构造器（不依赖 svelte 运行时，可单测）。
 *   [2] 草稿 → SkillFrontmatter 的投影（必填字段覆盖、未知字段透传）。
 *   [3] new 模式草稿结构化校验（creator-editor-polish Ch5；错误值为 i18n 词典 key，
 *       展示文案归消费组件 t() 渲染——webui-i18n-bilingual 4.1）。
 * 妥协声明：无。context 生命周期（provide/use）留在 creator-editor.svelte.ts。
 */
import { SkillDirectoryNameSchema } from "$shared/contracts/creator.js";
import { ProviderIdSchema, WorkspaceIdSchema } from "$shared/contracts/workspaces.js";
import type { SkillFrontmatter, WorkspaceProviderTarget } from "../types";
import type { SkillId } from "../types";

/** Creator 编辑会话草稿。 */
export interface CreatorDraft {
  /**
   * 编辑模式：edit = 已安装技能（provider-scoped）；new = store 新建（无身份）；
   * store = origin store 内技能的编辑（身份 = directoryName，target 恒为占位、
   * 不被 provider RPC 消费）。
   */
  mode: "edit" | "new" | "store";
  /** Workspace Provider 目标（edit 模式的 RPC target；new/store 为占位）。 */
  target: WorkspaceProviderTarget;
  /** 已存在技能的不透明 id；new/store 模式为 null（store 文档的 skillId 不参与编辑键）。 */
  skillId: SkillId | null;
  /** 草稿 name（frontmatter 必填）。 */
  name: string;
  /** 草稿 description（frontmatter 必填）。 */
  description: string;
  /** 草稿 markdown 正文（已剥离 frontmatter）。 */
  body: string;
  /** 已加载文档的 revision（edit/store 保存时作为 expectedRevision）；new 模式为 null。 */
  revision: string | null;
  /** 透传的未知 frontmatter 字段（保存时回写）。 */
  extraFrontmatter: Record<string, unknown>;
  /** 新建模式下的目录名草稿；store 模式下为身份（不可编辑）。 */
  directoryName: string;
}

/**
 * 构造一个空白草稿（new 模式）。target 传 null（store 直建——无 provider 身份，
 * 内部落占位）或既有测试注入的显式 target（占位语义等价，仅键派生差异）。
 */
export function emptyDraft(
  target: WorkspaceProviderTarget | null = null,
  directoryName = "",
): CreatorDraft {
  return {
    mode: "new",
    target: target ?? PLACEHOLDER_TARGET,
    skillId: null,
    name: "",
    description: "",
    body: "",
    revision: null,
    extraFrontmatter: {},
    directoryName,
  };
}

/** 一个合法但无意义的默认 Workspace Provider 目标（占位草稿用；new/store 不消费它）。 */
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

/**
 * 构造一个 store 编辑草稿占位（creator-skill-store 批 2）：身份 = store
 * directoryName；实际文档由 creatorStore.load 后 hydrate 填充。
 */
export function storeDraft(directoryName: string): CreatorDraft {
  return {
    mode: "store",
    target: PLACEHOLDER_TARGET,
    skillId: null,
    name: "",
    description: "",
    body: "",
    revision: null,
    extraFrontmatter: {},
    directoryName,
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

/**
 * new 模式草稿的字段级校验错误（值为 i18n 词典 key——store 保持纯数据，展示层
 * t() 渲染；webui-i18n-bilingual 4.1）。null = 该字段通过。
 */
export type NewDraftErrorKey =
  | "creatorEditor.directoryRule"
  | "creatorEditor.nameRequired"
  | "creatorEditor.descriptionRequired";

export interface NewDraftErrors {
  directoryName: NewDraftErrorKey | null;
  name: NewDraftErrorKey | null;
  description: NewDraftErrorKey | null;
}

const NEW_DRAFT_CLEAN: NewDraftErrors = {
  directoryName: null,
  name: null,
  description: null,
};

/**
 * new 模式草稿结构化校验（creator-editor-polish Ch5）：directoryName 规则 +
 * name/description 修剪后非空；edit 模式恒通过（revision 语义由服务端契约约束）。
 * 错误值为词典 key（webui-i18n-bilingual 4.1：错误文案归 creatorEditor.* 域）。
 */
export function validateNewDraft(draft: CreatorDraft): NewDraftErrors {
  if (draft.mode !== "new") return NEW_DRAFT_CLEAN;
  return {
    directoryName: SkillDirectoryNameSchema.safeParse(draft.directoryName).success
      ? null
      : "creatorEditor.directoryRule",
    name: draft.name.trim().length > 0 ? null : "creatorEditor.nameRequired",
    description: draft.description.trim().length > 0 ? null : "creatorEditor.descriptionRequired",
  };
}

/** 任一字段未过 → true（Save 禁用联动）。 */
export function hasNewDraftErrors(errors: NewDraftErrors): boolean {
  return errors.directoryName !== null || errors.name !== null || errors.description !== null;
}
