// @vitest-environment jsdom
/**
 * ComposerCard SlashMenu + 模式 chip DropdownMenu 组件测试（design §3.4；
 * codex R2：SlashMenu defer 解除、mode chip 脱离原生 select）。
 *
 * 用户原始需求 [2026-09-12]：「SlashMenu：稿文以 `/` 开头且光标在首行时，于
 * composer 上方锚定浮现……当前命令 `/compact`（执行并发送）；↑↓ 导航 + Enter
 * 执行 + Esc 关闭」；「模式 chip（`General ▾`……DropdownMenu 列 DSH_AGENT_MODES；
 * running 置灰 + title「Switch after the current turn ends」；无会话时点击 = 以
 * 该模式建会话）」。
 *
 * 正交意图：
 *   [1] SlashMenu：`/` 浮现、`/x` 无匹配隐藏、Enter 以命令文本发送并清稿、
 *       Esc 对当前稿文一次性驳回（稿文再变化重新浮现）。
 *   [2] 模式 chip：目录渲染 + 当前项 check；会话内切换 / 无会话建会话；running
 *       禁用与 title 文案。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const connection = vi.hoisted(() => ({
  rpc: null as unknown,
}));
const settingsUi = vi.hoisted(() => ({
  openSettings: vi.fn(),
}));
const toast = vi.hoisted(() => ({
  showToast: vi.fn(),
}));

vi.mock("../stores/connection.svelte", () => ({
  getRpc: () => connection.rpc ?? null,
  getConnectionGeneration: () => 0,
  requireRpc: () => {
    throw new Error("not connected");
  },
}));
vi.mock("../stores/agent.svelte", async () => await import("./stubs/agent-store-stub.svelte"));
// agent-composer 用真 store（runes .svelte.ts）：bind:value 与 SlashMenu 的
// text 属性必须随草稿真实联动；只 mock 其依赖的 toast。
vi.mock("../toast.svelte", () => ({
  showToast: toast.showToast,
}));
vi.mock("../stores/settings-ui.svelte", () => ({
  openSettings: settingsUi.openSettings,
}));
vi.mock("../components/agent/ContextMeter.svelte", async () => {
  const { default: stub } = await import("./stubs/context-meter-stub.svelte");
  return { default: stub };
});

// @lucide/svelte 图标 = node_modules 的 .svelte（root vitest 管线不编译）——空壳替换。
vi.mock("@lucide/svelte/icons/paperclip", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/file", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/arrow-up", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/square", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock(
  "@lucide/svelte/icons/chevron-down",
  async () => await import("./stubs/lucide-icon-mocks.js"),
);
vi.mock("@lucide/svelte/icons/check", async () => await import("./stubs/lucide-icon-mocks.js"));
vi.mock("@lucide/svelte/icons/x", async () => await import("./stubs/lucide-icon-mocks.js"));

// bits-ui 在 node_modules 含 .svelte（vitest 外置）——本地 dropdown stub 替换。
// 用 per-instance 三件套（Root/Trigger/Content：context 级开合态，经 $bindable
// 同步组件的 bind:open），Item/Group 等无状态件沿用共享 stub 目录。
vi.mock("$lib/components/ui/dropdown-menu", async () => {
  const Root = (await import("./stubs/dropdown-menu-pi-stub/Root.svelte")).default;
  const Trigger = (await import("./stubs/dropdown-menu-pi-stub/Trigger.svelte")).default;
  const Content = (await import("./stubs/dropdown-menu-pi-stub/Content.svelte")).default;
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

import ComposerCard from "../components/agent/ComposerCard.svelte";
import { flushSync, mount, unmount } from "./svelte-client";
import {
  agentSession,
  resetAgentStoreStub,
  createAgentSession,
  sendAgentPrompt,
  setAgentSessionMode,
} from "./stubs/agent-store-stub.svelte";
import { agentComposer } from "../stores/agent-composer.svelte";

function mountComposer() {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const instance = mount(ComposerCard, { target });
  flushSync();
  return {
    textarea: () => document.querySelector<HTMLTextAreaElement>("textarea[aria-label='Message']"),
    menu: () => document.querySelector<HTMLElement>('[data-slot="slash-menu"]'),
    modeTrigger: () =>
      document.querySelector<HTMLButtonElement>('button[aria-label="Session mode"]'),
    modeItems: () => [
      ...document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]'),
    ],
    openModeMenu: async () => {
      const trigger = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Session mode"]',
      );
      if (!trigger) throw new Error("mode chip trigger not rendered");
      trigger.click();
      await vi.waitFor(() => {
        if (document.querySelector('[data-slot="dropdown-menu-content"]') === null) {
          throw new Error("mode menu content not rendered");
        }
      });
    },
    cleanup: () => {
      unmount(instance);
      target.remove();
      document.querySelectorAll("[data-slot='dropdown-menu-content']").forEach((n) => n.remove());
    },
  };
}

/** 在 textarea 上派发 keydown（cancelable，preventDefault/stopPropagation 可生效）。 */
function pressKey(key: string): void {
  const textarea = document.querySelector<HTMLTextAreaElement>("textarea[aria-label='Message']");
  if (!textarea) throw new Error("composer textarea not rendered");
  textarea.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

describe("ComposerCard SlashMenu (design §3.4)", () => {
  beforeEach(() => {
    resetAgentStoreStub(null);
    agentSession.sessionId = "agent-s1";
    agentSession.mode = "free";
    agentComposer.text = "";
    agentComposer.images = [];
    agentComposer.files = [];
    agentComposer.editing = null;
  });

  it("surfaces the menu with /compact when the draft starts with a bare slash", () => {
    const ctx = mountComposer();
    agentComposer.text = "/";
    flushSync();

    const menu = ctx.menu();
    expect(menu).not.toBeNull();
    expect(menu?.textContent).toContain("/compact");
    ctx.cleanup();
  });

  it("hides the menu when no registered command matches the query", () => {
    const ctx = mountComposer();
    agentComposer.text = "/x";
    flushSync();
    expect(ctx.menu()).toBeNull();
    ctx.cleanup();
  });

  it("Enter executes the selected command: sends the command text and clears the draft", () => {
    const ctx = mountComposer();
    agentComposer.text = "/comp";
    flushSync();
    expect(ctx.menu()).not.toBeNull();

    pressKey("Enter");
    flushSync();
    expect(sendAgentPrompt).toHaveBeenCalledWith("/compact");
    expect(agentComposer.text).toBe("");
    expect(ctx.menu()).toBeNull();
    ctx.cleanup();
  });

  it("Escape dismisses the menu for the current draft; further typing resurfaces it", () => {
    const ctx = mountComposer();
    agentComposer.text = "/";
    flushSync();
    expect(ctx.menu()).not.toBeNull();

    pressKey("Escape");
    flushSync();
    expect(ctx.menu()).toBeNull();

    agentComposer.text = "/c";
    flushSync();
    expect(ctx.menu()).not.toBeNull();
    ctx.cleanup();
  });

  it("keeps plain Enter submit untouched when the menu is closed", () => {
    const ctx = mountComposer();
    agentComposer.text = "plain message";
    flushSync();
    expect(ctx.menu()).toBeNull();

    pressKey("Enter");
    flushSync();
    expect(sendAgentPrompt).toHaveBeenCalledWith("plain message", [], []);
    ctx.cleanup();
  });
});

describe("ComposerCard mode chip dropdown (design §3.4)", () => {
  beforeEach(() => {
    resetAgentStoreStub(null);
    agentComposer.text = "";
    agentComposer.images = [];
    agentComposer.files = [];
    agentComposer.editing = null;
  });

  it("lists DSH_AGENT_MODES and checks the current mode", async () => {
    resetAgentStoreStub(null);
    agentSession.sessionId = "agent-s1";
    agentSession.mode = "free";
    const ctx = mountComposer();

    expect(ctx.modeTrigger()?.textContent).toContain("General");
    await ctx.openModeMenu();

    const labels = ctx.modeItems().map((n) => n.textContent?.trim());
    expect(labels).toEqual(["Create", "Manage", "Explore", "General"]);
    const active = ctx.modeItems().find((n) => n.getAttribute("data-mode-active") === "true");
    expect(active?.textContent).toContain("General");
    ctx.cleanup();
  });

  it("switches the session mode in-session, and starts a session with the mode when none exists", async () => {
    // 有会话：切换模式。
    resetAgentStoreStub(null);
    agentSession.sessionId = "agent-s1";
    agentSession.mode = "free";
    const withSession = mountComposer();
    await withSession.openModeMenu();
    const explore = withSession.modeItems().find((n) => n.textContent?.includes("Explore"));
    explore!.click();
    expect(setAgentSessionMode).toHaveBeenCalledWith("explore");
    withSession.cleanup();

    // 无会话：以该模式建会话（空态卡等价第二入口）。
    resetAgentStoreStub(null);
    const withoutSession = mountComposer();
    expect(withoutSession.modeTrigger()?.textContent).toContain("Mode");
    await withoutSession.openModeMenu();
    const create = withoutSession.modeItems().find((n) => n.textContent?.includes("Create"));
    create!.click();
    expect(createAgentSession).toHaveBeenCalledWith(undefined, "create");
    withoutSession.cleanup();
  });

  it("disables the trigger while running with the shared switch-later title", () => {
    resetAgentStoreStub(null);
    agentSession.sessionId = "agent-s1";
    agentSession.mode = "free";
    const ctx = mountComposer();
    expect(ctx.modeTrigger()?.disabled).toBe(false);

    agentSession.status = "running";
    flushSync();
    const trigger = ctx.modeTrigger();
    expect(trigger?.disabled).toBe(true);
    expect(trigger?.title).toBe("Switch after the current turn ends");
    ctx.cleanup();
  });
});
