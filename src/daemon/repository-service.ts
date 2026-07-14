/**
 * Immutable repository scan, preview, and install sessions.
 *
 * User intent [2026-07-14]: people can review remote skills and install the
 * exact reviewed revision into a chosen workspace.
 * Original error request [2026-07-14]: repository errors must be typed and
 * actionable without exposing Git output that may contain credentials.
 *
 * Orthogonal intents:
 *   [1] Clone and pin a repository session to one commit.
 *   [2] Discover and validate installable SKILL.md entries.
 *   [3] Preview/install only opaque IDs from that pinned session.
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installSkills } from "ccski";
import { execa } from "execa";
import matter from "gray-matter";
import { ZodError } from "zod";
import { SkillDirectoryNameSchema, SkillFrontmatterSchema } from "../shared/contracts/creator.js";
import {
  RemoteSkillIdSchema,
  RepositorySessionIdSchema,
  type InstallPreview,
  type InstallResult,
  type InstallSummary,
  type RemoteRepoScan,
  type RemoteSkill,
  type RemoteSkillPreview,
  type RepositoryInstallInput,
} from "../shared/contracts/repository.js";
import { DomainError } from "./domain-error.js";
import { writableDirectory } from "./workspace-service.js";

const CLONE_TIMEOUT_MS = 60_000;
const MAX_SESSIONS = 6;

interface RepositorySession {
  scan: RemoteRepoScan;
  directory: string;
  skillsById: Map<string, RemoteSkill>;
}

const sessions = new Map<string, RepositorySession>();

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function repoTitle(source: string): string {
  const match = source.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  return match?.[1] ?? source;
}

async function cloneRepository(
  source: string,
  ref?: string,
): Promise<{ directory: string; commit: string }> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-repo-"));
  const args = ["clone", "--depth", "1"];
  if (ref) args.push("--branch", ref);
  args.push("--", source, directory);
  try {
    await execa("git", args, { timeout: CLONE_TIMEOUT_MS });
    const result = await execa("git", ["rev-parse", "HEAD"], { cwd: directory });
    return { directory, commit: result.stdout.trim() };
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw new DomainError(
      "UNAVAILABLE",
      "Repository could not be cloned. Verify the source and reference, then try again.",
      { cause: error },
    );
  }
}

function findSkillFiles(root: string): string[] {
  const results: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(candidate);
      else if (entry.isFile() && entry.name === "SKILL.md") results.push(candidate);
    }
  };
  visit(root);
  return results.sort();
}

function inspectSkill(repositoryRoot: string, file: string): RemoteSkill {
  const relativePath = path.relative(repositoryRoot, path.dirname(file)) || ".";
  const issues: string[] = [];
  let name = path.basename(path.dirname(file));
  let description = "";
  try {
    const parsed = matter(fs.readFileSync(file, "utf8"));
    const frontmatter = SkillFrontmatterSchema.parse(parsed.data);
    name = frontmatter.name;
    description = frontmatter.description;
    const safeName = SkillDirectoryNameSchema.safeParse(name);
    if (!safeName.success) issues.push("The frontmatter name is not a safe skill directory name.");
  } catch (error) {
    issues.push(formatSkillIssue(error));
  }
  return {
    id: RemoteSkillIdSchema.parse(`rsk_${digest(relativePath)}`),
    name,
    description,
    relativePath,
    installable: issues.length === 0,
    issues,
  };
}

function formatSkillIssue(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues
      .map((issue) => `${issue.path.join(".") || "frontmatter"}: ${issue.message}`)
      .join(" ");
  }
  return error instanceof Error ? error.message : String(error);
}

function rejectDuplicateNames(skills: RemoteSkill[]): void {
  const counts = new Map<string, number>();
  for (const skill of skills) counts.set(skill.name, (counts.get(skill.name) ?? 0) + 1);
  for (const skill of skills) {
    if ((counts.get(skill.name) ?? 0) > 1) {
      skill.installable = false;
      skill.issues.push(`Duplicate skill name in repository: ${skill.name}`);
    }
  }
}

function retainSession(session: RepositorySession): void {
  sessions.set(session.scan.sessionId, session);
  while (sessions.size > MAX_SESSIONS) {
    const oldestId = sessions.keys().next().value as string | undefined;
    if (!oldestId) return;
    const oldest = sessions.get(oldestId);
    sessions.delete(oldestId);
    if (oldest) fs.rmSync(oldest.directory, { recursive: true, force: true });
  }
}

function getSession(sessionId: string): RepositorySession {
  const parsedId = RepositorySessionIdSchema.parse(sessionId);
  const session = sessions.get(parsedId);
  if (!session || !fs.existsSync(session.directory)) {
    throw new DomainError("UNAVAILABLE", "Repository session expired. Scan the repository again.");
  }
  return session;
}

/** Clone and pin a repository source to an immutable preview session. */
export async function scan(source: string, ref?: string): Promise<RemoteRepoScan> {
  const clone = await cloneRepository(source, ref);
  const skills = findSkillFiles(clone.directory).map((file) => inspectSkill(clone.directory, file));
  rejectDuplicateNames(skills);
  const sessionId = RepositorySessionIdSchema.parse(
    `repo_${digest(`${source}\0${clone.commit}\0${randomBytes(8).toString("hex")}`)}`,
  );
  const result: RemoteRepoScan = {
    sessionId,
    source,
    title: repoTitle(source),
    commit: clone.commit,
    skills,
  };
  retainSession({
    scan: result,
    directory: clone.directory,
    skillsById: new Map(skills.map((skill) => [skill.id, skill])),
  });
  return result;
}

