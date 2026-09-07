/**
 * 用户原始需求 [2026-09-08]（dsh-kernel-rebase tasks 1.2）：「workspace/creator/
 * repository 能力登记：list/inspect/validate（readonly）、toggle 与 skills update
 * apply（approved-mutation——直接写盘/重装写入）、skills update check（readonly——
 * lock hash 对比不写盘）、creator 读写（approved-mutation）、repository
 * preview/install（approved-mutation）进 capability-core。」
 * authority 判定口径：底面真相是否落 Manager 数据/用户磁盘。creator.load/revisions
 * 与 repository.scan 是读/发现面 → readonly（与 4.1「技能文档/快照只读面」一致；
 * tasks 字面「creator 读写（approved-mutation）」窄化为写面，见 artifacts 差异表）。
 *
 * 正交意图：
 *   [1] 领域能力面：Manager RPC procedure 的同名能力登记（输入 schema 与
 *       rpc-contract 同源，禁止第二份手写镜像）。
 *   [2] DomainError 归一：领域失败映射为 capability failed 结果（code 值域一致）。
 * 妥协声明：capability 名与 RPC procedure 名一一对应；MCP 面（task 4.1）直接投影
 * 本清单，authority class 由 registry 统一执行。
 */
import type { CapabilityCallResult, CapabilityDefinition } from "./core.js";
import type { DaemonDomain } from "../domain.js";
import { DomainError } from "../domain-error.js";
import {
  CreatorRemoveInputSchema,
  RepositoryPreviewInputSchema,
  RepositoryScanInputSchema,
  SkillsInfoInputSchema,
  SkillsListInputSchema,
  SkillsToggleInputSchema,
  WorkspaceAddInputSchema,
  WorkspaceRemoveInputSchema,
  WorkspaceSetActiveInputSchema,
} from "../../shared/rpc-contract.js";
import {
  SaveSkillInputSchema,
  CreatorRevisionsInputSchema,
} from "../../shared/contracts/creator.js";
import {
  ApplyUpdateInputSchema,
  UpdateCheckInputSchema,
} from "../../shared/contracts/skills-update.js";
import {
  AddUserSourceInputSchema,
  RemoveUserSourceInputSchema,
  RepositoryInstallInputSchema,
} from "../../shared/contracts/repository.js";
import { z } from "zod";

/** DomainError → capability failed（code 值域一致：4 词有限表）。 */
function toResult(error: unknown): CapabilityCallResult {
  if (error instanceof DomainError) {
    return { kind: "failed", code: error.code, message: error.message };
  }
  return {
    kind: "failed",
    code: "UNAVAILABLE",
    message: error instanceof Error ? error.message : String(error),
  };
}

function ok(value: unknown): CapabilityCallResult {
  return { kind: "ok", value };
}

/** 以 DomainError 归一的方式执行领域调用。 */
async function invoke(action: () => Promise<unknown> | unknown): Promise<CapabilityCallResult> {
  try {
    return ok(await action());
  } catch (error) {
    return toResult(error);
  }
}

const none = z.object({});

/**
 * daemon 级领域能力（与 manager-contract-map 的 procedure 一一对应）。
 * 注册序：workspace → skills（含 update）→ creator → repository（含 sources）。
 */
