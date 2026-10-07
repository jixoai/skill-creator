/**
 * 用户原始需求 [2026-10-08]（ccski-3-host-migration 批 3.1 → 宿主修复批 6 P1-6）：
 * 「wrapper 退役收据必须可独立复核」——Codex 终审指出：收据表格 code span 内
 * 未转义 `|` 拆列、数据行只写「在/全等」无七字段实际值、一次性生成脚本不在
 * 仓库。本脚本把收据变成可复跑生成器：从 git 历史恢复 wrapper 与当前 ccski
 * 直连双半边同跑同一 fixture，产结构化 JSON 原始收据 + 人读 md（同源生成）。
 *
 * 正交意图：
 *   [1] 双半边复跑：wrapper 源码经 `git show <ref>:src/daemon/ccski-symlink-entries.ts`
 *       恢复到仓库内缓存目录动态 import（解析 node_modules/ccski），与当前
 *       ccski 直连 listSkills 跑同一 fixture 语料（all:true / all:false 双形状）。
 *   [2] 逐字段收据：七字段消费口径（provider/location/sourceKind/sourcePriority/
 *       disabled/canonicalPath(=mutation target)/directoryName）逐行落 JSON +
 *       md 逐字段值表（key 不进表格单元格，杜绝 `|` 拆列）。
 *   [3] 收据门禁（宿主修复批 7，P1-F）：字段漂移 / 缺行（仅单侧）/ 重复行键
 *       六项任一非零 → exit 1。旧门禁只看字段漂移，缺行只进报告不进门禁，且
 *       Map 折叠吞掉同键多行 → 行集合不一致仍假绿。门禁判定提炼为可测纯函数
 *       evaluateReceiptGate（main 经 isMainModule 守卫，测试可直接 import）。
 * 妥协声明：wrapper 已从主干删除，复跑依赖 git 历史在场（ref 可经首个参数覆盖，
 * 默认 fe52b62^ = 删除提交的父）；产物确定性（无时间戳），复跑 diff 为空即无漂移。
 * 缓存目录走 mkdtemp 唯一后缀（宿主修复批 7，P2-H：固定名 + recursive 清理可能
 * 删掉同名既有目录；仓库内位置是为 wrapper 源码的 node_modules 裸说明符可达）。
 *
 * 运行：bun scripts/ccski-wrapper-receipt.sh.ts [wrapperGitRef]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listSkills } from "ccski";
import type { ListOptions, SkillMetadata } from "ccski";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const changeDir = path.join(repoRoot, "openspec", "changes", "ccski-3-host-migration");
const wrapperRef = process.argv[2] ?? "fe52b62^";
const wrapperPathInHistory = "src/daemon/ccski-symlink-entries.ts";

/** 七字段消费口径（宿主消费面投影）。 */
const FIELDS = [
  "provider",
  "location",
  "sourceKind",
  "sourcePriority",
  "disabled",
  "canonicalPath",
  "directoryName",
] as const;
type FieldName = (typeof FIELDS)[number];
type ProjectedRow = { name: string } & Record<FieldName, string>;

export type { FieldName, ProjectedRow };

function projectRow(row: SkillMetadata, fixtureRoot: string): ProjectedRow {
  // canonicalPath 口径 = ccski 原生增量字段（realpath 身份源；缺席时回退 path），
  // 与批 3.1 收据的「canonicalPath(=mutation target 与身份源)」一致。
  const canonicalPath = String((row as { canonicalPath?: string }).canonicalPath ?? row.path);
  // fixture 根归一化为占位符：产物不受 mkdtemp 随机后缀影响（复跑 diff 为空）。
  const normalize = (value: string): string => value.split(fixtureRoot).join("<fixture>");
  return {
    name: row.name,
    provider: String(row.provider),
    location: String(row.location),
    sourceKind: String(row.sourceKind),
    sourcePriority: String(row.sourcePriority),
    disabled: JSON.stringify(row.disabled === true),
    canonicalPath: normalize(canonicalPath),
    directoryName: path.basename(canonicalPath),
  };
}

function rowKey(row: ProjectedRow): string {
  return `${row.name}|${row.canonicalPath}|${row.disabled}`;
}

function writeSkill(directory: string, name: string, filename = "SKILL.md"): string {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, filename),
    `---\nname: ${name}\ndescription: skill ${name}\n---\n\nbody\n`,
  );
  return directory;
}

