/**
 * ccski discovery adapter with server-owned skill identity.
 *
 * User input [2026-07-14]: "基于 ../ccski 这个 sdk 来快速搭建一个 ‘skills 管理器’。"
 * User input [2026-07-21]: "任何外部输入都应该遵循这个规则：各种配置文件、数据库结构、网络返回等"
 * User input [2026-07-27]: "自动区分经 npx-skills-cli 安装的技能；标记可升级。"
 * Architecture decisions [2026-07-22]: bind operations to explicit Workspace
 * Provider identity and expose expected lookup failures without leaking infrastructure.
 *
 * Orthogonal intents:
 *   [1] Discover and identify skills through a daemon-owned Workspace Registry.
 *   [2] Read enabled and disabled skill documents reliably.
 *   [3] Toggle and validate resolved skill IDs without caller paths（批 2.3 双路由：
 *       ccski 管辖 → toggleEntityProjection 摘链/重建；其余 → 文件改名不变）.
 *   [4] Project skills-CLI provenance (installedVia / updatable) from the probe map.
 *   [5] Delegate bounded file tree/read to skill-files (skills-tabs-redesign 批 3
 *       Δ2：每次调用经 discovery 重解析身份后进入 skill-files 有界实现——安全
 *       逻辑物理隔离在专属模块，此处只做身份解析委托).
 * 妥协声明：[5] 是传输接线不是第 5 个领域意图的实现地；文件预算/symlink/TOCTOU
 * 法则全部住在 skill-files.ts。
 */
import fs from "node:fs";
import path from "node:path";
import {
  listSkills as listCcskiSkills,
  toggleEntityProjection as ccskiToggleEntityProjection,
  validateSkill as validateCcskiSkill,
  type EntityToggleOptions,
  type EntityToggleResult,
  type ListOptions,
  type ValidateOptions,
} from "ccski";
import { z } from "zod";
import type { WorkspaceProviderTarget } from "../shared/contracts/workspaces.js";
import type {
  SkillId,
  SkillInfo,
  SkillMetadata,
  ToggleSummary,
  ValidateResult,
} from "../shared/contracts/skills.js";
import {
  PluginInfoSchema,
  SkillIdSchema,
  SkillLocationSchema,
  SkillMetadataSchema,
} from "../shared/contracts/skills.js";
import { safeParseExternal } from "../shared/external-input.js";
import { homeDir } from "../shared/paths.js";
import { readStateDisabledRows } from "./ccski-state-disabled.js";
import { DomainError } from "./domain-error.js";
import { listSkillFiles, readSkillFile } from "./skill-files.js";
import {
  assertPathInside,
  canonicalDirectory,
  contentRevision,
  opaquePathId,
} from "./path-safety.js";
import type { SkillsCliProbe, SkillsCliProbeMap } from "./skills-cli-probe.js";
import type { WorkspaceRegistry } from "./workspace-registry/index.js";
import type { WorkspaceProviderScope } from "./workspace-registry/index.js";

function metadataId(skillPath: string): SkillId {
  return SkillIdSchema.parse(opaquePathId("sk", canonicalDirectory(skillPath)));
}

const CcskiSkillMetadataSchema = z.object({
  name: z.string(),
  description: z.string(),
  disabled: z.boolean().optional(),
  provider: z.string(),
  location: SkillLocationSchema,
  sourcePriority: z.number().optional(),
  sourceKind: z.string().optional(),
  path: z.string().min(1),
  hasReferences: z.boolean(),
  hasScripts: z.boolean(),
  hasAssets: z.boolean(),
  pluginInfo: PluginInfoSchema.optional(),
  // ccski 3.0 发现层增量字段（ccski-3-host-migration 批 2.3）：顶层形态 + ownership
  // 认证。toggle 据此双路由（ccski 管辖 → 内核摘链/重建；其余 → 宿主文件改名）。
  entryKind: z.enum(["directory", "symlink"]).optional(),
  ownership: z.enum(["ccski", "external", "unknown"]).optional(),
});

const CcskiValidateResultSchema = z.object({
  success: z.boolean(),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
});

/** Third-party discovery boundary; results are untrusted until projected locally. */
export type SkillDiscoverer = (options: ListOptions) => Promise<ReadonlyArray<unknown>>;

/** Third-party validation boundary; results are untrusted until projected locally. */
export type SkillValidator = (options: ValidateOptions) => Promise<unknown>;

/** ccski 实体投影启停内核 seam（批 2.3）；typed result 不属于异常流。 */
export type EntityProjectionToggler = (options: EntityToggleOptions) => Promise<EntityToggleResult>;

