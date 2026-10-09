/**
 * 用户原始需求 [2026-10-09]（creator-skill-store 批 1）：「我们得有一个专门管理我们
 * 创建出来的这些 skills，比如 ~/.skill-creator/creator-skills，然后再通过 ccski-sdk
 * 将这些 skill 安装到本地 agent skills 目录（包括 .agents/skills .codex/skills 等）。
 * 所以架构上是两个分开的……它始终会有一个唯一的根源目录。比方说……直接把技能放在
 * .agents/skills 目录，这属于我们可以自动化做到事情。」
 * 正交意图：
 *   [1] origin store 文档面（list/create/save/remove）：唯一根源
 *       `<appDir()>/creator-skills/<directoryName>/`（Owner 原文 ~/.skill-creator/creator-skills）；目录名安全 + frontmatter
 *       safeParse 收窄（不兼容条目跳过计数）+ revision 契约（SKILL.md sha256）+
 *       原子写——文档机制复用 creator-service 的共享函数，不复制实现。
 *   [2] 内核应用面（apply/sync/uninstall/status）：ccski 两阶段
 *       （ensureEntity source=store + projectEntity 显式 roots）；global 应用
 *       userDir = 宿主 homeDir（与 skill-service toggle 的 Global 映射同源）；
 *       `~/.agents/skills` root 命中内核 entity-local 收据照常消费；sync =
 *       updateEntity + 逐 root 收据裁决（GUARD_PROJECTION 如实失败保留副本；
 *       degradedProjectionState fail-closed）；uninstall = removeEntityProjections
 *       （末投影内核 GC）/零投影时 deleteEntity；status = 已应用 roots（state
 *       镜像 + 路径绑定 containment）+ computeSkillFolderHash 单源对比。
 *   [3] delete-origin 与卸载正交：删 store 目录前 revision 闸门；有应用面时
 *       结果如实列出（剩余应用面），不阻止删除（UI 确认闸属批 2）。
 * 妥协声明：内核 typed error 经本服务有限词表映射（附 ccski code token），不透传
 * 内核 message；findApplications 按 provenance.source === store 目录 resolve 形态
 * 匹配（state 是内核单写者，宿主只读镜像；absent/不兼容 = 无应用面可见）。
 */
import fs from "node:fs";
import path from "node:path";
import {
  computeSkillFolderHash,
  deleteEntity as ccskiDeleteEntity,
  ensureEntity as ccskiEnsureEntity,
  projectEntity as ccskiProjectEntity,
  removeEntityProjections as ccskiRemoveEntityProjections,
  updateEntity as ccskiUpdateEntity,
  validateSkillFile as ccskiValidateSkillFile,
  type DeleteEntityOptions,
  type DeleteEntityResult,
  type EnsureEntityOptions,
  type EnsureEntityResult,
  type EntityRemoveResult,
  type EntityUpdateOptions,
  type ProjectEntityOptions,
  type ProjectEntityResult,
} from "ccski";
import { z } from "zod";
import {
  ccskiEntityLibraryRoot,
  ccskiEntityPathBound,
  ccskiProjectionPathBound,
  readCcskiState,
  type CcskiStateRead,
} from "./ccski-state-disabled.js";
import type { PinnedEntityRemoveOptions } from "./ccski-entity-remove.js";
import type { PinnedEntityUpdateResult } from "./skills-update-service.js";
import { composeSkillDocument, parseSkillDocumentParts } from "./creator-service.js";
import { DomainError } from "./domain-error.js";
import { globalProviderRoot, requireProvider } from "./provider-roots.js";
import { atomicWriteUtf8, contentRevision, directChild, opaquePathId } from "./path-safety.js";
import { homeDir, appDir } from "../shared/paths.js";
import { safeParseExternal } from "../shared/external-input.js";
import {
  SkillDirectoryNameSchema,
  type CreatorStoreApplication,
  type CreatorStoreApplyInput,
  type CreatorStoreApplyResult,
  type CreatorStoreApplyResultEntry,
  type CreatorStoreCreateInput,
  type CreatorStoreCreateResult,
  type CreatorStoreDocument,
  type CreatorStoreListResult,
  type CreatorStoreRemoveInput,
  type CreatorStoreRemoveResult,
  type CreatorStoreSaveInput,
  type CreatorStoreSaveResult,
  type CreatorStoreSkill,
  type CreatorStoreStatusInput,
  type CreatorStoreStatusResult,
  type CreatorStoreSyncResult,
  type CreatorStoreSyncResultEntry,
  type CreatorStoreUninstallInput,
  type CreatorStoreUninstallResult,
  type CreatorStoreUninstallResultEntry,
} from "../shared/contracts/creator-store.js";
import type {
  ImportedWorkspaceId,
  WorkspaceProviderTarget,
} from "../shared/contracts/workspaces.js";
import { GLOBAL_WORKSPACE_ID } from "../shared/contracts/workspaces.js";
import type { ValidateResult } from "../shared/contracts/skills.js";
import { SkillIdSchema } from "../shared/contracts/skills.js";
import type { WorkspaceRegistry } from "./workspace-registry/index.js";

