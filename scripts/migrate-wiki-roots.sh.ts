/**
 * 用户原始需求 [2026-09-22]（wiki-directory-standard Owner 裁决，tasks 1.2）：
 * 「wiki 从『中央根按名字分目录』改为『目录自身的属性』——存量数据一次性迁入
 * 新址：`~/.skill-wiki/~` 与 `~/.skill-creator/wiki/~` → 新 global；slug 存量经
 * 旧登记表 + registry 映射搬入各 workspace 的 `<dir>/.agents/skill-wiki/`；
 * 冲突保守拒绝并列出，孤儿不自动搬」。
 * 正交意图：
 *   [1] 纯函数迁移面 migrateWikiRoots(options)：三源枚举（中央根 slug/~、
 *       中央根 ws digest、侧车 ws/~）→ 目标占用模拟 → dry-run 计划 / --apply
 *       执行（同卷 rename 优先，EXDEV 回退 cp+rm；目标缺失或空才落位）。
 *   [2] 外部输入收窄：旧登记表 scopes.json 与 registry workspaces.json 均经
 *       zod safeParse，不兼容 → 空表 + notice（孤儿列出，人工处理）。
 *   [3] CLI 适配层：默认根解析（~/.skill-wiki、<appDir>/wiki、globalWikiDirectory），
 *       只读参数 + --apply 才写；报告人类可读输出。
 * 运行：`bun scripts/migrate-wiki-roots.sh.ts`（dry-run）或
 *   `bun scripts/migrate-wiki-roots.sh.ts --apply`；tsx 亦可。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  globalWikiDirectory,
  workspaceWikiDirectory,
} from "../packages/skill-wiki/src/workspace.js";
import { WorkspaceRegistryStateSchema } from "../src/daemon/workspace-registry/state.js";
import { appDir } from "../src/shared/paths.js";

/** 旧 slug 登记表文件形状（scopes.ts 退役前的 v1 契约）。 */
const LegacyScopesFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    assignments: z.record(z.string().min(1).max(128), z.string().min(1)),
  })
  .strict();

/** registry workspace 只读快照（迁移映射只用 id 与 path）。 */
export interface MigrationWorkspace {
  id: string;
  path: string;
}

/** 一次搬移动作（dry-run 计划项 / apply 执行项）。 */
export interface MigrationAction {
  kind: "move";
  /** 源 scope 目录绝对路径。 */
  source: string;
  /** 目标 wiki 目录绝对路径。 */
  target: string;
  /** 源侧 scope 名（"~" / slug / ws id）。 */
  scope: string;
  /** 源布局：中央根（~/.skill-wiki）或旧侧车（<appDir>/wiki）。 */
  sourceLayout: "central-root" | "sidecar";
  /** workspace 项的 registry id（global 无）。 */
  workspaceId?: string;
}

/** 不搬移的条目及其原因（孤儿/冲突/派生物/IO 错误等，全部人工可读）。 */
export interface MigrationNotice {
  kind:
    | "conflict"
    | "orphan"
    | "unknown-workspace"
    | "empty-source"
    | "symlink-source"
    | "derived-leftover"
    | "incompatible-input"
    | "error";
  source: string;
  target?: string;
  detail: string;
}

/** 迁移报告：dry-run 时 actions 为计划；apply 时为已执行（error notice 另计）。 */
export interface MigrationReport {
  actions: MigrationAction[];
  notices: MigrationNotice[];
  applied: boolean;
  /** apply 模式下成功落位的动作数（dry-run 恒 0）。 */
  moved: number;
}

/** 纯函数面选项（测试注入临时根路径；CLI 适配层负责真实默认值）。 */
export interface MigrateWikiRootsOptions {
  /** 旧中央根（slug 布局：`<root>/<slug>/` + `<root>/~/` + scopes.json）。 */
  centralRoot: string;
  /** 旧侧车根（切片②布局：`<appDir>/wiki/<ws id 或 ~>/`）。 */
  sidecarRoot: string;
  /** 新 global wiki 目录（globalWikiDirectory()）。 */
  globalTarget: string;
  /** registry 只读快照（ws id → workspace 目录）。 */
  workspaces: readonly MigrationWorkspace[];
  /** false = dry-run（默认语义由调用方决定；本函数只看该布尔值）。 */
  apply: boolean;
}

