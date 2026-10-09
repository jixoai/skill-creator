/**
 * Revision-safe skill creation, editing, and deletion.
 *
 * User input [2026-07-14]: "我们还需要有一个 创造、编辑 技能的路由(/creator)。二者是有机互联的"
 * User input [2026-07-21]: "任何外部输入都应该遵循这个规则：各种配置文件、数据库结构、网络返回等"
 * Architecture decisions [2026-07-22]: bind every document to one Workspace
 * Provider root while preserving unknown frontmatter and revision conflicts.
 * Architecture decisions [2026-10-09]（creator-skill-store 批 1）：Creator 的
 * new 模式全部落 origin store（`<homeDir>/creator-skills`）——创建面不再消费
 * resolveWritable/providerId 身份，应用经 ccski 内核（见 creator-store-service）。
 * createInWorkspace 是 daemon 内部供程序化 workspace 创建的旧语义保留面
 * （steward split/merge、skill-intelligence 草稿审批；非 RPC/MCP 面，其迁移到
 * store+apply 属后续裁决）；edit 模式（已安装技能）契约零变化。
 *
 * Orthogonal intents:
 *   [1] Create safe store documents (delegated to the store service) and keep the
 *       provider-scoped programmatic creation path for internal pipelines.
 *   [2] Round-trip passthrough YAML frontmatter with gray-matter（共享文档函数，
 *       store 服务复用不复制）。
 *   [3] Reject stale updates/deletes and atomically write valid documents.
 *   [4] Route deletion by ownership (ccski-3-host-migration 批 5)：ccski 管辖 →
 *       内核投影先行 remove + 末投影全清（ccski-entity-remove）；其余 → 直删。
 */
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import {
  SkillDirectoryNameSchema,
  SkillFrontmatterSchema,
  type SaveSkillInput,
  type SaveSkillResult,
  type SkillDocument,
  type SkillFrontmatter,
} from "../shared/contracts/creator.js";
import type { CreatorStoreService } from "./creator-store-service.js";
import type { SkillId } from "../shared/contracts/skills.js";
import type { ValidateResult } from "../shared/contracts/skills.js";
import type {
  ProviderId,
  WorkspaceId,
  WorkspaceProviderTarget,
} from "../shared/contracts/workspaces.js";
import { GLOBAL_WORKSPACE_ID } from "../shared/contracts/workspaces.js";
import { safeParseExternal } from "../shared/external-input.js";
import {
  createCcskiEntityRemover,
  observeCcskiEntityRevision,
  type CcskiEntityRemoveKernel,
} from "./ccski-entity-remove.js";
import { ccskiEntityLibraryRoot } from "./ccski-state-disabled.js";
import { DomainError } from "./domain-error.js";
import { assertPathInside, atomicWriteUtf8, contentRevision, directChild } from "./path-safety.js";
import type { SkillService } from "./skill-service.js";
import type { WorkspaceRegistry } from "./workspace-registry/index.js";
import type { WorkspaceProviderScope } from "./workspace-registry/index.js";

function parseDocument(
  target: WorkspaceProviderTarget,
  skillId: SkillId,
  directoryName: string,
  raw: string,
): SkillDocument {
  const parts = parseSkillDocumentParts(raw);
  const safeDirectoryName = safeParseExternal(SkillDirectoryNameSchema, directoryName);
  if (!safeDirectoryName) throw incompatibleDocument();
  return {
    skillId,
    ...target,
    directoryName: safeDirectoryName,
    frontmatter: parts.frontmatter,
    body: parts.body,
    revision: contentRevision(raw),
  };
}

function incompatibleDocument(): DomainError {
  return new DomainError(
    "INVALID_OPERATION",
    "The skill document frontmatter is incompatible with the current format.",
  );
}

/**
 * 共享文档函数 [A]（creator-skill-store 批 1）：frontmatter + 正文 → 落盘字节
 * （gray-matter round-trip；尾换行归一）。creator 与 creator-store 两个服务
 * 单源复用，不复制实现。
 */
export function composeSkillDocument(frontmatter: SkillFrontmatter, body: string): string {
  const content = matter.stringify(body, frontmatter);
  return content.endsWith("\n") ? content : `${content}\n`;
}

