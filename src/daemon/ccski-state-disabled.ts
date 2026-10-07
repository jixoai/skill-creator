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
  const statePath = path.join(path.resolve(input.stateBase), CCSKI_STATE_FILENAME);
  let text: string;
  try {
    text = fs.readFileSync(statePath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code === "ENOENT") return [];
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // 数据不兼容 → 零补充降级不计错（同发现层法则）。
    return [];
  }
  const envelope = safeParseExternal(StateEnvelopeSchema, parsed);
  if (!envelope) return [];

  const rows: SkillMetadata[] = [];
  for (const recordValue of Object.values(envelope.projections)) {
    const record = safeParseExternal(DisabledLinkProjectionSchema, recordValue);
    if (!record) continue;
    if (path.resolve(record.rootPath) !== path.resolve(input.providerRoot)) continue;
    // 重复防护：投影路径已有文件系条目 = 记录过时或被外部占位，文件系胜出。
    if (fs.existsSync(record.path)) continue;
    const entityValue = envelope.entities[record.folderName];
    const entity =
      entityValue === undefined ? null : safeParseExternal(EntityRecordSchema, entityValue);
    if (!entity) continue;
    try {
      // 实体内容源：canonical 身份 + SKILL.md frontmatter（enabled 形态恒在——
      // link 模式禁用永不换名）。
      const canonicalEntity = canonicalDirectory(entity.path);
      if (input.seenCanonicalPaths.has(canonicalEntity)) continue;
      const document = path.join(canonicalEntity, "SKILL.md");
      if (!fs.existsSync(document) || !fs.statSync(document).isFile()) continue;
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
