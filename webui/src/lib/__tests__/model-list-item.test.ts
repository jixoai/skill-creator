// @vitest-environment jsdom
/**
 * ModelListItem 组件测试（R7 8.7 + R10 走查 2/3/4/5）。
 * 用户原始需求 [2026-09-12]：「每个 ModelListItem：modelId 输入（选中已知 id 自动
 * 预填）、ModelName 自动生成可改、Effort tags、上下文窗口/最大输出 Token 简写
 * 解析（失焦解析为数字回显规范化格式；非法红边不提交）、输入类型多选
 * （text 必含不可去）、输出类型勾选、连接测试按钮、移除。」（B2 纠偏：「Effort
 * 设置这里，不能硬编码」——候选 = 标准档位 ∪ 目录 ∪ 路由并集；B4 纠偏：无已存
 * key 时提供 test-only key 输入，apiKey 直传不落盘。）
 * 用户原始需求 [2026-09-12 R10]：「默认收起，只显示一行：ModelName + test/edit/
 * remove 三个 icon-button（44px 命中区）；dirty 名字旁小圆点」；「input/output
 * chips 选中 = primary 底白字、text 恒选中不可去（视觉锁定）」；「目录命中预填
 * inputTypes/maxOutputTokens（glm-5.3 = text/131072/128k 回显）、手选后不被目录
 * 覆盖（除非再换 modelId）」；「efforts 默认 Low/High/Max 三档」。
 * 正交意图：
 *   [1] 折叠态（R10-2）：默认只见 header（name + 三 icon-button）；edit 切换展开；
 *       折叠行 remove/test 直达；dirty 小圆点；initialExpanded 挂载即展开。
 *   [2] 受控编辑：经 controlled host 回填 onchange（真实父级语义）——id/预填/
 *       name/efforts/inputTypes 的状态往返 + 预填只发生在未手触字段 + 换 id 重预填。
 *   [3] token 简写：parseTokenShorthand 往返（0.5M/253k/纯数字 → 规范化回显；
 *       非法红边不提交、onvalidity=false）。
 *   [4] 连接测试（B4 语义）：已存 key → provider 传递、无 apiKey、无 password
 *       输入；未存 key → password 输入出现、填入后按钮可用并带 apiKey 直传；
 *       折叠行 icon-button 与展开态按钮同一行为。
 *   [5] chips 锁定（R10-3）：text 输入 chip 与输出 chip 为非 button 的选中态
 *       （视觉锁定），可选项 chips 点击切换且选中态为 primary 底白字。
 */
import { describe, expect, it, vi } from "vitest";

const agentStore = vi.hoisted(() => ({
  testRouteConnection: vi.fn(),
}));

vi.mock("../stores/agent.svelte", () => ({
  testRouteConnection: agentStore.testRouteConnection,
}));

// ModelListItem 经 @lucide/svelte 引入 node_modules 的 .svelte 图标（root vitest
// 管线不编译）——以同签名 stub 替换（class 透传，无视觉语义）。
vi.mock("@lucide/svelte/icons/pencil", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/plug-zap", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/trash-2", async () => await import("./stubs/lucide-icon-mocks.js"));

import ControlledModelHost from "./stubs/controlled-model-host.svelte";
import { flushSync, mount, unmount } from "./svelte-client";

const CANDIDATES = [
  { id: "glm-5.3-flash", name: "GLM 5.3 Flash", image: true, contextWindow: 131072 },
  { id: "deepseek-chat", image: false },
];

