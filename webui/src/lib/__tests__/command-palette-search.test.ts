// @vitest-environment jsdom
/**
 * 命令面板 Skills 检索回归测试（skill-search-gui 走查 Case C）。
 * 用户原始需求 [2026-09-17]：「任何需要搜索 skills 的地方都吃到 BM25 + 中文
 * 分词 + typo 容忍」。
 * 正交意图：
 *   [1] 输入文本驱动去抖检索：query 必须绑 Command.Input 的 value——bits-ui
 *       Root(Dialog) 的 value 是「选中条目的值」，绑错通道则检索永不触发
 *       （走查 P1；command-stub 忠实建模两条 value 通道的分离契约）。
 *   [2] 选中条目不污染 query：面板关闭时配对清空 query + resetSkillSearch，
 *       重开必须是空输入且从未以条目值发起检索（走查 P2 永久 Searching 根因）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  searchSkills: vi.fn(async (_query: string, _limit?: number) => undefined),
  resetSkillSearch: vi.fn(),
  searchState: { query: "", results: [], searching: false, error: null },
  workspaceState: { workspaces: [] },
  installationScopeLabel: vi.fn(() => "WS / P"),
  workspaceEntryPath: vi.fn(() => "/workspaces"),
}));
const nav = vi.hoisted(() => ({ goto: vi.fn() }));
const shell = vi.hoisted(() => ({ goById: vi.fn() }));

vi.mock("$lib/store.svelte", () => store);
vi.mock("$app/navigation", () => nav);
vi.mock("$lib/shell", () => shell);
// @lucide/svelte 图标经 webui 测试项目 alias 全局替换为空壳 stub（vite.config.ts）。
// 真 bits-ui command 在 node_modules 含 .svelte（vitest 外置不可编译）——以
// command-stub 替换；Root/Item 与 Input 的 value 通道分离是 stub 建模的核心契约。
vi.mock("$lib/components/ui/command", async () => {
  const Dialog = (await import("./stubs/command-stub/Dialog.svelte")).default;
  const Input = (await import("./stubs/command-stub/Input.svelte")).default;
  const List = (await import("./stubs/command-stub/List.svelte")).default;
  const Group = (await import("./stubs/command-stub/Group.svelte")).default;
  const Item = (await import("./stubs/command-stub/Item.svelte")).default;
  const Empty = (await import("./stubs/command-stub/Empty.svelte")).default;
  const Loading = (await import("./stubs/command-stub/Loading.svelte")).default;
  return { Dialog, Input, List, Group, Item, Empty, Loading };
});

import CommandPalette from "../components/command-palette.svelte";
import { mount, unmount } from "./svelte-client";
import { tick } from "svelte";
import { resetCommandStub } from "./stubs/command-stub-state";

function openPalette(): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
}

function commandInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('[data-slot="command-input"]');
  if (!input) throw new Error("command input not rendered");
  return input;
}

function typeInto(input: HTMLInputElement, text: string): void {
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

let unmountPalette: (() => void) | null = null;

beforeEach(() => {
  document.body.innerHTML = "";
  resetCommandStub();
  store.searchSkills.mockClear();
  store.resetSkillSearch.mockClear();
  nav.goto.mockClear();
  shell.goById.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  unmountPalette?.();
  unmountPalette = null;
});

describe("command palette skills search", () => {
  it("typed input drives the debounced cross-workspace search", async () => {
    const app = mount(CommandPalette, { target: document.body });
    unmountPalette = () => unmount(app);
    await tick();
    openPalette();
    await tick();
    typeInto(commandInput(), "组件");
    await tick();
    expect(store.searchSkills).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    expect(store.searchSkills).toHaveBeenCalledTimes(1);
    expect(store.searchSkills).toHaveBeenCalledWith("组件", 20);
  });

  it("selecting a navigation item does not pollute the query for the next open", async () => {
    const app = mount(CommandPalette, { target: document.body });
    unmountPalette = () => unmount(app);
    await tick();
    openPalette();
    await tick();
    // 先输入再关闭才覆盖 P2 根因：残留 query 若未在关闭时清空，重开会带着
    // 旧值（codex 复审变异验证指出原场景未钉住此路径）。
    typeInto(commandInput(), "typed query");
    await tick();
    const item = document.querySelector<HTMLButtonElement>('[data-stub="command-item"]');
    if (!item) throw new Error("navigate item not rendered");
    item.click();
    await tick();
    expect(nav.goto).toHaveBeenCalledWith("/workspaces");
    // 选中写入的是 Root 的 value（stub data-value 可见），不得流进检索通道：
    // 重开后输入必须为空，且超过去抖窗口后也从未以条目值或残留值发起检索。
    openPalette();
    await tick();
    expect(commandInput().value).toBe("");
    await vi.advanceTimersByTimeAsync(300);
    expect(store.searchSkills).not.toHaveBeenCalled();
    const calls = store.searchSkills.mock.calls.map(([query]) => query);
    expect(calls).not.toContain("go workspaces manage locations");
    expect(calls).not.toContain("typed query");
  });
});
