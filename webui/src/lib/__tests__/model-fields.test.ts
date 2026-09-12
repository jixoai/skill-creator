/**
 * model-fields 纯函数单测（codex R7 B2 + R10 五项走查）。
 * 用户原始需求 [2026-09-12]：「Effort 设置这里，不能硬编码」——候选 = 用户自派生
 * 并集；目录 compat supportsReasoningEffort === false 时清空候选 + hint。
 * 用户原始需求 [2026-09-12 R10]：「智谱的模型，@cf/zai-org/glm-5.3 这明显是无效
 * 的」——跨 provider 候选剔除命名空间 id、当前 provider 置顶（含命名空间 id）；
 * 「Effort 按照 OpenAI/Anthropic/Gemini 的接口标准提供各种档位，默认提供
 * Low/High/Max 三档」——EFFORT_TIERS 标准档位 + DEFAULT_MODEL_EFFORTS 默认三档
 * + 目录 effortTiers 融入候选并集。
 *
 * 正交意图：
 *   [1] effortCandidates：标准档位 ∪ 目录 effortTiers ∪ 路由并集（去重排序）/
 *       false 旗标空候选 + hint / trim 归一。
 *   [2] catalogModelCandidates（R10-1）：当前 provider 置顶（含命名空间 id）、
 *       跨 provider 剔命名空间 id、同 id 去重当前 provider 优先、富字段
 *       （inputTypes/maxOutputTokens/effortTiers/supportsReasoningEffort）投影。
 *   [3] 档位常量：EFFORT_TIERS 内容与顺序、DEFAULT_MODEL_EFFORTS 三档。
 */
import { describe, expect, it } from "vitest";
import {
  catalogModelCandidates,
  DEFAULT_MODEL_EFFORTS,
  EFFORT_TIERS,
  EFFORT_UNSUPPORTED_HINT,
  effortCandidates,
  isNamespaceModelId,
} from "../components/settings/model-fields.js";

describe("effort tier constants (R10-5: user-decreed, interface-standard)", () => {
  it("EFFORT_TIERS covers OpenAI tiers plus xhigh and Gemini/Claude-style max", () => {
    expect(EFFORT_TIERS).toEqual(["minimal", "low", "medium", "high", "xhigh", "max"]);
  });

  it("DEFAULT_MODEL_EFFORTS is the user-specified Low/High/Max trio", () => {
    expect(DEFAULT_MODEL_EFFORTS).toEqual(["low", "high", "max"]);
  });
});

describe("effortCandidates (R7 B2 union + R10-5 fusion)", () => {
  it("fuses standard tiers, catalog effortTiers, and route-model unions (deduped, sorted)", () => {
    const result = effortCandidates(
      [{ efforts: ["high", "low"] }, {}, { efforts: ["low", "turbo", "high"] }],
      { effortTiers: ["ultra", "xhigh"] },
    );
    expect(result).toEqual({
      candidates: ["high", "low", "max", "medium", "minimal", "turbo", "ultra", "xhigh"],
      hint: null,
    });
  });

  it("offers the standard tiers even when nothing is configured (user decree, not a hack)", () => {
    const sortedTiers = [...EFFORT_TIERS].sort();
    expect(effortCandidates([{}, { efforts: undefined }], undefined)).toEqual({
      candidates: sortedTiers,
      hint: null,
    });
    expect(effortCandidates([], null)).toEqual({ candidates: sortedTiers, hint: null });
  });

  it("clears candidates and returns the hint when the catalog marks the model unsupported", () => {
    const result = effortCandidates([{ efforts: ["high", "low"] }], {
      supportsReasoningEffort: false,
      effortTiers: ["max"],
    });
    expect(result).toEqual({ candidates: [], hint: EFFORT_UNSUPPORTED_HINT });
    expect(EFFORT_UNSUPPORTED_HINT).toBe(
      "Catalog marks this model as not supporting reasoning effort",
    );
  });

  it("does not gate on true or unknown catalog flags", () => {
    const routes = [{ efforts: ["low"] }];
    const expected = [...EFFORT_TIERS].sort();
    expect(effortCandidates(routes, { supportsReasoningEffort: true })).toEqual({
      candidates: expected,
      hint: null,
    });
    expect(effortCandidates(routes, {})).toEqual({ candidates: expected, hint: null });
  });

  it("trims effort entries before union (whitespace never becomes a candidate)", () => {
    expect(effortCandidates([{ efforts: [" low ", "low", ""] }], null)).toEqual({
      candidates: [...EFFORT_TIERS].sort(),
      hint: null,
    });
  });
});

