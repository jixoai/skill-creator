/**
 * 模型目录投影单测（openspec add-agent-settings-modes 迭代四）。
 *
 * 用户原始需求 [2026-09-11]：「直接基于 models.generated.js 去提供可用提供商。」
 *
 * 正交意图：
 *   [1] 数据源真实性：从 pi-ai 装配目录（models.dev 镜像）resolve 出 data JSON，
 *       重点 provider（zai/anthropic/openai 等）在列且形状完整。
 *   [2] 投影法则：baseURL 非空、image 标志与 input 声明一致、faux 排除、
 *       重点 provider 置顶。
 */
import { describe, expect, it } from "vitest";
import { listModelProviders } from "../src/daemon/model-catalog.js";

describe("model provider catalog", () => {
  it("projects the pi-ai catalog with complete shapes", () => {
    const providers = listModelProviders();
    expect(providers.length).toBeGreaterThan(20);
    for (const entry of providers) {
      expect(entry.provider).toMatch(/^[a-z0-9-]+$/);
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.baseURL).toMatch(/^https?:\/\//);
      expect(entry.models.length).toBeGreaterThan(0);
      // icon：dataURL 或 null（字母回退），不可能是外链。
      if (entry.icon !== null) expect(entry.icon).toMatch(/^data:image\/svg\+xml;base64,/);
    }
  });

  it("covers the user-named providers and marks vision models", () => {
    const providers = listModelProviders();
    const ids = providers.map((entry) => entry.provider);
    for (const expected of [
      "zai-coding-cn",
      "moonshotai-cn",
      "deepseek",
      "minimax-cn",
      "qwen-token-plan-cn",
      "openai",
      "anthropic",
      "google",
    ]) {
      expect(ids).toContain(expected);
    }
    const anthropic = providers.find((entry) => entry.provider === "anthropic");
    expect(anthropic?.models.some((model) => model.image)).toBe(true);
    expect(anthropic?.icon).toMatch(/^data:image\/svg\+xml;base64,/);
    // 用户点名厂商必须带图标（models.dev 有 logo）。
    for (const expected of [
      "zai-coding-cn",
      "moonshotai-cn",
      "minimax-cn",
      "deepseek",
      "openai",
      "google",
    ]) {
      expect(providers.find((entry) => entry.provider === expected)?.icon).toBeTruthy();
    }
  });

  it("pins known providers first and excludes internal routes", () => {
    const providers = listModelProviders();
    expect(providers[0]?.provider).toBe("zai-coding-cn");
    expect(providers.map((entry) => entry.provider)).not.toContain("faux");
  });

  it("passes through pi-ai compat.supportsReasoningEffort verbatim (missing stays undefined)", () => {
    const providers = listModelProviders();
    // ant-ling Ling-2.6-1T 的 compat 显式声明 false（pi-ai 数据钉死事实）。
    const antLing = providers.find((entry) => entry.provider === "ant-ling");
    expect(
      antLing?.models.find((model) => model.id === "Ling-2.6-1T")?.supportsReasoningEffort,
    ).toBe(false);
    // zai-coding-cn 存在声明 true 的模型（补全候选门只挡 false）。
    const zai = providers.find((entry) => entry.provider === "zai-coding-cn");
    expect(zai?.models.some((model) => model.supportsReasoningEffort === true)).toBe(true);
    // 全集只可能是 boolean / undefined——缺失不伪造（大多数模型无 compat 声明）。
    for (const entry of providers) {
      for (const model of entry.models) {
        expect(
          model.supportsReasoningEffort === undefined ||
            typeof model.supportsReasoningEffort === "boolean",
        ).toBe(true);
      }
    }
    // 大多数模型缺失 compat 声明 → 投影必须保留 undefined（不降级为 false）。
    const all = providers.flatMap((entry) => entry.models);
    expect(
      all.filter((model) => model.supportsReasoningEffort === undefined).length,
    ).toBeGreaterThan(all.length / 2);
  });
});