/** glm-5.3 的目录富字段（R10-3/4/5：input 数组/maxTokens/thinkingLevelMap 投影）。 */
const GLM_CANDIDATES = [
  {
    id: "glm-5.3",
    name: "GLM 5.3",
    image: true,
    contextWindow: 1_000_000,
    inputTypes: ["text"],
    maxOutputTokens: 131072,
    effortTiers: ["high", "xhigh", "max"],
  },
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
    dirty: boolean;
    initialExpanded: boolean;
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
      dirty: props.dirty ?? false,
      initialExpanded: props.initialExpanded ?? false,
      onchangeLog: onchange as never,
      onvalidityLog: onvalidity,
      onremoveLog: onremove,
    },
  });
  flushSync();
  const editButton = (): HTMLButtonElement =>
    target.querySelector<HTMLButtonElement>('button[aria-label^="Edit model"]')!;
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
    /** 折叠行三个 icon-button（R10-2；44px 命中区）。 */
    headerTestButton: (): HTMLButtonElement =>
      target.querySelector<HTMLButtonElement>('button[aria-label^="Test connection for"]')!,
    headerRemoveButton: (): HTMLButtonElement =>
      target.querySelector<HTMLButtonElement>('button[aria-label^="Remove model"]')!,
    editButton,
    /** 展开/收起表单（同一 edit icon-button 双向切换）。 */
    expand: (): void => {
      editButton().click();
      flushSync();
    },
    collapse: (): void => {
      editButton().click();
      flushSync();
    },
    headerName: (): string =>
      target.querySelector<HTMLElement>("[data-header-name]")?.textContent ?? "",
    headerStatus: (): string =>
      target.querySelector<HTMLElement>("[data-header-status]")?.textContent ?? "",
    dirtyDot: (): HTMLElement | null => target.querySelector('[aria-label="Unsaved changes"]'),
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
    statusText: () => target.querySelector("[data-form-status]")?.textContent ?? "",
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

describe("ModelListItem collapsed row (R10-2)", () => {
  it("renders collapsed by default: header name + three icon buttons, no form fields", () => {
    const ctx = mountItem({ id: "m1", name: "My Model" }, { apiKeyConfigured: true });
    expect(ctx.headerName()).toBe("My Model");
    expect(ctx.target.querySelector('input[aria-label="Model id"]')).toBeNull();
    expect(ctx.target.querySelector('input[aria-label="Model name"]')).toBeNull();
    expect(ctx.headerTestButton()).toBeTruthy();
    expect(ctx.editButton()).toBeTruthy();
    expect(ctx.headerRemoveButton()).toBeTruthy();
    // 44px 命中区（h-11/w-11 = 44px）。
    for (const button of [ctx.headerTestButton(), ctx.editButton(), ctx.headerRemoveButton()]) {
      expect(button.className).toContain("h-11");
      expect(button.className).toContain("w-11");
    }
    ctx.cleanup();
  });

  it("falls back to the readable id (or 'New model') when the entry has no name", () => {
    const named = mountItem({ id: "glm-5.3-flash" });
    expect(named.headerName()).toBe("GLM 5.3 Flash");
    named.cleanup();
    const fresh = mountItem({ id: "" });
    expect(fresh.headerName()).toBe("New model");
    fresh.cleanup();
  });

  it("toggles the form through the edit icon button", () => {
    const ctx = mountItem({ id: "m1" });
    ctx.expand();
    expect(ctx.target.querySelector('input[aria-label="Model id"]')).not.toBeNull();
    ctx.collapse();
    expect(ctx.target.querySelector('input[aria-label="Model id"]')).toBeNull();
    ctx.cleanup();
  });

  it("mounts expanded with initialExpanded (the + Add model entry)", () => {
    const ctx = mountItem({ id: "" }, { initialExpanded: true });
    expect(ctx.target.querySelector('input[aria-label="Model id"]')).not.toBeNull();
    ctx.cleanup();
  });

  it("removes itself from the collapsed row without expanding", () => {
    const ctx = mountItem({ id: "m1" });
    ctx.headerRemoveButton().click();
    flushSync();
    expect(ctx.onremove).toHaveBeenCalledTimes(1);
    ctx.cleanup();
  });

  it("shows the dirty dot only when the entry has unsaved changes", () => {
    const clean = mountItem({ id: "m1" });
    expect(clean.dirtyDot()).toBeNull();
    clean.cleanup();
    const dirty = mountItem({ id: "m1" }, { dirty: true });
    expect(dirty.dirtyDot()).not.toBeNull();
    expect(dirty.dirtyDot()!.className).toContain("rounded-full");
    dirty.cleanup();
  });

  it("runs the connection test from the collapsed row and echoes the result inline", async () => {
    agentStore.testRouteConnection.mockReset();
    agentStore.testRouteConnection.mockResolvedValue({ outcome: "ok", latencyMs: 41 });
    const ctx = mountItem({ id: "glm-5.3-flash" }, { apiKeyConfigured: true, provider: "zai" });
    expect(ctx.headerTestButton().disabled).toBe(false);
    ctx.headerTestButton().click();
    flushSync();
    await vi.waitFor(() => expect(ctx.headerStatus()).toContain("ok · 41 ms"));
    expect(agentStore.testRouteConnection).toHaveBeenCalledWith({
      api: "anthropic-messages",
      baseURL: "http://localhost:20002/anthropic",
      modelId: "glm-5.3-flash",
      provider: "zai",
    });
    ctx.cleanup();
  });

  it("disables the collapsed test button until a test-only key exists (no stored key)", () => {
    agentStore.testRouteConnection.mockReset();
    const ctx = mountItem({ id: "m1" }, { apiKeyConfigured: false });
    expect(ctx.headerTestButton().disabled).toBe(true);
    expect(agentStore.testRouteConnection).not.toHaveBeenCalled();
    ctx.cleanup();
  });
});