describe("catalogModelCandidates (R10-1 sanitization + pinning)", () => {
  const catalog = {
    providers: [
      {
        provider: "cloudflare",
        label: "Cloudflare",
        api: "openai-completions",
        baseURL: "https://cf.test",
        icon: null,
        models: [
          { id: "@cf/zai-org/glm-5.3", image: false },
          { id: "workers-ai-smol", image: true },
        ],
      },
      {
        provider: "zai",
        label: "Z.ai",
        api: "openai-completions",
        baseURL: "https://z.ai",
        icon: null,
        models: [{ id: "glm-5.3", image: true }],
      },
    ],
  };

  it("isNamespaceModelId flags host-scoped ids", () => {
    expect(isNamespaceModelId("@cf/zai-org/glm-5.3")).toBe(true);
    expect(isNamespaceModelId("openai/gpt-4o")).toBe(true);
    expect(isNamespaceModelId("glm-5.3")).toBe(false);
  });

  it("drops namespace ids from cross-provider candidates (the @cf/... case)", () => {
    const ids = catalogModelCandidates(catalog).map((entry) => entry.id);
    expect(ids).not.toContain("@cf/zai-org/glm-5.3");
    expect(ids).toEqual(["glm-5.3", "workers-ai-smol"]);
  });

  it("pins the current provider's models first, keeping its namespace ids", () => {
    const ids = catalogModelCandidates(catalog, "cloudflare").map((entry) => entry.id);
    expect(ids).toEqual(["@cf/zai-org/glm-5.3", "workers-ai-smol", "glm-5.3"]);
  });

  it("lets the current provider's entry win the dedupe against other providers", () => {
    const both = {
      providers: [
        {
          provider: "p1",
          label: "P1",
          api: "openai-completions",
          baseURL: "https://p1.test",
          icon: null,
          models: [{ id: "shared-id", image: false, contextWindow: 111111 }],
        },
        {
          provider: "p2",
          label: "P2",
          api: "openai-completions",
          baseURL: "https://p2.test",
          icon: null,
          models: [{ id: "shared-id", image: true, contextWindow: 222222 }],
        },
      ],
    };
    // p1 先见（无当前 provider）→ 首见条目保留。
    expect(catalogModelCandidates(both)[0]?.contextWindow).toBe(111111);
    // p2 为当前 provider → 其条目覆盖 p1 的净化条目。
    expect(catalogModelCandidates(both, "p2")[0]?.contextWindow).toBe(222222);
    expect(catalogModelCandidates(both, "p2")).toHaveLength(1);
  });

  it("projects the R10 rich fields (inputTypes / maxOutputTokens / effortTiers) first-seen", () => {
    const rich = catalogModelCandidates({
      providers: [
        {
          provider: "zai",
          label: "Z.ai",
          api: "openai-completions",
          baseURL: "https://z.ai",
          icon: null,
          models: [
            {
              id: "glm-5.3",
              image: true,
              inputTypes: ["text"],
              maxOutputTokens: 131072,
              effortTiers: ["high", "max", "xhigh"],
            },
            { id: "m-plain", image: false },
          ],
        },
      ],
    });
    const glm = rich.find((entry) => entry.id === "glm-5.3");
    expect(glm?.inputTypes).toEqual(["text"]);
    expect(glm?.maxOutputTokens).toBe(131072);
    expect(glm?.effortTiers).toEqual(["high", "max", "xhigh"]);
    expect("inputTypes" in (rich.find((e) => e.id === "m-plain") ?? {})).toBe(false);
  });

  it("keeps the supportsReasoningEffort flag on first-seen entries and omits it when absent", () => {
    const flagged = catalogModelCandidates({
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
    });
    expect(flagged.find((entry) => entry.id === "m-flagged")?.supportsReasoningEffort).toBe(false);
    expect("supportsReasoningEffort" in (flagged.find((e) => e.id === "m-plain") ?? {})).toBe(
      false,
    );
  });
});