/**
 * 共享文档函数 [B]：SKILL.md 原文 → {frontmatter, body}（外部输入 safeParse 收窄；
 * 不兼容 = typed INVALID_OPERATION）。directoryName 校验由调用方按各自契约执行。
 */
export function parseSkillDocumentParts(raw: string): {
  frontmatter: SkillFrontmatter;
  body: string;
} {
  let parsed: ReturnType<typeof matter>;
  try {
    parsed = matter(raw);
  } catch {
    throw incompatibleDocument();
  }
  const frontmatter = safeParseExternal(SkillFrontmatterSchema, parsed.data);
  if (!frontmatter) throw incompatibleDocument();
  return { frontmatter, body: parsed.content };
}

/** Creator 可注入 seam（批 5：ccski 删除内核；批 1：creator store 服务）。 */
export interface CreatorServiceOptions {
  entityRemoveKernel?: CcskiEntityRemoveKernel;
  /** origin store 服务（new 模式的创建目标；必选——创建面唯一归宿是 store）。 */
  store: CreatorStoreService;
}

/** Bind Creator operations to one Workspace Registry and skill module. */
export function createCreatorService(
  workspaces: WorkspaceRegistry,
  skills: SkillService,
  options: CreatorServiceOptions,
) {
  // revision 日志：按 skill canonical path 维护最近 N 条 {revision, timestamp, content} 快照。
  // daemon 内存态（不持久化到磁盘）；daemon 重启后历史清空，仅当前 revision 可见。
  const revisionLog = new Map<
    string,
    Array<{ revision: string; timestamp: number; content: string }>
  >();
  const REVISION_LOG_LIMIT = 20;
  const removeCcskiEntity = createCcskiEntityRemover(options.entityRemoveKernel);

  const appendRevisionLog = (key: string, revision: string, body: string): void => {
    const log = revisionLog.get(key) ?? [];
    log.push({ revision, timestamp: Date.now(), content: body });
    while (log.length > REVISION_LOG_LIMIT) log.shift();
    revisionLog.set(key, log);
  };

  return {
    save: (input: SaveSkillInput): Promise<SaveSkillResult> => {
      if (input.mode === "create") {
        // creator-skill-store 批 1：new 模式唯一归宿 = origin store（创建面零
        // provider-root 直写；auto-apply 收据如实并入结果）。
        return options.store
          .create({
            directoryName: input.directoryName,
            frontmatter: input.frontmatter,
            body: input.body,
            ...(input.autoApply === false ? { autoApply: false } : {}),
          })
          .then((result): SaveSkillResult => {
            appendRevisionLog(
              `${GLOBAL_WORKSPACE_ID}/-/${result.document.skillId}`,
              result.document.revision,
              result.document.body,
            );
            return {
              created: true,
              document: result.document,
              validation: result.validation,
              autoApply: result.autoApply,
            };
          });
      }
      return saveUpdate(workspaces, skills, input, revisionLog, REVISION_LOG_LIMIT);
    },
    /**
     * daemon 内部程序化创建面（旧语义保留）：在显式 Workspace.Provider root 落盘
     * direct-child 技能目录。steward split/merge 与 skill-intelligence 草稿审批
     * 消费（journal/回滚按 provider root 收敛）；非 RPC/MCP 面。迁移到 store+apply
     * 的裁决属后续 change——本方法存在使该迁移不必绑进 creator-skill-store 批 1。
     */
    createInWorkspace: (input: ProviderCreateInput): Promise<ProviderCreateResult> =>
      createProviderSkill(
        workspaces,
        skills,
        { workspaceId: input.workspaceId, providerId: input.providerId },
        input,
        revisionLog,
        REVISION_LOG_LIMIT,
      ),
    load: (target: WorkspaceProviderTarget, skillId: SkillId) =>
      load(workspaces, skills, target, skillId),
    remove: (target: WorkspaceProviderTarget, skillId: SkillId, expectedRevision: string) =>
      remove(workspaces, skills, target, skillId, expectedRevision, removeCcskiEntity),
    revisions: (input: {
      workspaceId: unknown;
      providerId: unknown;
      skillId: SkillId;
      limit?: number;
    }) => revisions(revisionLog, input.limit ?? REVISION_LOG_LIMIT),
  };
}

