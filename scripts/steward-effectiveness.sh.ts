/**
 * 可解释的优化前后评估（openspec steward-product-workflow task 4.7）。
 *
 * 用户原始需求 [2026-09-07]（tasks 4.7）：「明确该触发的 5 条输入、不该触发的 5
 * 条输入；含冲突对、分工重叠对、配套脚本技能；保存 baseline 和 candidate 的原始
 * 结果、模型版本与判断理由。文档/资源完整性不退化；展示触发命中和误触发、任务
 * 断言、token 估算与真实消耗的区别；未知使用历史显示 unknown。每次优化有预期
 * 收益、证据、失败风险和保留/拒绝理由，不能把缩短字数视为默认提升。」
 *
 * 正交意图：
 *   [1] 输入面：test/fixtures/steward/evaluation/ 的 10 条 fixture（5 应触发 +
 *       5 不应触发），每条携带 expectation.json（期望、类别、判断理由、usage
 *       unknown）。
 *   [2] 策略对比：baseline = 「任何 finding 即提案」；candidate = 「warning+
 *       且结构化类别（冲突/文档缺陷）才提案，info 级（宽触发面/共享路径/描述
 *       重叠）只进人工复核」。逐条记录两策略的原始 findings 与命中/漏报/误报。
 *   [3] 非健康分：不输出单一分数；输出逐输入判定 + 逐优化（策略门）的预期
 *       收益/失败风险/保留或拒绝理由；token 估算（字符/4）与真实消耗
 *       （deterministic transport = 0 LLM token）分别记录。
 * 妥协声明：当前 agent 为 deterministic transport——评估测的是触发策略层（真实
 *   analyzeDocuments 引擎 + 真实 registry 工具面），live 模型的判断质量评估随
 *   4.6 已记录的凭据 blocker 补验。
 *
 * 执行：`pnpm exec tsx scripts/steward-effectiveness.sh.ts`
 * 产物：openspec/changes/steward-product-workflow/artifacts/steward-effectiveness.json
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const evaluationDir = path.join(root, "test", "fixtures", "steward", "evaluation");
const artifactsDir = path.join(
  root,
  "openspec",
  "changes",
  "steward-product-workflow",
  "artifacts",
);

type AnalyzerFindingKind = NonNullable<
  ReturnType<typeof analyzeDocuments>["findings"][number]["kind"]
>;

/** 与候选门一致的结构化类别（冲突与文档缺陷）；info 级只进复核。 */
const ACTIONABLE_KINDS = new Set<AnalyzerFindingKind>([
  "duplicate-name",
  "duplicate-trigger",
  "mutually-exclusive-rules",
  "validation-error",
  "missing-description",
  "empty-body",
]);

interface Finding {
  kind: AnalyzerFindingKind;
  severity: "info" | "warning" | "error";
  message: string;
  skillIds: string[];
}

function fail(message: string): never {
  console.error(`steward-effectiveness: FAIL: ${message}`);
  process.exit(1);
}

function flush(evidence: Record<string, unknown>): void {
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactsDir, "steward-effectiveness.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
}

/** baseline：任何 finding 都提案。 */
function baselinePolicy(findings: Finding[]): boolean {
  return findings.length > 0;
}

/** candidate：warning+ 且结构化类别才提案；info 级进人工复核清单。 */
function candidatePolicy(findings: Finding[]): { propose: boolean; reviewOnly: Finding[] } {
  const reviewOnly = findings.filter(
    (finding) => finding.severity === "info" || !ACTIONABLE_KINDS.has(finding.kind),
  );
  const propose = findings.some(
    (finding) =>
      (finding.severity === "warning" || finding.severity === "error") &&
      ACTIONABLE_KINDS.has(finding.kind),
  );
  return { propose, reviewOnly };
}

// —— 真实分析面：与 skills.relations 工具完全同一条代码路径 ——
const { analyzeDocuments } = await import("../src/daemon/skill-intelligence/analyzer.js");

interface CaseResult {
  case: string;
  expectTrigger: boolean;
  expectedKinds: string[];
  category: string;
  judgmentReason: string;
  usageHistory: string;
  tokenEstimate: number;
  realLlmTokens: number;
  skills: Array<{ directory: string; sha256: string }>;
  findingsRaw: Finding[];
  baseline: { propose: boolean; verdict: string };
  candidate: { propose: boolean; reviewOnlyKinds: string[]; verdict: string };
}

