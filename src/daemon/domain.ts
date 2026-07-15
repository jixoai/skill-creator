/**
 * Daemon domain composition root.
 *
 * User input [2026-07-15]: "按照你自己的节奏去推进开发迭代。"
 * Architecture decision [2026-07-15]: every Workspace-scoped capability shares
 * one authoritative Registry instance for the daemon lifetime.
 *
 * Orthogonal intents:
 *   [1] Construct and expose the four domain modules.
 *   [2] Keep dependency wiring out of transports and module implementations.
 */
import { createCreatorService, type CreatorService } from "./creator-service.js";
import { createRepositoryService, type RepositoryService } from "./repository-service.js";
import { createSkillService, type SkillService } from "./skill-service.js";
import { createWorkspaceRegistry, type WorkspaceRegistry } from "./workspace-registry/index.js";

/** One daemon lifetime's coherent Workspace, Skill, Creator, and Repository modules. */
export interface DaemonDomain {
  workspaces: WorkspaceRegistry;
  skills: SkillService;
  creator: CreatorService;
  repository: RepositoryService;
}

/** Build one coherent daemon domain; an injected Registry is reserved for tests. */
export function createDaemonDomain(
  workspaces: WorkspaceRegistry = createWorkspaceRegistry(),
): DaemonDomain {
  const skills = createSkillService(workspaces);
  return {
    workspaces,
    skills,
    creator: createCreatorService(workspaces, skills),
    repository: createRepositoryService(workspaces, skills),
  };
}