/** Replace external ccski adapters at the service boundary. */
export interface SkillServiceOptions {
  discoverSkills?: SkillDiscoverer;
  validateSkill?: SkillValidator;
  /** ccski `toggleEntityProjection` 适配器；默认走真实内核（批 2.3）。 */
  entityToggle?: EntityProjectionToggler;
  /** 可选 skills-CLI 探测器；注入后 `skills.list` 投影 installedVia / updatable。 */
  skillsCliProbe?: SkillsCliProbe;
}

/**
 * 把 skills-CLI 探测命中投影为 provenance 字段。
 *
 * probe 命中（按技能的 canonical path 查表）：标记 `skills-cli` + `updatable`。
 * 该 canonical path 已由 `skills.list(target)` 经 `workspaces.resolve` 限定在
 * server-owned 作用域内，故命中即等价于「probe 路径落在 server-owned 根下」，
 * 无需重复 containment（spec scenario「越界视为无 provenance」由不命中自然满足）。
 * 未命中或无 probe：`unknown` + `updatable=false`。
 */
function projectProvenance(
  skillPath: string,
  probeMap: SkillsCliProbeMap | null,
): { installedVia: "skills-cli" | "unknown"; updatable: boolean } {
  if (!probeMap) return { installedVia: "unknown", updatable: false };
  if (!probeMap.has(skillPath)) return { installedVia: "unknown", updatable: false };
  return { installedVia: "skills-cli", updatable: true };
}

function projectMetadata(
  source: unknown,
  probeMap: SkillsCliProbeMap | null,
): SkillMetadata | null {
  const skill = safeParseExternal(CcskiSkillMetadataSchema, source);
  if (!skill) return null;

  try {
    const canonicalPath = canonicalDirectory(skill.path);
    const provenance = projectProvenance(canonicalPath, probeMap);
    return safeParseExternal(SkillMetadataSchema, {
      id: metadataId(canonicalPath),
      name: skill.name,
      description: skill.description,
      directoryName: path.basename(canonicalPath),
      disabled: skill.disabled ?? false,
      provider: skill.provider,
      location: skill.location,
      sourcePriority: skill.sourcePriority,
      sourceKind: skill.sourceKind,
      path: canonicalPath,
      hasReferences: skill.hasReferences,
      hasScripts: skill.hasScripts,
      hasAssets: skill.hasAssets,
      pluginInfo: skill.pluginInfo ?? null,
      installedVia: provenance.installedVia,
      updatable: provenance.updatable,
      ...(skill.entryKind !== undefined ? { entryKind: skill.entryKind } : {}),
      ...(skill.ownership !== undefined ? { ownership: skill.ownership } : {}),
      // 批 3.3 四名区分：发现位置（symlink 投影路径）≠ canonical 实体路径时携带。
      ...(skill.path !== canonicalPath ? { projectionPath: skill.path } : {}),
    });
  } catch {
    return null;
  }
}

