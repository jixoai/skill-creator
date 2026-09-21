/**
 * 用户原始需求 [2026-09-21]：「workspace 很重要，但我们仍然需要有一个 global 的
 * 概念，global 能承载 workspace 泛化出来的 skill」——daemon 侧双级 wiki 服务。
 * 用户原始需求 [2026-09-21]（jixoai-search-core 3.1/3.2）：「RPC 侧对外仍是
 * WorkspaceId（契约不动），daemon 内部把 ws_* 映射为人类可读 slug；wiki 存储
 * 根统一 ~/.skill-wiki/，宿主经 symlink 衔接存量目录」。
 * 正交意图：
 *   [1] scope 权限闸 + workspaceId → slug 映射：`~` 直通；ws_* 必须是 registry
 *       已注册 Imported（轻量 lookup，不触发 ccski 扫描），未注册 → typed
 *       NOT_FOUND。slug 由 label 确定性派生（不持久化）；同 slug 冲突附 id
 *       digest 前 4 hex 消歧（经轻量 listImported 判定）。
 *   [2] 委派 skill-wiki 领域库（目录契约/去重/index 重建都在包内）+ 统一根
 *       装配（defaultWikiRoot()，SKILL_WIKI_HOME env 可覆盖）+ 存量迁移三态
 *       （wiki-root-migration，首次打开时执行一次）+ 错误映射
 *       （SkillWikiError → DomainError）。
 *   [3] direct mutation 面（spec 裁决：wiki 追加不走 proposal 审批链）。
 */
import path from "node:path";
import {
  SkillWikiError,
  defaultWikiRoot,
  openWikiWorkspace,
  parseWikiScope,
  patternContentHash,
  wikiScopeDirectory,
  type PatternListItem,
  type WikiScope,
} from "skill-wiki";
import { appDir } from "../shared/paths.js";
import type { WorkspaceId } from "../shared/contracts/workspaces.js";
import { DomainError } from "./domain-error.js";
import type { WorkspaceRegistry } from "./workspace-registry/index.js";
import type { WikiReadResult } from "../shared/contracts/wiki.js";
import { migrateLegacyWikiRoot } from "./wiki-root-migration.js";

/** daemon wiki 服务面（wiki.* RPC 的领域实现）。 */
export interface WikiService {
  /** 列出某 scope 的全部 pattern（畸形页由 skill-wiki 丢弃）。 */
  list: (scope: WorkspaceId) => { patterns: PatternListItem[] };
  /** 读单 pattern 全文。 */
  read: (scope: WorkspaceId, name: string) => WikiReadResult;
  /** 追加碎片认知（contentHash 幂等去重）。 */
  append: (
    scope: WorkspaceId,
    input: { title: string; body: string },
  ) => { item: PatternListItem; deduplicated: boolean };
}

/**
 * wiki 根装配选项：rootDir 默认 defaultWikiRoot()（构造期求值，daemon 生命周期
 * 内不变）；legacyDir 默认 appDir()/wiki（存量迁移源），null 显式禁用迁移
 * （测试隔离）。legacyDir 仅在未注入 rootDir 的默认装配下自动启用——注入
 * rootDir 而不显式给 legacyDir 视为测试隔离语义，避免误碰真实 home。
 */
export interface WikiServiceOptions {
  rootDir?: string;
  legacyDir?: string | null;
}

/** label 的 slug 裁剪上限（与 skill-wiki pattern 文件名 slugify 同口径）。 */
const WORKSPACE_SLUG_MAX = 48;

/**
 * label → npm-scope 式 base slug（确定性纯函数）：小写、非法字符→-、压缩、裁剪
 * 到 48、去尾连字符；空结果回退 "ws"（workspace 语义）。输出恒满足
 * SLUG_SCOPE_REGEX。
 */
export function workspaceLabelSlug(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, WORKSPACE_SLUG_MAX)
    .replace(/-+$/g, "");
  return slug === "" ? "ws" : slug;
}

/**
 * workspaceId → wiki scope slug（确定性、不持久化）：base = label 的 slugify；
 * `collides` 由调用方以 registry 顺序快照判定（存在**更早注册**的 workspace
 * 产生相同 base slug——首个保留裸名，避免追加冲突方移动既有 wiki 目录）——
 * 此时附 id digest 前 4 hex 消歧（如 `skill-creator-a1b2`）。
 */
