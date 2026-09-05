/**
 * 原始需求 [2026-07-14]：「引入各种各样的功能（保持模块化、正交）」。
 * 正交意图：
 * 1. 从共享运行时契约投影 WebUI 类型。
 * 2. 避免浏览器侧维护手写镜像类型。
 */
/** Creator 页面使用的共享文档与保存类型。 */
export type {
  SaveSkillInput,
  SaveSkillResult,
  SkillDocument,
  SkillFrontmatter,
} from "$shared/contracts/creator.js";
/** Repository 页面使用的共享扫描与安装类型。 */
export type {
  InstallResult,
  InstallSummary,
  RemoteRepoScan,
  RemoteSkill,
  RemoteSkillId,
  RemoteSkillPreview,
  UserSource,
} from "$shared/contracts/repository.js";
/** Workspace 页面使用的共享技能类型。 */
export type {
  SkillId,
  SkillInfo,
  SkillMetadata,
  ToggleSummary,
  ValidateResult,
} from "$shared/contracts/skills.js";
/** Provider 更新检查/重装使用的共享类型。 */
export type {
  ApplyUpdateResultEntry,
  UpdateCheckResultEntry,
} from "$shared/contracts/skills-update.js";
/** WebUI 导航使用的共享 workspace 类型。 */
export type {
  ImportedWorkspace,
  Workspace,
  WorkspaceId,
  WorkspaceProvider,
  WorkspaceProviderTarget,
} from "$shared/contracts/workspaces.js";