/**
 * ccski 实体内核 seam（creator-skill-store 批 1）：apply/sync/uninstall 的注入面。
 * typed result 不属于异常流；宿主按冻结码映射有限词表，不裸透传内核 message。
 */
export interface CreatorStoreKernel {
  ensureEntity: (options: EnsureEntityOptions) => Promise<EnsureEntityResult>;
  projectEntity: (options: ProjectEntityOptions) => Promise<ProjectEntityResult>;
  updateEntity: (options: EntityUpdateOptions) => Promise<PinnedEntityUpdateResult>;
  removeEntityProjections: (options: PinnedEntityRemoveOptions) => Promise<EntityRemoveResult>;
  deleteEntity: (options: DeleteEntityOptions) => Promise<DeleteEntityResult>;
}

/** 真实内核默认实现。 */
export const creatorStoreKernel: CreatorStoreKernel = {
  ensureEntity: ccskiEnsureEntity,
  projectEntity: ccskiProjectEntity,
  updateEntity: ccskiUpdateEntity,
  removeEntityProjections: ccskiRemoveEntityProjections,
  deleteEntity: ccskiDeleteEntity,
};

/** creator-store 服务依赖注入。 */
export interface CreatorStoreServiceOptions {
  kernel?: CreatorStoreKernel;
  /** apply 后按 target 失效 discovery 在途合并（写后读一致性；可选注入）。 */
  skills?: { invalidateDiscovery: (target: WorkspaceProviderTarget) => void };
}

/** store 应用的内核源标注（provenance.sourceType；内核按不透明字符串落账）。 */
const STORE_SOURCE_TYPE = "creator-store";

/** 实体记录镜像（应用面判定基准）：provenance.source 是 store 目录绑定键。 */
const EntityRecordMirrorSchema = z.object({
  logicalName: z.string().min(1),
  folderName: z.string().min(1),
  path: z.string().min(1),
  revision: z.string().min(1),
  provenance: z.object({ source: z.string().min(1) }),
});

/** 投影记录镜像（应用面 roots 判定基准）。 */
const ProjectionRecordMirrorSchema = z.object({
  rootPath: z.string().min(1),
  folderName: z.string().min(1),
  path: z.string().min(1),
});

/** 一处已应用面的内部记录（scope 解析产物 + state 镜像字段）。 */
interface StoreApplicationRecord {
  scope: "global" | "project";
  workspaceId?: ImportedWorkspaceId;
  /** 内核 scopeBase 解析入参（global = userDir；project = workspaceDir）。 */
  userDir?: string;
  workspaceDir?: string;
  stateBase: string;
  logicalName: string;
  folderName: string;
  entityRevision: string;
  canonicalRoot: string;
  entityPresent: boolean;
  /** 注册投影根（resolve 归一去重；不含 entity-local canonical root）。 */
  projectionRoots: string[];
}

/** apply 的 scope 分组 target 项（auto-apply 的 server-initiated root 无 target）。 */
interface ApplyTarget {
  target?: WorkspaceProviderTarget;
  root: string;
}

/** apply 的 scope 分组（同 scope 的多 target 一次 ensureEntity + projectEntity）。 */
interface ApplyGroup {
  scope: "global" | "project";
  userDir?: string;
  workspaceDir?: string;
  targets: ApplyTarget[];
}

/**
 * 内核失败码 → 宿主有限词表文案（store 语境；不透传内核 message）。码 token 来自
 * ccski 冻结词表（ensure/project/update/remove 四面并集），可安全入文。
 */
