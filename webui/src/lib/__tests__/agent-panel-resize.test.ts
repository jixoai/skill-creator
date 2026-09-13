// @vitest-environment jsdom
/**
 * Agent 面板 R17-C resize/收起测试（宽屏拖拽 + 开关=收起不销毁）。
 *
 * 用户原始需求 [2026-09-13]：「Agent Chat 面板也能支持 resize，并且控制好窄屏幕
 * 的支持，窄屏模式下和主面板不再是并排显示，而是用抽屉的方式提供层级覆盖。
 * 开关 AgentChat 面板，只是收起，不是 DOM 级别的销毁。」
 *
 * 正交意图：
 *   [1] 宽度语义：clamp 边界（320–720/默认 440，非有限数回默认）；拖拽写入
 *       经 sessionStorage 持久（skill-creator.agentPanelWidth.v1），模块重初始化
 *       往返恢复；损坏/越界持久值按领域收窄不迁移。
 *   [2] 收起语义：setAgentPanelOpen(false) 后 aside 仍留在 DOM（同一元素身份），
 *       宽屏收起 0 宽不占布局（border-l-0 + CSS var 0），窄屏收起 invisible +
 *       translate 退场；收起/展开不清 composer 草稿（与 Track A 开合语义对齐）。
 *   [3] 拖拽交互：pointerdown（左缘拖柄，仅 ≥720px 命中区类）→ window pointermove
 *       clamp 更新 → pointerup 恢复 body 选择/光标并持久。
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const connection = vi.hoisted(() => ({
  generation: 0,
  rpc: null as unknown,
}));

vi.mock("../stores/connection.svelte", () => ({
  getConnectionGeneration: () => connection.generation,
  getRpc: () => connection.rpc ?? null,
  requireRpc: () => {
    if (!connection.rpc) throw new Error("not connected");
    return connection.rpc;
  },
}));
vi.mock("../toast.svelte", () => ({
  showToast: vi.fn(),
}));
vi.mock("@lucide/svelte/icons/x", async () => await import("./stubs/lucide-icon-mocks.js"));
// 子组件不在被测面：以空渲染 stub 隔离（AgentHeader→settings-ui/lucide、
// TranscriptView→markstream、ComposerCard→bits-ui 的重导入链全部短路）。
vi.mock("../components/agent/AgentHeader.svelte", async () => {
  const { default: stub } = await import("./stubs/markdown-render-stub.svelte");
  return { default: stub };
});
vi.mock("../components/agent/TranscriptView.svelte", async () => {
  const { default: stub } = await import("./stubs/markdown-render-stub.svelte");
  return { default: stub };
});
vi.mock("../components/agent/TodoDock.svelte", async () => {
  const { default: stub } = await import("./stubs/markdown-render-stub.svelte");
  return { default: stub };
});
vi.mock("../components/agent/ComposerCard.svelte", async () => {
  const { default: stub } = await import("./stubs/markdown-render-stub.svelte");
  return { default: stub };
});

import AgentPanel from "../components/agent/AgentPanel.svelte";
import { flushSync, mount, unmount } from "./svelte-client";
import {
  AGENT_PANEL_DEFAULT_WIDTH,
  agentPanel,
  agentRuntimeConfig,
  clampAgentPanelWidth,
  setAgentPanelOpen,
  setAgentPanelWidth,
} from "../stores/agent.svelte";
import { agentComposer, resetAllComposerTracks } from "../stores/agent-composer.svelte";

const WIDTH_KEY = "skill-creator.agentPanelWidth.v1";

function mountPanel() {
  agentPanel.open = true;
  const target = document.createElement("div");
  document.body.appendChild(target);
  const instance = mount(AgentPanel, { target });
  flushSync();
  return {
    cleanup: () => {
      unmount(instance);
      target.remove();
    },
  };
}

function panelAside(): HTMLElement {
  const aside = document.querySelector('aside[aria-label="Agent panel"]');
  if (!(aside instanceof HTMLElement)) throw new Error("agent panel aside missing");
  return aside;
}

function dragHandle(): HTMLElement {
  const handle = document.querySelector('[aria-label="Resize agent panel"]');
  if (!(handle instanceof HTMLElement)) throw new Error("resize handle missing");
  return handle;
}

beforeAll(() => {
  // jsdom 无真实指针捕获语义：拖柄 pointerdown 依赖 setPointerCapture，直接空实现。
  Element.prototype.setPointerCapture = () => {};
});

beforeEach(() => {
  sessionStorage.clear();
  connection.rpc = {
    agent: { settings: { get: async () => ({ settings: {}, providers: [] }) } },
  };
  connection.generation = 0;
  agentPanel.open = false;
  agentPanel.seedPrompt = null;
  agentPanel.width = AGENT_PANEL_DEFAULT_WIDTH;
  agentRuntimeConfig.view = null;
  agentRuntimeConfig.loading = false;
  agentRuntimeConfig.updating = false;
  agentRuntimeConfig.error = null;
  resetAllComposerTracks();
  document.body.style.userSelect = "";
  document.body.style.cursor = "";
});

afterEach(() => {
  document.body.style.userSelect = "";
  document.body.style.cursor = "";
});

describe("agent panel width domain (R17-C)", () => {
  it("clamps widths into 320–720 and recovers defaults from non-finite input", () => {
    expect(clampAgentPanelWidth(100)).toBe(320);
    expect(clampAgentPanelWidth(-5)).toBe(320);
    expect(clampAgentPanelWidth(2000)).toBe(720);
    expect(clampAgentPanelWidth(500.4)).toBe(500);
    expect(clampAgentPanelWidth(NaN)).toBe(AGENT_PANEL_DEFAULT_WIDTH);
    expect(clampAgentPanelWidth(Number.POSITIVE_INFINITY)).toBe(AGENT_PANEL_DEFAULT_WIDTH);
  });

  it("persists dragged widths to sessionStorage after clamping", () => {
    setAgentPanelWidth(520);
    expect(agentPanel.width).toBe(520);
    expect(sessionStorage.getItem(WIDTH_KEY)).toBe("520");
    setAgentPanelWidth(50);
    expect(agentPanel.width).toBe(320);
    expect(sessionStorage.getItem(WIDTH_KEY)).toBe("320");
    setAgentPanelWidth(9999);
    expect(sessionStorage.getItem(WIDTH_KEY)).toBe("720");
  });

  it("restores the persisted width on module re-init (roundtrip)", async () => {
    setAgentPanelWidth(610);
    vi.resetModules();
    const fresh = await import("../stores/agent.svelte");
    expect(fresh.agentPanel.width).toBe(610);
  });

  it("projects corrupted or out-of-range stored values into the domain", async () => {
    sessionStorage.setItem(WIDTH_KEY, "not-a-number");
    vi.resetModules();
    const corrupted = await import("../stores/agent.svelte");
    expect(corrupted.agentPanel.width).toBe(AGENT_PANEL_DEFAULT_WIDTH);

    sessionStorage.setItem(WIDTH_KEY, "9999");
    vi.resetModules();
    const clamped = await import("../stores/agent.svelte");
    expect(clamped.agentPanel.width).toBe(720);
  });
});

describe("AgentPanel collapse semantics (R17-C: toggle collapses, never unmounts)", () => {
  it("keeps the same aside element in the DOM after collapsing", () => {
    const ctx = mountPanel();
    const asideBefore = panelAside();
    expect(asideBefore.classList.contains("border-l")).toBe(true);
    expect(asideBefore.classList.contains("border-border")).toBe(true);
    expect(asideBefore.getAttribute("style")).toContain(
      `--agent-panel-width: ${AGENT_PANEL_DEFAULT_WIDTH}px`,
    );

    setAgentPanelOpen(false);
    flushSync();

    const asideAfter = panelAside();
    expect(asideAfter).toBe(asideBefore); // DOM 身份保留：收起不是销毁。
    expect(asideAfter.classList.contains("border-l-0")).toBe(true);
    expect(asideAfter.classList.contains("border-border")).toBe(false);
    expect(asideAfter.getAttribute("style")).toContain("--agent-panel-width: 0px");
    ctx.cleanup();
  });

  it("keeps the composer draft across collapse and reopen", () => {
    const ctx = mountPanel();
    agentComposer.text = "draft survives collapse";
    flushSync();

    setAgentPanelOpen(false);
    flushSync();
    expect(agentComposer.text).toBe("draft survives collapse");

    setAgentPanelOpen(true);
    flushSync();
    expect(agentComposer.text).toBe("draft survives collapse");
    expect(panelAside().classList.contains("border-l")).toBe(true);
    ctx.cleanup();
  });

  it("renders the narrow-screen drawer collapse classes and hides the drag handle below 720px", () => {
    const ctx = mountPanel();
    const handle = dragHandle();
    // 拖柄只在 ≥720px 命中（窄屏抽屉无侧栏宽度语义）。
    expect(handle.classList.contains("cursor-col-resize")).toBe(true);
    expect(handle.classList.contains("hidden")).toBe(true);
    expect(handle.classList.contains("min-[720px]:block")).toBe(true);

    const aside = panelAside();
    // 宽屏宽度由 CSS var 经媒体断点消费（<720px 仍是全屏抽屉 w-full）。
    expect(aside.classList.contains("min-[720px]:w-(--agent-panel-width)")).toBe(true);
    expect(aside.classList.contains("min-[720px]:overflow-hidden")).toBe(true);

    setAgentPanelOpen(false);
    flushSync();
    // 窄屏收起：invisible + translate 退场（DOM/布局保留，覆盖层让位主区）。
    expect(aside.classList.contains("max-[720px]:invisible")).toBe(true);
    expect(aside.classList.contains("max-[720px]:translate-x-full")).toBe(true);
    ctx.cleanup();
  });
});

describe("AgentPanel drag resize (R17-C)", () => {
  it("resizes via pointer sequence with clamping, body lock, and persistence", async () => {
    const ctx = mountPanel();
    const aside = panelAside();
    const handle = dragHandle();

    handle.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 1000 }),
    );
    flushSync();
    expect(document.body.style.userSelect).toBe("none");
    expect(document.body.style.cursor).toBe("col-resize");

    // 左移 100px → 面板加宽 100px。
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 900 }));
    flushSync();
    expect(agentPanel.width).toBe(540);
    expect(aside.getAttribute("style")).toContain("--agent-panel-width: 540px");

    // 大幅左移越界 → clamp 到 720。
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: -2000 }));
    flushSync();
    expect(agentPanel.width).toBe(720);

    // 大幅右移越界 → clamp 到 320。
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 5000 }));
    flushSync();
    expect(agentPanel.width).toBe(320);

    window.dispatchEvent(new MouseEvent("pointerup"));
    flushSync();
    expect(document.body.style.userSelect).toBe("");
    expect(document.body.style.cursor).toBe("");
    expect(sessionStorage.getItem(WIDTH_KEY)).toBe("320");
    ctx.cleanup();
  });

  it("ignores window pointer moves when no drag is active", () => {
    const ctx = mountPanel();
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 0 }));
    flushSync();
    expect(agentPanel.width).toBe(AGENT_PANEL_DEFAULT_WIDTH);
    expect(document.body.style.userSelect).toBe("");
    ctx.cleanup();
  });
});