/** Bind skill operations to one daemon-owned Workspace Registry. */
export function createSkillService(
  workspaces: WorkspaceRegistry,
  options: SkillServiceOptions = {},
) {
  // 默认发现面 = ccski 3.0 listSkills（顶层 symlink 一等条目；批 3.1 退役
  // ccski-symlink-entries 增补——3.0 下 wrapper 已实证 no-op，见 change 目录
  // wrapper-retirement-receipt.md）。注入桩语义不变。
  const discoverSkills = options.discoverSkills ?? listCcskiSkills;
  const validateSkill = options.validateSkill ?? validateCcskiSkill;
  const entityToggle = options.entityToggle ?? ccskiToggleEntityProjection;
  const skillsCliProbe = options.skillsCliProbe;

  // 同 target discovery 在途合并（perf-firstscreen B-6）：进 provider 后同一
  // 交互簇内的 list/resolve/info/toggle/validate 并发共享一次扫描。曾试过 3s
  // TTL 缓存，但 steward/creator/测试 fixture 的「直接写盘 → 再读」路径对缓存
  // 不可见（实测 skill-steward-runtime 40 例 compensated），写后读一致性优先，
  // 降级为仅合并「同时在途」的请求；写路径通过 invalidateDiscovery 主动失效。
  // （跨请求缓存留给 skill-search 索引化，见 perf-firstscreen proposal B-7。）
  const discoveryInflight = new Map<string, Promise<SkillMetadata[]>>();

  const discoveryKey = (target: WorkspaceProviderTarget, includeDisabled: boolean): string =>
    `${target.workspaceId}:${target.providerId}:${includeDisabled}`;

  const cachedList = (
    target: WorkspaceProviderTarget,
    includeDisabled = true,
  ): Promise<SkillMetadata[]> => {
    const key = discoveryKey(target, includeDisabled);
    const existing = discoveryInflight.get(key);
    if (existing) return existing;
    const promise = list(workspaces, discoverSkills, target, includeDisabled, skillsCliProbe);
    discoveryInflight.set(key, promise);
    // settle 后移除在途记录（失败不缓存，成功也不跨请求缓存）。
    const forget = () => discoveryInflight.delete(key);
    promise.then(forget, forget);
    return promise;
  };

  const invalidateTarget = (target: WorkspaceProviderTarget): void => {
    discoveryInflight.delete(discoveryKey(target, true));
    discoveryInflight.delete(discoveryKey(target, false));
  };

  return {
    list: (target: WorkspaceProviderTarget, includeDisabled = true) =>
      cachedList(target, includeDisabled),
    resolve: (target: WorkspaceProviderTarget, skillId: SkillId) =>
      resolveSkill(cachedList, target, skillId),
    skillFile,
    info: (target: WorkspaceProviderTarget, skillId: SkillId) => info(cachedList, target, skillId),
    /** 有界文件树（Δ2）：重解析身份后进入 skill-files 有界枚举。 */
    files: (target: WorkspaceProviderTarget, skillId: SkillId) =>
      resolveSkill(cachedList, target, skillId).then((skill) =>
        listSkillFiles(skill.path, { disabled: skill.disabled }),
      ),
    /** 有界文件读（Δ2）：重解析身份后逐级验证相对路径（TOCTOU 防线在 skill-files）。 */
    fileRead: (target: WorkspaceProviderTarget, skillId: SkillId, filePath: string) =>
      resolveSkill(cachedList, target, skillId).then((skill) =>
        readSkillFile(skill.path, filePath),
      ),
    toggle: (target: WorkspaceProviderTarget, skillIds: SkillId[], mode: "enable" | "disable") =>
      toggle(
        cachedList,
        workspaces.resolve(target, true),
        target,
        skillIds,
        mode,
        entityToggle,
      ).finally(() => invalidateTarget(target)),
    validate: (target: WorkspaceProviderTarget, skillId: SkillId) =>
      validate(cachedList, validateSkill, workspaces, target, skillId),
    /**
     * 丢弃该 target 的 discovery 缓存（写事务用）：apply/rollback 等绕过
     * 本 service 直接写盘后，验证读必须看到新磁盘态（perf B-6 的 TTL 缓存
     * 不知道外部写入）。
     */
    invalidateDiscovery: invalidateTarget,
  };
}

/** Workspace Provider-scoped skill discovery, lookup, mutation, and validation operations. */
export type SkillService = ReturnType<typeof createSkillService>;

/** Discover unique skill metadata within one server-owned Workspace Provider scope. */
async function list(
  workspaces: WorkspaceRegistry,
  discoverSkills: SkillDiscoverer,
  target: WorkspaceProviderTarget,
  includeDisabled = true,
  skillsCliProbe?: SkillsCliProbe,
): Promise<SkillMetadata[]> {
  const scope = workspaces.resolve(target, includeDisabled);
  const skills = await discoverSkills(scope.options);
  // probe 非阻塞快照（perf-firstscreen B-5）：未就绪时 provenance 投影为缺省，
  // 不让 npx 冷启动（0-15s）阻塞 skills.list；daemon boot 后台预热补全。
  const probeMap = skillsCliProbe?.peek() ?? null;
  const byId = new Map<SkillId, SkillMetadata>();
  for (const skill of skills) {
    const projected = projectMetadata(skill, probeMap);
    if (!projected) continue;
    const existing = byId.get(projected.id);
    if (!existing || (existing.disabled && !projected.disabled)) byId.set(projected.id, projected);
  }
  // state-backed disabled 补充面（批 3.2）：link 摘链后文件系发现面消失的投影，
  // 经 state 记录 + 实体内容源补回 disabled 行，UI 启停往返闭合。仅 disabled
  // 请求面补充；文件系已见（canonical path 重复/投影路径被占位）不补。
  if (includeDisabled) {
    const seenCanonicalPaths = new Set([...byId.values()].map((skill) => skill.path));
    const stateBase = path.join(
      path.resolve(scope.workspaceDirectory ?? scope.options.userDir ?? homeDir()),
      ".agents",
    );
    for (const row of readStateDisabledRows({
      providerRoot: scope.directory,
      stateBase,
      providerId: target.providerId,
      seenCanonicalPaths,
    })) {
      if (!byId.has(row.id)) byId.set(row.id, row);
    }
  }
  return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
}

