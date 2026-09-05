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
