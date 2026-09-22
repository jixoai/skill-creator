/**
 * 用户原始需求 [2026-09-21]：「workspace 很重要，但我们仍然需要有一个 global 的
 * 概念，global 能承载 workspace 泛化出来的 skill」——daemon 侧双级 wiki 服务。
 * 用户原始需求 [2026-09-22]（wiki-directory-standard Owner 裁决）：「wiki 目录 =
 * <dir>/.agents/skill-wiki/——registry workspace 的 wiki 与 workspace 目录同居；
 * global 是 `~` 特例；slug 映射与侧车迁移机制退役」。
 * 正交意图：
 *   [1] scope 解析 + 注册闸：RPC 契约仍收 WorkspaceId——`~` → globalWikiDirectory()
 *       （SKILL_WIKI_HOME > ~/.agents/skill-wiki，按请求解析以支持测试 env 注入）；
 *       ws_* 必须 registry 已知（轻量 lookup 携带 path，不触发 ccski 扫描），
 *       未注册 → typed NOT_FOUND；已知 → workspaceWikiDirectory(path)。
 *   [2] 委派 skill-wiki 领域库（目录契约/去重/index 重建都在包内）+ 错误映射
 *       （SkillWikiError → DomainError）。origin 足迹：global 记 "~"，workspace
 *       记 registry 持久化的 workspace 目录绝对路径（与库约定一致，可机器解析）。
 *   [3] direct mutation 面（spec 裁决：wiki 追加不走 proposal 审批链）。
 *   [4] scope 索引（wiki.scopes，GUI Wiki 面板 home）：global 恒列 + 全部
 *       registry imported；patternCount 只统计已初始化目录（读面零写副作用——
 *       openWikiWorkspace.listPatterns 会惰性 mkdir patterns，未初始化 scope
 *       不得经 scopes() 被动建目录）。
 */
import fs from "node:fs";
import {
  SkillWikiError,
  countWikiPatterns,
  globalWikiDirectory,
  openWikiWorkspace,
  patternContentHash,
  workspaceWikiDirectory,
  type PatternListItem,
} from "skill-wiki";
import type { WorkspaceId } from "../shared/contracts/workspaces.js";
import { DomainError } from "./domain-error.js";
import type { WorkspaceRegistry } from "./workspace-registry/index.js";
import type { WikiReadResult, WikiScope } from "../shared/contracts/wiki.js";

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
  /** scope 索引：global 恒列 + 全部 registry imported（label/计数/是否已初始化）。 */
  scopes: () => { scopes: WikiScope[] };
}

/**
 * scope → {wiki 目录, workspace 目录}。global（`~`）无 workspace 目录（origin 记
 * "~"）；ws_* 经 registry 解析（path 是 import 时 canonicalize 过的持久身份）。
 */
interface ResolvedWikiScope {
  wikiDirectory: string;
  workspaceDirectory: string | null;
}

/** Create the daemon wiki service bound to one registry. */
export function createWikiService(
  workspaces: Pick<WorkspaceRegistry, "lookup" | "listImported">,
): WikiService {
  const resolveScope = (scope: WorkspaceId): ResolvedWikiScope => {
    if (scope === "~") {
      // 按请求解析（SKILL_WIKI_HOME 可被测试注入；生产 env 在 daemon 生命周期内不变）。
      return { wikiDirectory: globalWikiDirectory(), workspaceDirectory: null };
    }
    // scope 已由 RPC 契约的 WorkspaceIdSchema 收窄过形状；这里再闸注册态。
    const self = workspaces.lookup(scope);
    if (self === null) {
      throw new DomainError("NOT_FOUND", `Workspace not found: ${scope}`);
    }
    return {
      wikiDirectory: workspaceWikiDirectory(self.path),
      workspaceDirectory: self.path,
    };
  };

  const openScope = (scope: WorkspaceId) => openWikiWorkspace(resolveScope(scope).wikiDirectory);

  // 计数走只读投影（codex r1 P1）：countWikiPatterns 不触发 patterns/ 惰性
  // mkdir——「root 存在但 patterns 缺失」的部分初始化目录在 scopes() 下零写。
  const scopeProjection = (id: WorkspaceId, label: string, wikiDirectory: string): WikiScope => ({
    id,
    label,
    exists: fs.existsSync(wikiDirectory),
    patternCount: countWikiPatterns(wikiDirectory),
  });

  return {
    scopes() {
      // global 恒列（首位）；registry imported 按注册序跟随（label 来自持久化身份）。
      const scopes: WikiScope[] = [scopeProjection("~", "Global", globalWikiDirectory())];
      for (const imported of workspaces.listImported()) {
        scopes.push(
          scopeProjection(imported.id, imported.label, workspaceWikiDirectory(imported.path)),
        );
      }
      return { scopes };
    },

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
      const resolved = resolveScope(scope);
      const wiki = openWikiWorkspace(resolved.wikiDirectory);
      try {
        // origin 足迹（目录映射标准）：global 记 "~"，workspace 记其目录绝对路径。
        return wiki.appendPattern({
          ...input,
          origin: resolved.workspaceDirectory ?? "~",
        });
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
