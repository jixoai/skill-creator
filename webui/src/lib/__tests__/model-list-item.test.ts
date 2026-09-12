// @vitest-environment jsdom
/**
 * ModelListItem 组件测试（R7 8.7：字段编辑/校验/删除/连接测试/token 往返；
 * codex R7 B2/B4 纠偏）。
 * 用户原始需求 [2026-09-12]：「每个 ModelListItem：modelId 输入（选中已知 id 自动
 * 预填）、ModelName 自动生成可改、Effort tags、上下文窗口/最大输出 Token 简写
 * 解析（失焦解析为数字回显规范化格式；非法红边不提交）、输入类型多选
 * （text 必含不可去）、输出类型勾选、连接测试按钮、移除。」（B2 纠偏：「Effort
 * 设置这里，不能硬编码」——候选 = 全部路由 efforts 并集 + 目录 false 旗标 hint；
 * B4 纠偏：无已存 key 时提供 test-only key 输入，apiKey 直传不落盘。）
 * 正交意图：
 *   [1] 受控编辑：经 controlled host 回填 onchange（真实父级语义）——id/预填/
 *       name/efforts/inputTypes 的状态往返 + 预填只发生在未手触字段。
 *   [2] token 简写：parseTokenShorthand 往返（0.5M/253k/纯数字 → 规范化回显；
 *       非法红边不提交、onvalidity=false）。
 *   [3] 连接测试（B4 语义）：已存 key → provider 传递、无 apiKey、无 password
 *       输入；未存 key → password 输入出现、填入后按钮可用并带 apiKey 直传。
 *   [4] effort 补全（B2 语义）：候选来自 routeModels 并集（非硬编码词表）；
 *       目录 supportsReasoningEffort === false → 空候选 + 固定 hint。
 */
import { describe, expect, it, vi } from "vitest";

const agentStore = vi.hoisted(() => ({
  testRouteConnection: vi.fn(),
}));

vi.mock("../stores/agent.svelte", () => ({
  testRouteConnection: agentStore.testRouteConnection,
}));

import ControlledModelHost from "./stubs/controlled-model-host.svelte";
import { flushSync, mount, unmount } from "./svelte-client";

const CANDIDATES = [
  { id: "glm-5.3-flash", name: "GLM 5.3 Flash", image: true, contextWindow: 131072 },
  { id: "deepseek-chat", image: false },
];

function mountItem(
  initial: Record<string, unknown>,
  props: Partial<{
    apiKeyConfigured: boolean;
    provider: string;
    api: string;
    baseURL: string;
    candidates: Array<Record<string, unknown>>;
    routeModels: Array<Record<string, unknown>>;
  }> = {},
) {
  const onchange = vi.fn<(next: Record<string, unknown>) => void>();
  const onvalidity = vi.fn<(valid: boolean) => void>();
  const onremove = vi.fn();
  const target = document.createElement("div");
  document.body.appendChild(target);
  const instance = mount(ControlledModelHost, {
    target,
    props: {
      initial,
      candidates: (props.candidates ?? CANDIDATES) as never,
      routeModels: (props.routeModels ?? []) as never,
      api: props.api ?? "anthropic-messages",
      baseURL: props.baseURL ?? "http://localhost:20002/anthropic",
      provider: props.provider ?? "",
      apiKeyConfigured: props.apiKeyConfigured ?? false,
      onchangeLog: onchange as never,
      onvalidityLog: onvalidity,
      onremoveLog: onremove,
    },
  });
  flushSync();
  return {
    onchange,
    onvalidity,
    onremove,
    target,
    state: (): Record<string, unknown> =>
      JSON.parse(target.querySelector<HTMLSpanElement>('[data-testid="model-json"]')!.textContent!),
    inputByLabel: (label: string) =>
      target.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!,
    keyInput: () =>
      target.querySelector<HTMLInputElement>('input[aria-label="API key (test only)"]'),
    effortInput: () => target.querySelector<HTMLInputElement>('input[placeholder^="Add effort"]')!,
    testButton: () =>
      [...target.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Test connection"),
      )!,
    chipByName: (name: string): HTMLButtonElement =>
      [...target.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")].find(
        (b) => b.textContent?.trim() === name,
      )!,
    /** 聚焦 effort 输入后展开的补全候选（ModelTagsInput listbox 的 id 段）。 */
    effortSuggestions: (): string[] => {
      const input = target.querySelector<HTMLInputElement>('input[placeholder^="Add effort"]')!;
      input.focus();
      flushSync();
      return [...target.querySelectorAll('ul[aria-label="Model suggestions"] button')].map(
        (button) => {
          const idSpan = button.querySelector("span span");
          return idSpan?.textContent?.trim().replace(/^\(|\)$/g, "") ?? "";
        },
      );
    },
    statusText: () => target.querySelector("span.truncate")?.textContent ?? "",
    cleanup: () => {
      unmount(instance);
      target.remove();
    },
  };
}

