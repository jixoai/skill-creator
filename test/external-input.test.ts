/**
 * External input parsing contract tests.
 *
 * User input [2026-07-21]: "任何外部输入都应该遵循这个规则：各种配置文件、数据库结构、网络返回等"
 * Architecture decision [2026-07-21]: incompatible external snapshots become
 * explicit empty values before they enter domain state.
 *
 * Orthogonal intents:
 *   [1] Parse external JSON without exposing syntax errors as domain data.
 *   [2] Narrow current-schema values without accepting incompatible shapes.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { safeParseExternal, safeParseJson } from "../src/shared/external-input.js";

const SnapshotSchema = z.object({ schemaVersion: z.literal(1), items: z.array(z.string()) });

describe("external input parsing", () => {
  it("returns the current snapshot only when JSON and schema are both valid", () => {
    expect(safeParseJson('{"schemaVersion":1,"items":["current"]}', SnapshotSchema)).toEqual({
      schemaVersion: 1,
      items: ["current"],
    });
  });

  it("returns empty for malformed JSON and incompatible external values", () => {
    expect(safeParseJson("{", SnapshotSchema)).toBeNull();
    expect(safeParseExternal(SnapshotSchema, { schemaVersion: 0, items: [] })).toBeNull();
  });
});
