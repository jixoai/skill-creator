/**
 * builtin fixture 导入器（evaluation-corpus B4 细则；工作计划 Ch3 任务 2.2）。
 *
 * 用户原始需求 [2026-09-30]：「webui 里面还有一些残留的未完成的工作，比如 skill
 * 测试与评估」。
 *
 * 正交意图：
 *   [1] 十条确定性期望矩阵（test/fixtures/steward/evaluation）→ builtin-fixture
 *       case：expectTrigger（布尔）→ finding-triggered 断言；expectedKinds →
 *       finding-kind 断言；corpusDigest（语料域）与 boundRevision（技能文档域）
 *       分字段；导入落用户显式选择的 Imported 目标（Global 只读不落）。
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { corpusDigestOf, type EvaluationStore } from "./store.js";
import type { EvaluationCase, EvaluationTarget } from "../../shared/contracts/evaluation.js";
import type { SkillService } from "../skill-service.js";

/** expectation.json 契约（外部输入 safeParse；不兼容条目丢弃）。 */
const ExpectationSchema = z.object({
  expectTrigger: z.boolean(),
  expectedKinds: z.array(z.string().min(1)),
});

export interface FixtureImportResult {
  imported: number;
  skipped: number;
  caseIds: string[];
}

/** 仓库内 fixture 根（bundled dist 经 import.meta.url 定位源仓路径不可靠——
 * 导入器只在源码仓运行：CLI/daemon 进程内 __dirname 指向 src 或 dist；
 * dist 场景回退 CWD/test/fixtures，缺失时 typed 空结果）。 */
function fixtureRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../../test/fixtures/steward/evaluation"),
    path.resolve(process.cwd(), "test/fixtures/steward/evaluation"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return "";
}

export interface FixtureImporterDeps {
  store: EvaluationStore;
  skills: SkillService;
  /** caseId 生成 seam（测试注入）。 */
  newId?: () => string;
}

export function createFixtureImporter(deps: FixtureImporterDeps) {
  return {
    /** 导入全部 fixture 语料为 builtin-fixture case（幂等：corpusDigest 相同则跳过）。 */
    importAll(target: EvaluationTarget): FixtureImportResult {
      const root = fixtureRoot();
      if (root.length === 0) return { imported: 0, skipped: 0, caseIds: [] };
      let imported = 0;
      let skipped = 0;
      const caseIds: string[] = [];
      for (const group of fixtureGroups(root)) {
        const expectation = readExpectation(group);
        if (expectation === null) {
          skipped += 1;
          continue;
        }
        const corpusFiles = group.files.filter(
          (file) => !file.relativePath.endsWith("expectation.json"),
        );
        const digest = corpusDigestOf(corpusFiles);
        // 幂等：同语料 digest 已导入 → 跳过。
        const existing = deps.store
          .listCases(target)
          .find((entry) => entry.source === "builtin-fixture" && entry.corpusDigest === digest);
        if (existing !== undefined) {
          skipped += 1;
          caseIds.push(existing.caseId);
          continue;
        }
        const firstSkillFile = corpusFiles.find((file) => file.relativePath.endsWith("SKILL.md"));
        if (firstSkillFile === undefined) {
          skipped += 1;
          continue;
        }
        const boundRevision = `sha256:${createHash("sha256").update(firstSkillFile.content).digest("hex")}`;
        const now = new Date().toISOString();
        const entry: EvaluationCase = {
          schemaVersion: 1,
          caseId: deps.newId
            ? (deps.newId() as EvaluationCase["caseId"])
            : (`ev_${createHash("sha256").update(`${digest}:${now}`).digest("hex").slice(0, 24)}` as EvaluationCase["caseId"]),
          enabled: true,
          createdAt: now,
          updatedAt: now,
          source: "builtin-fixture",
          boundRevision,
          corpusDigest: digest,
          input: {
            // fixture 语料的任务描述 = 目录名（语义稳定，随语料演进）。
            prompt: `builtin fixture: ${path.basename(group.dir)}（${path.basename(path.dirname(group.dir))}）`,
            assertions: [
              { kind: "finding-triggered", value: expectation.expectTrigger },
              ...expectation.expectedKinds.map((kind) => ({
                kind: "finding-kind" as const,
                value: kind,
              })),
            ],
          },
        };
        deps.store.saveCase(target, entry);
        imported += 1;
        caseIds.push(entry.caseId);
      }
      return { imported, skipped, caseIds };
    },
  };
}

interface FixtureGroup {
  dir: string;
  files: Array<{ relativePath: string; content: Buffer }>;
}

function fixtureGroups(root: string): FixtureGroup[] {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .flatMap((suite) =>
      suite.isDirectory()
        ? fs
            .readdirSync(path.join(root, suite.name), { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => path.join(root, suite.name, entry.name))
        : [],
    )
    .map((dir) => ({
      dir,
      files: fs
        .readdirSync(dir, { recursive: true })
        .map((entry) => path.join(dir, String(entry)))
        .filter((file) => fs.statSync(file).isFile())
        .map((file) => ({
          relativePath: path.relative(dir, file),
          content: fs.readFileSync(file),
        })),
    }));
}

function readExpectation(
  group: FixtureGroup,
): { expectTrigger: boolean; expectedKinds: string[] } | null {
  const file = group.files.find((entry) => entry.relativePath.endsWith("expectation.json"));
  if (file === undefined) return null;
  try {
    const parsed = ExpectationSchema.safeParse(JSON.parse(file.content.toString("utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * 按 corpusDigest 定位 fixture 语料并投影为 analyzer 文档（builtin-fixture
 * case 的确定性回归分支：分析对象是 fixture 语料本身，非活技能语料——
 * boundRevision 闸在 fixture 域自洽）。
 */
export function fixtureCorpusDocuments(digest: string): Array<{
  workspaceId: string;
  providerId: string;
  skillId: string;
  name: string;
  directoryName: string;
  disabled: boolean;
  revision: string;
  content: string;
}> | null {
  const root = fixtureRoot();
  if (root.length === 0) return null;
  for (const group of fixtureGroups(root)) {
    const corpusFiles = group.files.filter(
      (file) => !file.relativePath.endsWith("expectation.json"),
    );
    if (corpusDigestOf(corpusFiles) !== digest) continue;
    const documents = [];
    const skillDirs = new Set(
      corpusFiles
        .filter((file) => file.relativePath.endsWith("SKILL.md"))
        .map((file) => path.dirname(file.relativePath)),
    );
    for (const skillDir of skillDirs) {
      const skillFile = corpusFiles.find(
        (file) => file.relativePath === path.join(skillDir, "SKILL.md"),
      );
      if (skillFile === undefined) continue;
      const content = skillFile.content.toString("utf8");
      const nameMatch = content.match(/^---\n(?:.*\n)*?name:\s*(.+)\n(?:.*\n)*?---/m);
      const name = nameMatch?.[1]?.trim() ?? path.basename(skillDir);
      documents.push({
        workspaceId: "fixture",
        providerId: "fixture",
        skillId: `fx_${createHash("sha256").update(skillDir).digest("hex").slice(0, 24)}`,
        name,
        directoryName: path.basename(skillDir),
        disabled: false,
        revision: `sha256:${createHash("sha256").update(skillFile.content).digest("hex")}`,
        content,
      });
    }
    return documents;
  }
  return null;
}
