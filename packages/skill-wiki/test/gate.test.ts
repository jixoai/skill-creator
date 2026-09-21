/**
 * 用户原始需求 [2026-09-21]：「将它移植进来，用 skill-wiki 这个包来承载」
 * （论文 §3.2.6 Gating & Rollback 的严格提升语义 + skill-impact 审计足迹）。
 * 正交意图：[1] gate 决策边界（严格提升才 accept）；[2] 决策条目 schema 钉死。
 */
import { describe, expect, it } from "vitest";
import { SkillImpactEntrySchema, decideGate } from "../src/index.js";

const proposal = { action: "create", skill: "exit-code-gating", summary: "add gating" };
const baseInput = {
  proposal,
  baselineScore: 0.4,
  candidateScore: 0.5,
  date: "2026-09-21T00:00:00.000Z",
};

describe("decideGate", () => {
  it("accepts on strict improvement", () => {
    const decision = decideGate(baseInput);
    expect(decision.decision).toBe("accept");
    expect(decision.improved).toBe(true);
    expect(decision.reason).toContain("strict improvement");
    expect(decision.entry.decision).toBe("accept");
  });

  it("rejects when the score is equal (no strict improvement)", () => {
    const decision = decideGate({ ...baseInput, candidateScore: 0.4 });
    expect(decision.decision).toBe("reject");
    expect(decision.improved).toBe(false);
    expect(decision.reason).toContain("rolled back");
  });

  it("rejects when the score regresses", () => {
    const decision = decideGate({ ...baseInput, candidateScore: 0.3999 });
    expect(decision.decision).toBe("reject");
  });

  it("embeds the score delta and optional context in the reason", () => {
    const decision = decideGate({ ...baseInput, context: "5 replayed tasks" });
    expect(decision.reason).toContain("0.4000 -> 0.5000 (+0.1000)");
    expect(decision.reason).toContain("5 replayed tasks");
  });

  it("produces entries that pass SkillImpactEntrySchema", () => {
    for (const candidateScore of [0.5, 0.4, 0.1]) {
      const decision = decideGate({ ...baseInput, candidateScore });
      expect(SkillImpactEntrySchema.safeParse(decision.entry).success).toBe(true);
      expect(decision.entry.proposal).toEqual(proposal);
    }
  });

  it("defaults the date to a real timestamp when not injected", () => {
    const decision = decideGate({ ...baseInput, date: undefined });
    expect(decision.entry.date).not.toBe("2026-09-21T00:00:00.000Z");
    expect(() => new Date(decision.entry.date).toISOString()).not.toThrow();
  });
});
