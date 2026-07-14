/**
 * ccski discovery adapter with server-owned skill identity.
 *
 * User intent [2026-07-14]: skill reads, validation, and toggles must act on
 * the workspace shown in the UI and must reject file conflicts.
 * Original error request [2026-07-14]: expose expected skill lookup and
 * availability failures without leaking unknown filesystem errors.
 *
 * Orthogonal intents:
 *   [1] Discover and identify skills through ccski.
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
import { readOptions } from "./workspace-service.js";

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

/** Discover unique skill metadata within one server-owned workspace scope. */
export async function list(
  workspaceId: WorkspaceId,
  includeDisabled = true,
): Promise<SkillMetadata[]> {
  const skills = await listSkills(readOptions(workspaceId, includeDisabled));
  const byId = new Map<SkillId, SkillMetadata>();
  for (const skill of skills) {
    const projected = projectMetadata(skill);
    const existing = byId.get(projected.id);
    if (!existing || (existing.disabled && !projected.disabled)) byId.set(projected.id, projected);
  }
  return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
}

/** Resolve an opaque skill ID only within its requested workspace. */
export async function resolveSkill(
  workspaceId: WorkspaceId,
  skillId: SkillId,
): Promise<SkillMetadata> {
  const skill = (await list(workspaceId, true)).find((candidate) => candidate.id === skillId);
  if (!skill) throw new DomainError("NOT_FOUND", `Skill not found in workspace: ${skillId}`);
  return skill;
}

/** Resolve the available enabled or disabled document for a discovered skill. */
export function skillFile(skill: SkillMetadata): string {
  const filename = skill.disabled ? ".SKILL.md" : "SKILL.md";
  const file = path.join(skill.path, filename);
  assertPathInside(skill.path, file);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new DomainError("UNAVAILABLE", `Skill document is unavailable: ${skill.name}`);
  }
  return file;
}

/** Read one skill document and its current content revision. */
export async function info(workspaceId: WorkspaceId, skillId: SkillId): Promise<SkillInfo> {
  const skill = await resolveSkill(workspaceId, skillId);
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
export async function toggle(
  workspaceId: WorkspaceId,
  skillIds: SkillId[],
  mode: "enable" | "disable",
): Promise<ToggleSummary> {
  const discovered = new Map((await list(workspaceId, true)).map((skill) => [skill.id, skill]));
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
export async function validate(
  workspaceId: WorkspaceId,
  skillId: SkillId,
): Promise<ValidateResult> {
  const skill = await resolveSkill(workspaceId, skillId);
  const result = await validateCcskiSkill({
    ...readOptions(workspaceId, true),
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