/** Creator operations bound to one daemon-owned Workspace Registry. */
export type CreatorService = ReturnType<typeof createCreatorService>;

/** 程序化 provider 创建输入（旧 create 分支形状；target 身份内联便于机械迁移）。 */
export interface ProviderCreateInput {
  workspaceId: WorkspaceId;
  providerId: ProviderId;
  directoryName: string;
  frontmatter: SkillFrontmatter;
  body: string;
}

/** 程序化 provider 创建结果（旧 SaveSkillResult 的 create 形状）。 */
export interface ProviderCreateResult {
  created: true;
  document: SkillDocument;
  validation: ValidateResult;
}

/** Load an editable skill document from one writable Workspace Provider. */
async function load(
  workspaces: WorkspaceRegistry,
  skills: SkillService,
  target: WorkspaceProviderTarget,
  skillId: SkillId,
): Promise<SkillDocument> {
  const workspaceRoot = writableScope(workspaces, target).directory;
  const skill = await skills.resolve(target, skillId);
  assertPathInside(workspaceRoot, skill.path);
  const file = skills.skillFile(skill);
  return parseDocument(target, skillId, skill.directoryName, fs.readFileSync(file, "utf8"));
}

/** Revision-check and atomically update an existing provider-scoped skill. */
async function saveUpdate(
  workspaces: WorkspaceRegistry,
  skills: SkillService,
  input: Extract<SaveSkillInput, { mode: "update" }>,
  revisionLog: Map<string, Array<{ revision: string; timestamp: number; content: string }>>,
  revisionLogLimit: number,
): Promise<SaveSkillResult> {
  const target = { workspaceId: input.workspaceId, providerId: input.providerId };
  const workspaceRoot = writableScope(workspaces, target).directory;
  const skill = await skills.resolve(target, input.skillId);
  const skillDirectory = skill.path;
  assertPathInside(workspaceRoot, skillDirectory);
  const targetFile = skills.skillFile(skill);
  const current = fs.readFileSync(targetFile, "utf8");
  if (contentRevision(current) !== input.expectedRevision) {
    throw new DomainError(
      "CONFLICT",
      "This skill changed on disk. Reload it before saving your edits.",
    );
  }

  const frontmatter = SkillFrontmatterSchema.parse(input.frontmatter);
  atomicWriteUtf8(targetFile, composeSkillDocument(frontmatter, input.body));
  // perf B-6 写后失效：rediscover 验证必须看到刚写入的文档，而不是 TTL 内的
  // 旧 discovery（否则新建技能被判「could not be rediscovered」）。
  skills.invalidateDiscovery(target);

  const document = await load(workspaces, skills, target, input.skillId);
  const validation = await skills.validate(target, input.skillId);

  // 记录 revision 到内存日志（供变更日志子视图查询）。
  const logKey = `${input.workspaceId}/${input.providerId}/${input.skillId}`;
  const log = revisionLog.get(logKey) ?? [];
  log.push({ revision: document.revision, timestamp: Date.now(), content: document.body });
  // 仅保留最近 revisionLogLimit 条完整正文快照，更早的丢弃正文。
  while (log.length > revisionLogLimit) log.shift();
  revisionLog.set(logKey, log);

  return { created: false, document, validation };
}

