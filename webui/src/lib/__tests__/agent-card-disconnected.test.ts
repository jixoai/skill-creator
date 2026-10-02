// @vitest-environment jsdom
/**
 * AgentCard 断线挂载回归测试（codex 复核 P2 #2）。
 *
 * 用户原始需求 [2026-10-02]（收尾简报）：「AgentCard 的 $effect 内直接
 * requireRpc().agent.card.get()，断线时同步 throw 逃逸（与 741eb3d 修的
 * Creator 冻结同族）」。
 *
 * 根因：requireRpc() 未连接时同步 throw，异常逃逸出 $effect——Svelte 5 batch
 * traverse 捕获后 discard 所在渲染分支（AgentCard 挂在 AgentPanel 帧流内，
 * 整个面板冻结成僵尸 DOM）。修复：getRpc() 判空早退 + 读 connectionState
 * 建立依赖（连接转 ready 自动重发，与 eval-view/ProviderView 补救同族）。
 *
 * 正交意图：
 *   [1] 组件层钉：断线挂载不逃逸同步异常、不误报 failed（保持 Loading）、
 *       不发 RPC；连接转 ready 后卡片自动补拉并渲染 iframe。
 *   [2] 组件层钉：RPC 失败路径仍投影 failed 态（连接闸不吞真实失败）。
 */
import { flushSync, mount, unmount } from "./svelte-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "../stores/connection.svelte",
  async () => await import("./stubs/connection-store-stub.svelte"),
);
// 本仓 vitest 管线把裸 "svelte" 解析到 server 入口——而 mount 用直连 client 入口
// （与 creator-deeplink-recovery.test.ts 同法，见彼处注释）。
// @ts-expect-error -- 无类型声明的运行时直连（与 svelte-client.ts 同法）
vi.mock("svelte", async () => await import("../../../node_modules/svelte/src/index-client.js"));
vi.mock("$app/navigation", () => ({ goto: vi.fn() }));

import AgentCard from "../components/agent/AgentCard.svelte";
import { connectMockClient, resetConnectionStub } from "./stubs/connection-store-stub.svelte";

const CARD_HTML = "<p>card body</p>";

function makeCardRpc(html: string | null = CARD_HTML) {
  return {
    agent: { card: { get: vi.fn().mockResolvedValue({ html }) } },
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
  resetConnectionStub();
  target = document.body.appendChild(document.createElement("div"));
});

describe("AgentCard disconnected mount (codex P2)", () => {
  it("mounts without a synchronous throw while disconnected and stays in loading", async () => {
    const rpc = makeCardRpc();
    // 深链/面板首帧：WS 未就绪（rpc=null）。挂载不得逃逸同步异常——旧代码
    // requireRpc() 在此 throw，$effect 逃逸会把面板分支 discard 成僵尸 DOM。
    let instance: ReturnType<typeof mount> | null = null;
    expect(() => {
      instance = mount(AgentCard, {
        target: target as HTMLElement,
        props: { resourceUri: "ui://card/skill", title: "Skill card" },
      });
    }).not.toThrow();
    await flushAsync();

    // 未连接：不发 RPC，也不误报 failed——保留 Loading（等待重连，非死亡终态）。
    expect(rpc.agent.card.get).not.toHaveBeenCalled();
    expect(target?.textContent).toContain("Loading card…");
    expect(target?.textContent).not.toContain("Card unavailable");

    unmount(instance!);
  });

  it("re-fetches and renders the card iframe after the connection turns ready", async () => {
    const rpc = makeCardRpc();
    const instance = mount(AgentCard, {
      target: target as HTMLElement,
      props: { resourceUri: "ui://card/finding", title: "Finding card" },
    });
    await flushAsync();
    expect(rpc.agent.card.get).not.toHaveBeenCalled();

    // 连接转 ready：自动重发（读 connectionState 的 $effect 重跑）。
    connectMockClient(rpc as unknown as Record<string, unknown>);
    await flushAsync();

    expect(rpc.agent.card.get).toHaveBeenCalledWith({ uri: "ui://card/finding" });
    const frame = target?.querySelector("iframe") ?? null;
    expect(frame).not.toBeNull();
    // replaySrcdoc action 同步落地 srcdoc property。
    expect(frame?.getAttribute("srcdoc")).toBe(CARD_HTML);
    expect(target?.querySelector('[data-card-uri="ui://card/finding"]')).not.toBeNull();

    unmount(instance);
  });

  it("still projects the failed tone when the RPC itself rejects", async () => {
    const rpc = {
      agent: { card: { get: vi.fn().mockRejectedValue(new Error("card render failed")) } },
    };
    connectMockClient(rpc as unknown as Record<string, unknown>);
    const instance = mount(AgentCard, {
      target: target as HTMLElement,
      props: { resourceUri: "ui://card/x", title: "X card" },
    });
    await flushAsync();

    expect(rpc.agent.card.get).toHaveBeenCalledTimes(1);
    expect(target?.textContent).toContain("Card unavailable: X card");

    unmount(instance);
  });
});
