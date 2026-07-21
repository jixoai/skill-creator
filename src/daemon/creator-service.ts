/**
 * Revision-safe skill creation, editing, and deletion.
 *
 * User input [2026-07-14]: "我们还需要有一个 创造、编辑 技能的路由(/creator)。二者是有机互联的"
 * User input [2026-07-21]: "任何外部输入都应该遵循这个规则：各种配置文件、数据库结构、网络返回等"
 * Architecture decisions [2026-07-22]: bind every document to one Workspace
 * Provider root while preserving unknown frontmatter and revision conflicts.
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
import type { WorkspaceProviderTarget } from "../shared/contracts/workspaces.js";
import { safeParseExternal } from "../shared/external-input.js";
import { DomainError } from "./domain-error.js";
import { assertPathInside, atomicWriteUtf8, contentRevision, directChild } from "./path-safety.js";
import type { SkillService } from "./skill-service.js";
import type { WorkspaceRegistry } from "./workspace-registry/index.js";

function parseDocument(
  target: WorkspaceProviderTarget,
  skillId: SkillId,
  directoryName: string,
  raw: string,
): SkillDocument {
  let parsed: ReturnType<typeof matter>;
  try {
    parsed = matter(raw);
  } catch {
    throw incompatibleDocument();
  }
  const safeDirectoryName = safeParseExternal(SkillDirectoryNameSchema, directoryName);
  const frontmatter = safeParseExternal(SkillFrontmatterSchema, parsed.data);
  if (!safeDirectoryName || !frontmatter) throw incompatibleDocument();
  return {
    skillId,
    ...target,
    directoryName: safeDirectoryName,
    frontmatter,
    body: parsed.content,
    revision: contentRevision(raw),
  };
}

function incompatibleDocument(): DomainError {
  return new DomainError(
    "INVALID_OPERATION",
    "The skill document frontmatter is incompatible with the current format.",
  );
}

/** Bind Creator operations to one Workspace Registry and skill module. */
export function createCreatorService(workspaces: WorkspaceRegistry, skills: SkillService) {
  return {
    load: (target: WorkspaceProviderTarget, skillId: SkillId) =>
      load(workspaces, skills, target, skillId),
    save: (input: SaveSkillInput) => save(workspaces, skills, input),
    remove: (target: WorkspaceProviderTarget, skillId: SkillId, expectedRevision: string) =>
      remove(workspaces, skills, target, skillId, expectedRevision),
  };
}

/** Creator operations bound to one daemon-owned Workspace Registry. */
export type CreatorService = ReturnType<typeof createCreatorService>;

/** Load an editable skill document from one writable Workspace Provider. */
async function load(
  workspaces: WorkspaceRegistry,
  skills: SkillService,
  target: WorkspaceProviderTarget,
  skillId: SkillId,
): Promise<SkillDocument> {
  const workspaceRoot = writableDirectory(workspaces, target);
  const skill = await skills.resolve(target, skillId);
  assertPathInside(workspaceRoot, skill.path);
  const file = skills.skillFile(skill);
  return parseDocument(target, skillId, skill.directoryName, fs.readFileSync(file, "utf8"));
}

/** Create a skill or revision-check and atomically update an existing skill. */
async function save(
  workspaces: WorkspaceRegistry,
  skills: SkillService,
  input: SaveSkillInput,
): Promise<SaveSkillResult> {
  const target = { workspaceId: input.workspaceId, providerId: input.providerId };
  const workspaceRoot = writableDirectory(workspaces, target);
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
    const skill = await skills.resolve(target, input.skillId);
    skillDirectory = skill.path;
    assertPathInside(workspaceRoot, skillDirectory);
    targetFile = skills.skillFile(skill);
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
      ? (await skills.list(target, true)).find(
          (skill) => skill.path === fs.realpathSync(skillDirectory),
        )?.id
      : input.skillId;
  if (!skillId) throw new Error("The saved skill could not be rediscovered by ccski.");

  const document = await load(workspaces, skills, target, skillId);
  const validation = await skills.validate(target, skillId);
  return { created, document, validation };
}

/** Delete a Workspace Provider-scoped skill only when its observed revision still matches. */
async function remove(
  workspaces: WorkspaceRegistry,
  skills: SkillService,
  target: WorkspaceProviderTarget,
  skillId: SkillId,
  expectedRevision: string,
): Promise<void> {
  const workspaceRoot = writableDirectory(workspaces, target);
  const skill = await skills.resolve(target, skillId);
  assertPathInside(workspaceRoot, skill.path);
  const current = fs.readFileSync(skills.skillFile(skill), "utf8");
  if (contentRevision(current) !== expectedRevision) {
    throw new DomainError("CONFLICT", "This skill changed on disk. Reload it before deleting.");
  }
  fs.rmSync(skill.path, { recursive: true, force: false });
}

function writableDirectory(workspaces: WorkspaceRegistry, target: WorkspaceProviderTarget): string {
  const scope = workspaces.resolveWritable(target);
  try {
    fs.mkdirSync(scope.directory, { recursive: true });
  } catch (error) {
    throw new DomainError(
      "UNAVAILABLE",
      `Provider skills directory is not writable: ${scope.workspaceLabel}`,
      { cause: error },
    );
  }
  return scope.directory;
}
