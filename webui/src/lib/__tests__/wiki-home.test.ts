// @vitest-environment jsdom
/**
 * WikiHome 组件测试（wiki-directory-standard task 3.5，2026-09-22）。
 *
 * 用户原始需求 [2026-09-22]（Owner 裁决）：「skill-creator GUI 新增第四个一级
 * Wiki 面板：home = scope 索引（Global 卡 + 各 registry workspace 的 wiki 卡：
 * label、pattern 计数；未初始化的 workspace 显示空态而非隐藏）」。
 *
 * 正交意图：
 *   [1] scope 索引：global 卡恒列 + workspace 卡计数 + Not initialized 空态。
 *   [2] 入口导航：卡片点击 → /wiki/:wsId（global "~" 编码 %7E）。
 *   [3] 失败可区分：scopes RPC 失败渲染错误 + Retry（不伪装成空索引）。
 */
import { flushSync, mount, unmount } from "./svelte-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() => ({
  wiki: {
    scopes: vi.fn(),
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
const goto = vi.hoisted(() => vi.fn());
vi.mock("$app/navigation", () => ({ goto }));

import WikiHome from "../apps/wiki/WikiHome.svelte";
import { resetWikiScopes } from "../stores/wiki.svelte";

const WS = "ws_0123456789abcdef01234567";

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
}

let target: HTMLElement | null = null;

beforeEach(() => {
  rpcMock.wiki.scopes.mockReset();
  goto.mockReset();
  resetWikiScopes();
  target = document.body.appendChild(document.createElement("div"));
});

function mountHome() {
  return mount(WikiHome, { target: target as HTMLElement });
}

describe("WikiHome", () => {
  it("renders the scope index: global card, counts, and Not initialized empty state", async () => {
    rpcMock.wiki.scopes.mockResolvedValue({
      scopes: [
        {
          id: "~",
          label: "Global",
          patternCount: 2,
          exists: true,
          lastUpdated: "2026-09-22T01:00:00.000Z",
        },
        { id: WS, label: "registered", patternCount: 0, exists: false, lastUpdated: null },
      ],
    });
    const instance = mountHome();
    await flushAsync();

    expect(rpcMock.wiki.scopes).toHaveBeenCalledWith({});
    expect(target?.textContent).toContain("Global");
    expect(target?.textContent).toContain("~ global");
    expect(target?.textContent).toContain("fragments captured");
    // 未初始化 workspace：空态可见（不隐藏）。
    expect(target?.textContent).toContain("registered");
    expect(target?.textContent).toContain("Not initialized");

    unmount(instance);
  });

  it("navigates to /wiki/:wsId on card click (global id encoded as %7E)", async () => {
    rpcMock.wiki.scopes.mockResolvedValue({
      scopes: [
        { id: "~", label: "Global", patternCount: 0, exists: false, lastUpdated: null },
        {
          id: WS,
          label: "registered",
          patternCount: 1,
          exists: true,
          lastUpdated: "2026-09-22T02:00:00.000Z",
        },
      ],
    });
    const instance = mountHome();
    await flushAsync();

    const cards = Array.from(target?.querySelectorAll("button[data-scope-id]") ?? []);
    expect(cards).toHaveLength(2);

    (cards[0] as HTMLButtonElement).click();
    expect(goto).toHaveBeenCalledWith("/wiki/%7E");

    (cards[1] as HTMLButtonElement).click();
    expect(goto).toHaveBeenCalledWith(`/wiki/${WS}`);

    unmount(instance);
  });

  it("shows a diagnosable error with Retry when the scopes RPC fails", async () => {
    rpcMock.wiki.scopes.mockRejectedValue(new Error("scopes io failed"));
    const instance = mountHome();
    await flushAsync();

    expect(target?.textContent).toContain("Couldn't load wiki scopes");
    expect(target?.textContent).toContain("scopes io failed");
    expect(target?.querySelectorAll("button[data-scope-id]")).toHaveLength(0);

    // Retry 走同一加载面（错误可恢复，不伪装成空索引）。
    rpcMock.wiki.scopes.mockResolvedValue({
      scopes: [{ id: "~", label: "Global", patternCount: 0, exists: false, lastUpdated: null }],
    });
    const retry = Array.from(target?.querySelectorAll("button") ?? []).find((button) =>
      button.textContent?.includes("Retry"),
    ) as HTMLButtonElement;
    retry.click();
    await flushAsync();
    expect(target?.querySelectorAll("button[data-scope-id]")).toHaveLength(1);

    unmount(instance);
  });
});
