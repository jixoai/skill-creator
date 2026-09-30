/**
 * 用户原始需求 [2026-09-30]（self-skill-symlink）：「~/.agents/skills/skill-creator-v2
 * 这个文件夹应该走 symlink」——而 ccski 2.5.0 的 root 扫描对条目做
 * `entry.isDirectory()` 过滤，symlink 目录条目恒 false 被跳过（实测钉死，
 * 无选项可开）。本模块在产品自身的两个 ccski 调用点补上 symlink 条目，
 * 让 symlink 技能（产品自举的 self skill 与用户手工链接的技能）在
 * skills.list / workspace 计数里与真实目录同形可见。
 *
 * 正交意图：
 *   [1] 增补逻辑：包装 ccski listSkills，对 customDirs 每个 root 的顶层
 *       symlink 条目做 SKILL.md/.SKILL.md 存在性 + frontmatter 解析。
 *   [2] 形状镜像：增补条目逐字段镜像 ccski customDir 条目实测形状
 *       （location "user" / sourceKind "custom" / sourcePriority 500），
 *       下游 projectMetadata 的 Zod 收窄兜底。
 * 妥协声明：只覆盖 root 顶层 symlink（与产品 customDir 扫描的平铺语义对齐）；
 * 嵌套 symlink 目录不在发现面（真实目录的嵌套发现同样受 ccski 递归策略约束）。
 */
import fs from "node:fs";
import path from "node:path";
import { listSkills, parseSkillFile, type ListOptions, type SkillMetadata } from "ccski";

/** customDirs 的条目形状（字符串或带 scope 的对象）统一为目录清单。 */
function customRoots(customDirs: ListOptions["customDirs"]): string[] {
  if (!customDirs) return [];
  return customDirs.map((entry) => (typeof entry === "string" ? entry : entry.path));
}

/** 顶层 symlink 条目中可解析为技能的部分（ccski 跳过的盲区；provider/location 由调用点补齐）。 */
function symlinkedSkillEntries(
  root: string,
  listedNames: ReadonlySet<string>,
  includeDisabled: boolean,
): Array<Omit<SkillMetadata, "provider" | "location">> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: Array<Omit<SkillMetadata, "provider" | "location">> = [];
  for (const entry of entries) {
    if (!entry.isSymbolicLink()) continue;
    const linkPath = path.join(root, entry.name);
    if (listedNames.has(entry.name)) continue;
    const enabledFile = path.join(linkPath, "SKILL.md");
    const disabledFile = path.join(linkPath, ".SKILL.md");
    const hasEnabled = fs.existsSync(enabledFile);
    const hasDisabled = includeDisabled && fs.existsSync(disabledFile);
    const document = hasEnabled ? enabledFile : hasDisabled ? disabledFile : null;
    if (!document) continue;
    try {
      const parsed = parseSkillFile(document);
      found.push({
        name: parsed.frontmatter.name,
        description: parsed.frontmatter.description,
        disabled: !hasEnabled,
        hasReferences: fs.existsSync(path.join(linkPath, "references")),
        hasScripts: fs.existsSync(path.join(linkPath, "scripts")),
        hasAssets: fs.existsSync(path.join(linkPath, "assets")),
        path: linkPath,
      });
    } catch {
      // 坏 frontmatter 的链接条目不进发现面（与 ccski 对坏技能的丢弃口径一致）。
    }
  }
  return found;
}

/**
 * ccski listSkills 的 symlink 增补版（签名兼容，直接替换调用点）。
 * provider/location/sourceKind/sourcePriority 按 customProvider + 实测形状补齐。
 */
export async function listSkillsWithSymlinkedEntries(
  options: ListOptions,
): Promise<SkillMetadata[]> {
  const listed = await listSkills(options);
  // 与 ccski applyFilters 的状态口径对齐：all/disabled 请求包含禁用条目。
  const includeDisabled = options.all === true || options.disabled === true;
  const roots = customRoots(options.customDirs);
  if (roots.length === 0) return listed;
  const provider = options.customProvider ?? "agents";
  const augmented: SkillMetadata[] = [];
  for (const root of roots) {
    // 去重按 root 内条目名（同名真实目录已由 ccski 列出时不重复补）。
    const listedNames = new Set(
      listed
        .filter((skill) => path.dirname(skill.path) === path.resolve(root))
        .map((skill) => path.basename(skill.path)),
    );
    for (const skill of symlinkedSkillEntries(root, listedNames, includeDisabled)) {
      augmented.push({
        ...skill,
        provider,
        location: "user",
        sourceKind: "custom",
        sourcePriority: 500,
      });
    }
  }
  return [...listed, ...augmented];
}
