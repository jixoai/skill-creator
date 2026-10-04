// @vitest-environment jsdom
/**
 * ExtensionPanel 空态图标 rail 三态测试（Owner 裁决 4b，空面板折叠）。
 * 用户原始需求 [2026-10-05]：「无活动 tab 时 side pane 收为 ~48px 竖排图标条
 * （四入口 + title 提示），点击任一图标即展开全宽面板并打开对应 tab；有活动
 * tab 时保持现有全宽形态」。
 * 正交意图：
 *   [1] 三态钉死：空态 rail（四入口 focusable + title key）/ 点击图标开 tab 后
 *       rail → tab 条 + 面板体 / 有 tab 全宽形态。
 *   [2] 派生回归：关闭最后一个 tab 空态事实翻转回 rail；railWhenEmpty=false
 *       （窄屏 drawer 等价）保持 open-tab launcher 卡。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";

const mocks = vi.hoisted(() => ({
  agentSession: { items: [] as Array<Record<string, never>>, status: "idle" as const },
}));

vi.mock("$lib/stores/agent.svelte", () => ({ agentSession: mocks.agentSession }));
vi.mock("$lib/stores/intelligence.svelte", () => ({
  loadProposals: async () => ({ proposals: null, error: null }),
}));
vi.mock("$lib/i18n", () => ({ t: (key: string) => key }));
vi.mock("$lib/components/ui/dropdown-menu", async () => ({
  DropdownMenu: (await import("$lib/__tests__/stubs/dropdown-menu-stub/Root.svelte")).default,
  Trigger: (await import("$lib/__tests__/stubs/dropdown-menu-stub/Trigger.svelte")).default,
  Content: (await import("$lib/__tests__/stubs/dropdown-menu-stub/Content.svelte")).default,
  Group: (await import("$lib/__tests__/stubs/dropdown-menu-stub/Group.svelte")).default,
  GroupHeading: (await import("$lib/__tests__/stubs/dropdown-menu-stub/GroupHeading.svelte"))
    .default,
  Item: (await import("$lib/__tests__/stubs/dropdown-menu-stub/Item.svelte")).default,
  Label: (await import("$lib/__tests__/stubs/dropdown-menu-stub/Label.svelte")).default,
  Separator: (await import("$lib/__tests__/stubs/dropdown-menu-stub/Separator.svelte")).default,
}));
vi.mock("$lib/components/agent/AgentToolRow.svelte", async () => {
  const stub = (await import("$lib/shell/__tests__/stub-leaf.svelte")).default;
  return { default: stub, toolUiCardRefOf: () => null };
});
vi.mock("$lib/components/agent/AgentProposalCard.svelte", async () => ({
  default: (await import("$lib/__tests__/stubs/proposal-card-stub.svelte")).default,
}));
vi.mock("$lib/components/agent/AgentCard.svelte", async () => ({
  default: (await import("$lib/shell/__tests__/stub-leaf.svelte")).default,
}));
vi.mock("$lib/components/agent/extension/FilePreviewBody.svelte", async () => ({
  default: (await import("$lib/shell/__tests__/stub-leaf.svelte")).default,
}));

import ExtensionPanel from "../ExtensionPanel.svelte";
import {
  closeExtensionTab,
  extensionPanel,
  rebindExtensionPanel,
  stopExtensionPanelWatch,
  visibleExtensionTabs,
} from "../extension-panel.svelte";

let host: HTMLElement;
let mounted: ReturnType<typeof mount> | null = null;

function mountPanel(railWhenEmpty: boolean): void {
  host = document.body.appendChild(document.createElement("div"));
  mounted = mount(ExtensionPanel, { target: host, props: { railWhenEmpty } });
  flushSync();
}

/** 重置 registry 到干净 owner（同 extension-panel.test.ts 的 resetStore）。 */
function resetStore(): void {
  stopExtensionPanelWatch();
  extensionPanel.tabs = [];
  extensionPanel.activeTabId = "";
  extensionPanel.recentClosed = [];
  extensionPanel.draggingTabId = null;
  extensionPanel.proposals = null;
  extensionPanel.error = null;
  rebindExtensionPanel(null);
  rebindExtensionPanel("session-a");
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = null;
  host?.remove();
  stopExtensionPanelWatch();
});

