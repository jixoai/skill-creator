/**
 * Daemon implementation of the shared oRPC contract.
 *
 * User intent [2026-07-14]: every WebUI action resolves opaque IDs through a
 * server-owned workspace or repository session.
 * Original error request [2026-07-14]: safely expose typed business errors and
 * keep unknown failures masked as internal errors.
 *
 * Orthogonal intents:
 *   [1] Workspace-scoped skill reads and mutations.
 *   [2] Workspace registry and revision-safe Creator operations.
 *   [3] Immutable repository session operations.
 *   [4] Daemon status projection.
 *   [5] Convert DomainError only at the root RPC boundary.
 * Compromise: oRPC router-wide middleware must be attached at this central
 * contract-composition root, so extracting the fifth intent would duplicate
 * or weaken the single transport boundary.
 */
import { implement, ORPCError } from "@orpc/server";
import { RpcErrorDefinitions } from "../shared/contracts/errors.js";
import { rpcContract } from "../shared/rpc-contract.js";
import type { DaemonStatus } from "../shared/contracts/daemon.js";
import * as creatorService from "./creator-service.js";
import { DomainError } from "./domain-error.js";
import * as repositoryService from "./repository-service.js";
import * as skillService from "./skill-service.js";
import * as workspaceService from "./workspace-service.js";

/** Bind domain services to the shared contract behind one error boundary. */
export function createRpcRouter(status: () => DaemonStatus) {
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
        skills: await skillService.list(input.workspaceId, input.includeDisabled ?? true),
      })),
      info: rpc.skills.info.handler(async ({ input }) =>
        skillService.info(input.workspaceId, input.skillId),
      ),
      toggle: rpc.skills.toggle.handler(async ({ input }) =>
        skillService.toggle(input.workspaceId, input.skillIds, input.mode),
      ),
      validate: rpc.skills.validate.handler(async ({ input }) =>
        skillService.validate(input.workspaceId, input.skillId),
      ),
    },
    workspace: {
      list: rpc.workspace.list.handler(async () => ({
        workspaces: await workspaceService.listWithFreshCounts(),
      })),
      add: rpc.workspace.add.handler(({ input }) => ({
        workspace: workspaceService.add(input.path, input.label),
      })),
      remove: rpc.workspace.remove.handler(({ input }) => ({
        activeId: workspaceService.remove(input.id),
      })),
      setActive: rpc.workspace.setActive.handler(({ input }) => ({
        activeId: workspaceService.setActive(input.id),
      })),
    },
    creator: {
      save: rpc.creator.save.handler(({ input }) => creatorService.save(input)),
      load: rpc.creator.load.handler(({ input }) =>
        creatorService.load(input.workspaceId, input.skillId),
      ),
      remove: rpc.creator.remove.handler(async ({ input }) => {
        await creatorService.remove(input.workspaceId, input.skillId, input.expectedRevision);
        return { removed: true as const };
      }),
    },
    repository: {
      scan: rpc.repository.scan.handler(({ input }) =>
        repositoryService.scan(input.source, input.ref),
      ),
      preview: rpc.repository.preview.handler(({ input }) =>
        repositoryService.preview(input.sessionId, input.skillId),
      ),
      install: rpc.repository.install.handler(({ input }) => repositoryService.install(input)),
    },
    daemon: {
      status: rpc.daemon.status.handler(() => status()),
    },
  });
}
