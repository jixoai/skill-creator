/**
 * 用户原始需求 [2026-09-21]：「workspace 很重要，但我们仍然需要有一个 global 的
 * 概念，global 能承载 workspace 泛化出来的 skill」——daemon 侧双级 wiki 服务。
 * 正交意图：
 *   [1] scope 权限闸：`~` 直通；ws_* 必须是 registry 已注册 Imported（轻量
 *       lookup，不触发 ccski 扫描），未注册 → typed NOT_FOUND。
 *   [2] 委派 skill-wiki 领域库（目录契约/去重/index 重建都在包内），本服务只做
 *       scope 解析 + 错误映射（SkillWikiError → DomainError）。
 *   [3] direct mutation 面（spec 裁决：wiki 追加不走 proposal 审批链）。
 */
import {
  SkillWikiError,
  openWikiWorkspace,
  parseWikiScope,
  patternContentHash,
  wikiScopeDirectory,
  type PatternListItem,
} from "skill-wiki";
import { appDir } from "../shared/paths.js";
import type { WorkspaceId } from "../shared/contracts/workspaces.js";
import { DomainError } from "./domain-error.js";
import type { WorkspaceRegistry } from "./workspace-registry/index.js";
import type { WikiReadResult } from "../shared/contracts/wiki.js";

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

/** wiki 侧车根目录注入缝（默认 appDir()；测试注入 tmp 根）。 */
export interface WikiServiceOptions {
  rootDir?: string;
}

/** Create the daemon wiki service bound to one registry. */
export function createWikiService(
  workspaces: Pick<WorkspaceRegistry, "lookup">,
  options: WikiServiceOptions = {},
): WikiService {
  const rootDir = options.rootDir ?? appDir();

  const openScope = (scope: WorkspaceId) => {
    // scope 已由 RPC 契约的 WorkspaceIdSchema 收窄过形状；这里再闸注册态。
    if (scope !== "~" && workspaces.lookup(scope) === null) {
      throw new DomainError("NOT_FOUND", `Workspace not found: ${scope}`);
    }
    return openWikiWorkspace(wikiScopeDirectory(rootDir, parseWikiScope(scope)));
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
        // origin 落 scope 足迹：global 追加记 "~"，workspace 追加记 ws_*。
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