const WS_ID_REGEX = /^ws_[a-f0-9]{24}$/;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isENOENT(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

/** 目录条目枚举（ENOENT → null = 源不存在；其余 IO 故障上抛为 notice）。 */
function listDirectoryEntries(directory: string): fs.Dirent[] | null {
  try {
    return fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (isENOENT(error)) return null;
    throw error;
  }
}

/** 目录内容非空判定（ENOENT 视为空）。 */
function directoryHasContent(directory: string): boolean {
  try {
    return fs.readdirSync(directory).length > 0;
  } catch (error) {
    if (isENOENT(error)) return false;
    throw error;
  }
}

/** 读旧 slug 登记表：缺失/不兼容 → null（调用方发 notice，孤儿降级列出）。 */
function readLegacySlugTable(file: string): {
  table: Map<string, string> /* slug -> id */;
  ok: boolean;
} {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (isENOENT(error)) return { table: new Map(), ok: true };
    throw error;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { table: new Map(), ok: false };
  }
  const parsed = LegacyScopesFileSchema.safeParse(json);
  if (!parsed.success) return { table: new Map(), ok: false };
  const slugToId = new Map<string, string>();
  for (const [id, slug] of Object.entries(parsed.data.assignments)) slugToId.set(slug, id);
  return { table: slugToId, ok: true };
}

/** 源 scope 目录 → 目标 wiki 目录（global 或 workspace 同居）。 */
function resolveTarget(
  scope: string,
  slugTable: Map<string, string>,
  workspaces: readonly MigrationWorkspace[],
  globalTarget: string,
): { target: string; workspaceId?: string } | { unresolvable: "orphan" | "unknown-workspace" } {
  if (scope === "~") return { target: globalTarget };
  let id: string | undefined;
  if (WS_ID_REGEX.test(scope)) {
    id = scope;
  } else {
    id = slugTable.get(scope);
    if (id === undefined) return { unresolvable: "orphan" };
  }
  const workspace = workspaces.find((entry) => entry.id === id);
  if (!workspace) return { unresolvable: "unknown-workspace" };
  return { target: workspaceWikiDirectory(workspace.path), workspaceId: workspace.id };
}

/**
 * 执行一次搬移（apply 模式）：同卷 rename 优先，EXDEV 回退 cp + rm；目标空
 * 目录先清；执行期重验占用（并发防护）。失败 → error notice（不中断其余动作）。
 */
function executeMove(action: MigrationAction): MigrationNotice | null {
  try {
    // 执行期重验：目标已非空 = 并发变化 → 保守拒绝。
    if (directoryHasContent(action.target)) {
      return {
        kind: "conflict",
        source: action.source,
        target: action.target,
        detail: "target became non-empty before the move; resolve manually",
      };
    }
    fs.mkdirSync(path.dirname(action.target), { recursive: true });
    if (fs.existsSync(action.target)) fs.rmdirSync(action.target); // 空目录占位
    try {
      fs.renameSync(action.source, action.target);
      return null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
      // 跨卷：复制到目标旁临时目录，rename 落位后删源（临时目录同卷保证原子性）。
      const temp = `${action.target}.migrating-${process.pid}`;
      fs.rmSync(temp, { recursive: true, force: true });
      fs.cpSync(action.source, temp, { recursive: true });
      fs.renameSync(temp, action.target);
      fs.rmSync(action.source, { recursive: true, force: true });
      return null;
    }
  } catch (error) {
    return {
      kind: "error",
      source: action.source,
      target: action.target,
      detail: errorMessage(error),
    };
  }
}

