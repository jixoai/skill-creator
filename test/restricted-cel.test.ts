/**
 * Restricted CEL 求值器单测（agent-models-config-v1 task 4.1）。
 *
 * 用户原始需求 [2026-09-30]：「将 zcode 标准作为 agent-models-config 配置标准。」
 * 用例形态 = rev 30 全部 25 个 distinct map 的真实形态类别（枚举分派/参数名直传/
 * 布尔开关/空对象/算术）；语义基准 = zai-org/ZCode packages/model-option-map。
 *
 * 正交意图：
 *   [1] DSL 保真：vendored 求值器对真实 map 形态逐位复现 ZCode 求值结果。
 *   [2] 拒绝面：成员访问/函数调用/未知标识符/类型混用按上游语义报错。
 * 妥协声明：无。
 */
import { describe, expect, it } from "vitest";
import { evaluateModelOptionMap, RestrictedCelError } from "../scripts/lib/restricted-cel.js";

describe("evaluateModelOptionMap (real rev-30 map forms)", () => {
  it("evaluates anthropic adaptive-effort ternary dispatch per tier", () => {
    // zai-api 线（anthropic-messages 通用规则，rev 30 实文）。
    const map = `reasoningLevel == "disabled"
  ? {
      "thinking": {
        "type": "disabled"
      }
    }
  : {
      "thinking": {
        "type": "enabled"
      },
      "output_config": {
        "effort": reasoningLevel == "enabled" ? "high" : reasoningLevel
      }
    }`;
    expect(evaluateModelOptionMap(map, "reasoningLevel", "disabled")).toEqual({
      thinking: { type: "disabled" },
    });
    expect(evaluateModelOptionMap(map, "reasoningLevel", "low")).toEqual({
      thinking: { type: "enabled" },
      output_config: { effort: "low" },
    });
    // 开关档 enabled 映射为 high（三元内层分派）。
    expect(evaluateModelOptionMap(map, "reasoningLevel", "enabled")).toEqual({
      thinking: { type: "enabled" },
      output_config: { effort: "high" },
    });
  });

  it("evaluates pass-through param maps", () => {
    expect(
      evaluateModelOptionMap('{"reasoning_effort": reasoningLevel}', "reasoningLevel", "high"),
    ).toEqual({
      reasoning_effort: "high",
    });
    expect(
      evaluateModelOptionMap(
        '{\n  "reasoning": {\n    "effort": reasoningLevel\n  }\n}',
        "reasoningLevel",
        "max",
      ),
    ).toEqual({ reasoning: { effort: "max" } });
  });

  it("evaluates boolean switch and zhipu multi-key maps", () => {
    expect(
      evaluateModelOptionMap(
        '{"enable_thinking": reasoningLevel == "enabled"}',
        "reasoningLevel",
        "enabled",
      ),
    ).toEqual({
      enable_thinking: true,
    });
    const zhipu = `{"thinking": {"type": reasoningLevel == "disabled" || reasoningLevel == "none" ? "disabled" : "enabled"}, "enable_thinking": reasoningLevel != "disabled" && reasoningLevel != "none", "reasoning_effort": reasoningLevel == "disabled" ? "none" : reasoningLevel}`;
    expect(evaluateModelOptionMap(zhipu, "reasoningLevel", "low")).toEqual({
      thinking: { type: "enabled" },
      enable_thinking: true,
      reasoning_effort: "low",
    });
    expect(evaluateModelOptionMap(zhipu, "reasoningLevel", "disabled")).toEqual({
      thinking: { type: "disabled" },
      enable_thinking: false,
      reasoning_effort: "none",
    });
  });

  it("evaluates empty-object and maxOutput identity maps", () => {
    expect(evaluateModelOptionMap("{}", "reasoningLevel", "low")).toEqual({});
    expect(
      evaluateModelOptionMap('{"max_tokens": maxOutputTokens}', "maxOutputTokens", 128000),
    ).toEqual({
      max_tokens: 128000,
    });
    expect(
      evaluateModelOptionMap("{'max_completion_tokens': maxOutputTokens}", "maxOutputTokens", 512),
    ).toEqual({
      max_completion_tokens: 512,
    });
  });

  it("keeps __proto__ as an own enumerable data key (upstream null-prototype semantics, B2)", () => {
    const result = evaluateModelOptionMap(
      '{"__proto__": {"polluted": true}, "safe": 1}',
      "reasoningLevel",
      "low",
    );
    expect(Object.keys(result)).toEqual(["__proto__", "safe"]);
    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    expect(Object.hasOwn(result, "safe")).toBe(true);
    // 原型未被污染：普通对象上读 polluted 不存在。
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    // 期望值用 JSON.parse 构造：对象字面量的 __proto__: 是原型设置器，不是自有键。
    const expected = JSON.parse('{"__proto__": {"polluted": true}, "safe": 1}');
    expect(Object.hasOwn(expected, "__proto__")).toBe(true);
    expect(result).toEqual(expected);
    expect(JSON.parse(JSON.stringify(result))).toEqual(expected);
  });

  it("rejects non-JSON-safe numeric input (upstream assertRestrictedCelValue, B5)", () => {
    expect(() =>
      evaluateModelOptionMap('{"x": maxOutputTokens}', "maxOutputTokens", Number.NaN),
    ).toThrow(RestrictedCelError);
    expect(() =>
      evaluateModelOptionMap('{"x": maxOutputTokens}', "maxOutputTokens", Number.POSITIVE_INFINITY),
    ).toThrow(RestrictedCelError);
    expect(() =>
      evaluateModelOptionMap(
        '{"x": maxOutputTokens}',
        "maxOutputTokens",
        Number.MAX_SAFE_INTEGER + 1,
      ),
    ).toThrow(RestrictedCelError);
    // 有限浮点仍是合法输入。
    expect(evaluateModelOptionMap('{"x": maxOutputTokens}', "maxOutputTokens", 1.5)).toEqual({
      x: 1.5,
    });
  });

  it("supports arithmetic and comparison (subset ZCode allows)", () => {
    expect(
      evaluateModelOptionMap('{"budget": 1024 + maxOutputTokens * 2}', "maxOutputTokens", 8),
    ).toEqual({
      budget: 1040,
    });
  });
});

describe("evaluateModelOptionMap rejections (upstream semantics)", () => {
  it("rejects member access, calls, unknown identifiers and type mixing", () => {
    expect(() =>
      evaluateModelOptionMap('{"a": reasoningLevel.foo}', "reasoningLevel", "low"),
    ).toThrow(RestrictedCelError);
    expect(() =>
      evaluateModelOptionMap('{"a": len(reasoningLevel)}', "reasoningLevel", "low"),
    ).toThrow(RestrictedCelError);
    expect(() => evaluateModelOptionMap('{"a": unknownVar}', "reasoningLevel", "low")).toThrow(
      RestrictedCelError,
    );
    // 字符串与数字比较 = 上游 evaluator 拒绝（同型才可比较）。
    expect(() =>
      evaluateModelOptionMap('{"a": reasoningLevel < 5}', "reasoningLevel", "low"),
    ).toThrow(RestrictedCelError);
  });

  it("rejects non-object top-level results and empty source", () => {
    expect(() => evaluateModelOptionMap("reasoningLevel", "reasoningLevel", "low")).toThrow(
      RestrictedCelError,
    );
    expect(() => evaluateModelOptionMap("  ", "reasoningLevel", "low")).toThrow(RestrictedCelError);
  });
});
