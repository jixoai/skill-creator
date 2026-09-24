/**
 * Skill Steward 不可变上下文快照 builder（openspec skill-steward-runtime task 2.3a）。
 *
 * 用户原始需求 [2026-09-06]（transaction-contract）：「同一次读取的字节计算 revision，
 * 并供 analyzer 和 Agent 使用；禁止 analyze A、复制 B、propose 时观察 C 的隐式重新绑定。」
 * 「总内容最多 2 MiB、每 skill 256 KiB、每 run 100 skills；超过限制明确拒绝。」
 *
 * 正交意图：
 *   [1] 单遍读取：每个技能一次 info（字节 → revision），一次资源清单遍历；
 *       之后 Provider 修改不影响已建立的快照。
 *   [2] 预算强制：超限抛 typed INVALID_OPERATION，绝不静默截断。
 *   [3] 故障区分：读权限/磁盘 I/O 失败是 hard error（UNAVAILABLE），
 *       不能投影成空快照（AGENTS 持久化载入法则）。
 *   [4] 持久化：快照 JSON 原子写入 home 下 steward-store/snapshots/（重启可读）。
 */
import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  SkillStewardContextSnapshotSchema,
  StewardSnapshotIdSchema,
  type AgentRuntimeCapabilities,
  type SkillStewardContextSnapshot,
} from "../../shared/contracts/skill-steward.js";
import { homeDir } from "../../shared/paths.js";
import type { SkillService } from "../skill-service.js";
import { DomainError } from "../domain-error.js";
import type { WorkspaceProviderTarget } from "../../shared/contracts/workspaces.js";
import { GLOBAL_WORKSPACE_ID } from "../../shared/contracts/workspaces.js";
import { atomicWriteUtf8 } from "../path-safety.js";

/** 快照持久化目录（home 下；测试经 setHomeOverride 隔离）。 */
export function stewardStoreDir(): string {
  return path.join(homeDir(), "steward-store");
}

function snapshotsDir(): string {
  return path.join(stewardStoreDir(), "snapshots");
}

/** 枚举技能目录内普通文件（不跟随 symlink；目录外链接不入清单）。 */
async function walkRegularFiles(directory: string): Promise<string[]> {
  const found: string[] = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".SKILL.md" || entry.name.startsWith(".tmp-")) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      // relPath 契约冻结为 `/` 分隔（isSafeRelativePath 拒绝反斜杠）——Windows
      // 的 path.join 产出 `\` 会被自己的契约拒绝（39 个 steward 失败同源于此），
      // 组装边界显式用 `/`。
      found.push(...(await walkRegularFiles(absolute)).map((rel) => `${entry.name}/${rel}`));
      continue;
    }
    if (entry.isFile()) {
      found.push(entry.name);
      continue;
    }
    // symlink / fifo 等不入清单（transaction-contract：不跟随目录外 symlink）。
  }
  return found;
}

/** 计算文件 sha256（资源清单 hash）。 */
async function sha256File(absolute: string): Promise<{ hash: string; byteSize: number }> {
  const bytes = await fs.readFile(absolute);
  return { hash: createHash("sha256").update(bytes).digest("hex"), byteSize: bytes.byteLength };
}

export interface BuildSnapshotInput {
  target: WorkspaceProviderTarget;
  /** 显式技能子集；省略时纳入全部（仍受 100 上限约束）。 */
  skillIds?: string[];
  promptVersion: string;
  toolVersion: string;
  capabilities: AgentRuntimeCapabilities;
}

