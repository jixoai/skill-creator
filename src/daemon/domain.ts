/**
 * Daemon domain composition root.
 *
 * User input [2026-07-15]: "按照你自己的节奏去推进开发迭代。"
 * Architecture decision [2026-07-15]: every Workspace-scoped capability shares
 * one authoritative Registry instance for the daemon lifetime.
 * Architecture decision [2026-07-27]: ACP bridge shares the same Registry to
 * resolve agent subprocess cwd from Workspace Provider roots.
 *
 * Orthogonal intents:
 *   [1] Construct and expose the domain modules.
 *   [2] Keep dependency wiring out of transports and module implementations.
 *   [3] Own the skills-CLI probe + update service instances for the daemon lifetime.
 *   [4] Own the ACP bridge subprocess pool for the daemon lifetime.
 */
import { createAcpBridgeService, type AcpBridgeService } from "./acp-bridge-service.js";
import { createCreatorService, type CreatorService } from "./creator-service.js";
import { createRepositoryService, type RepositoryService } from "./repository-service.js";
import { createSourceRegistry, type SourceRegistry } from "./source-registry.js";
import { createSkillsCliProbe, type SkillsCliProbe } from "./skills-cli-probe.js";
import { createSkillsUpdateService, type SkillsUpdateService } from "./skills-update-service.js";
import { createSkillService, type SkillService } from "./skill-service.js";
import { createWorkspaceRegistry, type WorkspaceRegistry } from "./workspace-registry/index.js";

/** One daemon lifetime's coherent Workspace, Skill, Creator, Repository, and ACP modules. */
export interface DaemonDomain {
  workspaces: WorkspaceRegistry;
  skills: SkillService;
  creator: CreatorService;
  repository: RepositoryService;
  /** 用户自定义 Git 源注册表；持久化在 daemon 侧 `sources.json`。 */
  sourceRegistry: SourceRegistry;
  /** skills-CLI 兼容探测；daemon 生命周期内缓存 probe 结果。 */
  skillsCliProbe: SkillsCliProbe;
  /** skills-CLI 更新检查与应用服务；复用 repository install 流水线。 */
  skillsUpdate: SkillsUpdateService;
  /** ACP 子进程池 + stdio↔WS 帧桥 + 安全门。 */
  acpBridge: AcpBridgeService;
}

/** Build one coherent daemon domain; an injected Registry is reserved for tests. */
export function createDaemonDomain(
  workspaces: WorkspaceRegistry = createWorkspaceRegistry(),
): DaemonDomain {
  const skillsCliProbe = createSkillsCliProbe();
  const skills = createSkillService(workspaces, { skillsCliProbe });
  const repository = createRepositoryService(workspaces, skills);
  return {
    workspaces,
    skills,
    creator: createCreatorService(workspaces, skills),
    repository,
    sourceRegistry: createSourceRegistry(),
    skillsCliProbe,
    skillsUpdate: createSkillsUpdateService(workspaces, skills, skillsCliProbe, repository),
    acpBridge: createAcpBridgeService(workspaces),
  };
}