/**
 * 一次性存量迁移（幂等：源缺失/目标已有数据 = no-op 报告）。
 * 源三处：中央根 `~`（global）与 slug/ws_* 目录、旧侧车 `<ws id 或 ~>` 目录；
 * 目标占用先模拟后执行——同目标的第二个源会得到 conflict notice。
 */
export function migrateWikiRoots(options: MigrateWikiRootsOptions): MigrationReport {
  const actions: MigrationAction[] = [];
  const notices: MigrationNotice[] = [];
  /** 模拟占用：已计划落位的目标集合。 */
  const claimedTargets = new Set<string>();
  let moved = 0;

  const slugFile = path.join(options.centralRoot, "scopes.json");
  let slugTable = new Map<string, string>();
  let slugTableOk = true;
  try {
    const table = readLegacySlugTable(slugFile);
    slugTable = table.table;
    slugTableOk = table.ok;
    if (!slugTableOk) {
      notices.push({
        kind: "incompatible-input",
        source: slugFile,
        detail:
          "legacy scopes.json is missing or incompatible; slug directories cannot be mapped " +
          "(listed as orphans — inspect manually)",
      });
    }
  } catch (error) {
    notices.push({ kind: "error", source: slugFile, detail: errorMessage(error) });
  }

  /** 枚举一个源根的 scope 目录并产出动作/notice。 */
  const ingestSourceRoot = (root: string, layout: "central-root" | "sidecar"): void => {
    let entries: fs.Dirent[] | null;
    try {
      entries = listDirectoryEntries(root);
    } catch (error) {
      notices.push({ kind: "error", source: root, detail: errorMessage(error) });
      return;
    }
    if (entries === null) return; // 源不存在 = 无存量。
    let rootStat: fs.Stats;
    try {
      rootStat = fs.lstatSync(root);
    } catch {
      return;
    }
    if (rootStat.isSymbolicLink()) {
      // wiki-root-migration 时代的兼容 symlink：数据已在中央根，本体无存量可迁。
      notices.push({
        kind: "symlink-source",
        source: root,
        detail:
          "compat symlink from the unified-root era; data already lives in its target — remove manually",
      });
      return;
    }
    for (const entry of entries) {
      if (entry.name === "scopes.json" || !entry.isDirectory()) continue; // 文件跳过（登记表另判）。
      if (entry.name === "search-index") {
        notices.push({
          kind: "derived-leftover",
          source: path.join(root, entry.name),
          detail:
            "similarity index is a derived artifact; it rebuilds on demand at the new location",
        });
        continue;
      }
      const source = path.join(root, entry.name);
      const resolved = resolveTarget(
        entry.name,
        slugTable,
        options.workspaces,
        options.globalTarget,
      );
      if ("unresolvable" in resolved) {
        notices.push({
          kind: resolved.unresolvable,
          source,
          detail:
            resolved.unresolvable === "orphan"
              ? `slug directory "${entry.name}" has no legacy registry mapping; migrate manually`
              : `workspace ${entry.name} is not registered anymore; re-import it or migrate manually`,
        });
        continue;
      }
      const target = resolved.target;
      const action: MigrationAction = {
        kind: "move",
        source,
        target,
        scope: entry.name,
        sourceLayout: layout,
        ...(resolved.workspaceId !== undefined ? { workspaceId: resolved.workspaceId } : {}),
      };
      if (!directoryHasContent(source)) {
        notices.push({
          kind: "empty-source",
          source,
          target,
          detail: "source scope directory is empty; nothing to migrate",
        });
        continue;
      }
      if (claimedTargets.has(target) || directoryHasContent(target)) {
        // 目标已有数据（含同轮已计划落位）：保守拒绝，不覆盖任何一边。
        notices.push({
          kind: "conflict",
          source,
          target,
          detail: "target wiki directory already holds data; merge one side manually, then retry",
        });
        continue;
      }
      claimedTargets.add(target);
      actions.push(action);
    }
  };

  // 中央根先于侧车：中央根是较新布局，持有最新数据；同目标冲突时侧车让位。
  ingestSourceRoot(options.centralRoot, "central-root");
  ingestSourceRoot(options.sidecarRoot, "sidecar");

  if (options.apply) {
    for (const action of actions) {
      const failure = executeMove(action);
      if (failure === null) moved += 1;
      else notices.push(failure);
    }
  }

  return {
    actions,
    notices,
    applied: options.apply,
    moved,
  };
}

