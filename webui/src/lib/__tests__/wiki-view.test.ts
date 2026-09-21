// @vitest-environment jsdom
/**
 * WikiView 组件测试（skill-wiki-incubation 切片② 3.2，2026-09-21）。
 *
 * 用户原始需求 [2026-09-21]：「P1 本质上是在收集一些碎片的认知……是 skill-wiki
 * 输入的一部分」。
 * 正交意图：
 *   [1] 空态：无 pattern 时渲染空态引导与首个碎片的 CTA。
 *   [2] 追加闭环：表单填 title/note 提交 → RPC append → toast 反馈 + 列表就地插入。
 *   [3] 幂等反馈：deduplicated=true 时 toast 语义区分且列表不重复。
 */
import { flushSync, mount, unmount } from "./svelte-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() => ({
  wiki: {
    list: vi.fn(),
    append: vi.fn(),
    read: vi.fn(),
  },
}));

vi.mock("../stores/connection.svelte", () => ({
  getRpc: () => rpcMock,
  getConnectionGeneration: () => 0,
  requireRpc: () => rpcMock,
  connectionState: { status: "connected", error: null },
}));
vi.mock("$app/state", () => ({
  page: {
    url: { pathname: "/workspaces/wiki/%7E", searchParams: new URLSearchParams() },
    params: { wsId: "~" },
  },
}));
vi.mock("$app/navigation", () => ({ goto: vi.fn() }));
vi.mock("../store.svelte", () => ({
  workspaceState: { workspaces: [], activeId: "~", loading: false, error: null },
}));
const showToast = vi.hoisted(() => vi.fn());
vi.mock("../toast.svelte", () => ({ showToast }));

import WikiView from "../apps/workspaces/WikiView.svelte";
import { resetWiki } from "../stores/wiki.svelte";
import type { PatternListItem } from "skill-wiki/schema";

function makeItem(name: string, title: string): PatternListItem {
  return {
    name,
    title,
    origin: "~",
    promotedFrom: null,
    updated: "2026-09-21T00:00:00.000Z",
    contentHash: name.padEnd(64, "0").slice(0, 64),
  };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
}

let target: HTMLElement | null = null;

beforeEach(() => {
  rpcMock.wiki.list.mockReset().mockResolvedValue({ patterns: [] });
  rpcMock.wiki.append.mockReset();
  rpcMock.wiki.read.mockReset();
  showToast.mockReset();
  resetWiki();
  target = document.body.appendChild(document.createElement("div"));
});

function mountView() {
  return mount(WikiView, { target: target as HTMLElement });
}

describe("WikiView", () => {
  it("renders the empty state with a first-fragment CTA when no patterns exist", async () => {
    const instance = mountView();
    await flushAsync();

    expect(rpcMock.wiki.list).toHaveBeenCalledWith({ scope: "~" });
    expect(target?.textContent).toContain("No fragments yet");
    expect(target?.textContent).toContain("Add the first fragment");

    unmount(instance);
  });

  it("appends a fragment through the form: RPC append → toast + in-place list row", async () => {
    const instance = mountView();
    await flushAsync();

    const addButton = Array.from(target?.querySelectorAll("button") ?? []).find((button) =>
      button.textContent?.includes("Add fragment"),
    ) as HTMLButtonElement;
    addButton.click();
    await flushAsync();

    const [titleInput] = Array.from(target?.querySelectorAll("input") ?? []) as HTMLInputElement[];
    const bodyArea = target?.querySelector("textarea") as HTMLTextAreaElement;
    titleInput.value = "Pin exit codes";
    titleInput.dispatchEvent(new Event("input", { bubbles: true }));
    bodyArea.value = "Branch on exit code.";
    bodyArea.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();

    rpcMock.wiki.append.mockResolvedValue({
      item: makeItem("pin-exit-codes", "Pin exit codes"),
      deduplicated: false,
    });
    const submit = Array.from(target?.querySelectorAll("button") ?? []).find((button) =>
      button.textContent?.includes("Add to wiki"),
    ) as HTMLButtonElement;
    submit.click();
    await flushAsync();

    expect(rpcMock.wiki.append).toHaveBeenCalledWith({
      scope: "~",
      title: "Pin exit codes",
      body: "Branch on exit code.",
    });
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("Pin exit codes"));
    expect(target?.textContent).toContain("pin-exit-codes");

    unmount(instance);
  });

  it("surfaces a duplicate capture with distinct feedback and no duplicate row", async () => {
    const instance = mountView();
    rpcMock.wiki.list.mockResolvedValue({ patterns: [makeItem("existing", "Existing note")] });
    // 重新触发加载：mount effect 已消费旧 mock；直接再调一次（视图内 refresh 按钮）。
    const refresh = Array.from(target?.querySelectorAll("button") ?? []).find(
      (button) => button.getAttribute("aria-label") === "Refresh wiki",
    ) as HTMLButtonElement;
    refresh.click();
    await flushAsync();
    expect(target?.textContent).toContain("Existing note");

    const addButton = Array.from(target?.querySelectorAll("button") ?? []).find((button) =>
      button.textContent?.includes("Add fragment"),
    ) as HTMLButtonElement;
    addButton.click();
    await flushAsync();

    const [titleInput] = Array.from(target?.querySelectorAll("input") ?? []) as HTMLInputElement[];
    titleInput.value = "Same body different title";
    titleInput.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();

    rpcMock.wiki.append.mockResolvedValue({
      item: makeItem("existing", "Existing note"),
      deduplicated: true,
    });
    const submit = Array.from(target?.querySelectorAll("button") ?? []).find((button) =>
      button.textContent?.includes("Add to wiki"),
    ) as HTMLButtonElement;
    submit.click();
    await flushAsync();

    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("Already captured"));
    const rows = target?.querySelectorAll("li") ?? [];
    expect(rows.length).toBe(1);

    unmount(instance);
  });
});
