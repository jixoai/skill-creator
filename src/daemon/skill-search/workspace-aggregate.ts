/**
 * `skills.listWorkspace` / `skills.listCanonical` 的 workspace 级有界聚合
 * （skills-dashboard task 1.1 + skills-tabs-redesign 批 2 Δ1）。
 *
 * 用户原始需求 [2026-10-03]（skills-dashboard design §5，r2-r4 定稿）：
 * 「聚合 RPC `skills.listWorkspace`：有界契约 + typed per-provider error——
 * 单次响应 skills 恒 ≤ limit，超出经 nextCursor 分段；duplicates 双层有界投影」。
 * 修订 [2026-10-06]（skills-tabs-redesign Δ1 定稿）：新增 `listCanonical` 唯一
 * name 分组投影——「Skills 默认不得出现重复 skill-name；同名技能跨 Agent 的差异
 * 归 SkillDetail 展示」（Owner 落地注意 2）。
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
 *   [5] 唯一 name 分组（Δ1）：复用 [1][2] 的扫描行按 name 精确匹配分组（plugin
 *       namespace 原样）；representative = enabled → sourcePriority → providerId →
 *       path，unavailable copy 顺延；copy 级 unavailable/conflict 投影时体检
 *       （canonical 目录 lstat + 双文档 exists）；两量纲计数分开返回。
 * 妥协声明：五个意图是同一对聚合响应（providers/skills/groups）的五个面，拆文件
 * 会让响应组装跨模块；上限 5 意图内已到警报线，后续意图必须拆分。
 */
import fs from "node:fs";
import path from "node:path";
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
  decodeSkillsListCanonicalCursor,
  decodeSkillsListWorkspaceCursor,
  encodeSkillsListCanonicalCursor,
  encodeSkillsListWorkspaceCursor,
  type SkillsCanonicalCopy,
  type SkillsCanonicalGroup,
  type SkillsListCanonicalOutput,
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

// ---- Δ1 唯一 name 分组投影（skills-tabs-redesign 批 2） ----

/** copy 投影时体检：canonical 目录不可达 = unavailable；双身份文档并存 = conflict。 */
function inspectCopyDirectory(skillPath: string): { unavailable: boolean; conflict: boolean } {
  try {
    if (!fs.statSync(skillPath).isDirectory()) return { unavailable: true, conflict: false };
    const conflict =
      fs.existsSync(path.join(skillPath, "SKILL.md")) &&
      fs.existsSync(path.join(skillPath, ".SKILL.md"));
    return { unavailable: false, conflict };
  } catch {
    return { unavailable: true, conflict: false };
  }
}

/**
 * representative 优先序（Δ1 冻结）：enabled 优先 → sourcePriority（缺失=最低）→
 * providerId 字典序 → path 字典序；unavailable copy 不参与代表（顺延到首个可用）。
 */
function compareCopyPriority(left: SkillsCanonicalCopy, right: SkillsCanonicalCopy): number {
  if (left.disabled !== right.disabled) return left.disabled ? 1 : -1;
  const leftPriority = left.sourcePriority ?? Number.NEGATIVE_INFINITY;
  const rightPriority = right.sourcePriority ?? Number.NEGATIVE_INFINITY;
  if (leftPriority !== rightPriority) return leftPriority > rightPriority ? -1 : 1;
  if (left.providerId !== right.providerId) return left.providerId < right.providerId ? -1 : 1;
  if (left.path !== right.path) return left.path < right.path ? -1 : 1;
  return 0;
}

/** duplicates 同源投影 → skillId → contentHash（组内区分同内容副本；缺席 = 唯一内容）。 */
async function contentHashBySkillId(
  duplicates: () => Promise<SkillDuplicateGroup[]>,
): Promise<Map<string, string>> {
  const groups = await duplicates();
  const map = new Map<string, string>();
  for (const group of groups) {
    for (const member of group.members) map.set(member.id, group.contentHash);
  }
  return map;
}

/**
 * 扫描行 → 唯一 name 组（纯函数）：name 精确匹配（trim 外无归一）；组内含任一
 * q 命中 copy 即整组入列（copies 恒完整，×N 与 copyCount 不随 q 缺角）；组序 =
 * name 码点升序（游标同一口径）。
 */
export interface CanonicalGrouping {
  groups: SkillsCanonicalGroup[];
  groupCount: number;
  copyCount: number;
}