function link(root: string, name: string, target: string): void {
  fs.mkdirSync(root, { recursive: true });
  fs.symlinkSync(target, path.join(root, name), "dir");
}

/** fixture 语料（与批 3.1 收据同口径）：跳过口径语料不进发现面，仅参与对照环境。 */
function buildFixture(sandbox: string): { providerRoot: string } {
  const providerRoot = path.join(sandbox, "provider-root");
  const lib = path.join(sandbox, "lib");
  // 真实目录 enabled / disabled。
  writeSkill(path.join(providerRoot, "real-enabled"), "real-enabled");
  writeSkill(path.join(providerRoot, "real-disabled"), "real-disabled", ".SKILL.md");
  // 内容源（lib）：被 provider-root 链接（linked-skill 携带 references/ 目录）。
  fs.mkdirSync(path.join(writeSkill(path.join(lib, "linked-skill"), "linked-skill"), "references"));
  writeSkill(path.join(lib, "disabled-link"), "disabled-link", ".SKILL.md");
  link(providerRoot, "linked-skill", path.join(lib, "linked-skill"));
  link(providerRoot, "disabled-link", path.join(lib, "disabled-link"));
  // 跳过口径语料：非 skill 目标链 / 坏 frontmatter 链 / 悬空链。
  fs.mkdirSync(path.join(sandbox, "empty-dir"), { recursive: true });
  link(providerRoot, "not-a-skill", path.join(sandbox, "empty-dir"));
  const broken = path.join(sandbox, "broken-src");
  fs.mkdirSync(broken, { recursive: true });
  fs.writeFileSync(path.join(broken, "SKILL.md"), "---\nname: [unclosed\n---\nbody\n");
  link(providerRoot, "broken-skill", broken);
  link(providerRoot, "dangling", path.join(sandbox, "no-such-target"));
  return { providerRoot };
}

interface ShapeResult {
  shape: string;
  wrapperRows: ProjectedRow[];
  directRows: ProjectedRow[];
  drift: Array<{ key: string; field: FieldName; wrapper: string; direct: string }>;
  missingInDirect: string[];
  missingInWrapper: string[];
  /** 重复行键（P1-F）：Map 折叠会把同键多行并成一行，行集合不一致被静默吞掉。 */
  duplicateWrapperKeys: string[];
  duplicateDirectKeys: string[];
}

export type { ShapeResult };

/** 找出一侧行集合里出现多于一次的行键（排序稳定，供门禁与报告）。 */
function duplicateKeys(rows: ProjectedRow[]): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(rowKey(row), (counts.get(rowKey(row)) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key)
    .sort();
}

export function compareShape(
  shape: string,
  wrapperRows: ProjectedRow[],
  directRows: ProjectedRow[],
): ShapeResult {
  const wrapperByKey = new Map(wrapperRows.map((row) => [rowKey(row), row]));
  const directByKey = new Map(directRows.map((row) => [rowKey(row), row]));
  const drift: ShapeResult["drift"] = [];
  const missingInDirect: string[] = [];
  const missingInWrapper: string[] = [];
  for (const [key, wrapperRow] of wrapperByKey) {
    const directRow = directByKey.get(key);
    if (!directRow) {
      missingInDirect.push(key);
      continue;
    }
    for (const field of FIELDS) {
      if (wrapperRow[field] !== directRow[field]) {
        drift.push({ key, field, wrapper: wrapperRow[field], direct: directRow[field] });
      }
    }
  }
  for (const key of directByKey.keys()) {
    if (!wrapperByKey.has(key)) missingInWrapper.push(key);
  }
  return {
    shape,
    wrapperRows,
    directRows,
    drift,
    missingInDirect,
    missingInWrapper,
    duplicateWrapperKeys: duplicateKeys(wrapperRows),
    duplicateDirectKeys: duplicateKeys(directRows),
  };
}

/**
 * 收据门禁判定（宿主修复批 7，P1-F）：字段漂移、行集合不一致（仅单侧在场的
 * missing rows）、任一侧重复行键——任一非零即收据不绿（exit 1）。旧门禁只看
 * 字段漂移：缺行只进报告不进门禁，且 compareShape 的 Map 折叠把同键多行并成
 * 一行，行集合不一致仍 exit 0（假绿）。
 */
