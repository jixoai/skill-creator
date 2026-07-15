/**
 * Immutable repository scan, preview, and install sessions.
 *
 * User input [2026-07-14]: "我们还需要一个 `/repository/`，来支持远程仓库预览 skills 并安装 它们"
 * Architecture decisions [2026-07-14]: preview/install share one pinned clone;
 * expected failures are actionable without exposing credential-bearing Git output.
 *
 * Orthogonal intents:
 *   [1] Clone, pin, and terminally dispose daemon-owned repository sessions.
 *   [2] Discover and validate installable SKILL.md entries.
 *   [3] Install only pinned opaque IDs and sign verified local Skill identities.
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installSkills } from "ccski";
import { execa } from "execa";
import matter from "gray-matter";
import { z, ZodError } from "zod";
import { SkillDirectoryNameSchema, SkillFrontmatterSchema } from "../shared/contracts/creator.js";
import {
  PinnedCommitSchema,
  RemoteSkillIdSchema,
  RepositorySessionIdSchema,
  type InstallResultEntry,
  type InstallPreview,
  type InstallResult,
  type InstallSummary,
  type RemoteRepoScan,
  type RemoteSkillId,
  type RemoteSkill,
  type RemoteSkillPreview,
  type RepositoryInstallInput,
  type RepositorySessionId,
} from "../shared/contracts/repository.js";
import { SkillIdSchema, type SkillId } from "../shared/contracts/skills.js";
import { DomainError } from "./domain-error.js";
import { assertPathInside, canonicalDirectory, opaquePathId } from "./path-safety.js";
import type { SkillService } from "./skill-service.js";
import type { WorkspaceRegistry } from "./workspace-registry/index.js";

const CLONE_TIMEOUT_MS = 60_000;
const MAX_SESSIONS = 6;

const InstallerResultEntrySchema = z.object({
  skill: z.string(),
  destination: z.string(),
  path: z.string(),
  status: z.enum(["installed", "skipped", "overwritten", "failed"]),
  error: z.string().optional(),
});
const InstallerSummarySchema = z.object({
  results: z.array(InstallerResultEntrySchema),
  installed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  overwritten: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});
const InstallerPreviewSchema = z.object({
  dryRun: z.literal(true),
  skills: z.array(z.object({ name: z.string(), description: z.string() })),
  destinations: z.array(z.object({ path: z.string(), exists: z.boolean() })),
  totalInstalls: z.number().int().nonnegative(),
});
type InstallerResultEntry = z.infer<typeof InstallerResultEntrySchema>;
type InstallerSummary = z.infer<typeof InstallerSummarySchema>;
type InstallerPreview = z.infer<typeof InstallerPreviewSchema>;

interface RepositorySession {
  scan: RemoteRepoScan;
  directory: string;
  skillsById: Map<RemoteSkillId, RemoteSkill>;
  activeLeases: number;
  retired: boolean;
}

type RepositorySessions = Map<RepositorySessionId, RepositorySession>;

/** Clone adapter; failed clones must remove any snapshot before rejecting. */
export type RepositoryCloner = (
  source: string,
  ref: string | undefined,
  cancelSignal: AbortSignal,
) => Promise<{ directory: string; commit: string }>;

/** ccski install adapter retained behind the Repository module boundary. */
export type RepositoryInstaller = typeof installSkills;

/** Repository service dependencies that may be replaced at the module boundary. */
export interface RepositoryServiceOptions {
  clone?: RepositoryCloner;
  installSkills?: RepositoryInstaller;
}

/** Daemon-owned Repository scan, preview, install, and teardown capability. */
export interface RepositoryService {
  scan(source: string, ref?: string): Promise<RemoteRepoScan>;
  preview(sessionId: RepositorySessionId, skillId: RemoteSkillId): Promise<RemoteSkillPreview>;
  install(input: RepositoryInstallInput): Promise<InstallResult>;
  dispose(): Promise<void>;
}