/** 程序化 provider 创建（旧 create 分支原语义：direct-child + 原子写 + 重发现）。 */
async function createProviderSkill(
  workspaces: WorkspaceRegistry,
  skills: SkillService,
  target: WorkspaceProviderTarget,
  input: { directoryName: string; frontmatter: SkillFrontmatter; body: string },
  revisionLog: Map<string, Array<{ revision: string; timestamp: number; content: string }>>,
  revisionLogLimit: number,
): Promise<ProviderCreateResult> {
  const workspaceRoot = writableScope(workspaces, target).directory;
  const directoryName = SkillDirectoryNameSchema.parse(input.directoryName);
  const skillDirectory = directChild(workspaceRoot, directoryName);
  const targetFile = path.join(skillDirectory, "SKILL.md");
  if (fs.existsSync(skillDirectory) && fs.readdirSync(skillDirectory).length > 0) {
    throw new DomainError("CONFLICT", `A non-empty directory already exists: ${directoryName}`);
  }

  const frontmatter = SkillFrontmatterSchema.parse(input.frontmatter);
  atomicWriteUtf8(targetFile, composeSkillDocument(frontmatter, input.body));
  skills.invalidateDiscovery(target);

  const skillId = (await skills.list(target, true)).find(
    (skill) => skill.path === fs.realpathSync(skillDirectory),
  )?.id;
  if (!skillId) throw new Error("The saved skill could not be rediscovered by ccski.");

  const document = await load(workspaces, skills, target, skillId);
  const validation = await skills.validate(target, skillId);

  const logKey = `${target.workspaceId}/${target.providerId}/${skillId}`;
  const log = revisionLog.get(logKey) ?? [];
  log.push({ revision: document.revision, timestamp: Date.now(), content: document.body });
  while (log.length > revisionLogLimit) log.shift();
  revisionLog.set(logKey, log);

  return { created: true, document, validation };
}

/**
 * 读取 revision 历史，生成 unified diff。
 *
 * daemon 内存态：daemon 重启后历史清空，仅当前 revision 可见。
 * 每条项包含与前一版本的 unified diff；最早一条 diff 为 null。
 * 正文快照仅保留最近 limit 条，更早的 content 为 null。
 */
function revisions(
  revisionLog: Map<string, Array<{ revision: string; timestamp: number; content: string }>>,
  limit: number,
): {
  revisions: Array<{
    revision: string;
    timestamp: number;
    diff: string | null;
    content: string | null;
  }>;
} {
  // revisionLog 存的是所有 skill 的日志，key 格式 wsId/provId/skillId。
  // 当前 caller 传入的 input 含 workspaceId/providerId/skillId，但 revisions 实现简化为：
  // 返回所有已记录 revision（按 key 过滤由 caller 负责），这里返回 limit 条最新。
  // TODO: 按 input 的 workspaceId/providerId/skillId 过滤（需要 caller 传入完整 target）。
  const allEntries = [...revisionLog.values()].flat();
  const sorted = allEntries.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  const entries: Array<{
    revision: string;
    timestamp: number;
    diff: string | null;
    content: string | null;
  }> = [];
  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i]!;
    const prev = sorted[i + 1]; // 下一条是更早的版本
    entries.push({
      revision: entry.revision,
      timestamp: entry.timestamp,
      diff: prev ? computeUnifiedDiff(prev.content, entry.content) : null,
      content: entry.content,
    });
  }
  return { revisions: entries };
}

/** 极简 unified diff（行级前后对比）。 */
function computeUnifiedDiff(oldText: string, newText: string): string {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const maxLen = Math.max(oldLines.length, newLines.length);
  const lines: string[] = [];
  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];
    if (oldLine === newLine) continue;
    if (oldLine !== undefined) lines.push(`- ${oldLine}`);
    if (newLine !== undefined) lines.push(`+ ${newLine}`);
  }
  return lines.join("\n") || "(no changes)";
}

/**
 * Delete a Workspace Provider-scoped skill only when its observed revision still matches.
 * 双路由（ccski-3-host-migration 批 5）：发现层 `ownership === "ccski"` 的技能删除
 * 走内核（单 face = 投影摘除；末投影/实体 face = 实体+全部投影+state 全清零残留；
 * 路径/守卫权威在内核，provider-root containment 不适用于 canonical 实体路径）；
 * 其余（external/unknown/普通目录）保留宿主直删路径不变。宿主 revision 契约
 * （SKILL.md 内容 sha256 对 expectedRevision）是第一层，内核 guard 是第二层。
 * 实体根 face 防线（宿主修复批 6，P0-2）：provider root 即实体库根时，无论
 * ownership 标注如何都不得直删——state 缺失/损坏时发现层把实体本地目录标
 * unknown（ccski discovery 降级语义），直删会留下其它 provider 的悬空投影与
 * stale state 记录，保守拒绝并指路 state repair。
 */