export function workspaceScopeSlug(label: string, id: WorkspaceId, collides: boolean): string {
  const base = workspaceLabelSlug(label);
  return collides ? `${base}-${id.slice(3, 7)}` : base;
}

/** Create the daemon wiki service bound to one registry. */
export function createWikiService(
  workspaces: Pick<WorkspaceRegistry, "lookup" | "listImported">,
  options: WikiServiceOptions = {},
): WikiService {
  const injectedRoot = options.rootDir !== undefined;
  const rootDir = options.rootDir ?? defaultWikiRoot();
  // 迁移源默认 = 真实装配的 appDir()/wiki；显式 null 或注入 rootDir 的测试
  // 隔离场景禁用（不误碰真实 home 的存量目录）。
  const legacyDir =
    options.legacyDir !== undefined
      ? options.legacyDir
      : injectedRoot
        ? null
        : path.join(appDir(), "wiki");
  let migrationDone = false;

  /** 首次打开时执行一次存量迁移（幂等；typed CONFLICT 上抛）。 */
  const runMigrationOnce = (): void => {
    if (migrationDone || legacyDir === null) return;
    migrateLegacyWikiRoot(rootDir, legacyDir);
    migrationDone = true;
  };

  /** ws_* → slug（RPC 契约仍是 WorkspaceId；wiki 侧车目录名是人类可读 slug）。 */
  const resolveScope = (scope: WorkspaceId): WikiScope => {
    if (scope === "~") return "~";
    // scope 已由 RPC 契约的 WorkspaceIdSchema 收窄过形状；这里再闸注册态。
    const self = workspaces.lookup(scope);
    if (self === null) {
      throw new DomainError("NOT_FOUND", `Workspace not found: ${scope}`);
    }
    // 冲突消解按 registry 顺序：首个产出该 base slug 的 workspace 保留裸名
    // （后出现的冲突方才附 digest——保证追加冲突方不移动既有 wiki 目录）。
    const base = workspaceLabelSlug(self.label);
    const imported = workspaces.listImported();
    const selfIndex = imported.findIndex((entry) => entry.id === scope);
    const collides =
      selfIndex >= 0 &&
      imported.some(
        (other, index) => index < selfIndex && workspaceLabelSlug(other.label) === base,
      );
    return parseWikiScope(workspaceScopeSlug(self.label, scope, collides));
  };

  const openScope = (scope: WorkspaceId) => {
    runMigrationOnce();
    return openWikiWorkspace(wikiScopeDirectory(rootDir, resolveScope(scope)));
  };

  return {
    list(scope) {
      return { patterns: openScope(scope).listPatterns() };
    },

    read(scope, name) {
      const wiki = openScope(scope);
      try {
        const read = wiki.readPattern(name);
        return {
          name: name as WikiReadResult["name"],
          title: read.frontmatter.title,
          origin: read.frontmatter.origin,
          promotedFrom: read.frontmatter.promotedFrom,
          updated: read.frontmatter.updated,
          contentHash: patternContentHash(read.body),
          body: read.body,
        };
      } catch (error) {
        // read 面的 WIKI_INVALID_PATTERN = 未知或畸形页 → NOT_FOUND。
        if (error instanceof SkillWikiError && error.code === "WIKI_INVALID_PATTERN") {
          throw new DomainError("NOT_FOUND", `Wiki pattern not found: ${name}`);
        }
        throw error;
      }
    },

    append(scope, input) {
      const wiki = openScope(scope);
      try {
        // origin 落 scope 足迹（registry 持久身份）：global 追加记 "~"，
        // workspace 追加记 ws_*（digest 是溯源事实，slug 只是目录名）。
        return wiki.appendPattern({ ...input, origin: scope });
      } catch (error) {
        // append 面的 WIKI_INVALID_PATTERN = 输入非法（title 收窄拒绝）。
        if (error instanceof SkillWikiError && error.code === "WIKI_INVALID_PATTERN") {
          throw new DomainError("INVALID_OPERATION", error.message);
        }
        throw error;
      }
    },
  };
}
