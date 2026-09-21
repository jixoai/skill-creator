/**
 * 用户原始需求 [2026-09-21]：「是 skill-wiki 输入的一部分」——轨迹采样钉死
 * 论文分层预算（≤5 失败 + ≤3 通过、15k 单条 cap）。
 * 正交意图：[1] 采样纯函数的预算/顺序/截断契约。
 */
import { describe, expect, it } from "vitest";
import {
  ENTRY_CHAR_CAP,
  MAX_SAMPLED_FAILURES,
  MAX_SAMPLED_PASSES,
  sampleTrajectories,
  type TrajectoryEntry,
} from "../src/index.js";

function entry(id: string, outcome: "pass" | "fail", content = `content-${id}`): TrajectoryEntry {
  return { id, outcome, content };
}

describe("sampleTrajectories", () => {
  it("keeps everything when under both budgets, in input order", () => {
    const input = [entry("a", "fail"), entry("b", "pass"), entry("c", "fail")];
    expect(sampleTrajectories(input)).toEqual(input);
  });

  it("keeps only the most recent 5 failures", () => {
    const fails = Array.from({ length: 8 }, (_, i) => entry(`f${i}`, "fail"));
    const sampled = sampleTrajectories(fails);
    expect(sampled.map((e) => e.id)).toEqual(["f3", "f4", "f5", "f6", "f7"]);
  });

  it("keeps only the most recent 3 passes", () => {
    const passes = Array.from({ length: 6 }, (_, i) => entry(`p${i}`, "pass"));
    const sampled = sampleTrajectories(passes);
    expect(sampled.map((e) => e.id)).toEqual(["p3", "p4", "p5"]);
  });

  it("mixes strata while preserving input order", () => {
    const input = [
      entry("f0", "fail"),
      entry("p0", "pass"),
      entry("f1", "fail"),
      entry("p1", "pass"),
    ];
    expect(sampledTrajectoriesIds(input)).toEqual(["f0", "p0", "f1", "p1"]);
  });

  it("truncates each entry's content to ENTRY_CHAR_CAP", () => {
    const long = "x".repeat(ENTRY_CHAR_CAP + 500);
    const [sampled] = sampleTrajectories([entry("big", "fail", long)]);
    expect(sampled?.content).toHaveLength(ENTRY_CHAR_CAP);
  });

  it("returns an empty array for empty input", () => {
    expect(sampleTrajectories([])).toEqual([]);
  });

  it("exposes the paper's budget constants", () => {
    expect(MAX_SAMPLED_FAILURES).toBe(5);
    expect(MAX_SAMPLED_PASSES).toBe(3);
    expect(ENTRY_CHAR_CAP).toBe(15_000);
  });
});

function sampledTrajectoriesIds(input: TrajectoryEntry[]): string[] {
  return sampleTrajectories(input).map((e) => e.id);
}
