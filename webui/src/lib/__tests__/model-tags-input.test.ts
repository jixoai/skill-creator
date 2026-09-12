// @vitest-environment jsdom
/**
 * ModelTagsInput 组件测试（Track B1 回归，redesign-model-tabs-and-agent-panel）。
 * 用户原始需求 [2026-09-12]：「Custom route 表单里输入 `gpt-test` 按 Enter 不生成
 * chip，Add route 持续 disabled」（codex 浏览器实证；根因是 NewRouteTab 的
 * presets effect 死循环僵死组件——见 model-settings-b1.test.ts。本文件钉死
 * tags 输入自身的受控往返与键盘面不回归）。
 * 正交意图：
 *   [1] 受控往返：手输 id + 真实 KeyboardEvent keydown Enter → onchange 收到
 *       全量数组、父级回填后 chip 渲染、输入框清空。
 *   [2] 键盘面：逗号提交、Backspace 删尾、候选高亮 Enter 取候选、Esc 关闭、
 *       重复 id 不二次提交。
 */
import { describe, expect, it, vi } from "vitest";
import ControlledTagsHost from "./stubs/controlled-tags-host.svelte";
import { flushSync, mount, unmount } from "./svelte-client";

type Candidate = { id: string; name?: string; image?: boolean };

function mountHost(initial: string[], candidates: Candidate[] = []) {
  const onchange = vi.fn<(next: string[]) => void>();
  const target = document.createElement("div");
  document.body.appendChild(target);
  const instance = mount(ControlledTagsHost, {
    target,
    props: { initial, candidates, onchangeLog: onchange },
  });
  flushSync();
  return {
    onchange,
    target,
    input: () => target.querySelector<HTMLInputElement>("input")!,
    chips: () =>
      [...target.querySelectorAll("span.flex.items-center.gap-1")].map((n) =>
        (n.textContent ?? "").replace(/\s*×\s*$/, "").trim(),
      ),
    selected: () =>
      JSON.parse(
        target.querySelector<HTMLSpanElement>('[data-testid="selected-json"]')!.textContent!,
      ) as string[],
    listboxOpen: () => target.querySelector('[role="listbox"]') !== null,
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

function pressKey(input: HTMLInputElement, key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  input.dispatchEvent(event);
  flushSync();
  return event;
}

describe("ModelTagsInput (B1 Enter commit, controlled round-trip)", () => {
  it("commits raw hand-typed id on Enter with no candidates (gpt-test repro)", () => {
    const ctx = mountHost([], []);
    const input = ctx.input();
    input.focus();
    typeValue(input, "gpt-test");
    const event = pressKey(input, "Enter");
    expect(event.defaultPrevented).toBe(true);
    expect(ctx.onchange).toHaveBeenCalledTimes(1);
    expect(ctx.onchange).toHaveBeenCalledWith(["gpt-test"]);
    expect(ctx.chips()).toContain("gpt-test");
    expect(ctx.selected()).toEqual(["gpt-test"]);
    expect(input.value).toBe("");
    ctx.cleanup();
  });

  it("commits raw hand-typed id on Enter even while unrelated candidates are open", () => {
    const ctx = mountHost([], [{ id: "model-b", name: "Model B", image: true }]);
    const input = ctx.input();
    input.focus();
    typeValue(input, "model-a");
    pressKey(input, "Enter");
    expect(ctx.onchange).toHaveBeenCalledWith(["model-a"]);
    expect(ctx.chips()).toContain("model-a");
    expect(ctx.selected()).toEqual(["model-a"]);
    ctx.cleanup();
  });

  it("takes the highlighted candidate on Enter when it matches the typed prefix", () => {
    const ctx = mountHost([], [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }]);
    const input = ctx.input();
    input.focus();
    typeValue(input, "gpt-4o");
    pressKey(input, "ArrowDown");
    pressKey(input, "Enter");
    expect(ctx.onchange).toHaveBeenCalledWith(["gpt-4o-mini"]);
    expect(ctx.chips()).toContain("gpt-4o-mini");
    ctx.cleanup();
  });

  it("commits on comma, deletes last chip on Backspace, ignores duplicate ids", () => {
    const ctx = mountHost(["keep-me"], []);
    const input = ctx.input();
    input.focus();
    typeValue(input, "new-model");
    pressKey(input, ",");
    expect(ctx.onchange).toHaveBeenCalledWith(["keep-me", "new-model"]);
    expect(ctx.chips()).toEqual(["keep-me", "new-model"]);

    typeValue(input, "keep-me");
    pressKey(input, "Enter");
    // 重复 id：不追加（onchange 不再被调用），但输入被清空。
    expect(ctx.onchange).toHaveBeenCalledTimes(1);
    expect(input.value).toBe("");

    typeValue(input, "");
    pressKey(input, "Backspace");
    // Backspace 删尾：移除最后一枚 chip（new-model），保留 keep-me。
    expect(ctx.onchange).toHaveBeenLastCalledWith(["keep-me"]);
    expect(ctx.chips()).toEqual(["keep-me"]);
    ctx.cleanup();
  });

  it("closes the suggestion list on Escape without committing", () => {
    const ctx = mountHost([], [{ id: "model-b" }]);
    const input = ctx.input();
    input.focus();
    typeValue(input, "model");
    expect(ctx.listboxOpen()).toBe(true);
    pressKey(input, "Escape");
    expect(ctx.listboxOpen()).toBe(false);
    expect(ctx.onchange).not.toHaveBeenCalled();
    expect(input.value).toBe("model");
    ctx.cleanup();
  });
});
