/**
 * ccski wrapper 退役收据脚本门禁测试（ccski-3-host-migration 宿主修复批 7，P1-F）。
 *
 * User input [2026-10-07]（MainAgent 工单，Codex 终审第二轮 P1-F）:
 * 「收据脚本假绿（scripts/ccski-wrapper-receipt.sh.ts:122/261）：compareShape
 * 记录 missing rows 但退出码只看字段 drift；Map 折叠重复键 → 行集合不一致仍
 * exit 0」。
 *
 * Orthogonal intents:
 *   [1] 判失败边界：缺行（仅单侧在场）与重复行键 fixture → 门禁必须判红
 *       （脚本层映射 exit 1，不再假绿）。
 *   [2] 判绿边界：全等 fixture → 门禁绿（保守不等于永久红）。
 */
import { describe, expect, it } from "vitest";
import { compareShape, evaluateReceiptGate } from "../scripts/ccski-wrapper-receipt.sh.ts";
import type { ProjectedRow } from "../scripts/ccski-wrapper-receipt.sh.ts";

/** 构造一行七字段全等的投影行（key = name|canonicalPath|disabled）。 */
function row(name: string, overrides: Partial<Record<string, string>> = {}): ProjectedRow {
  return {
    name,
    provider: "cline",
    location: "custom",
    sourceKind: "custom",
    sourcePriority: "500",
    disabled: "false",
    canonicalPath: `<fixture>/provider-root/${name}`,
    directoryName: name,
    ...overrides,
  };
}

describe("ccski wrapper receipt gate (P1-F)", () => {
  it("stays green for fully identical row sets", () => {
    const shape = compareShape(
      "all:true",
      [row("real-enabled"), row("linked-skill")],
      [row("real-enabled"), row("linked-skill")],
    );
    expect(shape.drift).toHaveLength(0);
    expect(shape.missingInDirect).toHaveLength(0);
    expect(shape.missingInWrapper).toHaveLength(0);
    expect(shape.duplicateWrapperKeys).toHaveLength(0);
    expect(shape.duplicateDirectKeys).toHaveLength(0);
    expect(evaluateReceiptGate([shape])).toEqual({ ok: true, reasons: [] });
  });

  it("fails the gate when rows exist only on one side (missing rows 进门禁，不再假绿)", () => {
    // 旧行为：missingInDirect 只进报告，退出码只看 drift → exit 0 假绿。
    const wrapperOnly = compareShape(
      "all:true",
      [row("real-enabled"), row("wrapper-only")],
      [row("real-enabled")],
    );
    const gate = evaluateReceiptGate([wrapperOnly]);
    expect(gate.ok).toBe(false);
    expect(gate.reasons.join("\n")).toContain("missing in direct");
    // 脚本层映射：!ok → process.exitCode = 1（非零退出）。
    expect(gate.ok ? 0 : 1).toBe(1);

    const directOnly = compareShape(
      "all:true",
      [row("real-enabled")],
      [row("real-enabled"), row("direct-only")],
    );
    expect(evaluateReceiptGate([directOnly]).reasons.join("\n")).toContain("missing in wrapper");
  });

  it("fails the gate when either side folds duplicate row keys (Map 折叠不再吞行集合不一致)", () => {
    // 旧行为：Map 折叠把同键多行并成一行 → 无 drift、无 missing → exit 0 假绿。
    const wrapperDup = compareShape(
      "all:true",
      [row("real-enabled"), row("real-enabled")],
      [row("real-enabled")],
    );
    expect(wrapperDup.drift).toHaveLength(0);
    expect(wrapperDup.missingInDirect).toHaveLength(0);
    expect(wrapperDup.missingInWrapper).toHaveLength(0);
    const gate = evaluateReceiptGate([wrapperDup]);
    expect(gate.ok).toBe(false);
    expect(gate.reasons.join("\n")).toContain("duplicate wrapper row key");

    const directDup = compareShape(
      "all:false",
      [row("linked-skill")],
      [row("linked-skill"), row("linked-skill", { provider: "other" })],
    );
    const directGate = evaluateReceiptGate([directDup]);
    expect(directGate.ok).toBe(false);
    expect(directGate.reasons.join("\n")).toContain("duplicate direct row key");
  });

  it("fails the gate on field drift (既有语义回归钉住)", () => {
    // 注意：disabled 在行键里（name|canonicalPath|disabled），改它会换键变缺行；
    // 字段漂移用非键字段（provider）构造。
    const drifted = compareShape(
      "all:true",
      [row("real-enabled", { provider: "other" })],
      [row("real-enabled")],
    );
    const gate = evaluateReceiptGate([drifted]);
    expect(gate.ok).toBe(false);
    expect(gate.reasons.join("\n")).toContain("drifted field");
  });
});
