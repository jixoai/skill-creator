// @vitest-environment jsdom
/**
 * Creator 深链恢复回归测试（WS5 走查 B 阻塞项）。
 *
 * 用户原始需求 [2026-10-02]（走查简报）：「/creator/edit/<ws>/<provider>/<skill>?subview=<非file>
 * 整页直开间歇性失败：子视图头渲染但数据永不加载；任何子视图 tab 都只改 URL
 * 而面板与高亮冻结」。
 * 修订 [2026-10-03]（evaluating-dashboard 1.4）：test/eval 子视图退役——非 file
 * 深链样本从 eval 换为 log（评估行的补载/愈合钉随迁移移驻
 * apps/evaluating/__tests__/evaluating-detail.dom.test.ts）。
 *
 * 根因链（确定性复现于 /tmp 沙箱 + WS 延迟代理）：
 *   [1] 深链非 file 子视图首帧 WS 未就绪时，CreatorWorkspace 的兜底 hydrate
 *       $effect 裸调用 loadSkillDoc —— requireRpc() 同步 throw 且 .catch 尚未
 *       附着，异常逃逸出 $effect，Svelte 5 batch traverse 捕获后 reset_all +
 *       discard 整个 creator 渲染分支（DOM 残留、效应全死）→ tab/高亮/Refresh
 *       冻结、后续状态写不再投影到 DOM。
 *   [2] 断线窗口内的深链子视图 RPC 静默失败 → 无重试面（各子视图自带 catch，
 *       不崩但空白；连接恢复后的文档兜底由路由属主承担）。
 *
 * 正交意图：
 *   [1] store 层钉：loadSkillDoc/saveSkill 断线时必须返回 rejected promise，
 *       不得同步 throw（async 化修复的回归钉）。
 *   [2] 组件层钉：深链 + 未连接挂载必须存活（不逃逸同步异常）、连接转 ready
 *       后文档自动补载且 URL search 变化仍然驱动子视图切换（反冻结钉）。
 */
import { flushSync, mount, unmount } from "./svelte-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "../stores/connection.svelte",
  async () => await import("./stubs/connection-store-stub.svelte"),
);
// 本仓 vitest 管线把裸 "svelte" 解析到 server 入口——而 mount 用直连 client 入口，
// 两份 runtime 的 component_context 分裂会让组件内 setContext 抛
// lifecycle_outside_component；统一重定向到 client 入口（组件挂载测试必需）。
// @ts-expect-error -- 无类型声明的运行时直连（与 svelte-client.ts 同法）
vi.mock("svelte", async () => await import("../../../node_modules/svelte/src/index-client.js"));

// shell 路由参数经 portal context 注入（useParams/useSearch 读 Svelte context，
// 不读 $app/state——那是 catch-all 承载层）。可变 params/search 走 runes stub
// （裸对象翻转不触发 $derived 重跑），供用例切换子视图。
vi.mock("../shell/portal-context.svelte", async () => {
  const { shellRouteState } = await import("./stubs/shell-route-stub.svelte");
  return {
    useParams:
      <T>() =>
      () =>
        shellRouteState.params as T,
    useSearch:
      <T>() =>
      () =>
        shellRouteState.search as T,
    useRoute: () => undefined,
    useApp: () => undefined,
  };
});
vi.mock("$app/state", () => ({
  page: {
    url: {
      pathname: "/w/ws_0123456789abcdef01234567/creator/edit/openclaw/sk_0123456789abcdef01234567",
      search: "?subview=log",
      searchParams: new URLSearchParams("subview=log"),
    },
    params: {},
  },
}));
vi.mock("$app/navigation", () => ({ goto: vi.fn() }));
vi.mock("../toast.svelte", () => ({ showToast: vi.fn() }));
// shadcn 原语 → bits-ui（node_modules .svelte，vitest 外置）：button/input 以
// 同契约 stub 替换；ConfirmDialog 用既有 stub（FileBrowser 删除流不在本测试面）。
vi.mock("$lib/components/ui/button", async () => {
  const { default: stub } = await import("./stubs/ui-button-stub.svelte");
  return { Button: stub };
});
vi.mock("$lib/components/ui/input", async () => {
  const { default: stub } = await import("./stubs/ui-input-stub.svelte");
  return { Input: stub };
});
vi.mock("../components/confirm-dialog.svelte", async () => {
  const { default: stub } = await import("./stubs/confirm-dialog-stub.svelte");
  return { default: stub };
});

import CreatorWorkspace from "../apps/creator/CreatorWorkspace.svelte";
import { loadSkillDoc, saveSkill } from "../stores/creator";
import {
  connectMockClient,
  resetConnectionStub,
  setRequireRpcError,
} from "./stubs/connection-store-stub.svelte";
import { shellRouteState } from "./stubs/shell-route-stub.svelte";
import {
  dropCachedCreatorDraft,
  resetDraftHydration,
  creatorDraftKey,
} from "../stores/creator-editor.svelte";
import type { WorkspaceProviderTarget, SkillId } from "../types";

