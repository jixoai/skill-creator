/**
 * Revision-safe skill creation, editing, and deletion.
 *
 * User input [2026-07-14]: "我们还需要有一个 创造、编辑 技能的路由(/creator)。二者是有机互联的"
 * User input [2026-07-21]: "任何外部输入都应该遵循这个规则：各种配置文件、数据库结构、网络返回等"
 * Architecture decisions [2026-07-14]: preserve unknown frontmatter and expose
 * revision conflicts as typed, actionable RPC errors.
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
import { safeParseExternal } from "../shared/external-input.js";
import { DomainError } from "./domain-error.js";
import { assertPathInside, atomicWriteUtf8, contentRevision, directChild } from "./path-safety.js";
import type { SkillService } from "./skill-service.js";
import type { WorkspaceRegistry } from "./workspace-registry/index.js";

function parseDocument(
  workspaceId: SkillDocument["workspaceId"],
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
    workspaceId,
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
    load: (workspaceId: SkillDocument["workspaceId"], skillId: SkillId) =>
      load(workspaces, skills, workspaceId, skillId),
    save: (input: SaveSkillInput) => save(workspaces, skills, input),
    remove: (
      workspaceId: SkillDocument["workspaceId"],
      skillId: SkillId,
      expectedRevision: string,
    ) => remove(workspaces, skills, workspaceId, skillId, expectedRevision),
  };
}

/** Creator operations bound to one daemon-owned Workspace Registry. */
export type CreatorService = ReturnType<typeof createCreatorService>;

/** Load an editable skill document from one writable workspace. */
async function load(
  workspaces: WorkspaceRegistry,
  skills: SkillService,
  workspaceId: SkillDocument["workspaceId"],
  skillId: SkillId,
): Promise<SkillDocument> {
  const workspaceRoot = writableDirectory(workspaces, workspaceId);
  const skill = await skills.resolve(workspaceId, skillId);
  assertPathInside(workspaceRoot, skill.path);
  const file = skills.skillFile(skill);
  return parseDocument(workspaceId, skillId, skill.directoryName, fs.readFileSync(file, "utf8"));
}

/** Create a skill or revision-check and atomically update an existing skill. */
async function save(
  workspaces: WorkspaceRegistry,
  skills: SkillService,
  input: SaveSkillInput,
): Promise<SaveSkillResult> {
  const workspaceRoot = writableDirectory(workspaces, input.workspaceId);
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
    const skill = await skills.resolve(input.workspaceId, input.skillId);
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
      ? (await skills.list(input.workspaceId, true)).find(
          (skill) => skill.path === fs.realpathSync(skillDirectory),
        )?.id
      : input.skillId;
  if (!skillId) throw new Error("The saved skill could not be rediscovered by ccski.");

  const document = await load(workspaces, skills, input.workspaceId, skillId);
  const validation = await skills.validate(input.workspaceId, skillId);
  return { created, document, validation };
}

/** Delete a workspace-scoped skill only when its observed revision still matches. */
async function remove(
  workspaces: WorkspaceRegistry,
  skills: SkillService,
  workspaceId: SkillDocument["workspaceId"],
  skillId: SkillId,
  expectedRevision: string,
): Promise<void> {
  const workspaceRoot = writableDirectory(workspaces, workspaceId);
  const skill = await skills.resolve(workspaceId, skillId);
  assertPathInside(workspaceRoot, skill.path);
  const current = fs.readFileSync(skills.skillFile(skill), "utf8");
  if (contentRevision(current) !== expectedRevision) {
    throw new DomainError("CONFLICT", "This skill changed on disk. Reload it before deleting.");
  }
  fs.rmSync(skill.path, { recursive: true, force: false });
}

function writableDirectory(
  workspaces: WorkspaceRegistry,
  workspaceId: SkillDocument["workspaceId"],
): string {
  const scope = workspaces.resolve(workspaceId);
  if (scope.kind !== "directory") {
    throw new DomainError("INVALID_OPERATION", "Creator requires an imported Workspace.");
  }
  return scope.directory;
}
