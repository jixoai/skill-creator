/**
 * 用户原始需求 [2026-09-21]：「workspace 很重要，但我们仍然需要有一个 global 的
 * 概念，global 能承载 workspace 泛化出来的 skill」——daemon 侧双级 wiki 服务。
 * 用户原始需求 [2026-09-21]（jixoai-search-core 3.1/3.2）：「RPC 侧对外仍是
 * WorkspaceId（契约不动），daemon 内部把 ws_* 映射为人类可读 slug；wiki 存储
 * 根统一 ~/.skill-wiki/，宿主经 symlink 衔接存量目录」。
 * 正交意图：
 *   [1] scope 权限闸 + workspaceId → slug 映射：`~` 直通；ws_* 必须是 registry
 *       已注册 Imported（轻量 lookup，不触发 ccski 扫描），未注册 → typed
 *       NOT_FOUND。slug 分配持久化于 <wikiRoot>/scopes.json（终审 P1-1：
 *       skill-wiki 库层登记表——同 id 复用、forget 不释放，杜绝 forget/
 *       re-import 后存活 workspace 顶替裸名读写他人目录）。
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
  openScopeSlugRegistry,
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

/** Create the daemon wiki service bound to one registry. */
export function createWikiService(
  workspaces: Pick<WorkspaceRegistry, "lookup">,
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
  // slug 分配登记表（终审 P1-1）：与 registry 顺序解耦的持久身份。
  const scopeSlugs = openScopeSlugRegistry(rootDir);

  /** 首次打开时执行一次存量迁移（幂等；typed CONFLICT 上抛）。 */
  const runMigrationOnce = (): void => {
    if (migrationDone || legacyDir === null) return;
    migrateLegacyWikiRoot(rootDir, legacyDir);
    migrationDone = true;
  };

  /**
   * ws_* → slug（RPC 契约仍是 WorkspaceId；wiki 侧车目录名是人类可读 slug）。
   * 分配走 scopes.json 登记表：登记表命中复用；登记表读/写失败与分配冲突
   * 映射为 typed DomainError（不伪装成功、不清目录）。
   */
  const resolveScope = (scope: WorkspaceId): WikiScope => {
    if (scope === "~") return "~";
    // scope 已由 RPC 契约的 WorkspaceIdSchema 收窄过形状；这里再闸注册态。
    const self = workspaces.lookup(scope);
    if (self === null) {
      throw new DomainError("NOT_FOUND", `Workspace not found: ${scope}`);
    }
    try {
      const slug = scopeSlugs.assign({
        key: scope,
        label: self.label,
        // id digest 前 4 hex 消歧（如 `skill-creator-a1b2`）。
        disambiguator: scope.slice(3, 7),
      });
      return parseWikiScope(slug);
    } catch (error) {
      if (error instanceof SkillWikiError) {
        if (error.code === "WIKI_SCOPE_CONFLICT") {
          throw new DomainError(
            "CONFLICT",
            `Wiki scope slug collision for workspace ${scope}: ${error.message}`,
          );
        }
        if (error.code === "WIKI_SCOPE_REGISTRY") {
          throw new DomainError(
            "UNAVAILABLE",
            `Wiki scope registry is unavailable; inspect ${path.join(rootDir, "scopes.json")} ` +
              `manually: ${error.message}`,
          );
        }
      }
      throw error;
    }
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