/** 一次读取构建不可变快照并持久化；任何 I/O 故障都向上抛 typed 错误。 */
export async function buildContextSnapshot(
  skills: SkillService,
  input: BuildSnapshotInput,
): Promise<SkillStewardContextSnapshot> {
  const scopeKind =
    input.target.workspaceId === GLOBAL_WORKSPACE_ID ? ("global" as const) : ("imported" as const);
  let discovered;
  try {
    discovered = await skills.list(input.target);
  } catch (error) {
    throw new DomainError(
      "UNAVAILABLE",
      `Snapshot skill discovery failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const selected = input.skillIds
    ? discovered.filter((skill) => input.skillIds!.includes(skill.id))
    : discovered;
  if (selected.length === 0) {
    throw new DomainError("INVALID_OPERATION", "No skills selected for the steward snapshot.");
  }
  if (selected.length > 100) {
    throw new DomainError(
      "INVALID_OPERATION",
      `Snapshot exceeds the 100-skill budget (${selected.length}); narrow the scope.`,
    );
  }

  // ---- 单遍读取：每个技能一次 info + 一次资源遍历 ----
  const snapshotId = StewardSnapshotIdSchema.parse(`snap_${randomBytes(8).toString("hex")}`);
  const entries: SkillStewardContextSnapshot["skills"] = [];
  const resources: SkillStewardContextSnapshot["resources"] = [];
  let totalBytes = 0;
  for (const skill of selected) {
    let info;
    try {
      info = await skills.info(input.target, skill.id);
    } catch (error) {
      if (error instanceof DomainError && error.code === "NOT_FOUND") {
        // 遍历期间被移除：跳过并在最终空集合时失败。
        continue;
      }
      throw error;
    }
    const byteSize = Buffer.byteLength(info.content, "utf8");
    if (byteSize > 256 * 1024) {
      throw new DomainError(
        "INVALID_OPERATION",
        `Skill ${skill.directoryName} exceeds the 256 KiB content budget (${byteSize} bytes).`,
      );
    }
    totalBytes += byteSize;
    if (totalBytes > 2 * 1024 * 1024) {
      throw new DomainError(
        "INVALID_OPERATION",
        `Snapshot exceeds the 2 MiB total content budget; narrow the scope.`,
      );
    }
    entries.push({
      skillId: skill.id,
      name: info.name,
      directoryName: info.directoryName,
      revision: info.revision,
      disabled: info.disabled,
      content: info.content,
      byteSize,
    });
    try {
      const relFiles = await walkRegularFiles(skill.path);
      for (const rel of relFiles) {
        const { hash, byteSize: resourceBytes } = await sha256File(path.join(skill.path, rel));
        resources.push({
          skillId: skill.id,
          relPath: rel,
          hash,
          byteSize: resourceBytes,
          kind: "file",
        });
      }
    } catch (error) {
      throw new DomainError(
        "UNAVAILABLE",
        `Snapshot resource manifest failed for ${skill.directoryName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (entries.length === 0) {
    throw new DomainError(
      "INVALID_OPERATION",
      "All selected skills disappeared before the snapshot read.",
    );
  }

  const candidate = {
    id: snapshotId,
    createdAt: new Date().toISOString(),
    target: input.target,
    scopeKind,
    skills: entries,
    resources,
    promptVersion: input.promptVersion,
    toolVersion: input.toolVersion,
    capabilities: input.capabilities,
  };
  const parsedSnapshot = SkillStewardContextSnapshotSchema.safeParse(candidate);
  if (!parsedSnapshot.success) {
    // 预算/清单上限命中真实 Provider 规模：类型化拒绝 + 可操作信息（不截断、不裸抛 ZodError）。
    throw new DomainError(
      "INVALID_OPERATION",
      `Snapshot exceeds contract limits (${parsedSnapshot.error.issues[0]?.path.join(".")}: ${parsedSnapshot.error.issues[0]?.message}); narrow the skill scope.`,
    );
  }
  const snapshot = parsedSnapshot.data;

  // ---- 持久化（原子写；故障 hard error，不静默丢快照） ----
  try {
    await fs.mkdir(snapshotsDir(), { recursive: true });
    const file = path.join(snapshotsDir(), `${snapshotId}.json`);
    atomicWriteUtf8(file, JSON.stringify(snapshot, null, 2));
  } catch (error) {
    throw new DomainError(
      "UNAVAILABLE",
      `Snapshot persistence failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return snapshot;
}

/** 重启后按 id 读回快照；文件缺失/不兼容 → null（调用方决定重建）；I/O 故障 → hard error。 */
export async function loadContextSnapshot(
  snapshotId: SkillStewardContextSnapshot["id"],
): Promise<SkillStewardContextSnapshot | null> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(snapshotsDir(), `${snapshotId}.json`), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new DomainError(
      "UNAVAILABLE",
      `Snapshot read failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    // 快照文件损坏（写入中断等）：按领域规则当空值处理。
    return null;
  }
  const parsed = SkillStewardContextSnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
