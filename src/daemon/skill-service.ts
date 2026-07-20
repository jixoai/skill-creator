/**
 * ccski discovery adapter with server-owned skill identity.
 *
 * User input [2026-07-14]: "基于 ../ccski 这个 sdk 来快速搭建一个 ‘skills 管理器’。"
 * User input [2026-07-21]: "任何外部输入都应该遵循这个规则：各种配置文件、数据库结构、网络返回等"
 * Architecture decisions [2026-07-14]: bind operations to explicit Workspace
 * identity and expose expected lookup failures without leaking infrastructure.
 *
 * Orthogonal intents:
 *   [1] Discover and identify skills through a daemon-owned Workspace Registry.
 *   [2] Read enabled and disabled skill documents reliably.
 *   [3] Toggle and validate resolved skill IDs without caller paths.
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
import type { WorkspaceId } from "../shared/contracts/workspaces.js";
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
}

function projectMetadata(source: unknown): SkillMetadata | null {
  const skill = safeParseExternal(CcskiSkillMetadataSchema, source);
  if (!skill) return null;

  try {
    const canonicalPath = canonicalDirectory(skill.path);
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
  return {
    list: (workspaceId: WorkspaceId, includeDisabled = true) =>
      list(workspaces, discoverSkills, workspaceId, includeDisabled),
    resolve: (workspaceId: WorkspaceId, skillId: SkillId) =>
      resolveSkill(workspaces, discoverSkills, workspaceId, skillId),
    skillFile,
    info: (workspaceId: WorkspaceId, skillId: SkillId) =>
      info(workspaces, discoverSkills, workspaceId, skillId),
    toggle: (workspaceId: WorkspaceId, skillIds: SkillId[], mode: "enable" | "disable") =>
      toggle(workspaces, discoverSkills, workspaceId, skillIds, mode),
    validate: (workspaceId: WorkspaceId, skillId: SkillId) =>
      validate(workspaces, discoverSkills, validateSkill, workspaceId, skillId),
  };
}

/** Workspace-scoped skill discovery, lookup, mutation, and validation operations. */
export type SkillService = ReturnType<typeof createSkillService>;

/** Discover unique skill metadata within one server-owned workspace scope. */
async function list(
  workspaces: WorkspaceRegistry,
  discoverSkills: SkillDiscoverer,
  workspaceId: WorkspaceId,
  includeDisabled = true,
): Promise<SkillMetadata[]> {
  const skills = await discoverSkills(workspaces.resolve(workspaceId, includeDisabled).options);
  const byId = new Map<SkillId, SkillMetadata>();
  for (const skill of skills) {
    const projected = projectMetadata(skill);
    if (!projected) continue;
    const existing = byId.get(projected.id);
    if (!existing || (existing.disabled && !projected.disabled)) byId.set(projected.id, projected);
  }
  return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
}

/** Resolve an opaque skill ID only within its requested workspace. */
async function resolveSkill(
  workspaces: WorkspaceRegistry,
  discoverSkills: SkillDiscoverer,
  workspaceId: WorkspaceId,
  skillId: SkillId,
): Promise<SkillMetadata> {
  const skill = (await list(workspaces, discoverSkills, workspaceId, true)).find(
    (candidate) => candidate.id === skillId,
  );
  if (!skill) throw new DomainError("NOT_FOUND", `Skill not found in workspace: ${skillId}`);
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

/** Read one skill document and its current content revision. */
async function info(
  workspaces: WorkspaceRegistry,
  discoverSkills: SkillDiscoverer,
  workspaceId: WorkspaceId,
  skillId: SkillId,
): Promise<SkillInfo> {
  const skill = await resolveSkill(workspaces, discoverSkills, workspaceId, skillId);
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
  workspaces: WorkspaceRegistry,
  discoverSkills: SkillDiscoverer,
  workspaceId: WorkspaceId,
  skillIds: SkillId[],
  mode: "enable" | "disable",
): Promise<ToggleSummary> {
  const discovered = new Map(
    (await list(workspaces, discoverSkills, workspaceId, true)).map((skill) => [skill.id, skill]),
  );
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

/** Validate one workspace-scoped skill through ccski. */
async function validate(
  workspaces: WorkspaceRegistry,
  discoverSkills: SkillDiscoverer,
  validateSkill: SkillValidator,
  workspaceId: WorkspaceId,
  skillId: SkillId,
): Promise<ValidateResult> {
  const skill = (await list(workspaces, discoverSkills, workspaceId, true)).find(
    (candidate) => candidate.id === skillId,
  );
  if (!skill) throw new DomainError("NOT_FOUND", `Skill not found in workspace: ${skillId}`);
  const result = safeParseExternal(
    CcskiValidateResultSchema,
    await validateSkill({
      ...workspaces.resolve(workspaceId, true).options,
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