describe("ModelListItem catalog prefill (R10-3/4/5)", () => {
  it("prefills inputTypes/maxOutputTokens/outputTypes/efforts from the catalog (glm-5.3)", () => {
    const ctx = mountItem({ id: "" }, { candidates: GLM_CANDIDATES, apiKeyConfigured: true });
    ctx.expand();
    typeValue(ctx.inputByLabel("Model id"), "glm-5.3");
    expect(ctx.state()).toEqual({
      id: "glm-5.3",
      name: "GLM 5.3",
      contextWindow: 1_000_000,
      maxOutputTokens: 131072,
      inputTypes: ["text"], // 目录 inputTypes 优先（image 旗标不覆盖目录声明）
      outputTypes: ["text"],
      efforts: ["low", "high", "max"],
    });
    // 显示层：token 简写回显（R10-4）。
    expect(ctx.inputByLabel("Max output tokens").value).toBe("128k");
    expect(ctx.inputByLabel("Context window (tokens)").value).toBe("976.6k");
    // 目录声明 text-only → image chip 未选中。
    expect(ctx.chipByName("image").getAttribute("aria-pressed")).toBe("false");
    ctx.cleanup();
  });

  it("keeps manual input-type choices on same-id re-input, re-prefills on id switch", () => {
    const ctx = mountItem(
      { id: "" },
      {
        apiKeyConfigured: true,
        candidates: [
          { id: "a-model", image: false },
          { id: "b-model", image: true },
        ],
      },
    );
    ctx.expand();
    typeValue(ctx.inputByLabel("Model id"), "a-model");
    expect(ctx.state()).toMatchObject({ inputTypes: ["text"] });
    // 手选 pdf → 同 id 再触发 input（如 datalist 重选）不覆盖手选。
    ctx.chipByName("pdf").click();
    flushSync();
    typeValue(ctx.inputByLabel("Model id"), "a-model");
    expect(ctx.state()).toMatchObject({ inputTypes: ["text", "pdf"] });
    // 换 modelId → 手触位复位，目录预填重新接管。
    typeValue(ctx.inputByLabel("Model id"), "b-model");
    expect(ctx.state()).toMatchObject({ inputTypes: ["text", "image"] });
    ctx.cleanup();
  });

  it("keeps manual effort tiers explicit: catalog default never overwrites them", () => {
    const ctx = mountItem({ id: "" }, { candidates: GLM_CANDIDATES, apiKeyConfigured: true });
    ctx.expand();
    typeValue(ctx.inputByLabel("Model id"), "glm-5.3");
    const input = ctx.effortInput();
    typeValue(input, "turbo");
    pressKey(input, "Enter");
    expect(ctx.state()).toMatchObject({ efforts: ["low", "high", "max", "turbo"] });
    // 同 id 重选 / 换 id：显式配置保留（默认三档只在未显式配置时写入）。
    typeValue(ctx.inputByLabel("Model id"), "glm-5.3");
    expect(ctx.state()).toMatchObject({ efforts: ["low", "high", "max", "turbo"] });
    ctx.cleanup();
  });

  it("prefills name/contextWindow/inputTypes when the typed id matches the catalog", () => {
    const ctx = mountItem({ id: "" }, { apiKeyConfigured: true });
    ctx.expand();
    typeValue(ctx.inputByLabel("Model id"), "glm-5.3-flash");
    expect(ctx.state()).toEqual({
      id: "glm-5.3-flash",
      name: "GLM 5.3 Flash",
      contextWindow: 131072,
      inputTypes: ["text", "image"],
      outputTypes: ["text"],
      efforts: ["low", "high", "max"],
    });
    expect(ctx.inputByLabel("Model name").value).toBe("GLM 5.3 Flash");
    expect(ctx.inputByLabel("Context window (tokens)").value).toBe("128k");
    expect(ctx.chipByName("image").getAttribute("aria-pressed")).toBe("true");
    ctx.cleanup();
  });

  it("clears stale prefill fields when the id is rewritten to an unknown one (efforts default stays)", () => {
    const ctx = mountItem({ id: "" }, { apiKeyConfigured: true });
    ctx.expand();
    typeValue(ctx.inputByLabel("Model id"), "glm-5.3-flash");
    typeValue(ctx.inputByLabel("Model id"), "my-relay-model");
    // efforts 默认三档是新条目语义（用户裁定），不随目录命中与否清除。
    expect(ctx.state()).toEqual({ id: "my-relay-model", efforts: ["low", "high", "max"] });
    ctx.cleanup();
  });
});