function buildCanonicalGroups(
  rows: Array<SkillMetadata & { providerId: ProviderId }>,
  wsId: WorkspaceId,
  needle: string,
  hashById: ReadonlyMap<string, string>,
): CanonicalGrouping {
  const byName = new Map<string, Array<SkillMetadata & { providerId: ProviderId }>>();
  for (const row of rows) {
    const bucket = byName.get(row.name);
    if (bucket) bucket.push(row);
    else byName.set(row.name, [row]);
  }

  const groups: SkillsCanonicalGroup[] = [];
  let copyCount = 0;
  for (const [name, members] of byName) {
    // 组级 q 闸：组名命中或任一 copy 的 name/description 命中（包含式，大小写不敏感）。
    if (
      needle !== "" &&
      !name.toLowerCase().includes(needle) &&
      !members.some(
        (member) =>
          member.name.toLowerCase().includes(needle) ||
          member.description.toLowerCase().includes(needle),
      )
    ) {
      continue;
    }
    const ordered = [...members].sort((left, right) =>
      compareRowKey(
        { providerId: left.providerId, skillId: left.id },
        { providerId: right.providerId, skillId: right.id },
      ),
    );
    const copies: SkillsCanonicalCopy[] = ordered.map((member) => ({
      ...member,
      providerId: member.providerId,
      workspaceId: wsId,
      skillId: member.id,
      ...inspectCopyDirectory(member.path),
      ...(hashById.has(member.id) ? { contentHash: hashById.get(member.id)! } : {}),
    }));
    const availableCopies = copies.filter((copy) => !copy.unavailable);
    const representative = [...(availableCopies.length > 0 ? availableCopies : copies)].sort(
      compareCopyPriority,
    )[0]!;
    groups.push({
      name,
      description: representative.description,
      representative,
      copies,
      groupMeta: {
        copyCount: copies.length,
        allUnavailable: availableCopies.length === 0,
      },
    });
    copyCount += copies.length;
  }
  groups.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  return { groups, groupCount: groups.length, copyCount };
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
    /** 全 provider 扫描（listWorkspace / listCanonical 共用的 fan-out 步骤）。 */
    scanAll: async (wsId: WorkspaceId): Promise<ProviderScan[]> => {
      const scope = resolveWorkspaceScope(wsId);
      return Promise.all(PROVIDER_CATALOG.map((provider) => scanProvider(wsId, scope, provider)));
    },

    /** 聚合单一 workspace 全部 provider 的有界平铺投影（readonly）。 */
    async listWorkspace(input: WorkspaceSkillsAggregateInput): Promise<SkillsListWorkspaceOutput> {
      const scans = await this.scanAll(input.wsId);

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

    /**
     * 唯一 name 分组投影（Δ1）：复用 listWorkspace 的扫描面；copy 级
     * unavailable/conflict 投影时体检；组级 q 闸（copies 恒完整）；组名序 +
     * opaque cursor 分段；groupCount/copyCount 为 (wsId, q) 全量两量纲。
     */
    async listCanonical(input: WorkspaceSkillsAggregateInput): Promise<SkillsListCanonicalOutput> {
      const [scans, hashById] = await Promise.all([
        this.scanAll(input.wsId),
        contentHashBySkillId(deps.duplicates),
      ]);

      const needle = input.q?.trim().toLowerCase() ?? "";
      const rows = scans.flatMap((scan) =>
        scan.skills.map((skill) => ({ ...skill, providerId: scan.providerId })),
      );
      const { groups, groupCount, copyCount } = buildCanonicalGroups(
        rows,
        input.wsId,
        needle,
        hashById,
      );

      // cursor = 下一首组键（含起始组）：schema 已校验可解码，此处仍防御收窄。
      let start = 0;
      if (input.cursor !== undefined) {
        const key = decodeSkillsListCanonicalCursor(input.cursor);
        if (key === null) {
          throw new DomainError("INVALID_OPERATION", "malformed skills.listCanonical cursor");
        }
        const index = groups.findIndex((group) => group.name >= key);
        start = index === -1 ? groups.length : index;
      }
      const page = groups.slice(start, start + input.limit);
      const next = groups[start + input.limit];

      return {
        providers: scans.map(({ skills: _skills, ...provider }) => provider),
        groups: page,
        groupCount,
        copyCount,
        ...(next === undefined ? {} : { nextCursor: encodeSkillsListCanonicalCursor(next.name) }),
      };
    },
  };
}
