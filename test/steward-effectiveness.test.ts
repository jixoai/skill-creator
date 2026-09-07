/**
 * 评估 fixture 期望矩阵回归（openspec steward-product-workflow task 4.7）。
 *
 * 用户原始需求 [2026-09-07]：「明确该触发的 5 条输入、不该触发的 5 条输入；含
 * 冲突对、分工重叠对、配套脚本技能。」本测试把 harness 的判定固化为回归——
 * fixture 或 analyzer 行为漂移（新误报/漏报）在这里显式失败。
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { analyzeDocuments } from "../src/daemon/skill-intelligence/analyzer.js";

const evaluationDir = path.join(__dirname, "fixtures", "steward", "evaluation");

interface CaseExpectation {
  case: string;
  expectTrigger: boolean;
  expectedKinds: string[];
  category: string;
}

function loadCases(group: "should-trigger" | "no-trigger"): CaseExpectation[] {
  return fs
    .readdirSync(path.join(evaluationDir, group), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const expectation = JSON.parse(
        fs.readFileSync(path.join(evaluationDir, group, name, "expectation.json"), "utf8"),
      ) as Omit<CaseExpectation, "case">;
      return { case: name, ...expectation };
    });
}

/** 与 harness 相同的真实分析面 + 候选策略门。 */
function analyze(caseDir: string) {
  const documents = fs
    .readdirSync(caseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((directoryName, index) => {
      const content = fs.readFileSync(path.join(caseDir, directoryName, "SKILL.md"), "utf8");
      const frontmatter = content.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
      const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? directoryName;
      return {
        workspaceId: "ws_evaluation0000000000000" as never,
        providerId: "openclaw" as never,
        skillId: `sk_eval${String(index).padStart(2, "0")}0000000000000` as never,
        name,
        directoryName,
        disabled: false,
        revision: `sha256:${createHash("sha256").update(content).digest("hex")}`,
        content,
      };
    });
  return analyzeDocuments(documents);
}

const ACTIONABLE = new Set([
  "duplicate-name",
  "duplicate-trigger",
  "mutually-exclusive-rules",
  "validation-error",
  "missing-description",
  "empty-body",
]);

function candidateProposes(caseDir: string): { propose: boolean; kinds: string[] } {
  const report = analyze(caseDir);
  const kinds = [...new Set(report.findings.map((finding) => finding.kind))];
  const propose = report.findings.some(
    (finding) =>
      (finding.severity === "warning" || finding.severity === "error") &&
      ACTIONABLE.has(finding.kind),
  );
  return { propose, kinds };
}

describe("steward effectiveness fixture matrix (task 4.7)", () => {
  it("should-trigger cases all hit with the expected finding kinds", () => {
    for (const expectation of loadCases("should-trigger")) {
      const caseDir = path.join(evaluationDir, "should-trigger", expectation.case);
      const { propose, kinds } = candidateProposes(caseDir);
      expect(propose, `${expectation.case} should trigger the candidate policy`).toBe(true);
      for (const kind of expectation.expectedKinds) {
        expect(kinds, `${expectation.case} missing ${kind}`).toContain(kind);
      }
    }
  });

  it("no-trigger cases stay quiet under the candidate policy", () => {
    for (const expectation of loadCases("no-trigger")) {
      const caseDir = path.join(evaluationDir, "no-trigger", expectation.case);
      const { propose, kinds } = candidateProposes(caseDir);
      expect(propose, `${expectation.case} must not trigger the candidate policy`).toBe(false);
      // info 级背景提示允许出现，但必须与 expectation 声明一致。
      for (const kind of kinds) {
        expect(
          expectation.expectedKinds.includes(kind) || expectation.expectedKinds.length === 0,
          `${expectation.case} unexpected finding kind ${kind}`,
        ).toBe(true);
      }
    }
  });

  it("baseline (any-finding) false-alarms exactly on the two info-only cases", () => {
    const noisy = [...loadCases("should-trigger"), ...loadCases("no-trigger")].filter(
      (expectation) => {
        const group = expectation.expectTrigger ? "should-trigger" : "no-trigger";
        const report = analyze(path.join(evaluationDir, group, expectation.case));
        return report.findings.length > 0 && !expectation.expectTrigger;
      },
    );
    expect(noisy.map((entry) => entry.case).sort()).toEqual([
      "09-wide-trigger-only",
      "10-overlap-descriptions-only",
    ]);
  });
});
