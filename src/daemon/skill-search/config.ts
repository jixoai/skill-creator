/**
 * 用户原始需求 [2026-09-18]：「一些特殊的文件夹名称不该索引，比如 node_modules/
 * .git/build/dist/target/.cargo/.cache/.npm/__pycache__/tmp/logs/.pnpm-store/.bun/
 * .cargo/.rustup/.local 等。我们应该有一个专门的配置文件可以做这个处理……可以选择
 * 可以注释的配置格式，比如 jsonc 或者 toml」。
 * 正交意图：
 * 1. search-config.toml 的 server-owned 生命周期（boot 缺失时原子写注释模板）。
 * 2. 外部输入收窄：TOML 文本 → unknown → Zod；语法/结构失败按领域空值（仅内置默认）。
 * 3. 冻结排除清单与 configDigest（进索引信封，变更触发全量重建）。
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { z } from "zod";
import { appDir } from "../../shared/paths.js";
import { safeParseExternal } from "../../shared/external-input.js";
import { atomicWriteUtf8 } from "../path-safety.js";
import { BUILTIN_EXCLUDED_DIRS } from "./content-files.js";
import { SkillSearchIndexError } from "./index.js";

/** 配置文件名（与 search-index.json 同目录：appDir()）。 */
const SEARCH_CONFIG_FILE = "search-config.toml";

/** 模板默认 excludeDirs（用户清单中未被内置清单覆盖的具名目录，显式写出便于理解与追加）。 */
const TEMPLATE_EXCLUDE_DIRS: readonly string[] = [
  ".cargo",
  ".cache",
  ".npm",
  ".pnpm-store",
  ".bun",
  ".rustup",
  ".local",
];

/** 配置文件内容的最小合法形状（未知键 → 解析失败 → 领域空值）。 */
const SearchConfigSchema = z
  .object({
    excludeDirs: z.array(z.string().min(1)).default([]),
  })
  .strict();

/** 收窄后的配置（excludeDirs 已排序去重）。 */
export interface SkillSearchConfig {
  /** 生效排除目录名集合 = 内置 ∪ 配置追加（排序只读数组）。 */
  excludedDirs: readonly string[];
  /** 生效集合的冻结摘要（进索引信封；变更触发全量重建）。 */
  configDigest: string;
}

/** server-owned 配置路径（恒由 appDir() 派生，与测试 setHomeOverride 兼容）。 */
export function searchConfigPath(): string {
  return path.join(appDir(), SEARCH_CONFIG_FILE);
}

/** 注释模板（boot 缺失时原子写出；语义说明写给编辑配置的人）。 */
export function searchConfigTemplate(): string {
  return `# Skill search content configuration (server-owned).
# 技能正文索引会收集技能目录内的其余 *.md；下列目录名不会进入收集
# （在内置清单之上追加，只能增加排除；以 "." 开头的目录始终全跳，
# 内置清单不可移除）。修改后下一次索引维护会自动全量重建。
excludeDirs = [
  ${TEMPLATE_EXCLUDE_DIRS.map((dir) => `"${dir}"`).join(",\n  ")},
]
`;
}

/**
 * 载入配置：缺失 → 原子写模板并按模板默认生效；TOML/Zod 失败 → 领域空值
 * （仅内置默认，不迁移不写回）；读/写 IO 硬错误（EACCES/EIO 等）→
 * SkillSearchIndexError（typed hard error，不伪装成空配置）。
 */
export function loadSkillSearchConfig(): SkillSearchConfig {
  const file = searchConfigPath();
  let source: string;
  try {
    source = fs.readFileSync(file, "utf8");
  } catch (error) {
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
    if (code === "ENOENT") {
      writeTemplate(file);
      return effectiveConfig(TEMPLATE_EXCLUDE_DIRS);
    }
    throw new SkillSearchIndexError(
      `Cannot read the skill search config ${file}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  // TOML 文本是外部输入：parse 结果先入 unknown，再经 Zod 收窄；语法错误或
  // 未知结构按领域空值（仅内置默认）继续，不迁移、不写回、不删除用户文件。
  let raw: unknown;
  try {
    raw = parseToml(source);
  } catch {
    return effectiveConfig([]);
  }
  const parsed = safeParseExternal(SearchConfigSchema, raw);
  return effectiveConfig(parsed ? parsed.excludeDirs : []);
}

/** 组装生效集合（内置 ∪ 追加，排序去重）与冻结摘要。 */
function effectiveConfig(extraDirs: readonly string[]): SkillSearchConfig {
  const merged = [...new Set([...BUILTIN_EXCLUDED_DIRS, ...extraDirs])].sort();
  return { excludedDirs: merged, configDigest: digestOf(merged) };
}

function digestOf(dirs: readonly string[]): string {
  return createHash("sha256").update(dirs.join("\n")).digest("hex");
}

function writeTemplate(file: string): void {
  try {
    atomicWriteUtf8(file, searchConfigTemplate());
  } catch (error) {
    throw new SkillSearchIndexError(
      `Cannot write the skill search config template ${file}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/** 模板自检：模板本身必须能被本模块的解析路径接受（防模板漂移）。 */
export function templateParsesSelf(): boolean {
  let raw: unknown;
  try {
    raw = parseToml(searchConfigTemplate());
  } catch {
    return false;
  }
  return safeParseExternal(SearchConfigSchema, raw) !== null;
}