const STORE_FAILURE_MESSAGES: Record<string, string> = {
  SCOPE_REQUIRED: "The application scope could not be resolved for the creator store skill.",
  NAME_COLLISION: "A different skill already owns the destination folder name in the skill store.",
  NAME_EXISTS: "The destination is already applied from a different source.",
  GUARD_ENTITY:
    "The applied skill changed while the operation was running; reload the status and retry.",
  SOURCE_NOT_FOUND: "The creator store no longer contains the skill directory.",
  SOURCE_SYMLINK: "The creator store skill directory resolved to a symbolic link.",
  SOURCE_NOT_DIRECTORY: "The creator store skill entry is not a directory.",
  SOURCE_INVALID: "The creator store skill has no parseable SKILL.md.",
  SOURCE_NAME_MISMATCH:
    "The skill name changed in the creator store; identity changes need a fresh application.",
  ENTITY_PATH_OCCUPIED: "The skill store has a conflicting entry at the entity path.",
  ENTITY_SWAP_FAILED: "The skill store could not swap the entity content safely.",
  ENTITY_NOT_FOUND: "The applied entity vanished from the skill store; re-apply the skill.",
  ENTITY_MISSING: "The recorded skill entity directory is missing from the skill store.",
  PROJECTIONS_REMAIN: "The skill still has provider projections; remove them first.",
  GUARD_PROJECTION:
    "The applied entry was modified externally; the operation kept the modified copy untouched.",
  FOREIGN_OWNERSHIP: "The applied entry is an external link the skill store does not own.",
  GC_UNKNOWN_REFERENCE: "References to the applied entity remain outside the skill store records.",
  STATE_RECOVERY_REQUIRED: "The skill store state is degraded; run ccski state repair.",
  STATE_GENERATION_CONFLICT: "The skill store state changed concurrently; retry the operation.",
  TARGET_DENIED: "The target skills directory denied the operation.",
  PROJECTION_PATH_OCCUPIED: "The destination is occupied by an entry the skill store does not own.",
  PROJECTION_DISABLED: "The destination projection is disabled; enable it first.",
  MODE_CONFLICT: "The destination projection has a different recorded mode.",
  ROOT_SYMLINK: "The target skills directory resolves through a symbolic link.",
  ROOT_NOT_DIRECTORY: "The target skills path is not a directory.",
  SYMLINK_FAILED: "The skill could not be projected into the target directory.",
  COPY_FAILED: "The skill could not be copied into the target directory.",
  DELETE_FAILED: "The applied entry could not be deleted from disk.",
  PINNED: "The applied entry is pinned; it was skipped.",
  INVALID_ROOTS: "The projection roots could not be resolved.",
  IO: "The skill store reported a filesystem failure.",
};

function storeKernelFailure(code: string | undefined): string {
  if (code !== undefined && STORE_FAILURE_MESSAGES[code] !== undefined) {
    return `${STORE_FAILURE_MESSAGES[code]} (ccski code: ${code})`;
  }
  return "The skill store reported an unexpected failure.";
}

/** sync 的 degraded fail-closed 文案（对齐 skills-update P0-C：指路 state repair）。 */
const STATE_DEGRADED_MESSAGE =
  "The projection records are degraded; whether an entry is registered cannot be proven. " +
  "Run ccski state repair, then retry the sync.";

/** creator store 根目录（唯一根源 = appDir()/creator-skills；随 homeDir override 同源隔离）。 */
export function creatorStoreRoot(): string {
  // Owner 原文「~/.skill-creator/creator-skills」：store 落 appDir()（生产 =
  // ~/.skill-creator；dev/测试随 homeDir override 同源隔离），不污染家目录根。
  return path.join(appDir(), "creator-skills");
}

/** global scope 的默认应用 root（= 内核 global 实体库根；entity-local 收据命中）。 */
function globalCanonicalRoot(): string {
  return ccskiEntityLibraryRoot(path.join(homeDir(), ".agents"));
}

/** store 内技能目录（server-owned direct-child 派生，不收调用方路径）。 */
function storeSkillDirectory(directoryName: string): string {
  return directChild(creatorStoreRoot(), SkillDirectoryNameSchema.parse(directoryName));
}

/** 解析 store 技能目录；缺席 = typed NOT_FOUND。 */
function requireStoreSkillDirectory(directoryName: string): string {
  const directory = storeSkillDirectory(directoryName);
  if (!fs.existsSync(directory)) {
    throw new DomainError("NOT_FOUND", `Creator store skill not found: ${directoryName}`);
  }
  return directory;
}