/** 同 target 列表装载器（createSkillService 的 TTL 缓存包装）。 */
export type SkillListLoader = (
  target: WorkspaceProviderTarget,
  includeDisabled?: boolean,
) => Promise<SkillMetadata[]>;

/** Resolve an opaque skill ID only within its requested Workspace Provider. */
async function resolveSkill(
  loadList: SkillListLoader,
  target: WorkspaceProviderTarget,
  skillId: SkillId,
): Promise<SkillMetadata> {
  const skill = (await loadList(target, true)).find((candidate) => candidate.id === skillId);
  if (!skill)
    throw new DomainError("NOT_FOUND", `Skill not found in Workspace Provider: ${skillId}`);
  return skill;
}

/**
 * Resolve the available enabled or disabled document for a discovered skill.
 * 身份文件缺席时的对侧回退（批 3.2）：state 补充的 disabled 行内容源在实体库，
 * 实体恒保持 enabled 形态 SKILL.md（link 模式禁用永不换名）——按禁用旗标首选
 * `.SKILL.md`，缺席则回退读取真实在场的另一身份文件；两份俱缺才是 UNAVAILABLE。
 */
function skillFile(skill: SkillMetadata): string {
  const filename = skill.disabled ? ".SKILL.md" : "SKILL.md";
  const alternate = skill.disabled ? "SKILL.md" : ".SKILL.md";
  const file = path.join(skill.path, filename);
  assertPathInside(skill.path, file);
  if (isRegularFile(file)) return file;
  const fallback = path.join(skill.path, alternate);
  assertPathInside(skill.path, fallback);
  if (isRegularFile(fallback)) return fallback;
  throw new DomainError("UNAVAILABLE", `Skill document is unavailable: ${skill.name}`);
}

/** lstat 确认真实 regular file（不跟进 symlink）。 */
function isRegularFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/** Read one Workspace Provider skill document and its current content revision. */
async function info(
  loadList: SkillListLoader,
  target: WorkspaceProviderTarget,
  skillId: SkillId,
): Promise<SkillInfo> {
  const skill = await resolveSkill(loadList, target, skillId);
  const file = skillFile(skill);
  const content = fs.readFileSync(file, "utf8");
  return {
    ...skill,
    size: Buffer.byteLength(content),
    content,
    revision: contentRevision(content),
  };
}

/**
 * Enable or disable selected skills without overwriting file conflicts.
 * 双路由（ccski-3-host-migration 批 2.3）：发现层 `ownership === "ccski"` 的技能走
 * 内核 `toggleEntityProjection`（link 摘链/重建的物理禁用语义；materialized 副本
 * 走内核 ccski-legacy 约定）；其余（external/unknown 链接、普通目录技能）保留宿主
 * 文件改名路径（SKILL.md ↔ .SKILL.md）不变。内核 typed error 映射有限词表，enable
 * 遇目标冲突返回 conflict 不覆盖。
 */
