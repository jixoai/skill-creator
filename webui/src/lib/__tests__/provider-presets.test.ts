/**
 * 本地 provider presets store 单测（redesign-model-tabs-and-agent-panel S1）。
 *
 * 用户原始需求 [2026-09-12]：「『另存为预设』把当前 route 的值包写入本地 presets；
 * NewTab 画廊多一个『Your presets』分组，卡片可删除。」
 *
 * 正交意图：
 *   [1] 往返一致性：save → localStorage → load 恢复同一集合；同名保存为替换。
 *   [2] 损坏丢弃：坏 JSON blob / 非数组 / 逐条 safeParse 失败的条目按领域投影
 *       丢弃，不抛错、不写回、不迁移。
 *   [3] 删除语义：按 provider 名移除并持久化。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROVIDER_PRESETS_STORAGE_KEY,
  deleteProviderPreset,
  loadProviderPresets,
  providerPresets,
  saveProviderPreset,
} from "../stores/provider-presets.svelte";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, value),
  } as Storage;
}

const deepseekPreset = {
  provider: "deepseek",
  label: "DeepSeek",
  api: "openai-completions",
  baseURL: "https://api.deepseek.com/v1",
  models: ["deepseek-chat", "deepseek-reasoner"],
};

const gatewayPreset = {
  provider: "local-gateway",
  label: "Local Gateway",
  baseURL: "http://127.0.0.1:8787/v1",
  models: ["proxy-model"],
  icon: "data:image/svg+xml;utf8,%3Csvg%3E%3C%2Fsvg%3E",
};

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  providerPresets.list = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider presets store (S1)", () => {
  it("round-trips save → localStorage → reload", () => {
    saveProviderPreset(deepseekPreset);
    saveProviderPreset(gatewayPreset);

    expect(localStorage.getItem(PROVIDER_PRESETS_STORAGE_KEY)).not.toBeNull();
    expect(providerPresets.list.map((item) => item.provider)).toEqual([
      "local-gateway",
      "deepseek",
    ]);

    // 模拟下一次会话：内存重置后从 localStorage 恢复。
    providerPresets.list = [];
    const restored = loadProviderPresets();
    expect(restored).toEqual([gatewayPreset, deepseekPreset]);
    expect(providerPresets.list).toHaveLength(2);
  });

  it("saving a same-name preset replaces it instead of duplicating", () => {
    saveProviderPreset(deepseekPreset);
    saveProviderPreset({
      ...deepseekPreset,
      baseURL: "https://api.deepseek.com/cn",
      models: ["deepseek-chat"],
    });

    expect(providerPresets.list).toHaveLength(1);
    expect(providerPresets.list[0]).toMatchObject({
      provider: "deepseek",
      baseURL: "https://api.deepseek.com/cn",
      models: ["deepseek-chat"],
    });

    const stored = JSON.parse(
      localStorage.getItem(PROVIDER_PRESETS_STORAGE_KEY) ?? "[]",
    ) as unknown[];
    expect(stored).toHaveLength(1);
  });

  it("drops a corrupt blob (invalid JSON / non-array) as empty", () => {
    localStorage.setItem(PROVIDER_PRESETS_STORAGE_KEY, "{not json");
    expect(loadProviderPresets()).toEqual([]);

    localStorage.setItem(PROVIDER_PRESETS_STORAGE_KEY, JSON.stringify({ nope: true }));
    expect(loadProviderPresets()).toEqual([]);

    // 坏 blob 不写回、不抛错：key 原样保留（无兼容迁移）。
    expect(localStorage.getItem(PROVIDER_PRESETS_STORAGE_KEY)).toBe('{"nope":true}');
  });

  it("drops individual corrupt entries and keeps valid ones", () => {
    const mixed = [
      deepseekPreset,
      { provider: "", label: "empty provider", baseURL: "https://x.example", models: ["m"] },
      { provider: "no-base-url", label: "No baseURL", models: ["m"] },
      { provider: "no-models", label: "No models", baseURL: "https://x.example", models: [] },
      "not-an-object",
      null,
      gatewayPreset,
    ];
    localStorage.setItem(PROVIDER_PRESETS_STORAGE_KEY, JSON.stringify(mixed));

    const loaded = loadProviderPresets();
    expect(loaded.map((item) => item.provider)).toEqual(["deepseek", "local-gateway"]);
  });

  it("deletes presets by provider name and persists", () => {
    saveProviderPreset(deepseekPreset);
    saveProviderPreset(gatewayPreset);

    deleteProviderPreset("deepseek");

    expect(providerPresets.list.map((item) => item.provider)).toEqual(["local-gateway"]);
    const stored = JSON.parse(
      localStorage.getItem(PROVIDER_PRESETS_STORAGE_KEY) ?? "[]",
    ) as unknown[];
    expect(stored).toHaveLength(1);
  });
});
