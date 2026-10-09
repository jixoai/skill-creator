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
 *   [3] Own daemon-lifetime service instances: skills-CLI probe/update, skill search.
 *   [4] Own the ACP bridge subprocess pool for the daemon lifetime.
 */
import { createAcpBridgeService, type AcpBridgeService } from "./acp-bridge-service.js";
import { createAgentFilesService, type AgentFilesService } from "./agent-files.js";
import { createCreatorService, type CreatorService } from "./creator-service.js";
import { createCreatorStoreService, type CreatorStoreService } from "./creator-store-service.js";
import { createRepositoryService, type RepositoryService } from "./repository-service.js";
import { createSourceRegistry, type SourceRegistry } from "./source-registry.js";
import { createSkillsCliProbe, type SkillsCliProbe } from "./skills-cli-probe.js";
import { join } from "node:path";
import { appDir } from "../shared/paths.js";
import { log as daemonLog } from "./log.js";

import { createSkillsUpdateService, type SkillsUpdateService } from "./skills-update-service.js";
import { createEvaluationService, type EvaluationService } from "./evaluation/service.js";
import { createProviderSessionAdapter } from "./evaluation/provider-adapter.js";
import { createWikiService, type WikiService } from "./wiki-service.js";
import {
  createWikiDistillService,
  type DistillJobDeps,
  type DistillJobService,
} from "./wiki-distill-service.js";
import { createSkillSearchService, type SkillSearchService } from "./skill-search/service.js";
import { platformOpenFile, type SearchConfigOpener } from "./search-config-opener.js";
import { createDialogService, type DialogService } from "./dialog-service.js";
import { createOpenerService, type OpenerService } from "./opener-service.js";
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
import { createAgentSessionsService, type AgentSessionsService } from "./kernel/agent-sessions.js";
import { createTerminalService, type TerminalService } from "./kernel/terminal/service.js";
import { createModelCatalogService, type ModelCatalogService } from "./model-catalog.js";
import { createSessionTranscripts } from "./kernel/session-transcripts.js";
import type { DshKernelHandle } from "./kernel/dsh-kernel.js";
import { createCapabilityRegistry, type CapabilityRegistry } from "./capability/core.js";
import { createDomainCapabilities } from "./capability/domain-capabilities.js";
import { UiCardRegistry } from "./mcp/cards.js";
import { createMcpProposalStore, type McpProposalStore } from "./mcp/proposals.js";
import { createCodexAppServerAdapter } from "./steward/codex-adapter.js";
import { createFixtureHarnessAdapter } from "./steward/fixture-adapter.js";
import type { HarnessAdapter } from "./steward/harness-adapter.js";
import { createWorkspaceRegistry, type WorkspaceRegistry } from "./workspace-registry/index.js";
import { DomainError } from "./domain-error.js";
import { GLOBAL_WORKSPACE_ID } from "../shared/contracts/workspaces.js";

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
  /** creator origin store（唯一根源 + ccski 应用/同步/卸载内核链）。 */
  creatorStore: CreatorStoreService;
  repository: RepositoryService;
  /** 用户自定义 Git 源注册表；持久化在 daemon 侧 `sources.json`。 */
  sourceRegistry: SourceRegistry;
  /** skills-CLI 兼容探测；daemon 生命周期内缓存 probe 结果。 */
  skillsCliProbe: SkillsCliProbe;
  /** skills-CLI 更新检查与应用服务；复用 repository install 流水线。 */
  skillsUpdate: SkillsUpdateService;
  /** daemon 长驻本地技能检索单例（server-owned roots；索引惰性加载 + 文件集 stat 增量 + watcher）。 */
  skillSearch: SkillSearchService;
  /** 以系统默认编辑器打开 server-owned search-config.toml（测试可注入 stub）。 */
  searchConfigOpener: SearchConfigOpener;
  /** 原生目录选择器（tray 挂载后 attach；ext-dialog 集成）。 */
  dialog: DialogService;
  /** 系统默认应用打开 https URL（tray 挂载后 attach；ext-opener 集成）。 */
  opener: OpenerService;
  /** 双级 wiki 知识库（skill-wiki 领域库委派；direct mutation 面）。 */
  wiki: WikiService;
  /** 蒸馏 Job 编排（skill-wiki-maintainer 1.3：run registry + kernel job + 审批桥）。 */
  wikiDistill: DistillJobService;
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
  /**
   * 人类终端域（skills-agent-page 1.6）：daemon-owned node-pty 池 + 专用
   * /ws/terminal typed JSON 协议；不入 agent 工具面（与内核收窄面正交）。
   */
  terminal: TerminalService;
  /** 后端文件选择器服务（R17-B）：真实路径浏览/预览 + prompt 附件 path 通道读盘。 */
  agentFiles: AgentFilesService;
  /** agent-models-config 标准生成物（agent-models.generated.ts）的 provider 画廊投影。 */
  modelCatalog: ModelCatalogService;
  /** 内核句柄注入（index 在 boot 成功后调用；降级时保持缺席 → typed UNAVAILABLE）。 */
  setKernelHost: (handle: DshKernelHandle) => void;
  /** Manager 能力面（MCP server 与提示词投影消费；task 4.1）。 */
  managerCapabilities: CapabilityRegistry;
  /** ui:// 卡片资源注册表（task 4.2；agent.card.get 代理读取）。 */
  uiCards: UiCardRegistry;
  /** MCP mutation proposal 链（task 4.4；审批执行经 managerCapabilities）。 */
  mcpProposals: McpProposalStore;
  /** 评估语料与跑分（evaluation-corpus；provider runner 经内核会话适配器）。 */
  evaluation: EvaluationService;
}