export function evaluateReceiptGate(shapes: ReadonlyArray<ShapeResult>): {
  ok: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  for (const shape of shapes) {
    if (shape.drift.length > 0) {
      reasons.push(`${shape.shape}: ${shape.drift.length} drifted field(s)`);
    }
    if (shape.missingInDirect.length > 0) {
      reasons.push(
        `${shape.shape}: ${shape.missingInDirect.length} row(s) missing in direct ccski`,
      );
    }
    if (shape.missingInWrapper.length > 0) {
      reasons.push(`${shape.shape}: ${shape.missingInWrapper.length} row(s) missing in wrapper`);
    }
    if (shape.duplicateWrapperKeys.length > 0) {
      reasons.push(
        `${shape.shape}: duplicate wrapper row key(s): ${shape.duplicateWrapperKeys.join(", ")}`,
      );
    }
    if (shape.duplicateDirectKeys.length > 0) {
      reasons.push(
        `${shape.shape}: duplicate direct row key(s): ${shape.duplicateDirectKeys.join(", ")}`,
      );
    }
  }
  return { ok: reasons.length === 0, reasons };
}

function renderMarkdown(receipt: {
  ccskiVersion: string;
  wrapperRef: string;
  shapes: ShapeResult[];
}): string {
  const lines: string[] = [];
  lines.push("# ccski-symlink-entries 退役收据（批 3.1 · 无漂移复跑对照表）");
  lines.push("");
  lines.push("> 生成方式：`bun scripts/ccski-wrapper-receipt.sh.ts`（可复跑；本文件与");
  lines.push("> `wrapper-retirement-receipt.json`（结构化原始收据）均为其确定性产物，");
  lines.push("> 复跑 `git diff` 为空即无漂移）。wrapper 半边经");
  lines.push(`> \`git show ${receipt.wrapperRef}:${wrapperPathInHistory}\` 恢复源码动态 import；`);
  lines.push(`> 直连半边 = 当前 node_modules 的 ccski ${receipt.ccskiVersion} \`listSkills\`。`);
  lines.push("> fixture 语料：真实目录 enabled/disabled + symlink enabled/disabled-only/");
  lines.push("> 非 skill 目标/坏 frontmatter/悬空链，customDirs 单 root、scanDefaultDirs:false。");
  lines.push("> 字段口径 = 宿主消费面七字段；行键 = `name|canonicalPath|disabled`（标题");
  lines.push("> 呈现，不进表格单元格——批 3.1 版把行键放进表格首列 code span，`|` 拆列");
  lines.push("> 即终审 P1-6 抓出的缺陷）。");
  for (const shape of receipt.shapes) {
    lines.push("");
    lines.push(`## 调用形状：${shape.shape}`);
    const keys = [...new Set([...shape.wrapperRows, ...shape.directRows].map(rowKey))];
    for (const key of keys) {
      const wrapperRow = shape.wrapperRows.find((row) => rowKey(row) === key);
      const directRow = shape.directRows.find((row) => rowKey(row) === key);
      lines.push("");
      lines.push(`### \`${key}\``);
      lines.push("");
      lines.push("| 字段 | wrapper 在场 | 直连 ccski 3.0 | 比较 |");
      lines.push("| ---- | ----------- | -------------- | ---- |");
      for (const field of FIELDS) {
        const wrapperValue = wrapperRow?.[field] ?? "（缺席）";
        const directValue = directRow?.[field] ?? "（缺席）";
        const equal = wrapperValue === directValue ? "全等" : "漂移";
        lines.push(`| ${field} | \`${wrapperValue}\` | \`${directValue}\` | ${equal} |`);
      }
    }
    lines.push("");
    lines.push(
      `- 行数：wrapper=${shape.wrapperRows.length}，直连=${shape.directRows.length}；` +
        `字段漂移=${shape.drift.length}；仅 wrapper=${shape.missingInDirect.length}；` +
        `仅直连=${shape.missingInWrapper.length}；重复键 wrapper=${shape.duplicateWrapperKeys.length}、` +
        `直连=${shape.duplicateDirectKeys.length}（P1-F：以上六项任一非零 → 门禁 exit 1）。`,
    );
  }
  lines.push("");
  lines.push("## 结论");
  lines.push("");
  const totalDrift = receipt.shapes.reduce((sum, shape) => sum + shape.drift.length, 0);
  const gate = evaluateReceiptGate(receipt.shapes);
  lines.push(
    `漂移字段总数 = ${totalDrift}（0 = 全等；wrapper 增补在 ccski 3.0 一等发现下为 no-op）。`,
  );
  lines.push("");
  lines.push(
    gate.ok
      ? "门禁：绿（字段漂移 / 缺行 / 重复键全部为零，P1-F 六项门禁全过）。"
      : "门禁：红（见上方行数统计；P1-F 门禁任一非零即 exit 1，不再假绿）。",
  );
  lines.push("");
  lines.push("已知分析性差异（不进入上表口径）：ccski 3.0 发现行额外携带 entryKind/canonicalPath/");
  lines.push(
    "ownership/mode 增量字段（z.object 收窄剥离，宿主投影不受影响，且为批 2.3 toggle 双路由",
  );
  lines.push("的依赖面——这是迁移收益不是漂移）。");
  lines.push("");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const ccskiVersion = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "node_modules", "ccski", "package.json"), "utf8"),
  ) as { version: string };

  // wrapper 半边：从 git 历史恢复源码（仓库内缓存目录 → node_modules 解析可达）。
  const wrapperSource = execFileSync("git", ["show", `${wrapperRef}:${wrapperPathInHistory}`], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  // P2-H：mkdtemp 唯一缓存目录——固定名 + recursive 清理可能删掉同名既有目录；
  // 唯一后缀保证只清理本次创建的路径（崩溃残留由 .gitignore 的前缀规则兜底）。
  const cacheDir = fs.mkdtempSync(path.join(repoRoot, ".wrapper-receipt-cache-"));
  const wrapperFile = path.join(cacheDir, "ccski-symlink-entries.generated.ts");
  fs.writeFileSync(wrapperFile, wrapperSource, "utf8");
  const wrapperModule = (await import(pathToFileUrlHref(wrapperFile))) as {
    listSkillsWithSymlinkedEntries: (options: ListOptions) => Promise<SkillMetadata[]>;
  };

  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "ccski-wrapper-receipt-"));
  let shapes: ShapeResult[];
  try {
    const { providerRoot } = buildFixture(sandbox);
    shapes = [];
    for (const all of [true, false] as const) {
      const options: ListOptions = {
        customDirs: [providerRoot],
        customProvider: "cline",
        scanDefaultDirs: false,
        all,
      };
      const wrapperRows = (await wrapperModule.listSkillsWithSymlinkedEntries(options)).map((row) =>
        projectRow(row, sandbox),
      );
      const directRows = (await listSkills(options)).map((row) => projectRow(row, sandbox));
      shapes.push(compareShape(`all:${all}`, wrapperRows, directRows));
    }
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }

  const receipt = { ccskiVersion: ccskiVersion.version, wrapperRef, shapes };
  fs.writeFileSync(
    path.join(changeDir, "wrapper-retirement-receipt.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
    "utf8",
  );
  const markdownPath = path.join(changeDir, "wrapper-retirement-receipt.md");
  fs.writeFileSync(markdownPath, renderMarkdown(receipt), "utf8");
  // 产物过仓库格式门（表格列宽对齐含 CJK 宽度规则，手工复刻脆弱 → 走 vp fmt）。
  execFileSync("pnpm", ["exec", "vp", "fmt", markdownPath], {
    cwd: repoRoot,
    stdio: "ignore",
  });

  const totalDrift = shapes.reduce((sum, shape) => sum + shape.drift.length, 0);
  const gate = evaluateReceiptGate(shapes);
  console.log(
    `receipt regenerated: ${shapes.length} shapes, drift fields = ${totalDrift}, ` +
      `ccski ${ccskiVersion.version}, wrapper @ ${wrapperRef}`,
  );
  // P1-F 门禁：字段漂移、缺行、重复键任一非零 → exit 1（不再只看 drift 假绿）。
  if (!gate.ok) {
    console.error(`receipt gate failed:\n  ${gate.reasons.join("\n  ")}`);
    process.exitCode = 1;
  }
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

if (isMainModule()) {
  await main();
}

function pathToFileUrlHref(target: string): string {
  return `file://${target.split(path.sep).map(encodeURIComponent).join("/")}`;
}
