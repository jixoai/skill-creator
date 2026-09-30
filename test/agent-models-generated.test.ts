/**
 * agent-models 生成物 runtime 门（agent-models-config-v1 task 4.3）。
 *
 * 用户原始需求 [2026-09-30]：「将 zcode 标准作为 agent-models-config 配置标准。」
 * type-safe = runtime-safe：生成物是 TS 常量（编译期类型保证），本测试以标准
 * schema safeParse 复核 runtime 形状——生成器或 schema 任一漂移在此拦截。
 *
 * 正交意图：
 *   [1] 生成物 runtime 校验：标准 schema 全量 safeParse + 溯源常量存在。
 *   [2] 关键语义锚点：zai-api/GLM-5.3 的 tier params（CEL 逐档求值产物）与
 *       paramName 分化锚死，防上游语义静默漂移。
 * 妥协声明：无。
 */
import { describe, expect, it } from "vitest";
import { AgentModelsConfigSchema } from "../src/shared/contracts/agent-models.js";
import {
  AGENT_MODELS_GENERATED_AT,
  AGENT_MODELS_SOURCE_URL,
  AGENT_MODELS_UPSTREAM_REVISION,
  agentModelsConfig,
} from "../src/daemon/agent-models.generated.js";

describe("agent-models.generated.ts", () => {
  it("safeParses against the agent-models-config v1 schema", () => {
    const parsed = AgentModelsConfigSchema.safeParse(agentModelsConfig);
    if (!parsed.success) {
      throw new Error(
        `生成物不符合标准 schema：${parsed.error.issues
          .slice(0, 5)
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")}`,
      );
    }
    expect(parsed.data.providers.length).toBeGreaterThanOrEqual(20);
  });

  it("carries provenance constants", () => {
    // N2：溯源恒为 canonical 上游（本地 fixture 重跑不污染 provenance）。
    expect(AGENT_MODELS_SOURCE_URL).toMatch(
      /^https:\/\/raw\.githubusercontent\.com\/zai-org\/ZCode\/main\//,
    );
    expect(AGENT_MODELS_UPSTREAM_REVISION).toBe(agentModelsConfig.revision);
    expect(AGENT_MODELS_GENERATED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(agentModelsConfig.sources[0]).toMatchObject({
      id: "zcode-registry",
      license: "Apache-2.0",
      fetchedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });

  it("anchors zai-api GLM-5.3 evaluated capabilities", () => {
    const zai = agentModelsConfig.providers.find((p) => p.id === "zai-api");
    expect(zai).toBeDefined();
    const glm = zai!.models.find((m) => m.id === "GLM-5.3");
    expect(glm).toBeDefined();
    expect(glm!.properties?.contextWindow).toBe(1_000_000);
    expect(glm!.properties?.input).toMatchObject({ text: true, image: true, video: true });
    expect(glm!.options?.maxOutputTokens).toEqual({ max: 128_000, paramName: "max_tokens" });
    const low = glm!.options?.reasoning?.tiers.find((tier) => tier.id === "low");
    expect(low?.kind).toBe("effort");
    // CEL 逐档求值产物锚点（rev 30 zai-api anthropic 线）。
    expect(low?.params).toMatchObject({ output_config: { effort: "low" } });

    const standard = agentModelsConfig.providers.find((p) => p.id === "zai-standard-api");
    const glmStd = standard!.models.find((m) => m.id === "GLM-5.3")!;
    // 同模型 openai 线 paramName 分化。
    expect(glmStd.options?.maxOutputTokens?.paramName).toBe("max_completion_tokens");
  });

  it("keeps disabled models and account providers in the standard artifact", () => {
    const zai = agentModelsConfig.providers.find((p) => p.id === "zai-api")!;
    expect(zai.models.find((m) => m.id === "GLM-5-Turbo")?.enabled).toBe(false);
    const account = agentModelsConfig.providers.find(
      (p) => p.id === "account:zai-individual-coding-plan",
    );
    expect(account?.access).toEqual({
      type: "account",
      vendor: "zai",
      plan: "individual-coding-plan",
    });
    expect(account?.visibility).toBeUndefined();
    expect(
      agentModelsConfig.providers.find((p) => p.id === "account:zai-offpeak-idle-plan")?.visibility,
    ).toBe("hidden");
  });

  it("has every tier either paramed or intentionally bare (never fabricated)", () => {
    for (const provider of agentModelsConfig.providers) {
      for (const model of provider.models) {
        for (const tier of model.options?.reasoning?.tiers ?? []) {
          expect(tier.id.length).toBeGreaterThan(0);
          if (tier.params !== undefined) {
            expect(typeof tier.params).toBe("object");
          }
        }
      }
    }
  });
});