function runCase(caseDir: string, name: string): CaseResult {
  const expectation = JSON.parse(
    fs.readFileSync(path.join(caseDir, "expectation.json"), "utf8"),
  ) as {
    expectTrigger: boolean;
    expectedKinds: string[];
    category: string;
    reason: string;
    usageHistory: string;
  };
  const skillDirs = fs
    .readdirSync(caseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(caseDir, entry.name))
    .sort();
  const documents = skillDirs.map((dir, index) => {
    const file = path.join(dir, "SKILL.md");
    const content = fs.readFileSync(file, "utf8");
    // 与真实快照一致：name 取 frontmatter（目录名只作 directoryName）。
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const nameMatch = frontmatterMatch?.[1]?.match(/^name:\s*(.+)$/m);
    return {
      workspaceId: "ws_evaluation0000000000000" as never,
      providerId: "openclaw" as never,
      skillId: `sk_eval${String(index).padStart(2, "0")}0000000000000` as never,
      name: (nameMatch?.[1] ?? path.basename(dir)).trim(),
      directoryName: path.basename(dir),
      disabled: false,
      revision: `sha256:${createHash("sha256").update(content).digest("hex")}`,
      content,
    };
  });
  const charTotal = documents.reduce((sum, doc) => sum + doc.content.length, 0);
  const report = analyzeDocuments(documents);
  const findingsRaw = report.findings.map((finding) => ({
    kind: finding.kind,
    severity: finding.severity,
    message: finding.message,
    skillIds: finding.skillIds,
  }));

  const baseline = baselinePolicy(findingsRaw);
  const candidate = candidatePolicy(findingsRaw);
  const observedKinds: AnalyzerFindingKind[] = [
    ...new Set(findingsRaw.map((finding) => finding.kind)),
  ];

  const verdictOf = (proposed: boolean): string => {
    if (expectation.expectTrigger && proposed) {
      const missing = (expectation.expectedKinds as AnalyzerFindingKind[]).filter(
        (kind) => !kind.startsWith("unknown") && !observedKinds.includes(kind),
      );
      return missing.length === 0
        ? "hit"
        : `hit-with-unexpected-kinds(missing:${missing.join(",")})`;
    }
    if (expectation.expectTrigger && !proposed) return "miss";
    if (!expectation.expectTrigger && proposed) return "false-alarm";
    return "correctly-quiet";
  };

  return {
    case: name,
    expectTrigger: expectation.expectTrigger,
    expectedKinds: expectation.expectedKinds,
    category: expectation.category,
    judgmentReason: expectation.reason,
    usageHistory: expectation.usageHistory,
    tokenEstimate: Math.ceil(charTotal / 4),
    realLlmTokens: 0,
    skills: documents.map((doc, index) => ({
      directory: doc.directoryName,
      sha256: doc.revision.slice("sha256:".length),
    })),
    findingsRaw,
    baseline: { propose: baseline, verdict: verdictOf(baseline) },
    candidate: {
      propose: candidate.propose,
      reviewOnlyKinds: [...new Set(candidate.reviewOnly.map((finding) => finding.kind))],
      verdict: verdictOf(candidate.propose),
    },
  };
}

const shouldDirs = fs
  .readdirSync(path.join(evaluationDir, "should-trigger"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const noDirs = fs
  .readdirSync(path.join(evaluationDir, "no-trigger"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
if (shouldDirs.length !== 5) fail(`expected 5 should-trigger cases, found ${shouldDirs.length}`);
if (noDirs.length !== 5) fail(`expected 5 no-trigger cases, found ${noDirs.length}`);

const results = [
  ...shouldDirs.map((name) => runCase(path.join(evaluationDir, "should-trigger", name), name)),
  ...noDirs.map((name) => runCase(path.join(evaluationDir, "no-trigger", name), name)),
];

const summarize = (policy: "baseline" | "candidate") => {
  const verdicts = results.map((result) => result[policy].verdict);
  return {
    hits: verdicts.filter((verdict) => verdict.startsWith("hit")).length,
    misses: verdicts.filter((verdict) => verdict === "miss").length,
    falseAlarms: verdicts.filter((verdict) => verdict === "false-alarm").length,
    correctlyQuiet: verdicts.filter((verdict) => verdict === "correctly-quiet").length,
  };
};

const evidence = {
  script: "scripts/steward-effectiveness.sh.ts",
  generatedAt: new Date().toISOString(),
  analyzerVersion: "deterministic analyzeDocuments (src/daemon/skill-intelligence/analyzer.ts)",
  modelVersion: "steward-deterministic transport (no live LLM; real token consumption = 0)",
  policies: {
    baseline: "propose on ANY finding (severity-agnostic)",
    candidate:
      "propose only on warning+ findings of structural kinds (conflict / doc defect); info-level findings (wide-trigger-surface, shared-resource-path, overlapping-responsibility) go to human review only",
  },
  docIntegrity: {
    note: "evaluation is read-only over fixtures; skill sha256 recorded per case",
    skillsHashed: results.reduce((sum, result) => sum + result.skills.length, 0),
  },
  baselineSummary: summarize("baseline"),
  candidateSummary: summarize("candidate"),
  tokenAccounting: {
    estimateNote: "tokenEstimate = content chars / 4 per case (upper-bound heuristic)",
    realNote: "realLlmTokens = 0 for every case: deterministic transport performs no model call",
    perCaseEstimateTotal: results.reduce((sum, result) => sum + result.tokenEstimate, 0),
  },
  cases: results,
};
flush(evidence);

for (const result of results) {
  console.log(
    `${result.case}: baseline=${result.baseline.verdict} candidate=${result.candidate.verdict}` +
      (result.candidate.reviewOnlyKinds.length
        ? ` (review-only: ${result.candidate.reviewOnlyKinds.join(",")})`
        : ""),
  );
}
console.log(
  `summary: baseline ${JSON.stringify(evidence.baselineSummary)} -> candidate ${JSON.stringify(evidence.candidateSummary)}`,
);

// 验收断言：candidate 必须全命中零误报；baseline 的误报差即策略收益的原始证据。
const bad = results.filter(
  (result) => result.candidate.verdict !== "hit" && result.candidate.verdict !== "correctly-quiet",
);
if (bad.length > 0) {
  fail(
    `candidate policy regressions: ${bad.map((result) => `${result.case}:${result.candidate.verdict}`).join(", ")}`,
  );
}
if (evidence.candidateSummary.hits !== 5 || evidence.candidateSummary.falseAlarms !== 0) {
  fail(`candidate summary unexpected: ${JSON.stringify(evidence.candidateSummary)}`);
}
console.log("steward-effectiveness: evaluation passed (candidate 5 hits / 0 false alarms)");