const WS = "ws_0123456789abcdef01234567" as WorkspaceProviderTarget["workspaceId"];
const PROVIDER = "openclaw" as WorkspaceProviderTarget["providerId"];
const SK = "sk_0123456789abcdef01234567" as SkillId;

function makeRpcMock() {
  return {
    creator: {
      load: vi.fn().mockResolvedValue({
        skillId: SK,
        directoryName: "code-review",
        revision: `sha256:${"c".repeat(64)}`,
        frontmatter: { name: "code-review", description: "Reviews code changes." },
        body: "## When to Use\n\nReviews code before merging.",
      }),
      revisions: vi.fn().mockResolvedValue({ revisions: [] }),
    },
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
  shellRouteState.params = { mode: "edit", wsId: WS, providerId: PROVIDER, skillId: SK };
  shellRouteState.search = { subview: "log" };
  const key = creatorDraftKey({ workspaceId: WS, providerId: PROVIDER }, "edit", SK);
  if (key !== null) {
    dropCachedCreatorDraft(key);
    resetDraftHydration(key);
  }
  target = document.body.appendChild(document.createElement("div"));
});

describe("creator deep-link recovery (WS5 walkthrough B)", () => {
  it("loadSkillDoc stays a rejected promise (never a synchronous throw) while disconnected", async () => {
    // 回归钉（根因 [1]）：同步 throw 逃逸 $effect 会把挂载 flush 打断成僵尸分支。
    setRequireRpcError(null);
    let pending: Promise<unknown> | null = null;
    expect(() => {
      pending = loadSkillDoc({ workspaceId: WS, providerId: PROVIDER }, SK);
      pending?.catch(() => {});
    }).not.toThrow();
    await expect(pending).rejects.toThrow("The Skill Creator daemon is not connected.");
  });

  it("saveSkill stays a rejected promise while disconnected", async () => {
    let pending: Promise<unknown> | null = null;
    expect(() => {
      pending = saveSkill({
        mode: "create",
        workspaceId: WS,
        providerId: PROVIDER,
        directoryName: "x",
        frontmatter: { name: "n", description: "d" },
        body: "",
      } as Parameters<typeof saveSkill>[0]);
      pending?.catch(() => {});
    }).not.toThrow();
    await expect(pending).rejects.toThrow("The Skill Creator daemon is not connected.");
  });

  it("deep-linked non-file subview mounts while disconnected, then heals and stays reactive", async () => {
    const rpc = makeRpcMock();
    // 深链首帧：WS 握手中（rpc=null）。挂载不得逃逸同步异常（旧代码在此把整个
    // creator 分支 discard 成僵尸 DOM）。
    const instance = mount(CreatorWorkspace, { target: target as HTMLElement });
    await flushAsync();

    expect(target?.textContent).toContain("Change history");
    // 未连接：不发文档 RPC（连接闸）；子视图 RPC（revisions）失败被 catch 成
    // 错误面——页面存活不冻结。
    expect(rpc.creator.load).not.toHaveBeenCalled();
    expect(target?.textContent).toContain("not connected");

    // 连接转 ready：文档兜底 hydrate 自动补载。
    connectMockClient(rpc as unknown as Record<string, unknown>);
    await flushAsync();

    expect(rpc.creator.load).toHaveBeenCalledWith({
      workspaceId: WS,
      providerId: PROVIDER,
      skillId: SK,
    });

    // 反冻结钉：URL search 变化仍驱动子视图切换（僵尸分支不可能做到），
    // 且兜底 hydrate 的文档落在草稿上（Name 字段 = 服务器名，非空占位）。
    shellRouteState.search = { subview: "file" };
    flushSync();
    expect(target?.textContent).toContain("SKILL.md");
    const nameInput = target?.querySelector<HTMLInputElement>("input[placeholder='Skill name']");
    expect(nameInput?.value).toBe("code-review");

    unmount(instance);
  });

  it("does not re-hydrate the document after healing when data already committed", async () => {
    const rpc = makeRpcMock();
    const instance = mount(CreatorWorkspace, { target: target as HTMLElement });
    await flushAsync();
    connectMockClient(rpc as unknown as Record<string, unknown>);
    await flushAsync();
    const loadCallsAfterHeal = rpc.creator.load.mock.calls.length;

    // 二次断线→重连：文档已 hydrate，不重复补载（isDraftHydrated 双闸幂等）。
    connectMockClient(rpc as unknown as Record<string, unknown>);
    await flushAsync();
    expect(rpc.creator.load.mock.calls.length).toBe(loadCallsAfterHeal);

    unmount(instance);
  });
});