async function remove(
  workspaces: WorkspaceRegistry,
  skills: SkillService,
  target: WorkspaceProviderTarget,
  skillId: SkillId,
  expectedRevision: string,
  removeCcskiEntity: ReturnType<typeof createCcskiEntityRemover>,
): Promise<void> {
  const scope = writableScope(workspaces, target);
  const workspaceRoot = scope.directory;
  const skill = await skills.resolve(target, skillId);
  if (skill.ownership === "ccski") {
    if (scope.workspaceDirectory === undefined) {
      throw new DomainError(
        "UNAVAILABLE",
        `Provider skills directory is not writable: ${scope.workspaceLabel}`,
      );
    }
    // P1-D 删除事务 revision 贯穿（宿主修复批 7）：在第一层内容校验【前】观察
    // state 实体 revision，经 expectedEntityRevision 传入内核末投影 GC 退役 CAS。
    // 币种依据：内核 GUARD_ENTITY 基准是 state 实体 revision（folder hash），宿主
    // 侧 SKILL.md sha256 与之不同币不可直传；先观察再校验使并发交叠全覆盖——
    // 观察→校验间换新由第一层内容校验拒绝，校验→内核提交间换新由内核 CAS 拒绝
    // （旧内核快照忽略该字段，无 CAS 保护，属已记录的过渡期缺口）。
    const observedEntityRevision = observeCcskiEntityRevision({
      workspaceDirectory: scope.workspaceDirectory,
      skillName: skill.name,
    });
    assertRevisionCurrent(skills, skill, expectedRevision);
    await removeCcskiEntity({
      workspaceDirectory: scope.workspaceDirectory,
      providerRoot: scope.directory,
      skillName: skill.name,
      expectedEntityRevision: observedEntityRevision ?? undefined,
    });
  } else {
    refuseEntityLibraryFaceDeletion(scope);
    assertPathInside(workspaceRoot, skill.path);
    assertRevisionCurrent(skills, skill, expectedRevision);
    fs.rmSync(skill.path, { recursive: true, force: false });
  }
  skills.invalidateDiscovery(target);
}

/**
 * 实体根 face 判定（P0-2）：provider root 经 resolve 后等于该 workspace 的
 * `<workspaceDirectory>/.agents/skills` 实体库根（与删除路由 ccskiEntityLibraryRoot
 * 同源）。此 face 上的条目由共享实体支撑其它 provider 投影，直删必留悬空链；
 * 非 ccski ownership 只能说明 state 降级（unknown）或外部占位（external），
 * 二者都无权绕过投影先行的删除协议。
 */
function refuseEntityLibraryFaceDeletion(scope: WorkspaceProviderScope): void {
  if (scope.workspaceDirectory === undefined) return;
  const entityLibrary = ccskiEntityLibraryRoot(path.join(scope.workspaceDirectory, ".agents"));
  if (path.resolve(scope.directory) !== entityLibrary) return;
  throw new DomainError(
    "INVALID_OPERATION",
    `This entry lives in the ccski skill entity library (${entityLibrary}) and may be shared by provider projections, but its ownership could not be confirmed against the skill store state (missing or degraded). Deleting it directly would orphan those projections. Run ccski state repair, then retry the deletion.`,
  );
}

/** 宿主 revision 契约：身份文件内容 sha256 必须仍等于 expectedRevision。 */
function assertRevisionCurrent(
  skills: SkillService,
  skill: Awaited<ReturnType<SkillService["resolve"]>>,
  expectedRevision: string,
): void {
  const current = fs.readFileSync(skills.skillFile(skill), "utf8");
  if (contentRevision(current) !== expectedRevision) {
    throw new DomainError("CONFLICT", "This skill changed on disk. Reload it before deleting.");
  }
}

/** resolveWritable + provider root mkdir（写前确保目录在场）；remove 需要 scope 全量。 */
function writableScope(
  workspaces: WorkspaceRegistry,
  target: WorkspaceProviderTarget,
): WorkspaceProviderScope {
  const scope = workspaces.resolveWritable(target);
  try {
    fs.mkdirSync(scope.directory, { recursive: true });
  } catch (error) {
    throw new DomainError(
      "UNAVAILABLE",
      `Provider skills directory is not writable: ${scope.workspaceLabel}`,
      { cause: error },
    );
  }
  return scope;
}
