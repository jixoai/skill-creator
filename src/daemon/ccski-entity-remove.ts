/**
 * 用户原始需求 [2026-10-08]（ccski-3-host-migration 批 5，走查 W8 实证缺口 F-3）：
 * 「卸载面无内核感知——Creator 删 entity face 直删文件系 → 悬空投影链 + stale
 * state 记录残留；删 symlink face 被 containment 拒。removeEntityProjections/
 * deleteEntity 宿主零引用。旧直删在 2.x 复制模型下完整，在 3.0 投影模型下产生
 * 残留——本批补齐（Owner：不希望有残留）」。
 *
 * 正交意图：
 *   [1] state 实体/投影镜像读取（沿用 ccski-state-disabled 的信封镜像 schema
 *       模式）：按逻辑名解析实体记录 + 该实体全部注册投影，作为路由判定基准；
 *       absent/不兼容/实体记录缺席 = 保守 typed 拒绝（不假装内核管辖、不回落
 *       直删制造残留）；非环 IO 故障上抛。
 *   [2] 双路由执行：单 face 删除 = removeEntityProjections（该 provider root
 *       的投影摘除，实体与其余投影保留）；末投影/实体 face 删除 = 全清（实体
 *       face 带投影时对全部注册投影根摘除，内核 last-reference GC 退役实体；
 *       零投影时直接 deleteEntity 受 GUARD_ENTITY）。disabled（已摘链）投影由
 *       内核语义处理（记录在、链接不在 → 记录随事实退役），宿主不自行发明。
 *   [3] 内核 typed error → 宿主有限词表（GUARD_* 与 FOREIGN_OWNERSHIP、
 *       PROJECTIONS_REMAIN、GC_UNKNOWN_REFERENCE、ENTITY_NOT_FOUND → conflict；
 *       基础设施族 → unavailable），不透传内核 message。
 * 妥协声明：宿主只传 {scope 映射, 逻辑名, server 解析的 roots}，不传调用方
 * 组合的实体路径——路径/守卫权威在内核（§5.4）；判定读的是时点 state 快照，
 * 与内核 commit 之间的竞态由内核 CAS + typed 拒绝兜底。
 */
import path from "node:path";
import {
  deleteEntity as ccskiDeleteEntity,
  removeEntityProjections as ccskiRemoveEntityProjections,
  type DeleteEntityOptions,
  type DeleteEntityResult,
  type EntityRemoveOptions,
  type EntityRemoveResult,
} from "ccski";
import { z } from "zod";
import {
  ccskiEntityLibraryRoot,
  ccskiEntityPathBound,
  ccskiProjectionPathBound,
  readCcskiState,
} from "./ccski-state-disabled.js";
import { DomainError } from "./domain-error.js";
import { safeParseExternal } from "../shared/external-input.js";

/** 实体记录的最小消费面（路由判定基准；键 = folderName）。 */
const EntityRecordMirrorSchema = z.object({
  /** 实体逻辑名（frontmatter name；内核解析键）。 */
  logicalName: z.string().min(1),
  folderName: z.string().min(1),
  /** 实体绝对路径。 */
  path: z.string().min(1),
  /** 实体 revision（computeSkillFolderHash hex；deleteEntity 的 GUARD_ENTITY 基准）。 */
  revision: z.string().min(1),
});

/** 投影记录的最小消费面（路由判定基准）。 */
const ProjectionRecordMirrorSchema = z.object({
  /** 投影根 resolve 归一路径。 */
  rootPath: z.string().min(1),
  folderName: z.string().min(1),
  /** 投影绝对路径（P1-4：绑定 `<rootPath>/<folderName>`，伪造信封拒绝）。 */
  path: z.string().min(1),
  mode: z.enum(["link", "materialized"]),
});

/** ccski 实体/投影删除内核 seam（批 5）；typed result 不属于异常流。 */
export interface CcskiEntityRemoveKernel {
  removeEntityProjections: (options: EntityRemoveOptions) => Promise<EntityRemoveResult>;
  deleteEntity: (options: DeleteEntityOptions) => Promise<DeleteEntityResult>;
}

/** 真实内核默认实现。 */
export const ccskiEntityRemoveKernel: CcskiEntityRemoveKernel = {
  removeEntityProjections: ccskiRemoveEntityProjections,
  deleteEntity: ccskiDeleteEntity,
};