function typeValue(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
}

function blur(input: HTMLInputElement): void {
  input.dispatchEvent(new Event("blur"));
  flushSync();
}

function pressKey(el: HTMLElement, key: string): void {
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  flushSync();
}

describe("ModelListItem (R7 8.7)", () => {
  it("prefills name/contextWindow/inputTypes when the typed id matches the catalog", () => {
    const ctx = mountItem({ id: "" }, { apiKeyConfigured: true });
    typeValue(ctx.inputByLabel("Model id"), "glm-5.3-flash");
    expect(ctx.state()).toEqual({
      id: "glm-5.3-flash",
      name: "GLM 5.3 Flash",
      contextWindow: 131072,
      inputTypes: ["text", "image"],
    });
    expect(ctx.inputByLabel("Model name").value).toBe("GLM 5.3 Flash");
    expect(ctx.inputByLabel("Context window (tokens)").value).toBe("128k");
    expect(ctx.chipByName("image").getAttribute("aria-pressed")).toBe("true");
    ctx.cleanup();
  });

  it("clears stale prefill fields when the id is rewritten to an unknown one", () => {
    const ctx = mountItem({ id: "" });
    typeValue(ctx.inputByLabel("Model id"), "glm-5.3-flash");
    typeValue(ctx.inputByLabel("Model id"), "my-relay-model");
    expect(ctx.state()).toEqual({ id: "my-relay-model" });
    ctx.cleanup();
  });

  it("generates a readable name for unknown ids and keeps manual edits (write name)", () => {
    const ctx = mountItem({ id: "glm-5.3-flash" });
    expect(ctx.inputByLabel("Model name").value).toBe("GLM 5.3 Flash");
    typeValue(ctx.inputByLabel("Model name"), "My Relay Model");
    expect(ctx.state()).toEqual({ id: "glm-5.3-flash", name: "My Relay Model" });
    ctx.cleanup();
  });

  it("edits efforts through the tags input (write efforts)", () => {
    const ctx = mountItem({ id: "m1" });
    const input = ctx.effortInput();
    input.focus();
    typeValue(input, "xhigh");
    pressKey(input, "Enter");
    expect(ctx.state()).toEqual({ id: "m1", efforts: ["xhigh"] });
    ctx.cleanup();
  });

  it("derives effort suggestions from all route models (union, deduped, sorted)", () => {
    const ctx = mountItem(
      { id: "m1" },
      {
        routeModels: [
          { id: "a", efforts: ["high", "low"] },
          { id: "b", efforts: ["low", "turbo", "high"] },
        ],
      },
    );
    expect(ctx.effortSuggestions()).toEqual(["high", "low", "turbo"]);
    ctx.cleanup();
  });

  it("offers no effort suggestions when no route has configured efforts (no hardcoded list)", () => {
    const ctx = mountItem({ id: "m1" }, { routeModels: [{ id: "a" }, { id: "b" }] });
    expect(ctx.effortSuggestions()).toEqual([]);
    // 空候选不是阻断：tags-input 仍自由输入。
    const input = ctx.effortInput();
    typeValue(input, "custom-tier");
    pressKey(input, "Enter");
    expect(ctx.state()).toEqual({ id: "m1", efforts: ["custom-tier"] });
    ctx.cleanup();
  });

  it("clears candidates and shows the catalog hint when the model is marked unsupported", () => {
    const ctx = mountItem(
      { id: "ling-2.6-1t" },
      {
        candidates: [{ id: "ling-2.6-1t", image: false, supportsReasoningEffort: false }],
        routeModels: [{ id: "a", efforts: ["high"] }],
      },
    );
    expect(ctx.effortSuggestions()).toEqual([]);
    expect(ctx.target.textContent).toContain(
      "Catalog marks this model as not supporting reasoning effort",
    );
    // hint 是提示不是阻断：仍可自由输入。
    const input = ctx.effortInput();
    typeValue(input, "anyway");
    pressKey(input, "Enter");
    expect(ctx.state()).toEqual({ id: "ling-2.6-1t", efforts: ["anyway"] });
    ctx.cleanup();
  });

  it("parses token shorthand on blur and echoes the normalized form (0.5M / 253k / raw)", () => {
    const ctx = mountItem({ id: "m1" });
    const field = ctx.inputByLabel("Context window (tokens)");
    typeValue(field, "0.5M");
    blur(field);
    expect(field.value).toBe("512k");
    expect(ctx.state()).toEqual({ id: "m1", contextWindow: 524288 });

    typeValue(field, "253k");
    blur(field);
    expect(field.value).toBe("253k");
    expect(ctx.state()).toEqual({ id: "m1", contextWindow: 259072 });

    typeValue(field, "131072");
    blur(field);
    expect(field.value).toBe("128k");
    expect(ctx.state()).toEqual({ id: "m1", contextWindow: 131072 });
    ctx.cleanup();
  });

  it("marks invalid token input red, does not commit, and flips validity", () => {
    const ctx = mountItem({ id: "m1" });
    const field = ctx.inputByLabel("Max output tokens");
    const commitsBefore = ctx.onchange.mock.calls.length;
    typeValue(field, "lots");
    blur(field);
    expect(field.className).toContain("border-destructive");
    expect(ctx.onchange.mock.calls.length).toBe(commitsBefore);
    expect(ctx.state()).toEqual({ id: "m1" });
    expect(ctx.onvalidity).toHaveBeenLastCalledWith(false);

    typeValue(field, "32k");
    blur(field);
    expect(ctx.onvalidity).toHaveBeenLastCalledWith(true);
    expect(ctx.state()).toEqual({ id: "m1", maxOutputTokens: 32768 });
    ctx.cleanup();
  });

  it("keeps text in inputTypes mandatory and toggles optional kinds", () => {
    const ctx = mountItem({ id: "m1", inputTypes: ["text", "image"] });
    ctx.chipByName("pdf").click();
    flushSync();
    expect(ctx.state()).toEqual({ id: "m1", inputTypes: ["text", "image", "pdf"] });
    ctx.chipByName("image").click();
    flushSync();
    expect(ctx.state()).toEqual({ id: "m1", inputTypes: ["text", "pdf"] });
    ctx.cleanup();
  });

  it("shows a test-only password input when no credential is stored; button waits for it", () => {
    const ctx = mountItem({ id: "m1" }, { apiKeyConfigured: false, provider: "zai-2" });
    const keyInput = ctx.keyInput();
    expect(keyInput).not.toBeNull();
    expect(keyInput!.type).toBe("password");
    expect(keyInput!.getAttribute("placeholder")).toBe("API key (test only)");
    expect(ctx.testButton().disabled).toBe(true);
    expect(ctx.statusText()).toContain("No saved key");
    expect(agentStore.testRouteConnection).not.toHaveBeenCalled();
    typeValue(keyInput!, "sk-draft-1");
    expect(ctx.testButton().disabled).toBe(false);
    ctx.cleanup();
  });

  it("sends the pasted test-only apiKey (not stored) when no credential exists", async () => {
    agentStore.testRouteConnection.mockReset();
    agentStore.testRouteConnection.mockResolvedValue({ outcome: "ok", latencyMs: 88 });
    const ctx = mountItem({ id: "m1" }, { apiKeyConfigured: false, provider: "zai-2" });
    typeValue(ctx.keyInput()!, "sk-draft-1");
    ctx.testButton().click();
    flushSync();
    await vi.waitFor(() => expect(ctx.statusText()).toContain("ok · 88 ms"));
    expect(agentStore.testRouteConnection).toHaveBeenCalledWith({
      api: "anthropic-messages",
      baseURL: "http://localhost:20002/anthropic",
      modelId: "m1",
      provider: "zai-2",
      apiKey: "sk-draft-1",
    });
    ctx.cleanup();
  });

  it("tests via stored credential (provider passed, no apiKey, no password input)", async () => {
    agentStore.testRouteConnection.mockReset();
    agentStore.testRouteConnection.mockResolvedValue({ outcome: "ok", latencyMs: 412 });
    const ctx = mountItem({ id: "glm-5.3-flash" }, { apiKeyConfigured: true, provider: "zai" });
    expect(ctx.keyInput()).toBeNull();
    expect(ctx.testButton().disabled).toBe(false);
    ctx.testButton().click();
    flushSync();
    await vi.waitFor(() => expect(ctx.statusText()).toContain("ok · 412 ms"));
    expect(agentStore.testRouteConnection).toHaveBeenCalledWith({
      api: "anthropic-messages",
      baseURL: "http://localhost:20002/anthropic",
      modelId: "glm-5.3-flash",
      provider: "zai",
    });
    ctx.cleanup();
  });

  it("renders failed+detail and omits provider for unnamed drafts", async () => {
    agentStore.testRouteConnection.mockReset();
    agentStore.testRouteConnection.mockResolvedValue({
      outcome: "failed",
      detail: "HTTP 401",
    });
    const ctx = mountItem({ id: "m1" }, { apiKeyConfigured: true, provider: "" });
    ctx.testButton().click();
    flushSync();
    await vi.waitFor(() => expect(ctx.statusText()).toContain("failed · HTTP 401"));
    expect(agentStore.testRouteConnection).toHaveBeenCalledWith({
      api: "anthropic-messages",
      baseURL: "http://localhost:20002/anthropic",
      modelId: "m1",
    });
    ctx.cleanup();
  });

  it("removes itself via the remove button", () => {
    const ctx = mountItem({ id: "m1" });
    ctx.target.querySelector<HTMLButtonElement>('button[aria-label="Remove model m1"]')!.click();
    flushSync();
    expect(ctx.onremove).toHaveBeenCalledTimes(1);
    ctx.cleanup();
  });
});