/** Build one coherent daemon domain; an injected Registry is reserved for tests. */
export function createDaemonDomain(
  workspaces: WorkspaceRegistry = createWorkspaceRegistry(),
  options: {
    stewardAdapters?: HarnessAdapter[];
    /** 测试注入确定性探测：避免真实 `npx skills list` 子进程把用例时序绑到网络与负载。 */
    skillsCliProbe?: SkillsCliProbe;
    /** 测试注入 search-config 打开 stub：避免真实 OS 副作用。 */
    searchConfigOpener?: SearchConfigOpener;
    dialog?: DialogService;
    /** 测试注入 ext-opener stub（真实 attach 需要 tray）。 */
    opener?: OpenerService;
    /**
     * 测试注入蒸馏 ephemeral 会话工厂（task 1.5 端到端）：经 DistillJobDeps 的
     * 既有 seam（1.3）替换真实 kernel 驱动；缺省走 kernel handle（生产路径）。
     */
    distillSession?: DistillJobDeps["createSession"];
    /**
     * CLI 短命进程（cli-surface-parity D1）传 false：跳过构造期的 `npx skills
     * list` 后台预热——进程退出不会留下 npx 孤儿；需要 provenance/update 的
     * 路径仍按需惰性 probe。daemon 默认预热（perf-firstscreen B-5）。
     */
    probeWarmup?: boolean;
  } = {},
): DaemonDomain {
  const kernelHostRef: { handle: DshKernelHandle | null } = { handle: null };
  const dshSettings = createDshSettingsService();
  // 面板会话转录存储：appDir()/sessions/YYYY/MM/DD/<sessionId>（产品自有持久层）。
  const agentTranscripts = createSessionTranscripts(join(appDir(), "sessions"));
  const modelCatalog = createModelCatalogService();
  // C1：file 引用展开守卫链归 agent-files（单一事实源）；agentSessions 经注入消费。
  const agentFiles = createAgentFilesService();
  // skills 先于 agentSessions 装配（skill-refs C1 的 `$` 引用展开需要注入）。
  const skillsCliProbe = options.skillsCliProbe ?? createSkillsCliProbe();
  // npx probe 后台预热（perf-firstscreen B-5）：shell out 一次 `npx skills
  // list --json`（冷启动 0-15s），不让首个 skills.list 阻塞在它后面；探测
  // 就绪前的列表 provenance 投影为缺省，就绪后自动补全。CLI 短命进程跳过
  // （probeWarmup:false）——退出即收，不留 npx 孤儿。
  if (options.probeWarmup !== false) void skillsCliProbe.probe().catch(() => undefined);
  const skills = createSkillService(workspaces, { skillsCliProbe });
  const agentSessions = createAgentSessionsService({
    kernel: () => kernelHostRef.handle,
    modelSelection: async () => (await dshSettings.getView()).settings.model,
    defaultMode: async () => (await dshSettings.getView()).settings.defaultMode,
    // skills-agent-page 1.1：target 创建校验（ws 解析 registry + provider 属该 ws
    // 投影；失败 typed 拒绝不建会话不写 meta——绝不从 cwd 推断归属）。
    validateTarget: async (target) => {
      if (
        target.workspaceId !== GLOBAL_WORKSPACE_ID &&
        workspaces.lookup(target.workspaceId) === null
      ) {
        throw new DomainError("NOT_FOUND", `workspace not found: ${target.workspaceId}`);
      }
      if (target.providerId === undefined) return;
      const projection = await workspaces.list();
      const workspace = projection.find((item) => item.id === target.workspaceId);
      if (workspace === undefined) {
        throw new DomainError("NOT_FOUND", `workspace not found: ${target.workspaceId}`);
      }
      if (!workspace.providers.some((provider) => provider.id === target.providerId)) {
        throw new DomainError(
          "INVALID_OPERATION",
          `provider ${target.providerId} is not part of workspace ${target.workspaceId}`,
        );
      }
    },
    // codex R7 B1：活动路由模型富字段驱动自动压缩阈值（缺字段 = 关闭不猜）。
    modelLimits: async (provider, model) => {
      const { settings } = await dshSettings.getView();
      const route = settings.modelRoutes.find((item) => item.provider === provider);
      const entry = route?.models.find((item) => item.id === model);
      if (entry === undefined) return null;
      return { contextWindow: entry.contextWindow, maxOutputTokens: entry.maxOutputTokens };
    },
    transcripts: agentTranscripts,
    expandFileReferences: (references) => agentFiles.resolvePromptReferences({ references }),
    // skill-refs C1：`$` 引用展开——registry 作用域解析 + 文档读取在 skills 服务
    //（NOT_FOUND 随 resolveSkill typed 抛出）；内容截断对齐 file 引用（200k chars）。
    expandSkillReferences: async (references) => {
      const blocks: string[] = [];
      for (const reference of references) {
        const info = await skills.info(
          { workspaceId: reference.workspaceId, providerId: reference.providerId },
          reference.skillId,
        );
        blocks.push(
          `[reference: skill ${info.name} · ${info.provider}]\n${info.content.slice(0, 200_000)}`,
        );
      }
      return blocks;
    },
  });
  const repository = createRepositoryService(workspaces, skills);
  // creator-skill-store 批 1：store 先于 creator 装配（creator 的 new 模式唯一
  // 归宿是 store；apply 后按 target 失效 discovery 在途合并）。
  const creatorStore = createCreatorStoreService(workspaces, { skills });
  const creator = createCreatorService(workspaces, skills, { store: creatorStore });
  const skillIntelligence = createSkillIntelligenceService(skills, creator);
  const searchConfigOpener = options.searchConfigOpener ?? platformOpenFile;
  const dialog = options.dialog ?? createDialogService();
  const opener = options.opener ?? createOpenerService();
  // wiki 随 workspace 目录同居（目录映射标准 2026-09-22）；global 由库解析。
  const wiki = createWikiService(workspaces);
  // 蒸馏 Job 服务先于 capability registry 构造（handler 闭包消费 domain.wikiDistill）；
  // proposal store 晚绑定注入（store 依赖 registry → registry 依赖 domain 的环由
  // 访问子切断）；store 的 onRejected 反向接线到本服务（N reject seam）。
  const proposalsRef: { store: McpProposalStore | null } = { store: null };
  const wikiDistill = createWikiDistillService({
    workspaces,
    kernel: () => kernelHostRef.handle,
    proposals: () => proposalsRef.store,
    // e2e 修复（2026-10-02）：生产装配必须与面板会话同源注入 settings
    // modelSelection——缺省 createSession 不传 agentOptions，ephemeral 蒸馏
    // agent 无 provider/model，内核 turn 直接 error（run failed(kernel-unavailable)）。
    modelSelection: async () => (await dshSettings.getView()).settings.model,
    // 可观测性：蒸馏失败原因进 daemon.log（缺省 console.warn 在 detached 进程丢失）。
    log: (message) => daemonLog(`[wiki-distill] ${message}`),
    ...(options.distillSession ? { createSession: options.distillSession } : {}),
  });
  const domain: DaemonDomain = {
    workspaces,
    skills,
    creator,
    creatorStore,
    repository,
    sourceRegistry: createSourceRegistry(),
    skillsCliProbe,
    skillsUpdate: createSkillsUpdateService(workspaces, skills, skillsCliProbe, repository),
    skillSearch: createSkillSearchService(),
    searchConfigOpener,
    dialog,
    opener,
    wiki,
    wikiDistill,
    acpBridge: createAcpBridgeService(workspaces),
    skillIntelligence,
    steward: createStewardService(workspaces, skills, skillIntelligence, {
      adapters: options.stewardAdapters ?? defaultStewardAdapters(),
    }),
    skillSteward: createSkillStewardPipelineService({ workspaces, skills, creator }),
    dshSettings,
    agentSessions,
    // 人类终端（skills-agent-page 1.6）：daemon-owned PTY 池；与 agent 工具面
    // 正交（内核收窄面无终端工具），cwd 只是启动目录（非 sandbox，如实声明）。
    terminal: createTerminalService(),
    agentFiles,
    modelCatalog,
    setKernelHost: (handle: DshKernelHandle): void => {
      kernelHostRef.handle = handle;
      agentSessions.attach(handle);
    },
    uiCards: new UiCardRegistry(),
    evaluation: createEvaluationService({
      skills,
      // B7 adapter：内核句柄注入后可用；降级期 provider-model run → typed
      // unavailable（依赖族），不做静默回退。
      providerAdapter: () =>
        kernelHostRef.handle ? createProviderSessionAdapter({ sessions: agentSessions }) : null,
    }),
  } as DaemonDomain;
  // manager 能力面先就绪（结构化子集依赖，不含自身），proposal 链随后注入其
  // 审批执行依赖——顺序即依赖方向。
  const managerCapabilities = createCapabilityRegistry(createDomainCapabilities(domain));
  Object.defineProperty(domain, "managerCapabilities", {
    value: managerCapabilities,
    enumerable: true,
    writable: false,
  });
  const mcpProposals = createMcpProposalStore(managerCapabilities, {
    onRejected: (view, cause) => wikiDistill.onProposalRejected(view, cause),
    // skills-agent-page 1.1：mcp *_propose 链的会话归属桥（fail-closed——同工具
    // 名多会话并发时对全部候选校验）。
    attributeProposeCalls: (toolName) => agentSessions.proposeCallSessions(toolName),
  });
  proposalsRef.store = mcpProposals;
  Object.defineProperty(domain, "mcpProposals", {
    value: mcpProposals,
    enumerable: true,
    writable: false,
  });
  return domain;
}