/** 删除路由输入（全部 server-owned：registry 解析产物 + 发现身份）。 */
export interface CcskiEntityRemoveInput {
  /** Imported Workspace canonical 根（内核 project scope 的 workspaceDir）。 */
  workspaceDirectory: string;
  /** Provider skills 根（投影/实体 face 的判定输入）。 */
  providerRoot: string;
  /** 实体逻辑名（发现行 frontmatter name）。 */
  skillName: string;
}

/**
 * 内核 typed error/失败码 → conflict 语义的有限集合（对齐 toggle 双路由映射：
 * GUARD_*、外部所有权、投影在场、未知引用、实体消失 = 并发/状态冲突）。
 */
const KERNEL_CONFLICT_CODES = new Set([
  "GUARD_ENTITY",
  "GUARD_PROJECTION",
  "FOREIGN_OWNERSHIP",
  "PROJECTIONS_REMAIN",
  "GC_UNKNOWN_REFERENCE",
  "ENTITY_NOT_FOUND",
]);

/** 内核失败码 → 宿主有限词表文案（删除语境；不透传内核 message）。 */
const REMOVAL_FAILURE_MESSAGES: Record<string, string> = {
  SCOPE_REQUIRED: "The removal could not resolve the skill store scope.",
  INVALID_ROOTS: "The projection roots could not be resolved for the removal.",
  ENTITY_NOT_FOUND: "The skill entity is no longer tracked by the skill store; reload and retry.",
  GUARD_ENTITY: "The skill changed while the deletion was running; reload it and retry.",
  PROJECTIONS_REMAIN:
    "The skill still has provider projections; remove them from their provider faces first.",
  GUARD_PROJECTION:
    "The provider entry changed on disk and no longer matches its recorded form; refusing to remove it.",
  FOREIGN_OWNERSHIP:
    "The provider entry is an external link the skill store does not own; it is never removed.",
  GC_UNKNOWN_REFERENCE:
    "References to the skill entity remain outside the skill store records; the entity was kept.",
  STATE_RECOVERY_REQUIRED: "The skill store state is degraded; run ccski state repair.",
  STATE_GENERATION_CONFLICT: "The skill store state changed concurrently; retry the removal.",
  TARGET_DENIED: "The provider skills directory denied the removal.",
  DELETE_FAILED: "The skill entry could not be deleted from disk.",
  IO: "The skill store reported a filesystem failure.",
};

function removalDomainError(code: string | undefined): DomainError {
  const message =
    code !== undefined && REMOVAL_FAILURE_MESSAGES[code] !== undefined
      ? `${REMOVAL_FAILURE_MESSAGES[code]} (ccski code: ${code})`
      : "The skill store reported an unexpected failure during the removal.";
  return new DomainError(
    code !== undefined && KERNEL_CONFLICT_CODES.has(code) ? "CONFLICT" : "UNAVAILABLE",
    message,
  );
}

function conservativeRefusal(detail: string): DomainError {
  return new DomainError(
    "INVALID_OPERATION",
    `The ccski skill store ${detail}; the deletion was refused to avoid orphaned projections.`,
  );
}

/**
 * ccski 管辖技能的内核删除（批 5 双路由的内核半区）。判定基准 = state 投影表
 * 该实体的注册投影数：
 * - 实体 face（provider root === 实体根）：零投影 → deleteEntity（GUARD_ENTITY
 *   第二层守卫；expectedRevision = state 实体 revision）；带投影 → 对全部注册
 *   投影根 removeEntityProjections，内核 last-reference GC 退役实体（全清）。
 * - 投影 face：末投影 → removeEntityProjections（内核 GC 全清，断言实体已退役，
 *   被引用阻塞时如实 conflict）；否则单 face 摘除（实体与其余投影保留）。
 * face 无投影记录（未注册条目）= 内核只读拒绝 → conflict，宿主不自行摘除。
 */
