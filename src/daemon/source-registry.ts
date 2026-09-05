/**
 * 用户原始需求 [2026-07-27]：「用户可向 Discover feed 追加自己的 Git URL，跨重启保留」。
 * 正交意图：
 *   [1] 在 daemon 侧持久化用户自定义源（`appDir()/sources.json`，server-owned）。
 *   [2] 读取走 `unknown → Zod safeParse`，schema 不兼容按空值加载（破坏性更新策略）。
 *   [3] 写入经 server-owned atomicWrite + `appDir()` containment 校验；用户源 id 与 curated
 *       命名空间隔离（`user_` 前缀），内置源 id 不可被 remove。
 * 妥协声明：浏览器永远经 `repository.sources.*` RPC 读写，不直接读盘、不写 localStorage。
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CURATED_SOURCES, type CuratedSourceEntry } from "../shared/curated-sources.js";
import {
  AddUserSourceInputSchema,
  SourcesFileSchema,
  UserSourceIdSchema,
  type AddUserSourceInput,
  type SourcesFile,
  type UserSource,
  type UserSourceId,
} from "../shared/contracts/repository.js";
import { safeParseJson } from "../shared/external-input.js";
import { appDir } from "../shared/paths.js";
import { DomainError } from "./domain-error.js";
import { atomicWriteUtf8 } from "./path-safety.js";

const SOURCES_FILE = "sources.json";
const USER_SOURCE_ID_PREFIX = "user_";

/** Source registry 端到端结果。 */
export interface SourceRegistryListing {
  /** 随应用发布的精选源目录（不可被用户删除）。 */
  builtIn: CuratedSourceEntry[];
  /** 用户持久化的自定义源。 */
  user: UserSource[];
}

/** 用户自定义源注册表（daemon-owned）。 */
export interface SourceRegistry {
  /** 返回内置精选源与用户自定义源的合并视图。 */
  list: () => SourceRegistryListing;
  /** 校验并追加一条用户源；gitUrl 不合法或重复时拒绝（不写盘）。 */
  add: (input: AddUserSourceInput) => UserSource;
  /** 按 id 移除用户源；内置源 id 被拒绝。 */
  remove: (id: UserSourceId) => { removed: true };
}

/** 创建一个绑定当前 appDir 的 daemon-owned SourceRegistry。 */
export function createSourceRegistry(): SourceRegistry {
  const file = path.join(appDir(), SOURCES_FILE);
  let state = loadState(file);

  const commit = (next: SourcesFile): void => {
    state = next;
    commitState(file, next);
  };

  return {
    list: () => ({ builtIn: [...CURATED_SOURCES], user: [...state.sources] }),
    add: (input) => {
      const validated = AddUserSourceInputSchema.safeParse(input);
      if (!validated.success) {
        throw new DomainError(
          "INVALID_OPERATION",
          `Invalid user source: ${formatZodError(validated.error)}`,
        );
      }
      const { gitUrl, label, description } = validated.data;
      if (state.sources.some((source) => source.gitUrl === gitUrl)) {
        throw new DomainError("CONFLICT", "This Git URL is already in your sources.");
      }
      const entry: UserSource = {
        id: UserSourceIdSchema.parse(nextUserSourceId(gitUrl)),
        label,
        gitUrl,
        description: description ?? "",
        addedAt: new Date().toISOString(),
      };
      commit({ version: 1, sources: [...state.sources, entry] });
      return entry;
    },
    remove: (id) => {
      const parsed = UserSourceIdSchema.safeParse(id);
      if (!parsed.success) {
        throw new DomainError(
          "INVALID_OPERATION",
          `Invalid user source id: ${formatZodError(parsed.error)}`,
        );
      }
      const remaining = state.sources.filter((source) => source.id !== parsed.data);
      if (remaining.length === state.sources.length) {
        throw new DomainError("NOT_FOUND", `User source not found: ${parsed.data}`);
      }
      commit({ version: 1, sources: remaining });
      return { removed: true as const };
    },
  };
}

/** 从落盘文件加载，缺失或 schema 不兼容返回空状态（破坏性更新策略一致）。 */
function loadState(file: string): SourcesFile {
  if (!fs.existsSync(file)) return emptyState();
  let source: string;
  try {
    source = fs.readFileSync(file, "utf8");
  } catch {
    return emptyState();
  }
  return safeParseJson(source, SourcesFileSchema) ?? emptyState();
}

/** 校验并原子写入落盘（server-owned，atomicWriteUtf8 保证 containment 与 mode）。 */
function commitState(file: string, state: SourcesFile): void {
  const validated = SourcesFileSchema.parse(state);
  atomicWriteUtf8(file, `${JSON.stringify(validated, null, 2)}\n`);
}

function emptyState(): SourcesFile {
  return { version: 1, sources: [] };
}

function nextUserSourceId(gitUrl: string): string {
  // 12 位随机 hex 保证多源命名空间隔离，hash 提供 gitUrl-stable 后缀。
  const digest = createHash("sha256").update(gitUrl).digest("hex").slice(0, 8);
  const random = randomBytes(2).toString("hex");
  return `${USER_SOURCE_ID_PREFIX}${digest}${random}`;
}

function formatZodError(error: {
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>;
}): string {
  return error.issues
    .map((issue) => `${issue.path.map(String).join(".") || "value"}: ${issue.message}`)
    .join("; ");
}
