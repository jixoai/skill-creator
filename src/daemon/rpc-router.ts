/**
 * Daemon implementation of the shared oRPC contract.
 *
 * User input [2026-07-15]: "type-safe 就是 runtime-safe 的核心，从类型安全上杜绝线上运行程序的安全性"
 * Architecture decisions [2026-07-14]: resolve opaque IDs through server-owned
 * scopes, expose expected DomainErrors, and mask unknown infrastructure failures.
 *
 * Orthogonal intents:
 *   [1] Workspace-scoped skill reads and mutations.
 *   [2] Workspace registry and revision-safe Creator operations.
 *   [3] Immutable repository session operations.
 *   [4] skills-CLI update check and apply, reusing the repository install pipeline.
 *   [5] Convert DomainError only at the root RPC boundary.
 * Compromise: oRPC router-wide middleware must be attached at this central
 * contract-composition root, so extracting the last intent would duplicate
 * or weaken the single transport boundary.
 */
import { implement, ORPCError } from "@orpc/server";
import { searchConfigPath } from "./skill-search/config.js";
import { RpcErrorDefinitions } from "../shared/contracts/errors.js";
import { rpcContract } from "../shared/rpc-contract.js";
import type { DaemonStatus } from "../shared/contracts/daemon.js";
import type { DaemonDomain } from "./domain.js";
import { DomainError } from "./domain-error.js";

export interface RpcRouterDeps {
  status: () => DaemonStatus;
  domain: DaemonDomain;
}

