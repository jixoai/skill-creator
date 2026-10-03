/**
 * `skills.listWorkspace` 的 workspace 级有界聚合（skills-dashboard task 1.1）。
 *
 * 用户原始需求 [2026-10-03]（skills-dashboard design §5，r2-r4 定稿）：
 * 「聚合 RPC `skills.listWorkspace`：有界契约 + typed per-provider error——
 * 单次响应 skills 恒 ≤ limit，超出经 nextCursor 分段；duplicates 双层有界投影」。
 *
 * 正交意图：
 *   [1] workspace provider 枚举：catalog + registry 持久态派生 server-owned roots
 *       与可用性（Global `~` 与 Imported 同形；未知 ws → typed NOT_FOUND）。
 *   [2] 全 provider 技能 fan-out：复用 skill-service 既有 discovery（单遍扫描/
 *       在途合并），单 provider 扫描失败仅投影为该 provider 条目的 typed error。
 *   [3] 有界分页：q 包含式预过滤 + (providerId, skillId) 字典序 + opaque cursor
 *       （含起始行；续页不重不漏）。
 *   [4] duplicates 同源有界投影：组判定复用 skills.duplicates 的 contentHash
 *       分组（不引入第二份分组逻辑），按 workspace 作用域过滤后做三层有界包装。
 * 妥协声明：四个意图是同一份聚合响应（providers/skills/nextCursor/duplicates）
 * 的四个面，拆文件会让响应组装跨模块；上限 4 意图内可接受。
 */
import type { SkillMetadata } from "../../shared/contracts/skills.js";
import type { SkillDuplicateGroup } from "../../shared/contracts/search.js";
import {
  GLOBAL_WORKSPACE_ID,
  ProviderIdSchema,
  type ProviderId,
  type WorkspaceId,
  type WorkspaceProviderTarget,
} from "../../shared/contracts/workspaces.js";
import {
  decodeSkillsListWorkspaceCursor,
  encodeSkillsListWorkspaceCursor,
  type SkillsListWorkspaceOutput,
} from "../../shared/rpc-contract.js";
import { PROVIDER_CATALOG } from "../../shared/provider-catalog.js";
import { DomainError } from "../domain-error.js";
import {
  globalProviderRoot,
  importedProviderRoot,
  providerRootAvailable,
} from "../provider-roots.js";
import { availableDirectory } from "../workspace-registry/projection.js";
import type { WorkspaceRegistry } from "../workspace-registry/index.js";

/** duplicates 三层有界包装的冻结上限（design §5 r4 定稿）。 */
const DUPLICATE_GROUPS_MAX = 50;
const DUPLICATE_MEMBERS_MAX = 16;
const DUPLICATE_INSTALLATIONS_MAX = 8;

export interface WorkspaceSkillsAggregateDeps {
  workspaces: Pick<WorkspaceRegistry, "lookup">;
  /** skill-service discovery 复用入口（单遍扫描/在途合并/mutation 后失效）。 */
  listSkills: (
    target: WorkspaceProviderTarget,
    includeDisabled?: boolean,
  ) => Promise<SkillMetadata[]>;
  /** skills.duplicates 同源分组入口（contentHash 分组 + 冻结排序）。 */
  duplicates: () => Promise<SkillDuplicateGroup[]>;
}

export interface WorkspaceSkillsAggregateInput {
  wsId: WorkspaceId;
  q?: string;
  limit: number;
  cursor?: string;
}

interface ProviderScan {
  providerId: ProviderId;
  label: string;
  available: boolean;
  skillCount: number;
  error?: { code: "unavailable" | "scan-failed" | "io-error"; message: string };
  skills: SkillMetadata[];
}

/** 单 provider 扫描失败 → typed code 闭集（DomainError=语义不可用/fs 错误=io）。 */
function classifyScanError(error: unknown): {
  code: "unavailable" | "scan-failed" | "io-error";
  message: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof DomainError) return { code: "unavailable", message };
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (
    code === "EACCES" ||
    code === "EPERM" ||
    code === "EIO" ||
    code === "ENOSPC" ||
    code === "EROFS" ||
    code === "EMFILE" ||
    code === "ENFILE"
  ) {
    return { code: "io-error", message };
  }
  return { code: "scan-failed", message };
}

/** (providerId, skillId) 字典序升序（排序与游标共用同一比较口径）。 */
function compareRowKey(
  left: { providerId: string; skillId: string },
  right: { providerId: string; skillId: string },
): number {
  if (left.providerId !== right.providerId) return left.providerId < right.providerId ? -1 : 1;
  return left.skillId < right.skillId ? -1 : left.skillId > right.skillId ? 1 : 0;
}