/** 读 store 文档（身份 = canonical store path 摘要；revision = SKILL.md sha256）。 */
function readStoreDocument(directory: string): CreatorStoreDocument {
  const file = path.join(directory, "SKILL.md");
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    throw new DomainError(
      "INVALID_OPERATION",
      "The creator store skill directory does not contain a readable SKILL.md.",
    );
  }
  const parts = parseSkillDocumentParts(raw);
  return {
    skillId: SkillIdSchema.parse(opaquePathId("sk", fs.realpathSync(directory))),
    directoryName: SkillDirectoryNameSchema.parse(path.basename(directory)),
    frontmatter: parts.frontmatter,
    body: parts.body,
    revision: contentRevision(raw),
  };
}

/** store 文档校验（ccski validateSkillFile 直读；不依赖 provider 发现面）。 */
function validateStoreDocument(document: CreatorStoreDocument): ValidateResult {
  const result = ccskiValidateSkillFile(
    path.join(storeSkillDirectory(document.directoryName), "SKILL.md"),
  );
  return {
    skillId: document.skillId,
    name: document.frontmatter.name,
    success: result.success,
    errors: result.errors,
    warnings: result.suggestions,
  };
}

/** scope 基准全集（global homeDir + 全部 Imported；userDir/workspaceDir 同源注入内核）。 */
function scopeBases(workspaces: WorkspaceRegistry): Array<{
  scope: "global" | "project";
  workspaceId?: ImportedWorkspaceId;
  stateBase: string;
  userDir?: string;
  workspaceDir?: string;
}> {
  const bases: Array<{
    scope: "global" | "project";
    workspaceId?: ImportedWorkspaceId;
    stateBase: string;
    userDir?: string;
    workspaceDir?: string;
  }> = [{ scope: "global", stateBase: path.join(homeDir(), ".agents"), userDir: homeDir() }];
  for (const workspace of workspaces.listImported()) {
    bases.push({
      scope: "project",
      workspaceId: workspace.id,
      stateBase: path.join(workspace.path, ".agents"),
      workspaceDir: workspace.path,
    });
  }
  return bases;
}

/** 一个 state 的注册投影根（resolve 归一去重 + 路径绑定 containment）。 */
function collectProjectionRoots(
  state: Extract<CcskiStateRead, { kind: "ok" }>,
  folderName: string,
): string[] {
  const roots = new Set<string>();
  for (const value of Object.values(state.projections)) {
    const record = safeParseExternal(ProjectionRecordMirrorSchema, value);
    if (!record || record.folderName !== folderName) continue;
    if (!ccskiProjectionPathBound(record.rootPath, record.folderName, record.path)) continue;
    roots.add(path.resolve(record.rootPath));
  }
  return [...roots].sort();
}

/**
 * 按逻辑名 + provenance.source 绑定解析一处实体记录（路径绑定纪律与
 * ccski-state-disabled / ccski-entity-remove 同源：伪造信封不得驱动应用面）。
 */
function findEntityRecord(
  state: Extract<CcskiStateRead, { kind: "ok" }>,
  stateBase: string,
  sourceIdentity: string,
): z.infer<typeof EntityRecordMirrorSchema> | null {
  return (
    Object.values(state.entities)
      .map((value) => safeParseExternal(EntityRecordMirrorSchema, value))
      .find(
        (record) =>
          record !== null &&
          record.provenance.source === sourceIdentity &&
          ccskiEntityPathBound(stateBase, record.folderName, record.path),
      ) ?? null
  );
}

/** 枚举一个 store 技能的全部已应用面（只读 state 镜像；absent/不兼容 = 无应用面）。 */
function findApplications(
  workspaces: WorkspaceRegistry,
  storeDirectory: string,
): StoreApplicationRecord[] {
  const sourceIdentity = path.resolve(storeDirectory);
  const applications: StoreApplicationRecord[] = [];
  for (const base of scopeBases(workspaces)) {
    const state = readCcskiState(base.stateBase);
    if (state.kind !== "ok") continue;
    const entity = findEntityRecord(state, base.stateBase, sourceIdentity);
    if (entity === null) continue;
    applications.push({
      scope: base.scope,
      ...(base.workspaceId !== undefined ? { workspaceId: base.workspaceId } : {}),
      ...(base.userDir !== undefined ? { userDir: base.userDir } : {}),
      ...(base.workspaceDir !== undefined ? { workspaceDir: base.workspaceDir } : {}),
      stateBase: base.stateBase,
      logicalName: entity.logicalName,
      folderName: entity.folderName,
      entityRevision: entity.revision,
      canonicalRoot: ccskiEntityLibraryRoot(base.stateBase),
      entityPresent: fs.existsSync(entity.path),
      projectionRoots: collectProjectionRoots(state, entity.folderName),
    });
  }
  return applications;
}