describe("ModelListItem chips (R10-3)", () => {
  it("locks the text input chip and the output chip as non-interactive selected chips", () => {
    const ctx = mountItem({ id: "m1", inputTypes: ["text", "image"] });
    ctx.expand();
    const textChip = ctx.target.querySelector('[data-input-chip="text"]')!;
    expect(textChip.tagName).not.toBe("BUTTON");
    expect(textChip.className).toContain("bg-primary");
    expect(textChip.className).toContain("text-primary-foreground");
    const outputChip = ctx.target.querySelector('[data-output-chip="text"]')!;
    expect(outputChip.tagName).not.toBe("BUTTON");
    expect(outputChip.className).toContain("bg-primary");
    expect(outputChip.className).toContain("text-primary-foreground");
    ctx.cleanup();
  });

  it("styles optional chips: selected = primary fill, unselected = muted border", () => {
    const ctx = mountItem({ id: "m1", inputTypes: ["text", "image"] });
    ctx.expand();
    expect(ctx.chipByName("image").className).toContain("bg-primary");
    expect(ctx.chipByName("image").className).toContain("text-primary-foreground");
    expect(ctx.chipByName("pdf").className).toContain("border-border");
    expect(ctx.chipByName("pdf").className).not.toContain("bg-primary");
    ctx.cleanup();
  });

  it("toggles the output image chip as a real selectTag and persists outputTypes (codex R11 P1)", () => {
    const ctx = mountItem({ id: "m1" });
    ctx.expand();
    const imageOut = ctx.target.querySelector<HTMLButtonElement>('[data-output-chip="image"]')!;
    expect(imageOut.tagName).toBe("BUTTON");
    // 默认未选中（muted 边框态）——目录无 output 数据，默认仅 text。
    expect(imageOut.getAttribute("aria-pressed")).toBe("false");
    expect(imageOut.className).toContain("border-border");
    expect(imageOut.className).not.toContain("bg-primary");
    imageOut.click();
    flushSync();
    expect(ctx.state().outputTypes).toEqual(["text", "image"]);
    expect(imageOut.getAttribute("aria-pressed")).toBe("true");
    expect(imageOut.className).toContain("bg-primary");
    // 再点关闭：text 恒存（锁定 chip），image 移除。
    imageOut.click();
    flushSync();
    expect(ctx.state().outputTypes).toEqual(["text"]);
    ctx.cleanup();
  });

  it("keeps text in inputTypes mandatory and toggles optional kinds", () => {
    const ctx = mountItem({ id: "m1", inputTypes: ["text", "image"] });
    ctx.expand();
    ctx.chipByName("pdf").click();
    flushSync();
    expect(ctx.state()).toEqual({ id: "m1", inputTypes: ["text", "image", "pdf"] });
    ctx.chipByName("image").click();
    flushSync();
    expect(ctx.state()).toEqual({ id: "m1", inputTypes: ["text", "pdf"] });
    ctx.cleanup();
  });
});

