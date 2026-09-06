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
import {
  createSkillIntelligenceService,
  type SkillIntelligenceService,
} from "./skill-intelligence-service.js";
import { createSkillService, type SkillService } from "./skill-service.js";
import { createStewardService, type StewardService } from "./steward-service.js";
import {
  createSkillStewardPipelineService,
  type SkillStewardPipelineService,
} from "./steward/pipeline-service.js";
import { createCodexAppServerAdapter } from "./steward/codex-adapter.js";
import { createDshHarnessAdapter } from "./steward/dsh-adapter.js";
import { createFixtureHarnessAdapter } from "./steward/fixture-adapter.js";
import type { HarnessAdapter } from "./steward/harness-adapter.js";
import { createWorkspaceRegistry, type WorkspaceRegistry } from "./workspace-registry/index.js";

/**
 * 生产 daemon 的 steward backend 集合：DSH 与 Codex 总是注册（缺失时 typed
 * unavailable）；fixture 仅在显式 env 开关下注册（测试/演示确定性 backend）。
 */
function defaultStewardAdapters(): HarnessAdapter[] {
  const adapters: HarnessAdapter[] = [createDshHarnessAdapter(), createCodexAppServerAdapter()];
  if (process.env.SKILL_CREATOR_STEWARD_ENABLE_FIXTURE === "1") {
    adapters.unshift(createFixtureHarnessAdapter());
  }
  return adapters;
}

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
  /** 只读技能分析 + proposal 草稿审批服务。 */
  skillIntelligence: SkillIntelligenceService;
  /** Agent steward 编排：analyze→recommend→draft→validate→approval→apply。 */
  steward: StewardService;
  /** Skill Steward 契约管线：snapshot→tool registry→proposal→grant→journal→audit。 */
  skillSteward: SkillStewardPipelineService;
}

/** Build one coherent daemon domain; an injected Registry is reserved for tests. */
export function createDaemonDomain(
  workspaces: WorkspaceRegistry = createWorkspaceRegistry(),
  options: {
    stewardAdapters?: HarnessAdapter[];
    /** 测试注入确定性探测：避免真实 `npx skills list` 子进程把用例时序绑到网络与负载。 */
    skillsCliProbe?: SkillsCliProbe;
  } = {},
): DaemonDomain {
  const skillsCliProbe = options.skillsCliProbe ?? createSkillsCliProbe();
  const skills = createSkillService(workspaces, { skillsCliProbe });
  const repository = createRepositoryService(workspaces, skills);
  const creator = createCreatorService(workspaces, skills);
  const skillIntelligence = createSkillIntelligenceService(skills, creator);
  return {
    workspaces,
    skills,
    creator,
    repository,
    sourceRegistry: createSourceRegistry(),
    skillsCliProbe,
    skillsUpdate: createSkillsUpdateService(workspaces, skills, skillsCliProbe, repository),
    acpBridge: createAcpBridgeService(workspaces),
    skillIntelligence,
    steward: createStewardService(workspaces, skills, skillIntelligence, {
      adapters: options.stewardAdapters ?? defaultStewardAdapters(),
    }),
    skillSteward: createSkillStewardPipelineService({ workspaces, skills, creator }),
  };
}
