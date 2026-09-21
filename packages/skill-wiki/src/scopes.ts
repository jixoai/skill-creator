/**
 * 用户原始需求 [2026-09-21]（jixoai-search-core 终审 P1-1 处置）：「slug 分配
 * 必须持久化——registry 顺序的纯函数会让 forget 后的存活 workspace 顶替裸名，
 * 读写他人遗留的 wiki 目录」（codex 探针实证：A/B 同 label，forget A 后 B
 * 解析为裸名并读到 A 的 pattern）。
 * 正交意图：
 *   [1] <wikiRoot>/scopes.json 登记表生命周期：v1 strict zod 收窄读取
 *       （ENOENT → 空表；不兼容/损坏 → typed 拒绝提示人工检查，不写回、
 *       绝不清既有 scope 目录）；分配先原子持久化（同目录 tmp + rename）
 *       后使用。
 *   [2] 分配算法：登记表命中即复用（同 key re-import 不换名；forget 不释放
 *       ——目录与数据留作恢复）；裸 slug 无人占用（登记表值 ∪ 现存 scope
 *       目录名）→ 裸名；被占 → base-<disambiguator>；仍占 → typed 冲突
 *       （极端，人工改 label）。
 * 妥协声明：登记表缺席但现存 scope 目录时，目录名仍视为已占用（保守方向：
 *   宁可让新分配带后缀，也不让任何 workspace 静默领养无法证明归属的目录；
 *   孤儿目录的人工认领不在库语义内——按现存目录回填 id→slug 不可行，id
 *   无法从目录名恢复）。
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { SkillWikiError } from "./schema.js";
import { SLUG_SCOPE_REGEX } from "./workspace.js";

/** 登记表结构版本（不兼容 → 整表 typed 拒绝，不做迁移）。 */
const SCOPES_SCHEMA_VERSION = 1;

/** label 的 slug 裁剪上限（与 pattern 文件名 slugify 同口径）。 */
const LABEL_SLUG_MAX = 48;

/** 登记表文件形状（外部输入边界：strict 收窄）。 */
const ScopesFileSchema = z
  .object({
    schemaVersion: z.literal(SCOPES_SCHEMA_VERSION),
    assignments: z.record(z.string().min(1).max(128), z.string().regex(SLUG_SCOPE_REGEX)),
  })
  .strict();

function scopesFile(wikiRoot: string): string {
  return path.join(wikiRoot, "scopes.json");
}

function isENOENT(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function registryError(message: string, options?: { cause?: unknown }): SkillWikiError {
  return new SkillWikiError("WIKI_SCOPE_REGISTRY", message, options);
}

/**
 * label → slug 基名（确定性纯函数）：小写、非法字符→-、压缩、裁剪到 48、去尾
 * 连字符；空结果回退 "ws"（workspace 语义）。输出恒满足 SLUG_SCOPE_REGEX。
 */
export function scopeSlugBase(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, LABEL_SLUG_MAX)
    .replace(/-+$/g, "");
  return slug === "" ? "ws" : slug;
}

/** scope slug 分配登记表（懒加载；进程内单实例由装配方保证）。 */
export interface ScopeSlugRegistry {
  /**
   * 为稳定 key 分配 slug（幂等）：登记表命中即复用（label 改名不换名）；否则
   * 按裸名 → 后缀名分配，先原子持久化后返回。disambiguator 必须使后缀结果
   * 仍是合法 scope slug；裸名与后缀名均被占 → WIKI_SCOPE_CONFLICT。
   */
  assign(input: { key: string; label: string; disambiguator: string }): string;
}

/**
 * 打开 <wikiRoot>/scopes.json 登记表（惰性加载：首次 assign 才读盘）。
 * wikiRoot 概念在库（defaultWikiRoot），登记表随库走——daemon 与未来 CLI
 * 复用同一分配真相。
 */
export function openScopeSlugRegistry(wikiRoot: string): ScopeSlugRegistry {
  let loaded = false;
  let assignments = new Map<string, string>();

  const load = (): void => {
    if (loaded) return;
    const file = scopesFile(wikiRoot);
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch (error) {
      if (isENOENT(error)) {
        loaded = true; // 缺失 = 全新登记表（空表起步）。
        return;
      }
      throw registryError(`Cannot read the wiki scope registry ${file}: ${errorMessage(error)}`, {
        cause: error,
      });
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (error) {
      throw registryError(
        `The wiki scope registry is not valid JSON; inspect ${file} manually ` +
          `(no scope directory was touched)`,
        { cause: error },
      );
    }
    const parsed = ScopesFileSchema.safeParse(json);
    if (!parsed.success) {
      throw registryError(
        `The wiki scope registry is incompatible; inspect ${file} manually ` +
          `(no scope directory was touched)`,
      );
    }
    assignments = new Map(Object.entries(parsed.data.assignments));
    loaded = true;
  };

  /** 现存占用集合：登记表值 ∪ <wikiRoot>/ 下合法 slug 形状的目录名。 */
  const claimedSlugs = (): Set<string> => {
    const claimed = new Set(assignments.values());
    try {
      for (const entry of fs.readdirSync(wikiRoot, { withFileTypes: true })) {
        if (entry.isDirectory() && SLUG_SCOPE_REGEX.test(entry.name)) claimed.add(entry.name);
      }
    } catch (error) {
      if (!isENOENT(error)) {
        throw registryError(`Cannot list the wiki root ${wikiRoot}: ${errorMessage(error)}`, {
          cause: error,
        });
      }
    }
    return claimed;
  };

  /** 登记表原子落盘（同目录 tmp + rename；先持久化后使用）。 */
  const persist = (next: Map<string, string>): void => {
    const file = scopesFile(wikiRoot);
    const payload = JSON.stringify({
      schemaVersion: SCOPES_SCHEMA_VERSION,
      assignments: Object.fromEntries(
        [...next].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
      ),
    });
    const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
    try {
      fs.mkdirSync(wikiRoot, { recursive: true });
      fs.writeFileSync(temp, `${payload}\n`, "utf8");
      fs.renameSync(temp, file);
    } catch (error) {
      throw registryError(
        `Cannot persist the wiki scope registry ${file}: ${errorMessage(error)}`,
        { cause: error },
      );
    }
  };

  return {
    assign({ key, label, disambiguator }) {
      load();
      // 命中即复用：同 key（含 forget 后 re-import、label 改名）不换名。
      const existing = assignments.get(key);
      if (existing !== undefined) return existing;
      const base = scopeSlugBase(label);
      const claimed = claimedSlugs();
      let slug: string;
      if (!claimed.has(base)) {
        slug = base;
      } else {
        const suffixed = `${base}-${disambiguator}`;
        if (!SLUG_SCOPE_REGEX.test(suffixed)) {
          throw new SkillWikiError(
            "WIKI_INVALID_SCOPE",
            `Disambiguator produces an invalid scope slug: ${suffixed}`,
          );
        }
        if (claimed.has(suffixed)) {
          throw new SkillWikiError(
            "WIKI_SCOPE_CONFLICT",
            `Both "${base}" and "${suffixed}" are already claimed; ` +
              `rename the workspace label to free a slug.`,
          );
        }
        slug = suffixed;
      }
      const next = new Map(assignments);
      next.set(key, slug);
      persist(next);
      assignments = next;
      return slug;
    },
  };
}
