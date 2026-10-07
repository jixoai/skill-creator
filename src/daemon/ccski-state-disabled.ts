/**
 * 用户原始需求 [2026-10-07]（ccski-3-host-migration 批 3.2，MainAgent 工单）：
 * 「UI 启停往返必须闭合：禁用（摘链）后技能仍要出现在该 provider 列表（标
 * disabled），再启用走既有 entityToggle 路径」——ccski 3.0 物理禁用（link 摘链）
 * 使该 root 的文件系发现面消失，CLI 靠 state 实体表解析名字，宿主 UI 同构地读
 * state 构造 disabled 补充行。
 *
 * 正交意图：
 *   [1] state 只读补充面：读 provider 对应 stateBase 的 `.ccski-state.json`
 *       （外部输入 → JSON parse → Zod safeParse 收窄），筛 `mode==="link" &&
 *       disabled===true && rootPath===provider root` 的投影记录；数据不兼容
 *       （safeParse 失败）/无 state 文件 = 零补充降级不计错（同发现层法则）；
 *       非环 IO 故障（EACCES/EIO…）向上传播，不伪装空值。
 *   [2] 内容源 = 实体记录：entity 表按 folderName 命中，从实体路径读 SKILL.md
 *       （parseSkillFile）取 name/description；实体缺失/坏 frontmatter → 该行
 *       丢弃（与发现层丢弃口径一致）。
 *   [3] 重复防护：投影路径在文件系已存在（state 记录过时/被外部条目占位）或
 *       实体 canonical path 已在文件系发现面 = 文件系胜出，不补。
 *   [4] 路径绑定（宿主修复批 6，P1-4）：state 是用户可写的外部输入——伪造合法
 *       信封不得把实体/投影路径指到实体库/注册根之外。实体路径绑定
 *       `<stateBase>/skills/<folderName>`、投影路径绑定 `<rootPath>/<folderName>`，
 *       词法 + realpath 双 containment；绑定失败 = 该记录不可信，消费面按各自
 *       语义丢弃/保守拒绝（绑定校验导出供 ccski-entity-remove 同源复用）。
 * 妥协声明：schema 镜像是宿主消费所需的最小字段集（kernel 记录的其余字段被
 * z.object 剥离）；kernel schema 破坏性演进时 safeParse 自然降级为零补充，
 * 不迁移不重建（§8）。
 */
import fs from "node:fs";
import path from "node:path";
import { parseSkillFile } from "ccski";
import { z } from "zod";
import {
  SkillIdSchema,
  SkillMetadataSchema,
  type SkillId,
  type SkillMetadata,
} from "../shared/contracts/skills.js";
import { safeParseExternal } from "../shared/external-input.js";
import { canonicalDirectory, opaquePathId } from "./path-safety.js";

/** ccski state 文件名（内核单写者恒定；宿主只读）。 */
const CCSKI_STATE_FILENAME = ".ccski-state.json";

/** state 信封最小镜像（kernel CCSKI_STATE_SCHEMA_VERSION=1；升版 → 零补充降级）。 */
const StateEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  generation: z.number().int().nonnegative(),
  entities: z.record(z.string(), z.unknown()),
  projections: z.record(z.string(), z.unknown()),
});

/** state 信封读取结果（批 5：absent/incompatible 显式区分，供删除路由保守裁决）。 */
export type CcskiStateRead =
  | { kind: "absent" }
  | { kind: "incompatible" }
  | { kind: "ok"; entities: Record<string, unknown>; projections: Record<string, unknown> };

/**
 * 读取一个 stateBase 的 `.ccski-state.json` 信封（只读、零写副作用）。
 * 文件缺失 = absent；JSON/schema 不兼容 = incompatible（不迁移不重建）；非环
 * IO 故障（EACCES/EIO…）向上传播，不伪装空值（与 readStateDisabledRows 同法）。
 */
export function readCcskiState(stateBase: string): CcskiStateRead {
  const statePath = path.join(path.resolve(stateBase), CCSKI_STATE_FILENAME);
  let text: string;
  try {
    text = fs.readFileSync(statePath, "utf8");
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return { kind: "absent" };
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: "incompatible" };
  }
  const envelope = safeParseExternal(StateEnvelopeSchema, parsed);
  if (!envelope) return { kind: "incompatible" };
  return { kind: "ok", entities: envelope.entities, projections: envelope.projections };
}

/**
 * 运行时类型守卫（宿主修复批 6，终审质量项①）：fs 抛出的错误形状不可静态断言
 * （外部输入纪律），用结构探测收敛为 NodeJS.ErrnoException。
 */
function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  );
}

/** stateBase 对应的实体库根（词法基准；disabled 补充面与删除路由共用）。 */
export function ccskiEntityLibraryRoot(stateBase: string): string {
  return path.join(path.resolve(stateBase), "skills");
}

/**
 * 实体记录路径绑定校验（P1-4）：词法上必须等于 `<stateBase>/skills/<folderName>`，
 * 且 realpath 落在实体库根内（防「实体库内 symlink 指向外部」的绕过）。目录
 * 不存在或任一 realpath 失败 = 无法证实绑定 = 拒绝。
 */
export function ccskiEntityPathBound(
  stateBase: string,
  folderName: string,
  entityPath: string,
): boolean {
  const lexicalRoot = ccskiEntityLibraryRoot(stateBase);
  if (path.resolve(entityPath) !== path.join(lexicalRoot, folderName)) return false;
  try {
    const realEntity = fs.realpathSync(path.resolve(entityPath));
    const realLibrary = fs.realpathSync(lexicalRoot);
    const relative = path.relative(realLibrary, realEntity);
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  } catch {
    return false;
  }
}

