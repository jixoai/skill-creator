// @vitest-environment jsdom
/**
 * ComposerCard attach 按钮传输中断复位测试（WS5 走查小项 7）。
 *
 * 用户原始需求 [2026-10-02]（走查简报）：「attach 按钮：file chooser 打开失败后
 * picking 永久不复位（按钮永久 disabled+spinner）」。
 *
 * 机制：原生对话框打开期间 WS 断开时，oRPC pending 永不 settle——try/finally
 * 无法到达。修复 = 连接断开（connectionState.status → disconnected）即复位
 * busy 态 + 迟到结果按连接世代丢弃。
 *
 * 正交意图：
 *   [1] 复位钉：pick 挂起中连接断开 → attach 按钮恢复可用（不永久 disabled）。
 *   [2] 世代钉：断线后才 settle 的迟到选择结果不写入附件（stale 丢弃）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const picker = vi.hoisted(() => ({
  pickAgentFiles: vi.fn(),
}));
const picked = vi.hoisted(() => ({
  docs: vi.fn(),
  images: vi.fn(),
}));

vi.mock(
  "../stores/connection.svelte",
  async () => await import("./stubs/connection-store-stub.svelte"),
);
vi.mock("../stores/agent.svelte", async () => {
  const stub = await import("./stubs/agent-store-stub.svelte");
  return { ...stub, pickAgentFiles: picker.pickAgentFiles, hydratePickedImagePreviews: vi.fn() };
});
vi.mock("../stores/agent-composer.svelte", () => ({
  agentComposer: { text: "", images: [], files: [], references: [], editing: null },
  addComposerImages: vi.fn(),
  addComposerDocs: vi.fn(),
  addComposerReference: vi.fn(),
  addPickedComposerDocs: picked.docs,
  addPickedComposerImages: picked.images,
  clearComposerEdit: vi.fn(),
  removeComposerReference: vi.fn(),
}));
vi.mock("../toast.svelte", () => ({ showToast: vi.fn() }));
vi.mock("../components/agent/ContextMeter.svelte", async () => {
  const { default: stub } = await import("./stubs/context-meter-stub.svelte");
  return { default: stub };
});
vi.mock("$lib/components/ui/dropdown-menu", async () => {
  const Root = (await import("./stubs/dropdown-menu-stub/Root.svelte")).default;
  const Trigger = (await import("./stubs/dropdown-menu-stub/Trigger.svelte")).default;
  const Content = (await import("./stubs/dropdown-menu-stub/Content.svelte")).default;
  const Group = (await import("./stubs/dropdown-menu-stub/Group.svelte")).default;
  const GroupHeading = (await import("./stubs/dropdown-menu-stub/GroupHeading.svelte")).default;
  const Item = (await import("./stubs/dropdown-menu-stub/Item.svelte")).default;
  const Label = (await import("./stubs/dropdown-menu-stub/Label.svelte")).default;
  const Separator = (await import("./stubs/dropdown-menu-stub/Separator.svelte")).default;
  return {
    DropdownMenu: Root,
    Trigger,
    Content,
    Group,
    GroupHeading,
    Item,
    Label,
    Separator,
  };
});
// vi.mock 是提升调用——不能依赖循环变量，逐个显式声明。
vi.mock("@lucide/svelte/icons/image", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/plus", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/list-plus", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/split", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/file-up", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock(
  "@lucide/svelte/icons/loader-circle",
  async () => await import("./stubs/lucide-icon-mocks.js"),
);
vi.mock("@lucide/svelte/icons/arrow-up", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/square", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock(
  "@lucide/svelte/icons/chevron-down",
  async () => await import("./stubs/lucide-icon-mocks.js"),
);
vi.mock("@lucide/svelte/icons/check", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/x", async () => await import("./stubs/lucide-icon-mocks.js"));

import ComposerCard from "../components/agent/ComposerCard.svelte";
import { flushSync, mount, unmount } from "./svelte-client";
import {
  connectMockClient,
  resetConnectionStub,
  rpcHolder,
} from "./stubs/connection-store-stub.svelte";

const CATALOG_RPC = {
  agent: { models: { catalog: async () => ({ providers: [] }) } },
};

function attachButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('button[aria-label^="Attach files"]');
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
}

beforeEach(() => {
  resetConnectionStub();
  picker.pickAgentFiles.mockReset();
  picked.docs.mockReset();
  picked.images.mockReset();
  // ComposerCard 模块级 catalog 缓存：首个挂载消费此 rpc。
  rpcHolder.rpc = CATALOG_RPC as unknown as Record<string, unknown>;
  connectMockClient(CATALOG_RPC as unknown as Record<string, unknown>);
  document.body.innerHTML = "";
});

describe("ComposerCard attach picker transport-death reset (WS5 item 7)", () => {
  it("resets the busy button when the connection dies while the native dialog is open", async () => {
    const gate: { release: (value: { paths: string[] } | null) => void } = {
      release: () => {},
    };
    picker.pickAgentFiles.mockImplementationOnce(
      () =>
        new Promise<{ paths: string[] } | null>((resolve) => {
          gate.release = resolve;
        }),
    );
    const target = document.body.appendChild(document.createElement("div"));
    const instance = mount(ComposerCard, { target });
    flushSync();

    const button = attachButton();
    if (!button) throw new Error("attach button not rendered");
    button.click();
    flushSync();
    expect(picker.pickAgentFiles).toHaveBeenCalledWith("file");
    // 对话框打开中：两个 attach 按钮共同 disabled。
    expect(attachButton()?.disabled).toBe(true);

    // 传输中断（对话框仍开着）：oRPC 永不 settle——busy 态必须即时复位。
    connectMockClient(null);
    await flushAsync();
    expect(attachButton()?.disabled).toBe(false);

    // 迟到的选择结果按世代丢弃：不写入附件。
    gate.release({ paths: ["/tmp/report.txt"] });
    await flushAsync();
    expect(picked.docs).not.toHaveBeenCalled();

    unmount(instance);
    target.remove();
  });

  it("still applies a pick that settles on the same connection", async () => {
    picker.pickAgentFiles.mockResolvedValueOnce({ paths: ["/tmp/notes.md"] });
    const target = document.body.appendChild(document.createElement("div"));
    const instance = mount(ComposerCard, { target });
    flushSync();

    attachButton()?.click();
    await flushAsync();
    expect(picked.docs).toHaveBeenCalledWith([{ path: "/tmp/notes.md", name: "notes.md" }]);

    unmount(instance);
    target.remove();
  });
});