/** 创建 workspace 级聚合器（rpc-router 组装；deps 均为既有 domain 成员）。 */
export function createWorkspaceSkillsAggregator(deps: WorkspaceSkillsAggregateDeps) {
  const resolveWorkspaceScope = (
    wsId: WorkspaceId,
  ): { kind: "global" } | { kind: "directory"; directory: string | null } => {
    if (wsId === GLOBAL_WORKSPACE_ID) return { kind: "global" };
    const entry = deps.workspaces.lookup(wsId);
    if (entry === null) throw new DomainError("NOT_FOUND", `Workspace not found: ${wsId}`);
    // 目录缺席 = workspace 已注册但不可用：provider 全体 available:false，不报错。
    return { kind: "directory", directory: availableDirectory(entry.path) };
  };

  const scanProvider = async (
    wsId: WorkspaceId,
    scope: { kind: "global" } | { kind: "directory"; directory: string | null },
    provider: (typeof PROVIDER_CATALOG)[number],
  ): Promise<ProviderScan> => {
    const providerId = ProviderIdSchema.parse(provider.id);
    const base = { providerId, label: provider.label, available: false, skillCount: 0 };
    const root =
      scope.kind === "global"
        ? globalProviderRoot(provider)
        : scope.directory !== null
          ? importedProviderRoot(scope.directory, provider)
          : null;
    if (!providerRootAvailable(root)) return { ...base, skills: [] };
    try {
      // 复用 skill-service discovery：同一 (ws,provider) 的在途扫描在此合并。
      const skills = await deps.listSkills({ workspaceId: wsId, providerId }, true);
      return { ...base, available: true, skillCount: skills.length, skills };
    } catch (error) {
      // 单 provider 失败隔离：typed error + 该 provider skills 缺席，整屏不失败。
      return { ...base, available: true, error: classifyScanError(error), skills: [] };
    }
  };

  const boundDuplicates = (
    groups: SkillDuplicateGroup[],
    wsId: WorkspaceId,
  ): SkillsListWorkspaceOutput["duplicates"] => {
    // 组判定与 skills.duplicates 数据同源，但按 workspace 作用域收窄（Codex r8
    // 处方）：每成员只保留 installation.workspaceId === wsId 的安装记录（跨 ws
    // 的 workspaceId/providerId/绝对路径不进入本 ws 响应），过滤后无本 ws 安装
    // 的成员丢弃；成员 <2 的组整体丢弃（单 ws 投影下不再是重复组）。三层有界
    // 包装在过滤后计算——上限语义只作用于本 ws 可见的成员/安装。
    const scoped = groups.flatMap((group) => {
      const members = group.members.flatMap((member) => {
        const installations = member.installations.filter(
          (installation) => installation.workspaceId === wsId,
        );
        return installations.length === 0 ? [] : [{ ...member, installations }];
      });
      return members.length >= 2 ? [{ contentHash: group.contentHash, members }] : [];
    });
    return {
      groups: scoped.slice(0, DUPLICATE_GROUPS_MAX).map((group) => ({
        contentHash: group.contentHash,
        members: group.members.slice(0, DUPLICATE_MEMBERS_MAX).map((member) => ({
          id: member.id,
          name: member.name,
          canonicalPath: member.canonicalPath,
          disabled: member.disabled,
          conflict: member.conflict,
          installations: {
            items: member.installations.slice(0, DUPLICATE_INSTALLATIONS_MAX),
            truncated: member.installations.length > DUPLICATE_INSTALLATIONS_MAX,
          },
        })),
        membersTruncated: group.members.length > DUPLICATE_MEMBERS_MAX,
      })),
      groupsTruncated: scoped.length > DUPLICATE_GROUPS_MAX,
    };
  };

  return {
    /** 聚合单一 workspace 全部 provider 的有界平铺投影（readonly）。 */
    async listWorkspace(input: WorkspaceSkillsAggregateInput): Promise<SkillsListWorkspaceOutput> {
      const scope = resolveWorkspaceScope(input.wsId);
      const scans = await Promise.all(
        PROVIDER_CATALOG.map((provider) => scanProvider(input.wsId, scope, provider)),
      );

      const needle = input.q?.trim().toLowerCase() ?? "";
      const rows = scans
        .flatMap((scan) => scan.skills.map((skill) => ({ ...skill, providerId: scan.providerId })))
        .filter((skill) => {
          if (needle === "") return true;
          return (
            skill.name.toLowerCase().includes(needle) ||
            skill.description.toLowerCase().includes(needle)
          );
        })
        .sort((left, right) =>
          compareRowKey(
            { providerId: left.providerId, skillId: left.id },
            { providerId: right.providerId, skillId: right.id },
          ),
        );

      // cursor = 下一首行键（含起始行）：schema 已校验可解码，此处仍防御收窄。
      let start = 0;
      if (input.cursor !== undefined) {
        const key = decodeSkillsListWorkspaceCursor(input.cursor);
        if (key === null) {
          throw new DomainError("INVALID_OPERATION", "malformed skills.listWorkspace cursor");
        }
        const index = rows.findIndex(
          (row) => compareRowKey({ providerId: row.providerId, skillId: row.id }, key) >= 0,
        );
        start = index === -1 ? rows.length : index;
      }
      const page = rows.slice(start, start + input.limit);
      const next = rows[start + input.limit];

      return {
        providers: scans.map(({ skills: _skills, ...provider }) => provider),
        skills: page,
        ...(next === undefined
          ? {}
          : {
              nextCursor: encodeSkillsListWorkspaceCursor({
                providerId: next.providerId,
                skillId: next.id,
              }),
            }),
        duplicates: boundDuplicates(await deps.duplicates(), input.wsId),
      };
    },
  };
}