async function toggle(
  loadList: SkillListLoader,
  scope: WorkspaceProviderScope,
  target: WorkspaceProviderTarget,
  skillIds: SkillId[],
  mode: "enable" | "disable",
  entityToggle: EntityProjectionToggler,
): Promise<ToggleSummary> {
  const providerRoot = scope.directory;
  const discovered = new Map((await loadList(target, true)).map((skill) => [skill.id, skill]));
  const results: ToggleSummary["results"] = [];

  /** ccski 管辖路由结果（调用方合并 skillId/name）。 */
  type ProjectionToggleOutcome = {
    status: ToggleSummary["results"][number]["status"];
    error?: string;
  };

  /** ccski 管辖路由：scope/roots 映射（Imported = project+workspaceDir；Global = global+userDir）。 */
  const toggleCcskiProjection = async (name: string): Promise<ProjectionToggleOutcome> => {
    const kernelOptions: EntityToggleOptions = {
      scope: scope.workspaceKind === "global" ? "global" : "project",
      ...(scope.workspaceKind === "global"
        ? { userDir: scope.options.userDir ?? homeDir() }
        : scope.workspaceDirectory === undefined
          ? {}
          : { workspaceDir: scope.workspaceDirectory }),
      name,
      root: providerRoot,
      action: mode,
    };
    const result = await entityToggle(kernelOptions);
    if (result.kind === "ok") {
      return result.status === "toggled"
        ? { status: mode === "disable" ? "disabled" : "enabled" }
        : { status: "skipped" };
    }
    // typed error → 有限词表（不裸透传内核 message）。
    if (result.code === "ENTITY_REVISED") {
      return {
        status: "conflict",
        error:
          "The skill was updated after this projection was disabled; update it before enabling. (ccski code: ENTITY_REVISED)",
      };
    }
    if (result.code === "GUARD_PROJECTION" || result.code === "FOREIGN_OWNERSHIP") {
      return {
        status: "conflict",
        error: `The projection destination is occupied or not ccski-owned; refusing to ${mode} over it. (ccski code: ${result.code})`,
      };
    }
    return {
      status: "failed",
      error: `The ccski projection could not be ${mode}d. (ccski code: ${result.code})`,
    };
  };

  // symlink 条目守卫（self-skill-symlink 复核 P1-3）：skill.path 已被 realpath
  // 归并到链接目标内部（条目名可能随别名漂移，不能按 directoryName 探测），
  // rename 会穿透链改写 server-owned root 之外的内容（产品安装内技能源/用户
  // 自有目录）。按「顶层链接条目的 realpath 覆盖域」判定，命中即 typed conflict。
  const linkedTargets: string[] = [];
  try {
    for (const entry of fs.readdirSync(providerRoot, { withFileTypes: true })) {
      if (!entry.isSymbolicLink()) continue;
      try {
        linkedTargets.push(fs.realpathSync(path.join(providerRoot, entry.name)));
      } catch {
        // 悬空链不覆盖任何现存技能。
      }
    }
  } catch {
    // root 不可读：守卫缺席，交给后续 rename 路径报 failed。
  }
  const isLinkedSkill = (skillPath: string): boolean =>
    linkedTargets.some((target) => skillPath === target || skillPath.startsWith(target + path.sep));

  for (const skillId of skillIds) {
    const skill = discovered.get(skillId);
    if (!skill) {
      results.push({ skillId, name: skillId, status: "failed", error: "Skill not found." });
      continue;
    }
    if (skill.ownership === "ccski") {
      const outcome = await toggleCcskiProjection(skill.name);
      results.push({ skillId, name: skill.name, ...outcome });
      continue;
    }
    if (isLinkedSkill(skill.path)) {
      results.push({
        skillId,
        name: skill.name,
        status: "conflict",
        error:
          "This entry is a symlink; toggling would rename files inside its target. Manage the link itself instead.",
      });
      continue;
    }
    const wantsDisabled = mode === "disable";
    if (skill.disabled === wantsDisabled) {
      results.push({ skillId, name: skill.name, status: "skipped" });
      continue;
    }
    const source = path.join(skill.path, wantsDisabled ? "SKILL.md" : ".SKILL.md");
    const destination = path.join(skill.path, wantsDisabled ? ".SKILL.md" : "SKILL.md");
    try {
      assertPathInside(skill.path, source);
      assertPathInside(skill.path, destination);
      if (fs.existsSync(destination)) {
        results.push({
          skillId,
          name: skill.name,
          status: "conflict",
          error: `Both ${path.basename(source)} and ${path.basename(destination)} exist.`,
        });
        continue;
      }
      fs.renameSync(source, destination);
      results.push({ skillId, name: skill.name, status: wantsDisabled ? "disabled" : "enabled" });
    } catch {
      results.push({
        skillId,
        name: skill.name,
        status: "failed",
        error: "The skill could not be updated on disk.",
      });
    }
  }

  return {
    mode,
    results,
    succeeded: results.filter(
      (result) => result.status === "enabled" || result.status === "disabled",
    ).length,
    skipped: results.filter((result) => result.status === "skipped").length,
    conflicts: results.filter((result) => result.status === "conflict").length,
    failed: results.filter((result) => result.status === "failed").length,
  };
}

/** Validate one Workspace Provider-scoped skill through ccski. */
async function validate(
  loadList: SkillListLoader,
  validateSkill: SkillValidator,
  workspaces: WorkspaceRegistry,
  target: WorkspaceProviderTarget,
  skillId: SkillId,
): Promise<ValidateResult> {
  const skill = (await loadList(target, true)).find((candidate) => candidate.id === skillId);
  if (!skill)
    throw new DomainError("NOT_FOUND", `Skill not found in Workspace Provider: ${skillId}`);
  const result = safeParseExternal(
    CcskiValidateResultSchema,
    await validateSkill({
      ...workspaces.resolve(target, true).options,
      path: skillFile(skill),
    }),
  );
  if (!result) {
    return {
      skillId,
      name: skill.name,
      success: false,
      errors: ["ccski returned an incompatible validation result."],
      warnings: [],
    };
  }
  return {
    skillId,
    name: skill.name,
    success: result.success,
    errors: result.errors,
    warnings: result.warnings,
  };
}
