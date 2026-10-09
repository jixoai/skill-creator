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
import {
  parseUnifiedProposalRef,
  projectIntelligenceDraft,
  projectMcpProposal,
} from "./agent-proposals-projection.js";
import { searchConfigPath } from "./skill-search/config.js";
import { createWorkspaceSkillsAggregator } from "./skill-search/workspace-aggregate.js";
import { RpcErrorDefinitions } from "../shared/contracts/errors.js";
import { rpcContract } from "../shared/rpc-contract.js";
import type { DaemonStatus } from "../shared/contracts/daemon.js";
import { GLOBAL_WORKSPACE_ID } from "../shared/contracts/workspaces.js";
import type { DaemonDomain } from "./domain.js";
import { DomainError } from "./domain-error.js";
import { ensureAgentsMdPromptBlock } from "./agents-md-block.js";
import {
  keepSelfSkillUserVersion,
  resolveSelfSkillConflict,
  selfSkillStatus,
} from "./self-skill.js";

export interface RpcRouterDeps {
  status: () => DaemonStatus;
  domain: DaemonDomain;
}

/** Bind daemon domain modules to the shared contract behind one error boundary. */
export function createRpcRouter(deps: RpcRouterDeps) {
  const { status, domain } = deps;
  const rpc = implement(rpcContract);
  // skills-dashboard task 1.1：workspace 级聚合器由既有 domain 成员组装
  // （skill-service discovery 复用 + skills.duplicates 同源投影），不新建域模块。
  const workspaceSkills = createWorkspaceSkillsAggregator({
    workspaces: domain.workspaces,
    listSkills: (target, includeDisabled) => domain.skills.list(target, includeDisabled),
    duplicates: () => domain.skillSearch.duplicates(),
  });
  const domainErrorBoundary = rpc.middleware(async ({ next }) => {
    try {
      return await next();
    } catch (error) {
      if (error instanceof DomainError) {
        throw new ORPCError(error.code, {
          status: RpcErrorDefinitions[error.code].status,
          message: error.message,
          cause: error,
          // U：结构化 detail（如 PROPOSAL_STALE 的 currentView）作 oRPC error data
          // ——与 capability/MCP/proposal 面同一 CapabilityFailureDetailSchema。
          ...(error.detail === undefined ? {} : { data: error.detail }),
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
      // skills-dashboard task 1.1：workspace 级有界聚合（oRPC 不保证应用 zod
      // default——limit 缺省在 handler 侧落 200）。
      listWorkspace: rpc.skills.listWorkspace.handler(async ({ input }) =>
        workspaceSkills.listWorkspace({
          wsId: input.wsId,
          ...(input.q === undefined ? {} : { q: input.q }),
          limit: input.limit ?? 200,
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        }),
      ),
      // skills-tabs-redesign 批 2 Δ1：唯一 name 分组投影（同一聚合器，不建第二套扫描）。
      listCanonical: rpc.skills.listCanonical.handler(async ({ input }) =>
        workspaceSkills.listCanonical({
          wsId: input.wsId,
          ...(input.q === undefined ? {} : { q: input.q }),
          limit: input.limit ?? 200,
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        }),
      ),
      // skills-tabs-redesign 批 3 Δ2：有界文件树/文件读（重解析 + TOCTOU 防线在
      // skill-service/skill-files；INVALID_PATH/BINARY 经统一 DomainError 边界）。
      files: rpc.skills.files.handler(async ({ input }) =>
        domain.skills.files(input, input.skillId),
      ),
      fileRead: rpc.skills.fileRead.handler(async ({ input }) =>
        domain.skills.fileRead(input, input.skillId, input.path),
      ),
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
    // creator-skill-store 批 1：origin store 面（typed result，逐收据不抛业务错）。
    creatorStore: {
      list: rpc.creatorStore.list.handler(() => domain.creatorStore.list()),
      create: rpc.creatorStore.create.handler(({ input }) => domain.creatorStore.create(input)),
      save: rpc.creatorStore.save.handler(({ input }) => domain.creatorStore.save(input)),
      remove: rpc.creatorStore.remove.handler(({ input }) => domain.creatorStore.remove(input)),
      apply: rpc.creatorStore.apply.handler(({ input }) => domain.creatorStore.apply(input)),
      sync: rpc.creatorStore.sync.handler(({ input }) => domain.creatorStore.sync(input)),
      uninstall: rpc.creatorStore.uninstall.handler(({ input }) =>
        domain.creatorStore.uninstall(input),
      ),
      status: rpc.creatorStore.status.handler(({ input }) => domain.creatorStore.status(input)),
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
    wiki: {
      // skill-wiki 双级知识库面：direct mutation（spec 裁决，不经 proposal 链）。
      scopes: rpc.wiki.scopes.handler(() => domain.wiki.scopes()),
      list: rpc.wiki.list.handler(({ input }) => domain.wiki.list(input.scope)),
      read: rpc.wiki.read.handler(({ input }) => domain.wiki.read(input.scope, input.name)),
      append: rpc.wiki.append.handler(({ input }) =>
        domain.wiki.append(input.scope, { title: input.title, body: input.body }),
      ),
      // 蒸馏编排（skill-wiki-maintainer 1.3）：DomainError（DISTILL_*）经统一边界。
      distill: {
        start: rpc.wiki.distill.start.handler(async ({ input }) =>
          domain.wikiDistill.start(input.source, input.limit),
        ),
        status: rpc.wiki.distill.status.handler(async ({ input }) =>
          domain.wikiDistill.status(input.runId),
        ),
        cancel: rpc.wiki.distill.cancel.handler(async ({ input }) =>
          domain.wikiDistill.cancel(input.runId),
        ),
      },
    },
    daemon: {
      status: rpc.daemon.status.handler(() => status()),
      // ext-opener 外开（Owner 2026-10-05）：https 闸在 service（server-owned）。
      openExternal: rpc.daemon.openExternal.handler(async ({ input }) => {
        await domain.opener.openHttpsUrl(input.url);
        return { opened: true as const };
      }),
    },
    selfSkill: {
      // self-skill-symlink：fs 直达的 server-owned 逻辑（与 CLI/daemon 入口同一
      // 模块）；conflict 投影补 backupAvailable（由 kind 推导）。
      state: rpc.selfSkill.state.handler(() => {
        const status = selfSkillStatus();
        return status.state === "conflict" || status.state === "kept"
          ? {
              ...status,
              conflict: {
                ...status.conflict,
                backupAvailable: status.conflict.kind === "user-directory",
              },
            }
          : status;
      }),
      resolve: rpc.selfSkill.resolve.handler(async ({ input }) => {
        const result = resolveSelfSkillConflict(input);
        if (!result.ok) return result;
        // Owner 裁决 [2026-10-02]「处理完 setup 前置冲突应走完整 setup」：
        // 冲突解决成功即接续引导块注入（banner 与 CLI setup 同语义；注入失败
        // 不回滚已完成的链接——增强项语义与 CLI 一致）。
        const block = ensureAgentsMdPromptBlock();
        return {
          ...result,
          agentsMd: {
            kind: block.kind,
            ...(block.kind === "multiple" ? { file: block.file } : {}),
            ...(block.kind === "failed" ? { reason: block.reason } : {}),
          },
        };
      }),
      keep: rpc.selfSkill.keep.handler(() => keepSelfSkillUserVersion()),
    },
    evaluation: {
      // evaluation-corpus（工作计划 Ch3）：Imported-only 写门在 store（Global →
      // EvaluationStoreError → 错误边界 typed 拒绝）；读面 Imported/Global 均可。
      // evaluating-dashboard task 1.1：overview 聚合 + Global run 前置闸。
      overview: rpc.evaluation.overview.handler(async ({ input }) =>
        domain.evaluation.overview({
          wsId: input.wsId,
          limit: input.limit ?? 50,
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        }),
      ),
      cases: {
        list: rpc.evaluation.cases.list.handler(async ({ input }) => ({
          cases: await domain.evaluation.listCases(input.target),
        })),
        create: rpc.evaluation.cases.create.handler(async ({ input }) => ({
          case_: domain.evaluation.createCase(input),
        })),
        update: rpc.evaluation.cases.update.handler(async ({ input }) => {
          const { caseId, ...rest } = input;
          return { case_: domain.evaluation.updateCase({ ...rest, caseId }) };
        }),
        remove: rpc.evaluation.cases.remove.handler(async ({ input }) => ({
          removed: domain.evaluation.removeCase(input),
        })),
      },
      run: {
        start: rpc.evaluation.run.start.handler(async ({ input }) => {
          // Global run 前置闸（evaluating-dashboard design §2 r2）：排队与调用
          // runner 之前拒绝——不产生 run entry、不触 provider adapter、零落盘。
          // （service.startRun 有同一闸作进程内兜底；此处先行，使目标级前置
          // 条件先于 caseIds 校验失败报告。）
          if (input.target.workspaceId === GLOBAL_WORKSPACE_ID) {
            throw new DomainError(
              "INVALID_OPERATION",
              `Global Workspace ${GLOBAL_WORKSPACE_ID} is read-only; evaluation runs require an Imported Workspace target`,
            );
          }
          // caseIds 前置校验：未知/禁用的 case 直接拒绝（不产生静默空 run）；
          // fixture case × provider-model 组合同样前置拒绝（analyzer 域样本）。
          const cases = domain.evaluation
            .listCases(input.target)
            .filter((entry) => entry.enabled && input.caseIds.includes(entry.caseId));
          const missing = input.caseIds.filter(
            (caseId) => !cases.some((entry) => entry.caseId === caseId),
          );
          if (missing.length > 0) {
            throw new ORPCError("NOT_FOUND", {
              message: `unknown or disabled evaluation cases: ${missing.join(", ")}`,
            });
          }
          if (
            input.runner === "provider-model" &&
            cases.some((entry) => entry.source === "builtin-fixture")
          ) {
            throw new ORPCError("NOT_FOUND", {
              message: "builtin-fixture cases are analyzer-domain samples; use the analyzer runner",
            });
          }
          return domain.evaluation.startRun(input);
        }),
        status: rpc.evaluation.run.status.handler(({ input }) => {
          const status = domain.evaluation.runStatus(input.runId);
          return { status: status.status, resultIds: status.resultIds };
        }),
        cancel: rpc.evaluation.run.cancel.handler(({ input }) =>
          domain.evaluation.cancelRun(input.runId),
        ),
      },
      results: {
        list: rpc.evaluation.results.list.handler(async ({ input }) => ({
          results: (await domain.evaluation.results(input.target)).filter(
            (result) => input.caseId === undefined || result.caseId === input.caseId,
          ),
        })),
      },
    },
    skillIntelligence: {
      analyze: rpc.skillIntelligence.analyze.handler(async ({ input }) =>
        domain.skillIntelligence.analyze(input),
      ),
      // propose 直连面已退役（intelligence-proposal-parity）：创建向量唯一 =
      // agent 会话中的 intelligence_propose_* 工具调用（capability 投影）。
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
        // intelligence-proposal-parity C′2：统一审批入口——mcp:|si: 双源合并投影；
        // approve/reject 按前缀路由（McpProposalStore / skillIntelligence 服务）。
        list: rpc.agent.proposals.list.handler(() => ({
          proposals: [
            ...domain.mcpProposals.list().map(projectMcpProposal),
            ...domain.skillIntelligence.list().proposals.map(projectIntelligenceDraft),
          ],
        })),
        approve: rpc.agent.proposals.approve.handler(async ({ input }) => {
          const ref = parseUnifiedProposalRef(input.proposalId);
          if (ref.source === "mcp") {
            const result = await domain.mcpProposals.approve(ref.id);
            return { proposal: projectMcpProposal(result.view) };
          }
          // si：approve 消费草稿（r6 P1-2：stale → rejected + rejectCause:"stale"
          // （design C′2 冻结），草稿保留待重提案；正常路径逐项结果入投影）。
          const result = await domain.skillIntelligence.approve({ proposalId: ref.id as never });
          const draft = domain.skillIntelligence
            .list()
            .proposals.find((entry) => entry.id === ref.id);
          const base = draft !== undefined ? projectIntelligenceDraft(draft) : null;
          if (base !== null && result.conflicts > 0 && result.applied === 0) {
            return {
              proposal: {
                ...base,
                status: "rejected" as const,
                rejectCause: "stale" as const,
              },
            };
          }
          const failedEntry = result.results.find((entry) => entry.status === "failed");
          return {
            proposal:
              base === null || result.applied > 0
                ? {
                    ...(base ?? {
                      id: input.proposalId,
                      source: "skill-intelligence",
                      origin: "agent-tool" as const,
                      capability: null,
                      kind: "unknown",
                      target: null,
                      observedRevision: null,
                      before: null,
                      after: null,
                      finding: null,
                      validation: null,
                      createdAt: new Date().toISOString(),
                    }),
                    status:
                      failedEntry || result.failed > 0
                        ? ("failed" as const)
                        : ("executed" as const),
                    result: {
                      applied: result.applied > 0,
                      ...(failedEntry?.error !== undefined ? { error: failedEntry.error } : {}),
                    },
                  }
                : {
                    ...base,
                    validation: {
                      success: false,
                      errors: ["revision stale — refresh and re-propose"],
                      warnings: [],
                    },
                  },
          };
        }),
        // reject 变 await 语义（N/U）：late reject → typed PROPOSAL_STALE（data =
        // CapabilityFailureDetail.currentView）；ledger 迁移 IO 失败 → DISTILL_IO。
        reject: rpc.agent.proposals.reject.handler(async ({ input }) => {
          const ref = parseUnifiedProposalRef(input.proposalId);
          if (ref.source === "mcp") {
            const rejected = await domain.mcpProposals.reject(ref.id);
            if (!rejected) throw new DomainError("NOT_FOUND", `proposal not found: ${ref.id}`);
            return { proposal: projectMcpProposal(rejected.view) };
          }
          const drafts = domain.skillIntelligence.list().proposals;
          const draft = drafts.find((entry) => entry.id === ref.id);
          if (draft === undefined)
            throw new DomainError("NOT_FOUND", `proposal not found: ${ref.id}`);
          domain.skillIntelligence.reject(ref.id as never);
          return {
            proposal: {
              ...projectIntelligenceDraft(draft),
              status: "rejected" as const,
              rejectCause: "user" as const,
            },
          };
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
          sourceRevision: domain.modelCatalog.sourceRevision(),
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
