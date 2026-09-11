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
  });

  it("pins known providers first and excludes internal routes", () => {
    const providers = listModelProviders();
    expect(providers[0]?.provider).toBe("zai-coding-cn");
    expect(providers.map((entry) => entry.provider)).not.toContain("faux");
  });
});
