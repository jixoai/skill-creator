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
 *   [3] Toggle and validate resolved skill IDs without caller paths.
 *   [4] Project skills-CLI provenance (installedVia / updatable) from the probe map.
 */
import fs from "node:fs";
import path from "node:path";
import {
  listSkills,
  validateSkill as validateCcskiSkill,
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
import { DomainError } from "./domain-error.js";
import {
  assertPathInside,
  canonicalDirectory,
  contentRevision,
  opaquePathId,
} from "./path-safety.js";
import type { SkillsCliProbe, SkillsCliProbeMap } from "./skills-cli-probe.js";
import type { WorkspaceRegistry } from "./workspace-registry/index.js";

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

/** Replace external ccski adapters at the service boundary. */
export interface SkillServiceOptions {
  discoverSkills?: SkillDiscoverer;
  validateSkill?: SkillValidator;
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
  const discoverSkills = options.discoverSkills ?? listSkills;
  const validateSkill = options.validateSkill ?? validateCcskiSkill;
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
    toggle: (target: WorkspaceProviderTarget, skillIds: SkillId[], mode: "enable" | "disable") =>
      toggle(cachedList, target, skillIds, mode).finally(() => invalidateTarget(target)),
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

/** Resolve the available enabled or disabled document for a discovered skill. */
function skillFile(skill: SkillMetadata): string {
  const filename = skill.disabled ? ".SKILL.md" : "SKILL.md";
  const file = path.join(skill.path, filename);
  assertPathInside(skill.path, file);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new DomainError("UNAVAILABLE", `Skill document is unavailable: ${skill.name}`);
  }
  return file;
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

/** Enable or disable selected skills without overwriting file conflicts. */
async function toggle(
  loadList: SkillListLoader,
  target: WorkspaceProviderTarget,
  skillIds: SkillId[],
  mode: "enable" | "disable",
): Promise<ToggleSummary> {
  const discovered = new Map((await loadList(target, true)).map((skill) => [skill.id, skill]));
  const results: ToggleSummary["results"] = [];

  for (const skillId of skillIds) {
    const skill = discovered.get(skillId);
    if (!skill) {
      results.push({ skillId, name: skillId, status: "failed", error: "Skill not found." });
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
