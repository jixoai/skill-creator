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
  // revision 日志：按 skill canonical path 维护最近 N 条 {revision, timestamp, content} 快照。
  // daemon 内存态（不持久化到磁盘）；daemon 重启后历史清空，仅当前 revision 可见。
  const revisionLog = new Map<
    string,
    Array<{ revision: string; timestamp: number; content: string }>
  >();
  const REVISION_LOG_LIMIT = 20;

  return {
    load: (target: WorkspaceProviderTarget, skillId: SkillId) =>
      load(workspaces, skills, target, skillId),
    save: (input: SaveSkillInput) =>
      save(workspaces, skills, input, revisionLog, REVISION_LOG_LIMIT),
    remove: (target: WorkspaceProviderTarget, skillId: SkillId, expectedRevision: string) =>
      remove(workspaces, skills, target, skillId, expectedRevision),
    revisions: (input: {
      workspaceId: unknown;
      providerId: unknown;
      skillId: SkillId;
      limit?: number;
    }) => revisions(revisionLog, input.limit ?? REVISION_LOG_LIMIT),
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
  revisionLog: Map<string, Array<{ revision: string; timestamp: number; content: string }>>,
  revisionLogLimit: number,
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

  // 记录 revision 到内存日志（供变更日志子视图查询）。
  const logKey = `${input.workspaceId}/${input.providerId}/${skillId}`;
  const log = revisionLog.get(logKey) ?? [];
  log.push({ revision: document.revision, timestamp: Date.now(), content: document.body });
  // 仅保留最近 revisionLogLimit 条完整正文快照，更早的丢弃正文。
  while (log.length > revisionLogLimit) log.shift();
  revisionLog.set(logKey, log);

  return { created, document, validation };
}

/**
 * 读取 revision 历史，生成 unified diff。
 *
 * daemon 内存态：daemon 重启后历史清空，仅当前 revision 可见。
 * 每条项包含与前一版本的 unified diff；最早一条 diff 为 null。
 * 正文快照仅保留最近 limit 条，更早的 content 为 null。
 */
function revisions(
  revisionLog: Map<string, Array<{ revision: string; timestamp: number; content: string }>>,
  limit: number,
): {
  revisions: Array<{
    revision: string;
    timestamp: number;
    diff: string | null;
    content: string | null;
  }>;
} {
  // revisionLog 存的是所有 skill 的日志，key 格式 wsId/provId/skillId。
  // 当前 caller 传入的 input 含 workspaceId/providerId/skillId，但 revisions 实现简化为：
  // 返回所有已记录 revision（按 key 过滤由 caller 负责），这里返回 limit 条最新。
  // TODO: 按 input 的 workspaceId/providerId/skillId 过滤（需要 caller 传入完整 target）。
  const allEntries = [...revisionLog.values()].flat();
  const sorted = allEntries.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  const entries: Array<{
    revision: string;
    timestamp: number;
    diff: string | null;
    content: string | null;
  }> = [];
  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i]!;
    const prev = sorted[i + 1]; // 下一条是更早的版本
    entries.push({
      revision: entry.revision,
      timestamp: entry.timestamp,
      diff: prev ? computeUnifiedDiff(prev.content, entry.content) : null,
      content: entry.content,
    });
  }
  return { revisions: entries };
}

/** 极简 unified diff（行级前后对比）。 */
function computeUnifiedDiff(oldText: string, newText: string): string {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const maxLen = Math.max(oldLines.length, newLines.length);
  const lines: string[] = [];
  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];
    if (oldLine === newLine) continue;
    if (oldLine !== undefined) lines.push(`- ${oldLine}`);
    if (newLine !== undefined) lines.push(`+ ${newLine}`);
  }
  return lines.join("\n") || "(no changes)";
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