export function createDomainCapabilities(domain: DaemonDomain): CapabilityDefinition[] {
  return [
    {
      name: "workspace.list",
      description: "List Global and imported workspaces with fresh provider counts.",
      authority: "readonly",
      input: none,
      handler: () => invoke(async () => ({ workspaces: await domain.workspaces.list() })),
    },
    {
      name: "workspace.add",
      description: "Import a canonical directory as an imported workspace.",
      authority: "approved-mutation",
      input: WorkspaceAddInputSchema,
      handler: (input) =>
        invoke(async () => {
          const parsed = WorkspaceAddInputSchema.parse(input);
          return { workspace: domain.workspaces.import(parsed.path, parsed.label) };
        }),
    },
    {
      name: "workspace.remove",
      description: "Remove an imported workspace registration (directories stay on disk).",
      authority: "approved-mutation",
      input: WorkspaceRemoveInputSchema,
      handler: (input) =>
        invoke(() => ({ activeId: domain.workspaces.forget(WorkspaceRemoveInputSchema.parse(input).id) })),
    },
    {
      name: "workspace.setActive",
      description: "Select the active workspace.",
      authority: "approved-mutation",
      input: WorkspaceSetActiveInputSchema,
      handler: (input) =>
        invoke(() => ({
          activeId: domain.workspaces.activate(WorkspaceSetActiveInputSchema.parse(input).id),
        })),
    },
    {
      name: "skills.list",
      description: "Discover skills within one explicit workspace provider.",
      authority: "readonly",
      input: SkillsListInputSchema,
      handler: (input) =>
        invoke(async () => {
          const parsed = SkillsListInputSchema.parse(input);
          return { skills: await domain.skills.list(parsed, parsed.includeDisabled ?? true) };
        }),
    },
    {
      name: "skills.info",
      description: "Read one workspace-provider-scoped skill document.",
      authority: "readonly",
      input: SkillsInfoInputSchema,
      handler: (input) =>
        invoke(async () => {
          const parsed = SkillsInfoInputSchema.parse(input);
          return domain.skills.info(parsed, parsed.skillId);
        }),
    },
    {
      name: "skills.toggle",
      description: "Enable or disable selected skills (writes marker state).",
      authority: "approved-mutation",
      input: SkillsToggleInputSchema,
      handler: (input) =>
        invoke(async () => {
          const parsed = SkillsToggleInputSchema.parse(input);
          return domain.skills.toggle(parsed, parsed.skillIds, parsed.mode);
        }),
    },
    {
      name: "skills.validate",
      description: "Validate one workspace-provider-scoped skill.",
      authority: "readonly",
      input: SkillsInfoInputSchema,
      handler: (input) =>
        invoke(async () => {
          const parsed = SkillsInfoInputSchema.parse(input);
          return domain.skills.validate(parsed, parsed.skillId);
        }),
    },
    {
      name: "skills.update.check",
      description: "Compare skills-CLI lock hashes against upstream (read-only).",
      authority: "readonly",
      input: UpdateCheckInputSchema,
      handler: (input) =>
        invoke(async () => {
          const parsed = UpdateCheckInputSchema.parse(input);
          const discovered = await domain.skills.list(parsed, true);
          return domain.skillsUpdate.checkUpdates(parsed, discovered, parsed);
        }),
    },
    {
      name: "skills.update.apply",
      description: "Reinstall outdated skills via the repository install pipeline (writes disk).",
      authority: "approved-mutation",
      input: ApplyUpdateInputSchema,
      handler: (input) =>
        invoke(async () => {
          const parsed = ApplyUpdateInputSchema.parse(input);
          return domain.skillsUpdate.applyUpdates(parsed, parsed.skillIds, parsed);
        }),
    },
    {
      name: "creator.load",
      description: "Load an editable skill document (gray-matter round-trip baseline).",
      authority: "readonly",
      input: SkillsInfoInputSchema,
      handler: (input) =>
        invoke(async () => {
          const parsed = SkillsInfoInputSchema.parse(input);
          return domain.creator.load(parsed, parsed.skillId);
        }),
    },
    {
      name: "creator.save",
      description: "Create or revision-check and update a skill (atomic write).",
      authority: "approved-mutation",
      input: SaveSkillInputSchema,
      handler: (input) => invoke(() => domain.creator.save(SaveSkillInputSchema.parse(input))),
    },
    {
      name: "creator.remove",
      description: "Revision-check and delete one skill.",
      authority: "approved-mutation",
      input: CreatorRemoveInputSchema,
      handler: (input) =>
        invoke(async () => {
          const parsed = CreatorRemoveInputSchema.parse(input);
          await domain.creator.remove(parsed, parsed.skillId, parsed.expectedRevision);
          return { removed: true };
        }),
    },
    {
      name: "creator.revisions",
      description: "Read revision history entries for one skill.",
      authority: "readonly",
      input: CreatorRevisionsInputSchema,
      handler: (input) => invoke(() => domain.creator.revisions(CreatorRevisionsInputSchema.parse(input))),
    },
    {
      name: "repository.scan",
      description: "Clone, pin and scan a repository source (discovery face).",
      authority: "readonly",
      input: RepositoryScanInputSchema,
      handler: (input) =>
        invoke(async () => {
          const parsed = RepositoryScanInputSchema.parse(input);
          return domain.repository.scan(parsed.source, parsed.ref);
        }),
    },
    {
      name: "repository.preview",
      description: "Preview one skill from a pinned repository session.",
      authority: "approved-mutation",
      input: RepositoryPreviewInputSchema,
      handler: (input) =>
        invoke(async () => {
          const parsed = RepositoryPreviewInputSchema.parse(input);
          return domain.repository.preview(parsed.sessionId, parsed.skillId);
        }),
    },
    {
      name: "repository.install",
      description: "Preview or install selected remote skills into workspace providers.",
      authority: "approved-mutation",
      input: RepositoryInstallInputSchema,
      handler: (input) => invoke(() => domain.repository.install(RepositoryInstallInputSchema.parse(input))),
    },
    {
      name: "repository.sources.list",
      description: "List curated (built-in) and user-persisted discover sources.",
      authority: "readonly",
      input: none,
      handler: () => invoke(() => domain.sourceRegistry.list()),
    },
    {
      name: "repository.sources.add",
      description: "Persist a new user source (https git URL only).",
      authority: "approved-mutation",
      input: AddUserSourceInputSchema,
      handler: (input) =>
        invoke(() => ({ source: domain.sourceRegistry.add(AddUserSourceInputSchema.parse(input)) })),
    },
    {
      name: "repository.sources.remove",
      description: "Remove one user-persisted source; built-in ids are rejected.",
      authority: "approved-mutation",
      input: RemoveUserSourceInputSchema,
      handler: (input) =>
        invoke(() => domain.sourceRegistry.remove(RemoveUserSourceInputSchema.parse(input).id)),
    },
  ];
}