export function createCcskiEntityRemover(
  kernel: CcskiEntityRemoveKernel = ccskiEntityRemoveKernel,
) {
  return async function removeCcskiEntity(input: CcskiEntityRemoveInput): Promise<void> {
    const stateBase = path.join(path.resolve(input.workspaceDirectory), ".agents");
    const state = readCcskiState(stateBase);
    if (state.kind !== "ok") {
      throw conservativeRefusal(
        state.kind === "absent"
          ? "state file is missing for this workspace"
          : "state is incompatible with the current format",
      );
    }

    const entity = Object.values(state.entities)
      .map((value) => safeParseExternal(EntityRecordMirrorSchema, value))
      .find(
        (record) =>
          record !== null &&
          record.logicalName === input.skillName &&
          // 路径绑定（P1-4，与 disabled 补充面同源）：伪造实体路径不得驱动删除
          // 路由（词法 + realpath 双 containment，绑定失败 = 记录不可信不匹配）。
          ccskiEntityPathBound(stateBase, record.folderName, record.path),
      );
    if (!entity) {
      throw conservativeRefusal(
        `does not track a skill named "${input.skillName}" in this workspace`,
      );
    }

    const projections = Object.values(state.projections)
      .map((value) => safeParseExternal(ProjectionRecordMirrorSchema, value))
      .filter((record): record is z.infer<typeof ProjectionRecordMirrorSchema> => record !== null)
      .filter((record) => record.folderName === entity.folderName)
      .filter((record) =>
        ccskiProjectionPathBound(record.rootPath, record.folderName, record.path),
      );

    const providerRoot = path.resolve(input.providerRoot);
    const entityRoot = ccskiEntityLibraryRoot(stateBase);
    const scope = {
      scope: "project" as const,
      workspaceDir: input.workspaceDirectory,
      name: input.skillName,
    };

    // 实体 face：删除语义 = 实体（+ 全部投影）全清，绝不留悬空链与 stale 记录。
    if (providerRoot === path.resolve(entityRoot)) {
      if (projections.length === 0) {
        const result = await kernel.deleteEntity({
          ...scope,
          expectedRevision: entity.revision,
          roots: [providerRoot],
        });
        if (result.kind === "error") throw removalDomainError(result.code);
        if (!result.directoryDeleted) {
          throw new DomainError(
            "UNAVAILABLE",
            "The skill entity record was retired but its directory could not be deleted; an unrecorded directory remains.",
          );
        }
        return;
      }
      const roots = [...new Set(projections.map((record) => path.resolve(record.rootPath)))];
      const result = await kernel.removeEntityProjections({ ...scope, roots });
      if (result.kind === "error") throw removalDomainError(result.code);
      const failedRoot = result.results.find((rootResult) => rootResult.status === "failed");
      if (failedRoot) throw removalDomainError(failedRoot.errorCode);
      if (!result.entityRemoved) {
        throw new DomainError(
          "CONFLICT",
          `The provider projections were removed but the skill entity was kept${result.gc.blockedBy ? ` (${result.gc.blockedBy.toLowerCase().replace("_", " ")})` : ""}; references remain.`,
        );
      }
      return;
    }

    // 投影 face：face 记录缺席 = 未注册条目，内核只读（GC_UNKNOWN_REFERENCE/
    // FOREIGN_OWNERSHIP 家族），宿主不自行发明摘除。
    const faceRecord = projections.find((record) => path.resolve(record.rootPath) === providerRoot);
    if (!faceRecord) {
      throw new DomainError(
        "CONFLICT",
        "The entry at this provider is not a registered ccski projection; the skill store refuses to remove it. Manage the entry manually.",
      );
    }

    const result = await kernel.removeEntityProjections({ ...scope, roots: [providerRoot] });
    if (result.kind === "error") throw removalDomainError(result.code);
    const faceResult = result.results.find(
      (rootResult) => path.resolve(rootResult.root) === providerRoot,
    );
    if (!faceResult || faceResult.status === "failed") {
      throw removalDomainError(faceResult?.errorCode);
    }
    if (faceResult.status === "skipped" && faceResult.errorCode === "GC_UNKNOWN_REFERENCE") {
      throw removalDomainError("GC_UNKNOWN_REFERENCE");
    }
    // 末投影：内核 last-reference GC 必须完成全清；被引用阻塞 = 如实 conflict。
    if (projections.length === 1 && !result.entityRemoved) {
      throw new DomainError(
        "CONFLICT",
        `The provider face was removed but the skill entity was kept${result.gc.blockedBy ? ` (${result.gc.blockedBy.toLowerCase().replace("_", " ")})` : ""}; references remain.`,
      );
    }
  };
}

/** 默认 remover（真实内核）。 */
export const removeCcskiEntity = createCcskiEntityRemover();
