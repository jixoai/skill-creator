/**
 * Revision-safe skill creation, editing, and deletion.
 *
 * User intent [2026-07-14]: Creator is linked to the selected workspace and
 * must preserve skill documents instead of rebuilding lossy YAML.
 * Original error request [2026-07-14]: Creator revision conflicts must remain
 * safe, typed, and actionable across the WebUI RPC boundary.
 *
 * Orthogonal intents:
 *   [1] Create only safe direct-child skill directories.
 *   [2] Round-trip passthrough YAML frontmatter with gray-matter.
 *   [3] Reject stale updates/deletes and atomically write valid documents.
 */
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import {
  SkillDirectoryNameSchema,
  SkillFrontmatterSchema,
  type SaveSkillInput,
  type SaveSkillResult,
  type SkillDocument,
} from "../shared/contracts/creator.js";
import type { SkillId } from "../shared/contracts/skills.js";
import { DomainError } from "./domain-error.js";
import { assertPathInside, atomicWriteUtf8, contentRevision, directChild } from "./path-safety.js";
import * as skillService from "./skill-service.js";
import { writableDirectory } from "./workspace-service.js";

function parseDocument(
  workspaceId: SkillDocument["workspaceId"],
  skillId: SkillId,
  directoryName: string,
  raw: string,
): SkillDocument {
  const parsed = matter(raw);
  return {
    skillId,
    workspaceId,
    directoryName: SkillDirectoryNameSchema.parse(directoryName),
    frontmatter: SkillFrontmatterSchema.parse(parsed.data),
    body: parsed.content,
    revision: contentRevision(raw),
  };
}

/** Load an editable skill document from one writable workspace. */
export async function load(
  workspaceId: SkillDocument["workspaceId"],
  skillId: SkillId,
): Promise<SkillDocument> {
  const workspaceRoot = writableDirectory(workspaceId);
  const skill = await skillService.resolveSkill(workspaceId, skillId);
  assertPathInside(workspaceRoot, skill.path);
  const file = skillService.skillFile(skill);
  return parseDocument(workspaceId, skillId, skill.directoryName, fs.readFileSync(file, "utf8"));
}

/** Create a skill or revision-check and atomically update an existing skill. */
export async function save(input: SaveSkillInput): Promise<SaveSkillResult> {
  const workspaceRoot = writableDirectory(input.workspaceId);
  let created = false;
  let skillDirectory: string;
  let targetFile: string;

  if (input.mode === "create") {
    const directoryName = SkillDirectoryNameSchema.parse(input.directoryName);
    skillDirectory = directChild(workspaceRoot, directoryName);
    targetFile = path.join(skillDirectory, "SKILL.md");
    if (fs.existsSync(skillDirectory) && fs.readdirSync(skillDirectory).length > 0) {
      throw new DomainError("CONFLICT", `A non-empty directory already exists: ${directoryName}`);
    }
    created = true;
  } else {
    const skill = await skillService.resolveSkill(input.workspaceId, input.skillId);
    skillDirectory = skill.path;
    assertPathInside(workspaceRoot, skillDirectory);
    targetFile = skillService.skillFile(skill);
    const current = fs.readFileSync(targetFile, "utf8");
    if (contentRevision(current) !== input.expectedRevision) {
      throw new DomainError(
        "CONFLICT",
        "This skill changed on disk. Reload it before saving your edits.",
      );
    }
  }

  const frontmatter = SkillFrontmatterSchema.parse(input.frontmatter);
  const content = matter.stringify(input.body, frontmatter);
  atomicWriteUtf8(targetFile, content.endsWith("\n") ? content : `${content}\n`);

  const skillId =
    input.mode === "create"
      ? (await skillService.list(input.workspaceId, true)).find(
          (skill) => skill.path === fs.realpathSync(skillDirectory),
        )?.id
      : input.skillId;
  if (!skillId) throw new Error("The saved skill could not be rediscovered by ccski.");

  const document = await load(input.workspaceId, skillId);
  const validation = await skillService.validate(input.workspaceId, skillId);
  return { created, document, validation };
}

/** Delete a workspace-scoped skill only when its observed revision still matches. */
export async function remove(
  workspaceId: SkillDocument["workspaceId"],
  skillId: SkillId,
  expectedRevision: string,
): Promise<void> {
  const workspaceRoot = writableDirectory(workspaceId);
  const skill = await skillService.resolveSkill(workspaceId, skillId);
  assertPathInside(workspaceRoot, skill.path);
  const current = fs.readFileSync(skillService.skillFile(skill), "utf8");
  if (contentRevision(current) !== expectedRevision) {
    throw new DomainError("CONFLICT", "This skill changed on disk. Reload it before deleting.");
  }
  fs.rmSync(skill.path, { recursive: true, force: false });
}