describe("ExtensionPanel empty-state icon rail (Owner ruling 4b)", () => {
  it("renders the collapsed rail with four focusable entries instead of the launcher card", () => {
    mountPanel(true);

    const rail = host.querySelector<HTMLElement>("[data-side-pane-rail]");
    expect(rail).toBeTruthy();
    expect(rail?.getAttribute("aria-label")).toBe("agentExtension.railAria");

    const items = Array.from(
      host.querySelectorAll<HTMLButtonElement>("[data-side-pane-rail-item]"),
    );
    expect(items.map((item) => item.dataset.sidePaneRailItem)).toEqual([
      "approvals",
      "bash-output",
      "subagents",
      "cards",
    ]);
    // title 提示 = t(key)（mock 后即 key 本身）；原生 button = 键盘可达。
    expect(items[0]?.getAttribute("title")).toBe("agentExtension.railOpenApprovals");
    expect(items[1]?.getAttribute("title")).toBe("agentExtension.railOpenBashOutput");
    items[0]?.focus();
    expect(document.activeElement).toBe(items[0]);

    // 空态卡与 tab 条均不渲染（rail 是唯一空态形态）。
    expect(host.querySelector("[data-side-pane-open-tab-item]")).toBeNull();
    expect(host.querySelector("[data-side-pane-tabs-content]")).toBeNull();
  });

  it("expands to the full tab-strip form when a rail entry opens its tab", () => {
    mountPanel(true);

    const entry = host.querySelector<HTMLButtonElement>('[data-side-pane-rail-item="approvals"]');
    entry!.click();
    flushSync();

    // 点击 = 开对应 tab（点击展开）；空态事实翻转 → rail 退役、tab 条 + 面板体上场。
    expect(visibleExtensionTabs().map((tab) => tab.type)).toEqual(["approvals"]);
    expect(host.querySelector("[data-side-pane-rail]")).toBeNull();
    expect(host.querySelector("[data-side-pane-tabs-content]")).toBeTruthy();
    const tabButtons = host.querySelectorAll("[data-side-pane-tab-id]");
    expect(tabButtons).toHaveLength(1);
    const panel = host.querySelector('[role="tabpanel"]');
    expect(panel).toBeTruthy();

    // 派生回归：关闭最后一个 tab → 空态事实翻转回 rail（不新增持久字段）。
    closeExtensionTab(visibleExtensionTabs()[0]!.id);
    flushSync();
    expect(visibleExtensionTabs()).toHaveLength(0);
    expect(host.querySelector("[data-side-pane-rail]")).toBeTruthy();
    expect(host.querySelector("[data-side-pane-tabs-content]")).toBeNull();
  });

  it("keeps the full-width form when tabs are open and the launcher card when rail is off", () => {
    // 有 tab：全宽形态（tab 条 + 面板体），railWhenEmpty 不参与。
    rebindExtensionPanel("session-a");
    mountPanel(true);
    host.querySelector<HTMLButtonElement>('[data-side-pane-rail-item="cards"]')!.click();
    flushSync();
    expect(host.querySelector("[data-side-pane-tabs-content]")).toBeTruthy();
    expect(host.querySelector("[data-side-pane-rail]")).toBeNull();

    // railWhenEmpty=false（窄屏 drawer 等价）：空态保持 open-tab launcher 卡。
    unmount(mounted!);
    mounted = null;
    host.remove();
    resetStore();
    mountPanel(false);
    expect(host.querySelector("[data-side-pane-rail]")).toBeNull();
    const launcher = Array.from(
      host.querySelectorAll<HTMLButtonElement>("[data-side-pane-open-tab-item]"),
    );
    expect(launcher.map((item) => item.dataset.sidePaneOpenTabItem)).toEqual([
      "approvals",
      "bash-output",
      "subagents",
      "cards",
    ]);
  });
});