/** Read one opaque remote skill from its pinned repository session. */
export async function preview(sessionId: string, skillId: string): Promise<RemoteSkillPreview> {
  const session = getSession(sessionId);
  const skill = session.skillsById.get(RemoteSkillIdSchema.parse(skillId));
  if (!skill) {
    throw new DomainError("NOT_FOUND", `Remote skill not found in scan session: ${skillId}`);
  }
  const file = path.resolve(session.directory, skill.relativePath, "SKILL.md");
  const relative = path.relative(session.directory, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Remote skill path escaped the repository snapshot.");
  }
  return {
    sessionId: session.scan.sessionId,
    skill,
    content: fs.readFileSync(file, "utf8"),
  };
}

function emptySummary(): InstallSummary {
  return {
    kind: "result",
    results: [],
    installed: 0,
    skipped: 0,
    overwritten: 0,
    failed: 0,
  };
}

function appendSummary(target: InstallSummary, source: Omit<InstallSummary, "kind">): void {
  target.results.push(...source.results);
  target.installed += source.installed;
  target.skipped += source.skipped;
  target.overwritten += source.overwritten;
  target.failed += source.failed;
}

function appendPreview(
  target: InstallPreview,
  source: Pick<InstallPreview, "skills" | "destinations" | "totalInstalls">,
): void {
  target.skills.push(...source.skills);
  const destinationPaths = new Set(target.destinations.map((destination) => destination.path));
  for (const destination of source.destinations) {
    if (destinationPaths.has(destination.path)) continue;
    destinationPaths.add(destination.path);
    target.destinations.push(destination);
  }
  target.totalInstalls += source.totalInstalls;
}

/** Preview or install selected skills from one pinned session into a workspace. */
export async function install(input: RepositoryInstallInput): Promise<InstallResult> {
  const session = getSession(input.sessionId);
  const selected = input.skillIds.map((skillId) => {
    const skill = session.skillsById.get(skillId);
    if (!skill) {
      throw new DomainError("NOT_FOUND", `Remote skill not found in scan session: ${skillId}`);
    }
    if (!skill.installable) {
      throw new DomainError(
        "INVALID_OPERATION",
        `Skill ${skill.name} is not installable: ${skill.issues.join(" ")}`,
      );
    }
    return skill;
  });
  const destination = writableDirectory(input.workspaceId);

  if (input.dryRun) {
    const preview: InstallPreview = {
      kind: "preview",
      skills: [],
      destinations: [],
      totalInstalls: 0,
    };
    for (const skill of selected) {
      const result = await installSkills({
        source: session.directory,
        path: skill.relativePath,
        outDir: [destination],
        all: true,
        force: input.force,
        yes: true,
        dryRun: true,
      });
      if (!("dryRun" in result) || !result.dryRun) {
        throw new Error("ccski returned an unexpected install result for dry-run.");
      }
      appendPreview(preview, result);
    }
    return preview;
  }

  const summary = emptySummary();
  for (const skill of selected) {
    const result = await installSkills({
      source: session.directory,
      path: skill.relativePath,
      outDir: [destination],
      all: true,
      force: input.force,
      yes: true,
    });
    if ("dryRun" in result) throw new Error("ccski returned an unexpected dry-run result.");
    appendSummary(summary, result);
  }
  return summary;
}

/** Dispose all temporary repository snapshots; used during shutdown and tests. */
export function clearSessions(): void {
  for (const session of sessions.values()) {
    fs.rmSync(session.directory, { recursive: true, force: true });
  }
  sessions.clear();
}
