/**
 * 用户原始需求 [2026-09-30]：「skill-creator 自身也需要暴露更多的 cli 能力……
 * 比如技能的维护、清理和升级 等等」（cli-surface-parity D2）。
 *
 * 正交意图：
 *   [1] 人类可读引用 → opaque 身份的三段解析（workspace / provider / skill），
 *       与 wiki CLI 的 label/ws_id 口径一致；歧义/零匹配列候选并以 exit 2 拒绝。
 */
import fs from "node:fs";
import path from "node:path";
import type { DaemonDomain } from "../daemon/domain.js";
import type { SkillMetadata } from "../shared/contracts/skills.js";
import type { Workspace, WorkspaceProvider } from "../shared/contracts/workspaces.js";

/** 用法错误（exit 2）：引用歧义/零匹配/形状非法。 */
export class CliRefUsageError extends Error {}

function candidates(list: string[]): string {
  return list.length > 0 ? ` candidates: ${list.join(", ")}` : "";
}

/**
 * 解析 workspace 引用：`~` = Global；路径形状（含 `./` 缺省）= realpath 反查
 * 注册表；裸 token = ws_* id 精确 → label 前缀（ci）。
 */
export async function resolveWorkspaceRef(
  domain: DaemonDomain,
  requested: string,
): Promise<Workspace> {
  const trimmed = requested.trim();
  if (trimmed.length === 0 || trimmed.includes("\0")) {
    throw new CliRefUsageError("workspace reference is empty");
  }
  const workspaces = await domain.workspaces.list();
  if (trimmed === "~") {
    const global = workspaces.find((ws) => ws.kind === "global");
    if (!global) throw new CliRefUsageError("global workspace is not projected");
    return global;
  }
  if (
    trimmed === "." ||
    trimmed === ".." ||
    path.isAbsolute(trimmed) ||
    trimmed.includes("/") ||
    trimmed.includes("\\")
  ) {
    let resolved: string;
    try {
      resolved = fs.realpathSync(path.resolve(trimmed));
    } catch (error) {
      throw new CliRefUsageError(
        `cannot resolve workspace path "${trimmed}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    for (const ws of workspaces) {
      if (ws.kind !== "directory") continue;
      let registered: string | null = null;
      try {
        registered = fs.realpathSync(ws.path);
      } catch {
        continue; // 注册目录已消失：可用性由投影呈现，反查跳过
      }
      if (registered === resolved) return ws;
    }
    throw new CliRefUsageError(
      `"${trimmed}" is not a registered imported workspace (register it in the Workspaces app, ` +
        "or address it by label/ws_* id)",
    );
  }
  const idMatches = workspaces.filter((ws) => ws.id === trimmed);
  if (idMatches.length > 0) return idMatches[0];
  const prefixMatches = workspaces.filter((ws) =>
    ws.label.toLowerCase().startsWith(trimmed.toLowerCase()),
  );
  if (prefixMatches.length === 1) return prefixMatches[0];
  if (prefixMatches.length > 1) {
    throw new CliRefUsageError(
      `ambiguous workspace "${trimmed}":${candidates(
        prefixMatches.map((ws) => `"${ws.label}" (${ws.id})`),
      )}`,
    );
  }
  throw new CliRefUsageError(
    `no workspace matches "${trimmed}".${candidates(workspaces.map((ws) => ws.id))}` +
      ' (use a path, "~" for global, or a label/ws_* id)',
  );
}

/** 解析 provider 引用（在该 workspace 的 provider 集内）：id 精确 → label 前缀（ci）。 */
export function resolveProviderRef(workspace: Workspace, requested: string): WorkspaceProvider {
  const trimmed = requested.trim();
  if (trimmed.length === 0 || trimmed.includes("\0")) {
    throw new CliRefUsageError("provider reference is empty");
  }
  const exact = workspace.providers.find((p) => p.id === trimmed);
  if (exact) return exact;
  const prefixMatches = workspace.providers.filter((p) =>
    p.label.toLowerCase().startsWith(trimmed.toLowerCase()),
  );
  if (prefixMatches.length === 1) return prefixMatches[0];
  if (prefixMatches.length > 1) {
    throw new CliRefUsageError(
      `ambiguous provider "${trimmed}" in ${workspace.label}:${candidates(
        prefixMatches.map((p) => `"${p.label}" (${p.id})`),
      )}`,
    );
  }
  throw new CliRefUsageError(
    `no provider matches "${trimmed}" in ${workspace.label}.${candidates(
      workspace.providers.map((p) => p.id),
    )}`,
  );
}

/**
 * 在已发现的技能集合内解析引用序列：name 精确（ci）→ directoryName 精确 →
 * sk_ id 精确；逐个解析，任一失败即整批拒绝（不部分执行 mutation）。
 */
export function resolveSkillRefs(discovered: SkillMetadata[], refs: string[]): SkillMetadata[] {
  if (refs.length === 0) throw new CliRefUsageError("no skill reference given");
  return refs.map((ref) => {
    const trimmed = ref.trim();
    if (trimmed.length === 0) throw new CliRefUsageError("skill reference is empty");
    const byName = discovered.filter((s) => s.name.toLowerCase() === trimmed.toLowerCase());
    if (byName.length === 1) return byName[0];
    if (byName.length > 1) {
      throw new CliRefUsageError(
        `ambiguous skill "${ref}":${candidates(byName.map((s) => `"${s.name}" (${s.id})`))}`,
      );
    }
    const byDir = discovered.filter((s) => s.directoryName === trimmed);
    if (byDir.length === 1) return byDir[0];
    const byId = discovered.filter((s) => s.id === trimmed);
    if (byId.length === 1) return byId[0];
    throw new CliRefUsageError(
      `no skill matches "${ref}" in this provider.${candidates(discovered.map((s) => s.name))}`,
    );
  });
}