/** Bind pinned repository sessions to one daemon and Workspace Registry. */
export function createRepositoryService(
  workspaces: WorkspaceRegistry,
  skills: SkillService,
  options: RepositoryServiceOptions = {},
): RepositoryService {
  const sessions: RepositorySessions = new Map();
  const activeTasks = new Set<Promise<unknown>>();
  const scanControllers = new Set<AbortController>();
  const clone = options.clone ?? cloneRepository;
  const installer = options.installSkills ?? installSkills;
  let closing = false;
  let disposePromise: Promise<void> | null = null;

  const assertOpen = (): void => {
    if (closing) {
      throw new DomainError("UNAVAILABLE", "Repository service is shutting down.");
    }
  };

  const runTask = <T>(operation: () => Promise<T>): Promise<T> => {
    try {
      assertOpen();
      let tracked: Promise<T>;
      tracked = operation().finally(() => activeTasks.delete(tracked));
      activeTasks.add(tracked);
      return tracked;
    } catch (error) {
      return Promise.reject(error);
    }
  };

  return {
    scan: (source: string, ref?: string) =>
      runTask(async () => {
        const controller = new AbortController();
        scanControllers.add(controller);
        try {
          return await scan(sessions, clone, assertOpen, source, ref, controller.signal);
        } finally {
          scanControllers.delete(controller);
        }
      }),
    preview: (sessionId: RepositorySessionId, skillId: RemoteSkillId) =>
      runTask(() =>
        preview(
          sessions,
          RepositorySessionIdSchema.parse(sessionId),
          RemoteSkillIdSchema.parse(skillId),
        ),
      ),
    install: (input: RepositoryInstallInput) =>
      runTask(() => install(sessions, workspaces, skills, installer, input)),
    dispose: (): Promise<void> => {
      if (disposePromise) return disposePromise;
      closing = true;
      for (const controller of scanControllers) controller.abort();
      disposePromise = Promise.allSettled([...activeTasks]).then(() => clearSessions(sessions));
      return disposePromise;
    },
  };
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function repoTitle(source: string): string {
  const match = source.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  return match?.[1] ?? source;
}

async function cloneRepository(
  source: string,
  ref: string | undefined,
  cancelSignal: AbortSignal,
): Promise<{ directory: string; commit: string }> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-repo-"));
  const args = ["clone", "--depth", "1"];
  if (ref) args.push("--branch", ref);
  args.push("--", source, directory);
  try {
    await execa("git", args, {
      timeout: CLONE_TIMEOUT_MS,
      cancelSignal,
      forceKillAfterDelay: 1_000,
    });
    const result = await execa("git", ["rev-parse", "HEAD"], {
      cwd: directory,
      timeout: CLONE_TIMEOUT_MS,
      cancelSignal,
      forceKillAfterDelay: 1_000,
    });
    return { directory, commit: PinnedCommitSchema.parse(result.stdout.trim()) };
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    if (cancelSignal.aborted) {
      throw new DomainError("UNAVAILABLE", "Repository service is shutting down.", {
        cause: error,
      });
    }
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

function retainSession(sessions: RepositorySessions, session: RepositorySession): void {
  sessions.set(session.scan.sessionId, session);
  while (sessions.size > MAX_SESSIONS) {
    const oldestId = sessions.keys().next().value;
    if (!oldestId) return;
    const oldest = sessions.get(oldestId);
    sessions.delete(oldestId);
    if (oldest) retireSession(oldest);
  }
}

function getSession(
  sessions: RepositorySessions,
  sessionId: RepositorySessionId,
): RepositorySession {
  const session = sessions.get(sessionId);
  if (!session || !fs.existsSync(session.directory)) {
    throw new DomainError("UNAVAILABLE", "Repository session expired. Scan the repository again.");
  }
  return session;
}

function acquireSession(
  sessions: RepositorySessions,
  sessionId: RepositorySessionId,
): RepositorySession {
  const session = getSession(sessions, sessionId);
  session.activeLeases += 1;
  return session;
}

function releaseSession(session: RepositorySession): void {
  session.activeLeases -= 1;
  if (session.activeLeases === 0 && session.retired) removeSnapshot(session);
}

function retireSession(session: RepositorySession): void {
  if (session.retired) return;
  session.retired = true;
  if (session.activeLeases === 0) removeSnapshot(session);
}

function removeSnapshot(session: RepositorySession): void {
  fs.rmSync(session.directory, { recursive: true, force: true });
}

/** Clone and pin a repository source to an immutable preview session. */
async function scan(
  sessions: RepositorySessions,
  clone: RepositoryCloner,
  assertOpen: () => void,
  source: string,
  ref: string | undefined,
  cancelSignal: AbortSignal,
): Promise<RemoteRepoScan> {
  const snapshot = await clone(source, ref, cancelSignal);
  let retained = false;
  try {
    assertOpen();
    const commit = PinnedCommitSchema.parse(snapshot.commit);
    const skills = findSkillFiles(snapshot.directory).map((file) =>
      inspectSkill(snapshot.directory, file),
    );
    rejectDuplicateNames(skills);
    const sessionId = RepositorySessionIdSchema.parse(
      `repo_${digest(`${source}\0${commit}\0${randomBytes(8).toString("hex")}`)}`,
    );
    const result: RemoteRepoScan = {
      sessionId,
      source,
      title: repoTitle(source),
      commit,
      skills,
    };
    assertOpen();
    retainSession(sessions, {
      scan: result,
      directory: snapshot.directory,
      skillsById: new Map(skills.map((skill) => [skill.id, skill])),
      activeLeases: 0,
      retired: false,
    });
    retained = true;
    return result;
  } finally {
    if (!retained) fs.rmSync(snapshot.directory, { recursive: true, force: true });
  }
}

/** Read one opaque remote skill from its pinned repository session. */
async function preview(
  sessions: RepositorySessions,
  sessionId: RepositorySessionId,
  skillId: RemoteSkillId,
): Promise<RemoteSkillPreview> {
  const session = getSession(sessions, sessionId);
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

function emptySummary(workspaceId: InstallSummary["workspaceId"]): InstallSummary {
  return {
    kind: "result",
    workspaceId,
    results: [],
    installed: 0,
    skipped: 0,
    overwritten: 0,
    failed: 0,
  };
}

interface ExpectedInstallTarget {
  workspaceId: InstallSummary["workspaceId"];
  workspaceRoot: string;
  skill: RemoteSkill;
  expectedPath: string;
}

function createExpectedInstallTarget(
  workspaceId: InstallSummary["workspaceId"],
  workspaceRoot: string,
  skill: RemoteSkill,
): ExpectedInstallTarget {
  const expectedPath = path.resolve(workspaceRoot, skill.name);
  if (path.dirname(expectedPath) !== workspaceRoot) {
    throw new Error("Remote skill name must resolve to a direct Workspace child.");
  }
  return { workspaceId, workspaceRoot, skill, expectedPath };
}

function expectedInstallEntryBase(target: ExpectedInstallTarget) {
  return {
    skill: target.skill.name,
    destination: target.workspaceRoot,
    path: target.expectedPath,
  };
}

function failedInstallEntry(target: ExpectedInstallTarget, error: string): InstallResultEntry {
  return { ...expectedInstallEntryBase(target), status: "failed", error };
}

function appendInstallEntry(target: InstallSummary, entry: InstallResultEntry): void {
  target.results.push(entry);
  target[entry.status] += 1;
}

function assertExpectedInstallerEntry(
  target: ExpectedInstallTarget,
  entry: InstallerResultEntry,
): void {
  if (entry.skill !== target.skill.name) {
    throw new Error("Installer returned a result for a different remote skill.");
  }
  if (
    !path.isAbsolute(entry.destination) ||
    canonicalDirectory(entry.destination) !== target.workspaceRoot
  ) {
    throw new Error("Installer returned a result for a different Workspace.");
  }
  if (
    !path.isAbsolute(entry.path) ||
    path.basename(entry.path) !== target.skill.name ||
    canonicalDirectory(path.dirname(entry.path)) !== target.workspaceRoot
  ) {
    throw new Error("Installer returned an unexpected skill path.");
  }
}

async function installedSkillId(
  target: ExpectedInstallTarget,
  skills: SkillService,
): Promise<SkillId> {
  const canonicalPath = canonicalDirectory(target.expectedPath);
  if (canonicalPath !== target.expectedPath) {
    throw new Error("Installed skill path must not resolve through a symbolic link.");
  }
  assertPathInside(target.workspaceRoot, canonicalPath);
  if (path.dirname(canonicalPath) !== target.workspaceRoot) {
    throw new Error("Installed skill path must be a direct child of the Workspace.");
  }
  const skillFile = path.join(canonicalPath, "SKILL.md");
  let skillFileStats: fs.Stats;
  try {
    skillFileStats = fs.lstatSync(skillFile);
  } catch {
    throw new Error("Installed skill directory does not contain SKILL.md.");
  }
  if (!skillFileStats.isFile() || skillFileStats.isSymbolicLink()) {
    throw new Error("Installed skill directory does not contain a regular SKILL.md file.");
  }
  const canonicalSkillFile = fs.realpathSync(skillFile);
  assertPathInside(canonicalPath, canonicalSkillFile);
  if (!fs.lstatSync(canonicalSkillFile).isFile()) {
    throw new Error("Installed skill directory does not contain a regular SKILL.md file.");
  }
  let frontmatterName = "";
  try {
    frontmatterName = SkillFrontmatterSchema.parse(
      matter(fs.readFileSync(skillFile, "utf8")).data,
    ).name;
  } catch (error) {
    throw new Error(`Installed skill frontmatter is invalid: ${formatSkillIssue(error)}`);
  }
  if (frontmatterName !== target.skill.name) {
    throw new Error("Installed skill frontmatter name does not match the selected remote skill.");
  }
  const skillId = SkillIdSchema.parse(opaquePathId("sk", canonicalPath));
  const discovered = await skills.resolve(target.workspaceId, skillId);
  if (discovered.directoryName !== target.skill.name || discovered.path !== canonicalPath) {
    throw new Error("Installed skill identity does not match the selected remote skill.");
  }
  const validation = await skills.validate(target.workspaceId, skillId);
  if (!validation.success) {
    throw new Error("Installed skill frontmatter is invalid.");
  }
  return discovered.id;
}

async function projectInstallEntry(
  target: ExpectedInstallTarget,
  entry: InstallerResultEntry,
  skills: SkillService,
): Promise<InstallResultEntry> {
  assertExpectedInstallerEntry(target, entry);
  const base = expectedInstallEntryBase(target);
  if (entry.status === "installed" || entry.status === "overwritten") {
    return {
      ...base,
      status: entry.status,
      skillId: await installedSkillId(target, skills),
    };
  }
  return {
    ...base,
    status: entry.status,
    ...(entry.error === undefined ? {} : { error: entry.error }),
  };
}

async function appendSummary(
  target: InstallSummary,
  source: unknown,
  expected: ExpectedInstallTarget,
  skills: SkillService,
): Promise<void> {
  const parsed = InstallerSummarySchema.safeParse(source);
  if (!parsed.success) {
    appendInstallEntry(
      target,
      failedInstallEntry(expected, "Installer returned an invalid result."),
    );
    return;
  }
  const summary: InstallerSummary = parsed.data;
  if (summary.results.length !== 1) {
    appendInstallEntry(
      target,
      failedInstallEntry(
        expected,
        `Installer returned ${summary.results.length} results for one selected skill.`,
      ),
    );
    return;
  }
  const [entry] = summary.results;
  if (!entry) {
    appendInstallEntry(target, failedInstallEntry(expected, "Installer returned no result."));
    return;
  }
  try {
    appendInstallEntry(target, await projectInstallEntry(expected, entry, skills));
  } catch (error) {
    appendInstallEntry(target, failedInstallEntry(expected, formatInstallFailure(error)));
  }
}

function formatInstallFailure(error: unknown): string {
  return error instanceof Error ? error.message : "The installer returned an invalid result.";
}

function appendPreview(
  target: InstallPreview,
  source: Pick<InstallerPreview, "skills" | "destinations" | "totalInstalls">,
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
async function install(
  sessions: RepositorySessions,
  workspaces: WorkspaceRegistry,
  skills: SkillService,
  installer: RepositoryInstaller,
  input: RepositoryInstallInput,
): Promise<InstallResult> {
  const session = acquireSession(sessions, input.sessionId);
  try {
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
    const scope = workspaces.resolve(input.workspaceId);
    if (scope.kind !== "directory") {
      throw new DomainError(
        "INVALID_OPERATION",
        "Repository installs require an imported Workspace.",
      );
    }
    const destination = scope.directory;

    if (input.dryRun) {
      const installPreview: InstallPreview = {
        kind: "preview",
        skills: [],
        destinations: [],
        totalInstalls: 0,
      };
      for (const skill of selected) {
        const result = await installer({
          source: session.directory,
          path: skill.relativePath,
          outDir: [destination],
          all: true,
          force: input.force,
          yes: true,
          dryRun: true,
        });
        const parsedPreview = InstallerPreviewSchema.safeParse(result);
        if (!parsedPreview.success) {
          throw new Error("ccski returned an unexpected install result for dry-run.");
        }
        appendPreview(installPreview, parsedPreview.data);
      }
      return installPreview;
    }

    const summary = emptySummary(input.workspaceId);
    for (const skill of selected) {
      const expected = createExpectedInstallTarget(input.workspaceId, destination, skill);
      try {
        const result = await installer({
          source: session.directory,
          path: skill.relativePath,
          outDir: [destination],
          all: true,
          force: input.force,
          yes: true,
        });
        if ("dryRun" in result) {
          appendInstallEntry(
            summary,
            failedInstallEntry(expected, "Installer returned an unexpected dry-run result."),
          );
          continue;
        }
        await appendSummary(summary, result, expected, skills);
      } catch (error) {
        appendInstallEntry(summary, failedInstallEntry(expected, formatInstallFailure(error)));
      }
    }
    return summary;
  } finally {
    releaseSession(session);
  }
}

/** Dispose all temporary repository snapshots; used during shutdown and tests. */
function clearSessions(sessions: RepositorySessions): void {
  for (const session of sessions.values()) retireSession(session);
  sessions.clear();
}