/** 应用面 → 契约投影（roots = entity-local canonical root（在场时）+ 注册投影根）。 */
function projectApplication(application: StoreApplicationRecord): CreatorStoreApplication {
  return {
    scope: application.scope,
    ...(application.workspaceId !== undefined ? { workspaceId: application.workspaceId } : {}),
    entityRevision: application.entityRevision,
    roots: [
      ...(application.entityPresent ? [application.canonicalRoot] : []),
      ...application.projectionRoots,
    ],
  };
}

/** scope 组的内核入参基底（global = userDir；project = workspaceDir）。 */
function scopeArguments(group: {
  scope: "global" | "project";
  userDir?: string;
  workspaceDir?: string;
}): { scope: "global"; userDir: string } | { scope: "project"; workspaceDir: string } {
  if (group.scope === "global") {
    return { scope: "global", userDir: group.userDir ?? homeDir() };
  }
  if (group.workspaceDir === undefined) {
    throw new DomainError(
      "UNAVAILABLE",
      "The workspace directory is unavailable for this application.",
    );
  }
  return { scope: "project", workspaceDir: group.workspaceDir };
}

/**
 * 内核两阶段应用（ensureEntity + projectEntity）到一个 scope 分组，产出逐 target
 * 收据（entity 阶段来自 ensureEntity status；mode/entity-local 收据原样透传）。
 */
async function applyGroup(
  kernel: CreatorStoreKernel,
  storeDirectory: string,
  name: string,
  group: ApplyGroup,
): Promise<CreatorStoreApplyResultEntry[]> {
  const base = scopeArguments(group);
  const source = { dir: storeDirectory, sourceType: STORE_SOURCE_TYPE };
  const ensured = await kernel.ensureEntity({ ...base, source });
  if (ensured.kind === "error") {
    const message = storeKernelFailure(ensured.code);
    return group.targets.map((entry) => ({
      ...(entry.target !== undefined ? { target: entry.target } : {}),
      root: entry.root,
      path: path.join(entry.root, name),
      status: "failed" as const,
      error: message,
    }));
  }
  const roots = [...new Set(group.targets.map((entry) => path.resolve(entry.root)))];
  const projected = await kernel.projectEntity({ ...base, name, roots });
  if (projected.kind === "error") {
    const message = storeKernelFailure(projected.code);
    return group.targets.map((entry) => ({
      ...(entry.target !== undefined ? { target: entry.target } : {}),
      root: entry.root,
      path: path.join(entry.root, name),
      status: "failed" as const,
      error: message,
    }));
  }
  return group.targets.map((entry) => {
    const receipt = projected.results.find(
      (result) => path.resolve(result.root) === path.resolve(entry.root),
    );
    if (!receipt || receipt.status === "failed") {
      return {
        ...(entry.target !== undefined ? { target: entry.target } : {}),
        root: entry.root,
        path: path.join(entry.root, name),
        status: "failed" as const,
        error: storeKernelFailure(receipt?.errorCode),
      };
    }
    return {
      ...(entry.target !== undefined ? { target: entry.target } : {}),
      root: entry.root,
      path: receipt.path,
      status: receipt.status === "projected" ? ("applied" as const) : ("unchanged" as const),
      ...(receipt.mode !== undefined ? { mode: receipt.mode } : {}),
      entity: ensured.status,
    };
  });
}

function countApply(entries: readonly CreatorStoreApplyResultEntry[]): {
  applied: number;
  unchanged: number;
  failed: number;
} {
  return {
    applied: entries.filter((entry) => entry.status === "applied").length,
    unchanged: entries.filter((entry) => entry.status === "unchanged").length,
    failed: entries.filter((entry) => entry.status === "failed").length,
  };
}

function applyResultOf(entries: CreatorStoreApplyResultEntry[]): CreatorStoreApplyResult {
  return { kind: "result", results: entries, ...countApply(entries) };
}

/**
 * Bind Creator origin-store operations to one daemon-owned Workspace Registry and
 * the ccski entity kernel. store 是唯一根源；应用/同步/卸载全部经内核投影。
 */
