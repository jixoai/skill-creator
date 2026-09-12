/**
 * model-fields 纯函数单测（codex R7 B2：effort 补全去硬编码）。
 * 用户原始需求 [2026-09-12]：「Effort 设置这里，不能硬编码」——候选 = 全部路由
 * 已配置 efforts 的并集（用户自派生）；目录 compat supportsReasoningEffort ===
 * false 时清空候选 + hint；目录投影透传该旗标（缺失 = undefined 不伪造）。
 *
 * 正交意图：
 *   [1] effortCandidates：并集去重排序 / false 旗标空候选 + hint / 无配置空 /
 *       true 与未知旗标不设门。
 *   [2] catalogModelCandidates：supportsReasoningEffort 的首见投影（有则带、
 *       无则省略键）。
 */
import { describe, expect, it } from "vitest";
import {
  catalogModelCandidates,
  EFFORT_UNSUPPORTED_HINT,
  effortCandidates,
} from "../components/settings/model-fields.js";

describe("effortCandidates (R7 B2: user-derived, not hardcoded)", () => {
  it("unions efforts across all route models, dedupes and sorts", () => {
    const result = effortCandidates(
      [{ efforts: ["high", "low"] }, {}, { efforts: ["low", "turbo", "high"] }],
      null,
    );
    expect(result).toEqual({ candidates: ["high", "low", "turbo"], hint: null });
  });

  it("returns empty candidates when no route has configured efforts", () => {
    expect(effortCandidates([{}, { efforts: undefined }], undefined)).toEqual({
      candidates: [],
      hint: null,
    });
    expect(effortCandidates([], null)).toEqual({ candidates: [], hint: null });
  });

  it("clears candidates and returns the hint when the catalog marks the model unsupported", () => {
    const result = effortCandidates([{ efforts: ["high", "low"] }], {
      supportsReasoningEffort: false,
    });
    expect(result).toEqual({ candidates: [], hint: EFFORT_UNSUPPORTED_HINT });
    expect(EFFORT_UNSUPPORTED_HINT).toBe(
      "Catalog marks this model as not supporting reasoning effort",
    );
  });

  it("does not gate on true or unknown catalog flags", () => {
    const routes = [{ efforts: ["low"] }];
    expect(effortCandidates(routes, { supportsReasoningEffort: true })).toEqual({
      candidates: ["low"],
      hint: null,
    });
    expect(effortCandidates(routes, {})).toEqual({ candidates: ["low"], hint: null });
  });

  it("trims effort entries before union (whitespace never becomes a candidate)", () => {
    expect(effortCandidates([{ efforts: [" low ", "low", ""] }], null)).toEqual({
      candidates: ["low"],
      hint: null,
    });
  });
});

describe("catalogModelCandidates supportsReasoningEffort projection", () => {
  it("keeps the flag on first-seen entries and omits the key when absent", () => {
    const catalog = {
      providers: [
        {
          provider: "p1",
          label: "P1",
          api: "openai-completions",
          baseURL: "https://p1.test",
          icon: null,
          models: [
            { id: "m-flagged", image: false, supportsReasoningEffort: false },
            { id: "m-plain", image: false },
          ],
        },
        {
          provider: "p2",
          label: "P2",
          api: "anthropic-messages",
          baseURL: "https://p2.test",
          icon: null,
          models: [{ id: "m-flagged", image: false, supportsReasoningEffort: true }],
        },
      ],
    };
    const candidates = catalogModelCandidates(catalog);
    expect(candidates.find((entry) => entry.id === "m-flagged")?.supportsReasoningEffort).toBe(
      false,
    );
    expect("supportsReasoningEffort" in (candidates.find((e) => e.id === "m-plain") ?? {})).toBe(
      false,
    );
  });
});