/* ------------------------------ CLI adapter ------------------------------ */

/** 只读解析 registry workspaces.json（缺失/不兼容 → 空表 + stderr 提示）。 */
function readRegistryWorkspaces(file: string): MigrationWorkspace[] {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (isENOENT(error)) return [];
    throw error;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }
  const parsed = WorkspaceRegistryStateSchema.safeParse(json);
  return parsed.success
    ? parsed.data.workspaces.map((workspace) => ({ id: workspace.id, path: workspace.path }))
    : [];
}

function printReport(report: MigrationReport, out: (text: string) => void): number {
  out(
    report.applied
      ? `wiki roots migration (apply): moved ${report.moved} of ${report.actions.length} planned action(s)`
      : "wiki roots migration (dry-run) — pass --apply to execute the plan below",
  );
  if (report.actions.length > 0) {
    out("");
    out(report.applied ? "moved:" : "plan:");
    for (const action of report.actions) {
      out(`  ${action.source} -> ${action.target}`);
    }
  }
  if (report.notices.length > 0) {
    out("");
    out("notices:");
    for (const notice of report.notices) {
      out(`  [${notice.kind}] ${notice.source}${notice.target ? ` -> ${notice.target}` : ""}`);
      out(`    ${notice.detail}`);
    }
  }
  const failures = report.notices.filter((notice) => notice.kind === "error").length;
  return failures > 0 ? 1 : 0;
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fs.realpathSync(path.resolve(entry)) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

function main(argv: readonly string[]): number {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--apply") flags.add("apply");
    else if (
      token === "--central-root" ||
      token === "--sidecar-root" ||
      token === "--global-target"
    ) {
      const value = argv[index + 1];
      if (value === undefined) {
        process.stderr.write(`migrate-wiki-roots: ${token} requires a value\n`);
        return 2;
      }
      values.set(token, value);
      index += 1;
    } else if (token === "--help" || token === "-h") {
      process.stdout.write(
        [
          "usage: bun scripts/migrate-wiki-roots.sh.ts [--apply] [--central-root <dir>] [--sidecar-root <dir>] [--global-target <dir>]",
          "",
          "One-time migration to the wiki directory standard (2026-09-22):",
          "  ~/.skill-wiki/~            -> global wiki directory (SKILL_WIKI_HOME > ~/.agents/skill-wiki)",
          "  ~/.skill-wiki/<slug>/      -> <workspace>/.agents/skill-wiki/ (via legacy scopes.json + registry)",
          "  ~/.skill-creator/wiki/<ws|~>/ -> same targets (slice-2 sidecar layout)",
          "",
          "Default is a dry-run (plan only). --apply executes it; conflicting targets are",
          "refused conservatively and orphan slug directories are listed for manual handling.",
          "",
        ].join("\n"),
      );
      return 0;
    } else {
      process.stderr.write(`migrate-wiki-roots: unknown argument: ${token}\n`);
      return 2;
    }
  }

  const registryFile = path.join(appDir(), "workspaces.json");
  const workspaces = readRegistryWorkspaces(registryFile);
  const report = migrateWikiRoots({
    centralRoot: values.get("--central-root") ?? path.join(os.homedir(), ".skill-wiki"),
    sidecarRoot: values.get("--sidecar-root") ?? path.join(appDir(), "wiki"),
    globalTarget: values.get("--global-target") ?? globalWikiDirectory(),
    workspaces,
    apply: flags.has("apply"),
  });
  return printReport(report, (text) => process.stdout.write(`${text}\n`));
}

if (isMainModule()) {
  process.exit(main(process.argv.slice(2)));
}