/**
 * 投影记录路径绑定校验（P1-4）：词法上必须等于 `<rootPath>/<folderName>`
 * （注册根的直接子级）。rootPath 本身由消费面对 providerRoot/注册根另行匹配。
 */
export function ccskiProjectionPathBound(
  rootPath: string,
  folderName: string,
  projectionPath: string,
): boolean {
  return path.resolve(projectionPath) === path.join(path.resolve(rootPath), folderName);
}

/** 禁用 link 投影记录的最小消费面（kernel ProjectionRecord 的字段子集）。 */
const DisabledLinkProjectionSchema = z.object({
  mode: z.literal("link"),
  disabled: z.literal(true),
  rootPath: z.string().min(1),
  folderName: z.string().min(1),
  /** 投影绝对路径（provider root 下；禁用期物理缺席，重链落点）。 */
  path: z.string().min(1),
});

/** 实体记录的最小消费面（entity 表键 = folderName）。 */
const EntityRecordSchema = z.object({
  folderName: z.string().min(1),
  /** 实体绝对路径（实体库内；内容源）。 */
  path: z.string().min(1),
});

/** state-backed disabled 补充面输入。 */
export interface StateDisabledInput {
  /** provider root canonical 路径（registry resolve 产物）。 */
  providerRoot: string;
  /** 投影 scope 的 stateBase（Imported = `<ws>/.agents`；Global = `<home>/.agents`）。 */
  stateBase: string;
  /** 补充行归属的 provider id。 */
  providerId: string;
  /** 文件系发现面已见的 canonical path 集合（重复防护 [3]）。 */
  seenCanonicalPaths: ReadonlySet<string>;
}

function skillId(canonicalPath: string): SkillId {
  return SkillIdSchema.parse(opaquePathId("sk", canonicalPath));
}

/**
 * 读取一个 provider root 的 state-backed disabled 补充行（只读、零写副作用）。
 * 返回行恒 `disabled=true`、`ownership="ccski"`；`path` = 实体 canonical 路径
 * （内容源与 mutation 身份），`projectionPath` = 记录的投影路径（重链落点）。
 */
export function readStateDisabledRows(input: StateDisabledInput): SkillMetadata[] {
  const state = readCcskiState(input.stateBase);
  if (state.kind !== "ok") {
    // absent/不兼容 → 零补充降级不计错（同发现层法则）。
    return [];
  }

  const rows: SkillMetadata[] = [];
  for (const recordValue of Object.values(state.projections)) {
    const record = safeParseExternal(DisabledLinkProjectionSchema, recordValue);
    if (!record) continue;
    if (path.resolve(record.rootPath) !== path.resolve(input.providerRoot)) continue;
    // 路径绑定（P1-4）：投影路径必须是注册根直接子级，伪造信封拒绝。
    if (!ccskiProjectionPathBound(record.rootPath, record.folderName, record.path)) continue;
    // 重复防护：投影路径已有文件系条目 = 记录过时或被外部占位，文件系胜出。
    if (fs.existsSync(record.path)) continue;
    const entityValue = state.entities[record.folderName];
    const entity =
      entityValue === undefined ? null : safeParseExternal(EntityRecordSchema, entityValue);
    if (!entity) continue;
    // 路径绑定（P1-4）：实体路径必须落在实体库内，伪造信封拒绝（否则
    // skills.list/info 可被驱使读取任意 SKILL.md）。
    if (!ccskiEntityPathBound(input.stateBase, entity.folderName, entity.path)) continue;
    try {
      // 实体内容源：canonical 身份 + SKILL.md frontmatter（enabled 形态恒在——
      // link 模式禁用永不换名）。
      const canonicalEntity = canonicalDirectory(entity.path);
      if (input.seenCanonicalPaths.has(canonicalEntity)) continue;
      const document = path.join(canonicalEntity, "SKILL.md");
      // 身份文件防线（P1-4）：lstat 不跟随符号链接——实体库内指向外部的
      // SKILL.md 链接不是可信内容源。
      let documentStat: fs.Stats;
      try {
        documentStat = fs.lstatSync(document);
      } catch {
        continue;
      }
      if (!documentStat.isFile()) continue;
      const parsedSkill = parseSkillFile(document);
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(canonicalEntity);
      } catch {
        continue;
      }
      const row = safeParseExternal(SkillMetadataSchema, {
        id: skillId(canonicalEntity),
        name: parsedSkill.frontmatter.name,
        description: parsedSkill.frontmatter.description,
        directoryName: path.basename(canonicalEntity),
        disabled: true,
        provider: input.providerId,
        location: "user",
        sourceKind: "custom",
        sourcePriority: 500,
        path: canonicalEntity,
        projectionPath: record.path,
        hasReferences: fs.existsSync(path.join(canonicalEntity, "references")),
        hasScripts: fs.existsSync(path.join(canonicalEntity, "scripts")),
        hasAssets: fs.existsSync(path.join(canonicalEntity, "assets")),
        pluginInfo: null,
        installedVia: "unknown",
        updatable: false,
        ownership: "ccski",
        entryKind: stat.isSymbolicLink() ? "symlink" : "directory",
      });
      if (row) rows.push(row);
    } catch {
      // 实体目录不可达/文档不可读：该行丢弃，不阻断其余补充行。
      continue;
    }
  }
  return rows;
}