/** Bind daemon domain modules to the shared contract behind one error boundary. */
export function createRpcRouter(deps: RpcRouterDeps) {
  const { status, domain } = deps;
  const rpc = implement(rpcContract);
  const domainErrorBoundary = rpc.middleware(async ({ next }) => {
    try {
      return await next();
    } catch (error) {
      if (error instanceof DomainError) {
        throw new ORPCError(error.code, {
          status: RpcErrorDefinitions[error.code].status,
          message: error.message,
          cause: error,
        });
      }
      throw error;
    }
  });

  return rpc.use(domainErrorBoundary).router({
    skills: {
      list: rpc.skills.list.handler(async ({ input }) => ({
        skills: await domain.skills.list(input, input.includeDisabled ?? true),
      })),
      info: rpc.skills.info.handler(async ({ input }) => domain.skills.info(input, input.skillId)),
      toggle: rpc.skills.toggle.handler(async ({ input }) =>
        domain.skills.toggle(input, input.skillIds, input.mode),
      ),
      validate: rpc.skills.validate.handler(async ({ input }) =>
        domain.skills.validate(input, input.skillId),
      ),
      // skill-search-integration C1：daemon 长驻检索单例（索引 IO 故障经错误边界透传）。
      search: rpc.skills.search.handler(async ({ input }) => ({
        results: await domain.skillSearch.search(input.query, { limit: input.limit ?? 10 }),
      })),
      // search-robustness R3：在系统默认编辑器打开 server-owned search-config.toml。
      searchConfig: {
        open: rpc.skills.searchConfig.open.handler(async () => {
          await domain.searchConfigOpener(searchConfigPath());
          return { opened: true };
        }),
      },
      // search-duplicates P1：内容重复组投影（索引事实，排序冻结）。
      duplicates: rpc.skills.duplicates.handler(async () => ({
        groups: await domain.skillSearch.duplicates(),
      })),
      update: {
        check: rpc.skills.update.check.handler(async ({ input }) => {
          const discovered = await domain.skills.list(input, true);
          return domain.skillsUpdate.checkUpdates(input, discovered, input);
        }),
        apply: rpc.skills.update.apply.handler(async ({ input }) =>
          domain.skillsUpdate.applyUpdates(input, input.skillIds, input),
        ),
      },
    },
    workspace: {
      list: rpc.workspace.list.handler(async () => ({
        workspaces: await domain.workspaces.list(),
      })),
      add: rpc.workspace.add.handler(({ input }) => ({
        workspace: domain.workspaces.import(input.path, input.label),
      })),
      remove: rpc.workspace.remove.handler(({ input }) => ({
        activeId: domain.workspaces.forget(input.id),
      })),
      setActive: rpc.workspace.setActive.handler(({ input }) => ({
        activeId: domain.workspaces.activate(input.id),
      })),
      pickDirectory: rpc.workspace.pickDirectory.handler(async () => domain.dialog.pickDirectory()),
    },
    creator: {
      save: rpc.creator.save.handler(({ input }) => domain.creator.save(input)),
      load: rpc.creator.load.handler(({ input }) => domain.creator.load(input, input.skillId)),
      remove: rpc.creator.remove.handler(async ({ input }) => {
        await domain.creator.remove(input, input.skillId, input.expectedRevision);
        return { removed: true as const };
      }),
      revisions: rpc.creator.revisions.handler(({ input }) => domain.creator.revisions(input)),
    },
    repository: {
      scan: rpc.repository.scan.handler(({ input }) =>
        domain.repository.scan(input.source, input.ref),
      ),
      preview: rpc.repository.preview.handler(({ input }) =>
        domain.repository.preview(input.sessionId, input.skillId),
      ),
      install: rpc.repository.install.handler(({ input }) => domain.repository.install(input)),
      sources: {
        list: rpc.repository.sources.list.handler(() => domain.sourceRegistry.list()),
        add: rpc.repository.sources.add.handler(({ input }) => ({
          source: domain.sourceRegistry.add(input),
        })),
        remove: rpc.repository.sources.remove.handler(({ input }) =>
          domain.sourceRegistry.remove(input.id),
        ),
      },
    },
    daemon: {
      status: rpc.daemon.status.handler(() => status()),
    },
    skillIntelligence: {
      analyze: rpc.skillIntelligence.analyze.handler(async ({ input }) =>
        domain.skillIntelligence.analyze(input),
      ),
      propose: rpc.skillIntelligence.propose.handler(async ({ input }) =>
        domain.skillIntelligence.propose(input),
      ),
      list: rpc.skillIntelligence.list.handler(() => domain.skillIntelligence.list()),
      reject: rpc.skillIntelligence.reject.handler(async ({ input }) =>
        domain.skillIntelligence.reject(input.proposalId),
      ),
      approve: rpc.skillIntelligence.approve.handler(async ({ input }) =>
        domain.skillIntelligence.approve(input),
      ),
    },
    steward: {
      backends: rpc.steward.backends.handler(async () => domain.steward.backends()),
      list: rpc.steward.list.handler(() => domain.steward.list()),
      start: rpc.steward.start.handler(async ({ input }) => domain.steward.start(input)),
      events: rpc.steward.events.handler(({ input }) => domain.steward.events(input)),
      cancel: rpc.steward.cancel.handler(async ({ input }) => domain.steward.cancel(input)),
      decidePermission: rpc.steward.decidePermission.handler(async ({ input }) =>
        domain.steward.decidePermission(input),
      ),
      approveProposal: rpc.steward.approveProposal.handler(async ({ input }) =>
        domain.steward.approveProposal(input),
      ),
      rejectProposal: rpc.steward.rejectProposal.handler(async ({ input }) =>
        domain.steward.rejectProposal(input),
      ),
    },
    skillSteward: {
      startRun: rpc.skillSteward.startRun.handler(async ({ input }) =>
        domain.skillSteward.startRun(input),
      ),
      validate: rpc.skillSteward.validate.handler(async ({ input }) =>
        domain.skillSteward.validate(input.proposalId),
      ),
      approve: rpc.skillSteward.approve.handler(async ({ input }) =>
        domain.skillSteward.approve(input.proposalId),
      ),
      apply: rpc.skillSteward.apply.handler(async ({ input }) =>
        domain.skillSteward.apply(input.proposalId),
      ),
      prepareRollback: rpc.skillSteward.prepareRollback.handler(async ({ input }) =>
        domain.skillSteward.prepareRollback(input.auditId),
      ),
      applyRollback: rpc.skillSteward.applyRollback.handler(async ({ input }) =>
        domain.skillSteward.applyRollback(input.auditId),
      ),
    },
    agent: {
      card: {
        get: rpc.agent.card.get.handler(({ input }) => ({
          html: domain.uiCards.get(input.uri),
        })),
      },
      proposals: {
        list: rpc.agent.proposals.list.handler(() => ({
          proposals: domain.mcpProposals.list(),
        })),
        approve: rpc.agent.proposals.approve.handler(async ({ input }) => ({
          proposal: (await domain.mcpProposals.approve(input.proposalId)).view,
        })),
        reject: rpc.agent.proposals.reject.handler(({ input }) => {
          const rejected = domain.mcpProposals.reject(input.proposalId);
          if (!rejected)
            throw new DomainError("NOT_FOUND", `proposal not found: ${input.proposalId}`);
          return { proposal: rejected.view };
        }),
      },
      sessions: {
        list: rpc.agent.sessions.list.handler(async () => ({
          sessions: domain.agentSessions.list(),
        })),
        streams: rpc.agent.sessions.streams.handler(async ({ input }) => ({
          frames: await domain.dshSettings.listStreamFrames(input),
        })),
        // R14-C：清理产品转录层（不触碰内核会话日志；running 会话跳过）。
        cleanup: rpc.agent.sessions.cleanup.handler(async ({ input }) =>
          domain.agentSessions.cleanup(input),
        ),
      },
      session: {
        create: rpc.agent.session.create.handler(async ({ input }) => ({
          session: await domain.agentSessions.create(input),
        })),
        prompt: rpc.agent.session.prompt.handler(async ({ input }) => {
          // R17-B：path 通道附件在 daemon 读盘（大小/magic 守卫）→ base64 交给
          // 既有内核准入链；W4 mode 透传（queue/steer 提交模式）；C1 references
          // 透传（daemon 展开为 [reference: …] 文本块）。
          const resolved = await domain.agentFiles.resolvePromptAttachments(input);
          await domain.agentSessions.prompt(
            input.sessionId,
            input.text,
            resolved.images,
            resolved.files,
            input.mode ?? "queue",
            input.references ?? [],
          );
          return { accepted: true as const };
        }),
        cancel: rpc.agent.session.cancel.handler(({ input }) => {
          domain.agentSessions.cancel(input.sessionId);
          return { canceled: true as const };
        }),
        answer: rpc.agent.session.answer.handler(({ input }) => ({
          answered: domain.agentSessions.answer(input.sessionId, input.requestSeq, input.answers),
        })),
        stream: rpc.agent.session.stream.handler(({ input }) =>
          domain.agentSessions.stream(input.sessionId, input.afterSeq, input.limit),
        ),
        setMode: rpc.agent.session.setMode.handler(async ({ input }) => ({
          session: await domain.agentSessions.setMode(input.sessionId, input.mode),
        })),
      },
      queue: {
        // C2：内核 inbox 队列面（非 live = 空 items；update 竞态 typed NOT_FOUND）。
        list: rpc.agent.queue.list.handler(({ input }) =>
          domain.agentSessions.queueList(input.sessionId),
        ),
        update: rpc.agent.queue.update.handler(({ input }) => {
          domain.agentSessions.queueUpdate(input.sessionId, {
            messageId: input.messageId,
            action: input.action,
            ...(input.action === "edit" ? { text: input.text } : {}),
          });
          return { updated: true as const };
        }),
      },
      files: {
        // R17-B 后端文件选择器：用户本机自由浏览（读面，无 containment）。
        list: rpc.agent.files.list.handler(async ({ input }) => domain.agentFiles.list(input)),
        pickFiles: rpc.agent.files.pickFiles.handler(async ({ input }) =>
          domain.agentFiles.pickFiles(input),
        ),
        preview: rpc.agent.files.preview.handler(async ({ input }) =>
          domain.agentFiles.preview(input),
        ),
      },
      models: {
        catalog: rpc.agent.models.catalog.handler(() => ({
          providers: domain.modelCatalog.list(),
        })),
      },
      settings: {
        get: rpc.agent.settings.get.handler(async () => domain.dshSettings.getView()),
        update: rpc.agent.settings.update.handler(async ({ input }) =>
          domain.dshSettings.update(input),
        ),
        // 路由连接测试（R7）：用户显式外呼；结果 typed，永不 throw。
        testConnection: rpc.agent.settings.testConnection.handler(async ({ input }) =>
          domain.dshSettings.testConnection(input),
        ),
      },
      credentials: {
        set: rpc.agent.credentials.set.handler(async ({ input }) =>
          domain.dshSettings.setCredential(input),
        ),
        clear: rpc.agent.credentials.clear.handler(async ({ input }) =>
          domain.dshSettings.clearCredential(input),
        ),
      },
    },
    acp: {
      agents: {
        list: rpc.acp.agents.list.handler(async () => ({
          agents: await domain.acpBridge.agents(),
        })),
      },
      session: {
        open: rpc.acp.session.open.handler(async ({ input }) =>
          domain.acpBridge.openSession(input),
        ),
        close: rpc.acp.session.close.handler(async ({ input }) => {
          await domain.acpBridge.closeSession(input.sessionId);
          return { closed: true as const };
        }),
      },
    },
  });
}
