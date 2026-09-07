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
import { createDshSettingsService, type DshSettingsService } from "./steward/dsh-settings.js";
import {
  createAgentSessionsService,
  type AgentSessionsService,
} from "./kernel/agent-sessions.js";
import type { DshKernelHandle } from "./kernel/dsh-kernel.js";
import {
  createCapabilityRegistry,
  type CapabilityRegistry,
} from "./capability/core.js";
import { createDomainCapabilities } from "./capability/domain-capabilities.js";
import { createCodexAppServerAdapter } from "./steward/codex-adapter.js";
import { createFixtureHarnessAdapter } from "./steward/fixture-adapter.js";
import type { HarnessAdapter } from "./steward/harness-adapter.js";
import { createWorkspaceRegistry, type WorkspaceRegistry } from "./workspace-registry/index.js";

/**
 * 生产 daemon 的 steward backend 集合：DSH 与 Codex 总是注册（缺失时 typed
 * unavailable）；fixture 仅在显式 env 开关下注册（测试/演示确定性 backend）。
 */
function defaultStewardAdapters(): HarnessAdapter[] {
  // 旧 dsh-acp backend 已按 GOAL 移除（DSH 走 package composition 路线，见
  // dsh-runtime-integration）；旧 steward 面只保留 codex app-server 与显式 fixture。
  const adapters: HarnessAdapter[] = [createCodexAppServerAdapter()];
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
  /** Steward DSH settings/credentials/session-stream（task 3.3；agent.* 消费同一服务）。 */
  dshSettings: DshSettingsService;
  /** 内核 agent 会话服务（task 2.2；kernel 句柄由 daemon index boot 后注入）。 */
  agentSessions: AgentSessionsService;
  /** 内核句柄注入（index 在 boot 成功后调用；降级时保持缺席 → typed UNAVAILABLE）。 */
  setKernelHost: (handle: DshKernelHandle) => void;
  /** Manager 能力面（MCP server 与提示词投影消费；task 4.1）。 */
  managerCapabilities: CapabilityRegistry;
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
  const kernelHostRef: { handle: DshKernelHandle | null } = { handle: null };
  const dshSettings = createDshSettingsService();
  const agentSessions = createAgentSessionsService({
    kernel: () => kernelHostRef.handle,
    modelSelection: async () => (await dshSettings.getView()).settings.model,
  });
  const skillsCliProbe = options.skillsCliProbe ?? createSkillsCliProbe();
  const skills = createSkillService(workspaces, { skillsCliProbe });
  const repository = createRepositoryService(workspaces, skills);
  const creator = createCreatorService(workspaces, skills);
  const skillIntelligence = createSkillIntelligenceService(skills, creator);
  const domain: DaemonDomain = {
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
    dshSettings,
    agentSessions,
    setKernelHost: (handle: DshKernelHandle): void => {
      kernelHostRef.handle = handle;
      agentSessions.attach(handle);
    },
  } as DaemonDomain;
  // manager 能力面：结构化子集依赖（不含自身），构造后冻结为普通属性。
  const managerCapabilities = createCapabilityRegistry(createDomainCapabilities(domain));
  Object.defineProperty(domain, "managerCapabilities", {
    value: managerCapabilities,
    enumerable: true,
    writable: false,
  });
  return domain;
}
