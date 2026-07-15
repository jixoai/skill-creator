/**
 * ccski discovery adapter with server-owned skill identity.
 *
 * User input [2026-07-14]: "基于 ../ccski 这个 sdk 来快速搭建一个 ‘skills 管理器’。"
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
import { listSkills, validateSkill as validateCcskiSkill } from "ccski";
import type { WorkspaceId } from "../shared/contracts/workspaces.js";
import type {
  SkillId,
  SkillInfo,
  SkillMetadata,
  ToggleSummary,
  ValidateResult,
} from "../shared/contracts/skills.js";
import { SkillIdSchema } from "../shared/contracts/skills.js";
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

function projectMetadata(skill: Awaited<ReturnType<typeof listSkills>>[number]): SkillMetadata {
  const canonicalPath = canonicalDirectory(skill.path);
  return {
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
  };
}

/** Bind skill operations to one daemon-owned Workspace Registry. */
export function createSkillService(workspaces: WorkspaceRegistry) {
  return {
    list: (workspaceId: WorkspaceId, includeDisabled = true) =>
      list(workspaces, workspaceId, includeDisabled),
    resolve: (workspaceId: WorkspaceId, skillId: SkillId) =>
      resolveSkill(workspaces, workspaceId, skillId),
    skillFile,
    info: (workspaceId: WorkspaceId, skillId: SkillId) => info(workspaces, workspaceId, skillId),
    toggle: (workspaceId: WorkspaceId, skillIds: SkillId[], mode: "enable" | "disable") =>
      toggle(workspaces, workspaceId, skillIds, mode),
    validate: (workspaceId: WorkspaceId, skillId: SkillId) =>
      validate(workspaces, workspaceId, skillId),
  };
}

/** Workspace-scoped skill discovery, lookup, mutation, and validation operations. */
export type SkillService = ReturnType<typeof createSkillService>;

/** Discover unique skill metadata within one server-owned workspace scope. */
async function list(
  workspaces: WorkspaceRegistry,
  workspaceId: WorkspaceId,
  includeDisabled = true,
): Promise<SkillMetadata[]> {
  const skills = await listSkills(workspaces.resolve(workspaceId, includeDisabled).options);
  const byId = new Map<SkillId, SkillMetadata>();
  for (const skill of skills) {
    const projected = projectMetadata(skill);
    const existing = byId.get(projected.id);
    if (!existing || (existing.disabled && !projected.disabled)) byId.set(projected.id, projected);
  }
  return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
}

/** Resolve an opaque skill ID only within its requested workspace. */
async function resolveSkill(
  workspaces: WorkspaceRegistry,
  workspaceId: WorkspaceId,
  skillId: SkillId,
): Promise<SkillMetadata> {
  const skill = (await list(workspaces, workspaceId, true)).find(
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
  workspaceId: WorkspaceId,
  skillId: SkillId,
): Promise<SkillInfo> {
  const skill = await resolveSkill(workspaces, workspaceId, skillId);
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
  workspaceId: WorkspaceId,
  skillIds: SkillId[],
  mode: "enable" | "disable",
): Promise<ToggleSummary> {
  const discovered = new Map(
    (await list(workspaces, workspaceId, true)).map((skill) => [skill.id, skill]),
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
  workspaceId: WorkspaceId,
  skillId: SkillId,
): Promise<ValidateResult> {
  const skill = await resolveSkill(workspaces, workspaceId, skillId);
  const result = await validateCcskiSkill({
    ...workspaces.resolve(workspaceId, true).options,
    path: skillFile(skill),
  });
  return {
    skillId,
    name: skill.name,
    success: result.success,
    errors: result.errors,
    warnings: result.warnings,
  };
}