export function createCreatorStoreService(
  workspaces: WorkspaceRegistry,
  options: CreatorStoreServiceOptions = {},
) {
  const kernel: CreatorStoreKernel = options.kernel ?? creatorStoreKernel;

  const invalidateTargets = (targets: readonly WorkspaceProviderTarget[]): void => {
    if (!options.skills) return;
    for (const target of targets) options.skills.invalidateDiscovery(target);
  };

  return {
    /** 读一份 store 文档（store 编辑页的读取面；批 2 webui 消费，body/revision 同币）。 */
    load(input: { directoryName: string }): CreatorStoreDocument {
      return readStoreDocument(requireStoreSkillDirectory(input.directoryName));
    },

    /** 枚举 store 技能（不兼容条目跳过计数；无状态字段——状态走 status）。 */
    list(): CreatorStoreListResult {
      const root = creatorStoreRoot();
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(root, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return { skills: [], skipped: 0 };
        throw error;
      }
      let skipped = 0;
      const skills: CreatorStoreSkill[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) {
          skipped += 1;
          continue;
        }
        const directory = path.join(root, entry.name);
        try {
          const document = readStoreDocument(directory);
          skills.push({
            skillId: document.skillId,
            name: document.frontmatter.name,
            description: document.frontmatter.description,
            directoryName: document.directoryName,
            revision: document.revision,
            updatedAt: Math.trunc(fs.statSync(path.join(directory, "SKILL.md")).mtimeMs),
          });
        } catch {
          skipped += 1;
        }
      }
      skills.sort((left, right) => left.directoryName.localeCompare(right.directoryName));
      return { skills, skipped };
    },

    /** store 新建（唯一创建入口的领域面）；auto-apply 默认走 global canonical root。 */
    async create(input: CreatorStoreCreateInput): Promise<CreatorStoreCreateResult> {
      const directoryName = SkillDirectoryNameSchema.parse(input.directoryName);
      const directory = storeSkillDirectory(directoryName);
      if (fs.existsSync(directory) && fs.readdirSync(directory).length > 0) {
        throw new DomainError(
          "CONFLICT",
          `A skill already exists in the creator store: ${directoryName}`,
        );
      }
      const file = path.join(directory, "SKILL.md");
      atomicWriteUtf8(file, composeSkillDocument(input.frontmatter, input.body));
      const document = readStoreDocument(directory);
      const validation = validateStoreDocument(document);
      const autoApply =
        input.autoApply === false
          ? applyResultOf([])
          : applyResultOf(
              await applyGroup(kernel, directory, document.frontmatter.name, {
                scope: "global",
                userDir: homeDir(),
                targets: [{ root: globalCanonicalRoot() }],
              }),
            );
      return { document, validation, autoApply };
    },

    /** store 编辑（revision-safe；编辑后已应用面变 outdated，sync 显式收敛）。 */
    async save(input: CreatorStoreSaveInput): Promise<CreatorStoreSaveResult> {
      const directory = requireStoreSkillDirectory(input.directoryName);
      const file = path.join(directory, "SKILL.md");
      const current = fs.readFileSync(file, "utf8");
      if (contentRevision(current) !== input.expectedRevision) {
        throw new DomainError(
          "CONFLICT",
          "This skill changed on disk. Reload it before saving your edits.",
        );
      }
      atomicWriteUtf8(file, composeSkillDocument(input.frontmatter, input.body));
      const document = readStoreDocument(directory);
      return { document, validation: validateStoreDocument(document) };
    },

    /** 删除根源（与卸载正交）：revision 闸门 + 剩余应用面如实列出，不阻止删除。 */
    remove(input: CreatorStoreRemoveInput): CreatorStoreRemoveResult {
      const directory = requireStoreSkillDirectory(input.directoryName);
      const file = path.join(directory, "SKILL.md");
      const current = fs.readFileSync(file, "utf8");
      if (contentRevision(current) !== input.expectedRevision) {
        throw new DomainError("CONFLICT", "This skill changed on disk. Reload it before deleting.");
      }
      const remainingApplications = findApplications(workspaces, directory).map(projectApplication);
      fs.rmSync(directory, { recursive: true, force: false });
      return { removed: true, remainingApplications };
    },

    /** 应用到显式 targets（server 解析为投影根；逐 target typed 收据）。 */
    async apply(input: CreatorStoreApplyInput): Promise<CreatorStoreApplyResult> {
      const directory = requireStoreSkillDirectory(input.directoryName);
      const document = readStoreDocument(directory);
      const groups = new Map<string, ApplyGroup>();
      const seenTargets = new Set<string>();
      for (const target of input.targets) {
        const seenKey = `${target.workspaceId}:${target.providerId}`;
        if (seenTargets.has(seenKey)) continue;
        seenTargets.add(seenKey);
        if (target.workspaceId === GLOBAL_WORKSPACE_ID) {
          const provider = requireProvider(target.providerId);
          const root = globalProviderRoot(provider, homeDir());
          if (root === null) {
            throw new DomainError(
              "INVALID_OPERATION",
              `${provider.label} does not support Global Workspace skills.`,
            );
          }
          const group = groups.get("global") ?? {
            scope: "global" as const,
            userDir: homeDir(),
            targets: [],
          };
          group.targets.push({ target, root });
          groups.set("global", group);
          continue;
        }
        const scope = workspaces.resolve(target, true);
        if (scope.workspaceDirectory === undefined) {
          throw new DomainError(
            "UNAVAILABLE",
            `Workspace directory is unavailable: ${scope.workspaceLabel}`,
          );
        }
        const groupKey = `project:${target.workspaceId}`;
        const group = groups.get(groupKey) ?? {
          scope: "project" as const,
          workspaceDir: scope.workspaceDirectory,
          targets: [],
        };
        group.targets.push({ target, root: scope.directory });
        groups.set(groupKey, group);
      }
      const entries: CreatorStoreApplyResultEntry[] = [];
      for (const group of groups.values()) {
        entries.push(...(await applyGroup(kernel, directory, document.frontmatter.name, group)));
      }
      invalidateTargets(
        entries.flatMap((entry) => (entry.target !== undefined ? [entry.target] : [])),
      );
      return applyResultOf(entries);
    },

    /** 同步（updateEntity source=store；逐 root 收据 + degraded fail-closed）。 */
    async sync(input: { directoryName: string }): Promise<CreatorStoreSyncResult> {
      const directory = requireStoreSkillDirectory(input.directoryName);
      const entries: CreatorStoreSyncResultEntry[] = [];
      let degraded = false;
      for (const application of findApplications(workspaces, directory)) {
        const base = scopeArguments(application);
        const updated = await kernel.updateEntity({
          ...base,
          name: application.logicalName,
          source: { dir: directory, sourceType: STORE_SOURCE_TYPE },
          expectedRevision: application.entityRevision,
        });
        const scopeFields = {
          scope: application.scope,
          ...(application.workspaceId !== undefined
            ? { workspaceId: application.workspaceId }
            : {}),
        };
        if (updated.kind === "error") {
          entries.push({
            ...scopeFields,
            root: "",
            path: "",
            status: "failed",
            code: updated.code,
            detail: storeKernelFailure(updated.code),
          });
          continue;
        }
        // 逐 root 收据裁决（P0-1 语义）：GUARD_PROJECTION 等失败如实呈现，
        // 用户改动的物化副本由内核保留，宿主绝不做任何 legacy 清理。
        for (const receipt of updated.projections) {
          entries.push({
            ...scopeFields,
            root: receipt.rootPath,
            path: receipt.path,
            status: receipt.status,
            ...(receipt.code !== undefined ? { code: receipt.code } : {}),
            ...(receipt.status === "failed"
              ? { detail: storeKernelFailure(receipt.code) }
              : receipt.detail !== undefined
                ? { detail: receipt.detail }
                : {}),
          });
        }
        // entity-local canonical root 无投影记录/收据——实体稳路径换新即它的新内容。
        if (application.entityPresent) {
          entries.push({
            ...scopeFields,
            root: application.canonicalRoot,
            path: path.join(application.canonicalRoot, application.folderName),
            status: updated.status,
            detail: "entity-local (canonical root) reflects the entity swap",
          });
        }
        // degraded fail-closed（P0-C 语义）：投影表损坏时「无收据 ≠ 未登记」——
        // 显式失败指路 state repair；字段缺席（旧内核快照）按保守失败处理。
        if (updated.degradedProjectionState !== false) {
          degraded = true;
          entries.push({
            ...scopeFields,
            root: "",
            path: "",
            status: "failed",
            code: "STATE_DEGRADED",
            detail: STATE_DEGRADED_MESSAGE,
          });
        }
      }
      return {
        kind: "result",
        results: entries,
        updated: entries.filter((entry) => entry.status === "updated").length,
        unchanged: entries.filter((entry) => entry.status === "unchanged").length,
        skipped: entries.filter((entry) => entry.status === "skipped").length,
        failed: entries.filter((entry) => entry.status === "failed").length,
        degradedProjectionState: degraded,
      };
    },

    /** 卸载（removeEntityProjections 末投影 GC；零投影 = deleteEntity）。 */
    async uninstall(input: CreatorStoreUninstallInput): Promise<CreatorStoreUninstallResult> {
      const directory = requireStoreSkillDirectory(input.directoryName);
      const entries: CreatorStoreUninstallResultEntry[] = [];
      for (const application of findApplications(workspaces, directory)) {
        if (
          input.scopes !== undefined &&
          !input.scopes.some(
            (ref) =>
              ref.scope === application.scope &&
              (ref.scope === "global" || ref.workspaceId === application.workspaceId),
          )
        ) {
          continue;
        }
        const base = scopeArguments(application);
        const scopeFields = {
          scope: application.scope,
          ...(application.workspaceId !== undefined
            ? { workspaceId: application.workspaceId }
            : {}),
        };
        try {
          let entityRemoved = false;
          if (application.projectionRoots.length === 0) {
            // 仅 entity-local（canonical root）应用：实体删除走 deleteEntity
            //（GUARD_ENTITY 第二层守卫；canonical root 不参与投影 remove）。
            const result = await kernel.deleteEntity({
              ...base,
              name: application.logicalName,
              expectedRevision: application.entityRevision,
              roots: [application.canonicalRoot],
            });
            if (result.kind === "error") {
              entries.push({
                ...scopeFields,
                status: "failed",
                entityRemoved: false,
                error: storeKernelFailure(result.code),
              });
              continue;
            }
            entityRemoved = result.directoryDeleted;
            if (!result.directoryDeleted) {
              entries.push({
                ...scopeFields,
                status: "failed",
                entityRemoved: false,
                error:
                  "The skill entity record was retired but its directory could not be deleted; an unrecorded directory remains.",
              });
              continue;
            }
          } else {
            const result = await kernel.removeEntityProjections({
              ...base,
              name: application.logicalName,
              roots: application.projectionRoots,
              expectedEntityRevision: application.entityRevision,
            });
            if (result.kind === "error") {
              entries.push({
                ...scopeFields,
                status: "failed",
                entityRemoved: false,
                error: storeKernelFailure(result.code),
              });
              continue;
            }
            const failedRoot = result.results.find((rootResult) => rootResult.status === "failed");
            if (failedRoot) {
              entries.push({
                ...scopeFields,
                status: "failed",
                entityRemoved: result.entityRemoved,
                error: storeKernelFailure(failedRoot.errorCode),
              });
              continue;
            }
            entityRemoved = result.entityRemoved;
            if (!result.entityRemoved) {
              entries.push({
                ...scopeFields,
                status: "partial",
                entityRemoved: false,
                detail: `The projections were removed but the entity was kept${
                  result.gc.blockedBy
                    ? ` (${result.gc.blockedBy.toLowerCase().replaceAll("_", " ")})`
                    : ""
                }; references remain.`,
              });
              continue;
            }
          }
          entries.push({ ...scopeFields, status: "removed", entityRemoved });
        } catch (error) {
          entries.push({
            ...scopeFields,
            status: "failed",
            entityRemoved: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return {
        kind: "result",
        results: entries,
        removed: entries.filter((entry) => entry.status === "removed").length,
        failed: entries.filter((entry) => entry.status === "failed").length,
      };
    },

    /** 状态（已应用 roots + store/entity hash 对比；computeSkillFolderHash 单源）。 */
    async status(input: CreatorStoreStatusInput): Promise<CreatorStoreStatusResult> {
      const directory = requireStoreSkillDirectory(input.directoryName);
      const document = readStoreDocument(directory);
      const storeHash = await computeSkillFolderHash(directory);
      const applications = findApplications(workspaces, directory);
      const projected = applications.map(projectApplication);
      return {
        skill: {
          skillId: document.skillId,
          name: document.frontmatter.name,
          description: document.frontmatter.description,
          directoryName: document.directoryName,
          revision: document.revision,
          updatedAt: Math.trunc(fs.statSync(path.join(directory, "SKILL.md")).mtimeMs),
          appliedRoots: projected,
          outdated: projected.some((application) => application.entityRevision !== storeHash),
        },
        storeHash,
      };
    },
  };
}

/** creator-store 服务实例接口。 */
export type CreatorStoreService = ReturnType<typeof createCreatorStoreService>;