describe("ModelListItem field editing (R7 8.7)", () => {
  it("generates a readable name for unknown ids and keeps manual edits (write name)", () => {
    const ctx = mountItem({ id: "glm-5.3-flash" });
    ctx.expand();
    expect(ctx.inputByLabel("Model name").value).toBe("GLM 5.3 Flash");
    typeValue(ctx.inputByLabel("Model name"), "My Relay Model");
    expect(ctx.state()).toEqual({ id: "glm-5.3-flash", name: "My Relay Model" });
    ctx.cleanup();
  });

  it("edits efforts through the tags input (write efforts)", () => {
    const ctx = mountItem({ id: "m1" });
    ctx.expand();
    const input = ctx.effortInput();
    typeValue(input, "xhigh");
    pressKey(input, "Enter");
    expect(ctx.state()).toEqual({ id: "m1", efforts: ["xhigh"] });
    ctx.cleanup();
  });

  it("derives effort suggestions from standard tiers + route models (union, deduped, sorted)", () => {
    const ctx = mountItem(
      { id: "m1" },
      {
        routeModels: [
          { id: "a", efforts: ["high", "low"] },
          { id: "b", efforts: ["low", "turbo", "high"] },
        ],
      },
    );
    ctx.expand();
    expect(ctx.effortSuggestions()).toEqual([
      "high",
      "low",
      "max",
      "medium",
      "minimal",
      "turbo",
      "xhigh",
    ]);
    ctx.cleanup();
  });

  it("still offers the standard tiers when nothing is configured (user decree)", () => {
    const ctx = mountItem({ id: "m1" }, { routeModels: [{ id: "a" }, { id: "b" }] });
    ctx.expand();
    expect(ctx.effortSuggestions()).toEqual(["high", "low", "max", "medium", "minimal", "xhigh"]);
    // 建议词是补全不是阻断：tags-input 仍自由输入。
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
    ctx.expand();
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
    ctx.expand();
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
    ctx.expand();
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
});

describe("ModelListItem connection test (R7 B4)", () => {
  it("shows a test-only password input when no credential is stored; button waits for it", () => {
    agentStore.testRouteConnection.mockReset();
    const ctx = mountItem({ id: "m1" }, { apiKeyConfigured: false, provider: "zai-2" });
    ctx.expand();
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
    ctx.expand();
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
    ctx.expand();
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
    ctx.expand();
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
});

describe("output selectTags persistence boundaries (codex R11 P1)", () => {
  it("keeps a hand-selected image output across same-catalog-id re-input", () => {
    const ctx = mountItem({ id: "m1" }, { candidates: GLM_CANDIDATES as never });
    ctx.expand();
    typeValue(ctx.inputByLabel("Model id"), "glm-5.3");
    const imageOut = ctx.target.querySelector<HTMLButtonElement>('[data-output-chip="image"]')!;
    imageOut.click();
    flushSync();
    expect(ctx.state().outputTypes).toEqual(["text", "image"]);
    // 同 id 再输入（datalist 重选/重打）：手选 image 不得被静默重置。
    typeValue(ctx.inputByLabel("Model id"), "glm-5.3");
    expect(ctx.state().outputTypes).toEqual(["text", "image"]);
    ctx.cleanup();
  });

  it("keeps image output across genuine custom-id same-id re-input", () => {
    const ctx = mountItem({ id: "my-custom-model", outputTypes: ["text", "image"] });
    ctx.expand();
    typeValue(ctx.inputByLabel("Model id"), "my-custom-model");
    expect(ctx.state().outputTypes).toEqual(["text", "image"]);
    ctx.cleanup();
  });

  it("resets output when returning to a catalog id after a custom detour (codex R11 终验)", () => {
    // catalog A → custom C（锚失效）→ 手选 image → 回 catalog A：必须按换 id 复位。
    const ctx = mountItem({ id: "glm-5.3" }, { candidates: GLM_CANDIDATES as never });
    ctx.expand();
    typeValue(ctx.inputByLabel("Model id"), "my-custom-model");
    const imageOut = ctx.target.querySelector<HTMLButtonElement>('[data-output-chip="image"]')!;
    imageOut.click();
    flushSync();
    expect(ctx.state().outputTypes).toEqual(["text", "image"]);
    typeValue(ctx.inputByLabel("Model id"), "glm-5.3");
    expect(ctx.state().outputTypes).toEqual(["text"]);
    ctx.cleanup();
  });

  it("resets output to the text default when the id actually changes", () => {
    const ctx = mountItem({ id: "glm-5.3", outputTypes: ["text", "image"] });
    ctx.expand();
    typeValue(ctx.inputByLabel("Model id"), "glm-5.3-flash");
    // 换目录 id：预填重新接管（含 output 回默认）。
    expect(ctx.state().outputTypes).toEqual(["text"]);
    ctx.cleanup();
  });
});
