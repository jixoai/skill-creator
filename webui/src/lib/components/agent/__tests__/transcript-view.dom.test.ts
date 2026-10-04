// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount, type ComponentProps } from "svelte";

const callbacks = vi.hoisted(() => ({
  beginComposerEdit: vi.fn(),
  sendAgentPrompt: vi.fn(),
}));

vi.mock("$lib/stores/agent.svelte", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/stores/agent.svelte")>();
  return { ...actual, sendAgentPrompt: callbacks.sendAgentPrompt };
});
vi.mock("$lib/stores/agent-composer.svelte", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/stores/agent-composer.svelte")>();
  return { ...actual, beginComposerEdit: callbacks.beginComposerEdit };
});
vi.mock("$lib/toast.svelte", () => ({ showToast: vi.fn() }));

vi.mock("@lucide/svelte/icons/copy", async () => ({
  default: (await import("$lib/shell/__tests__/stub-leaf.svelte")).default,
}));
vi.mock("@lucide/svelte/icons/check", async () => ({
  default: (await import("$lib/shell/__tests__/stub-leaf.svelte")).default,
}));
vi.mock("@lucide/svelte/icons/pen-line", async () => ({
  default: (await import("$lib/shell/__tests__/stub-leaf.svelte")).default,
}));
vi.mock("@lucide/svelte/icons/refresh-cw", async () => ({
  default: (await import("$lib/shell/__tests__/stub-leaf.svelte")).default,
}));
vi.mock("@lucide/svelte/icons/sparkles", async () => ({
  default: (await import("$lib/shell/__tests__/stub-leaf.svelte")).default,
}));
vi.mock("@lucide/svelte/icons/file", async () => ({
  default: (await import("$lib/shell/__tests__/stub-leaf.svelte")).default,
}));
vi.mock("@lucide/svelte/icons/image", async () => ({
  default: (await import("$lib/shell/__tests__/stub-leaf.svelte")).default,
}));
vi.mock("@lucide/svelte/icons/arrow-down", async () => ({
  default: (await import("$lib/shell/__tests__/stub-leaf.svelte")).default,
}));
vi.mock("@lucide/svelte/icons/bot", async () => ({
  default: (await import("$lib/shell/__tests__/stub-leaf.svelte")).default,
}));
vi.mock("markstream-svelte", async () => ({
  default: (await import("./transcript-markdown-probe.svelte")).default,
}));
vi.mock("../AgentApprovalCard.svelte", async () => ({
  default: (await import("$lib/shell/__tests__/stub-leaf.svelte")).default,
}));
vi.mock("../AgentToolRow.svelte", async () => ({
  default: (await import("$lib/shell/__tests__/stub-leaf.svelte")).default,
}));
vi.mock("../DisclosureRow.svelte", async () => ({
  default: (await import("$lib/shell/__tests__/stub-leaf.svelte")).default,
}));

import { agentSession, type PanelItem } from "$lib/stores/agent.svelte";
import TranscriptView from "../TranscriptView.svelte";

type TranscriptViewProps = ComponentProps<typeof TranscriptView>;

class TestResizeObserver {
  static callbacks: ResizeObserverCallback[] = [];

  constructor(private readonly callback: ResizeObserverCallback) {
    TestResizeObserver.callbacks.push(callback);
  }

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}

  static triggerLatest(): void {
    TestResizeObserver.callbacks.at(-1)?.([], {} as ResizeObserver);
  }
}

describe("TranscriptView", () => {
  const mounted: ReturnType<typeof mount>[] = [];
  const hosts: HTMLElement[] = [];

  function setSession(items: PanelItem[], sessionId = `transcript-${crypto.randomUUID()}`): void {
    agentSession.sessionId = sessionId;
    agentSession.status = "idle";
    agentSession.items = items;
    agentSession.sending = false;
    agentSession.error = null;
    agentSession.promptError = null;
  }

  function mountView(props: TranscriptViewProps = {}): HTMLElement {
    const host = document.body.appendChild(document.createElement("div"));
    hosts.push(host);
    mounted.push(mount(TranscriptView, { target: host, props }));
    return host;
  }

  function setScrollGeometry(
    region: HTMLElement,
    height: number,
  ): { read: () => number; setHeight: (height: number) => void } {
    let contentHeight = height;
    let scrollTop = 0;
    Object.defineProperty(region, "clientHeight", { configurable: true, get: () => 100 });
    Object.defineProperty(region, "scrollHeight", {
      configurable: true,
      get: () => contentHeight,
    });
    Object.defineProperty(region, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = Math.max(0, Math.min(value, contentHeight - 100));
      },
    });
    return {
      read: () => scrollTop,
      setHeight: (nextHeight) => {
        contentHeight = nextHeight;
      },
    };
  }

  beforeEach(() => {
    TestResizeObserver.callbacks = [];
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    callbacks.beginComposerEdit.mockReset();
    callbacks.sendAgentPrompt.mockReset();
    setSession([]);
  });

  afterEach(() => {
    for (const component of mounted.splice(0)) unmount(component);
    for (const host of hosts.splice(0)) host.remove();
    vi.unstubAllGlobals();
  });

  it("renders interrupted turn-end reasons visibly and with failure status", () => {
    setSession([
      { kind: "assistant", seq: 1, text: "partial response", streaming: false },
      {
        kind: "turn-end",
        seq: 2,
        reason: "interrupted",
        usage: { inputTokens: 9, outputTokens: 4 },
      },
    ]);
    const host = mountView();
    flushSync();

    const status = host.querySelector<HTMLElement>('[role="status"]');
    expect(status?.textContent).toContain("interrupted");
    expect(status?.className).toContain("text-destructive");
    expect(host.textContent).toContain("↑ 9");
    expect(host.textContent?.match(/interrupted/g)).toHaveLength(1);
  });

  it("does not repeat a failure reason when the turn has no usage metrics", () => {
    setSession([{ kind: "turn-end", seq: 1, reason: "error" }]);
    const host = mountView();
    flushSync();

    expect(host.textContent?.match(/error/g)).toHaveLength(1);
  });

  it("keeps the streamed assistant row and finalizes its markdown renderer in place", () => {
    setSession([{ kind: "assistant", seq: 1, text: "partial response", streaming: true }]);
    const host = mountView();
    flushSync();

    expect(host.querySelector("[data-markdown-final='false']")?.textContent).toBe(
      "partial response",
    );

    agentSession.items = [
      { kind: "assistant", seq: 1, text: "completed response", streaming: false },
    ];
    flushSync();

    expect(host.querySelector("[data-markdown-final='true']")?.textContent).toBe(
      "completed response",
    );
  });

  it("makes the transcript keyboard reachable and keeps copy, edit, and resend actions discoverable", async () => {
    setSession([{ kind: "user", seq: 1, text: "inspect the failing test" }]);
    const focusComposer = vi.fn();
    const host = mountView({ focusComposer });
    flushSync();

    const region = host.querySelector<HTMLElement>('[role="region"]');
    expect(region?.tabIndex).toBe(0);
    expect(region?.getAttribute("aria-label")).toBe("Agent panel");
    region?.focus();
    expect(document.activeElement).toBe(region);

    const actions = [...host.querySelectorAll<HTMLButtonElement>('[role="toolbar"] button')];
    expect(actions.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Copy message",
      "Edit and resend — resends as a new message, keeps history",
      "Resend message — keeps history",
    ]);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    actions[0]?.focus();
    expect(document.activeElement).toBe(actions[0]);
    actions[0]?.click();
    actions[1]?.click();
    actions[2]?.click();
    await Promise.resolve();

    expect(callbacks.beginComposerEdit).toHaveBeenCalledWith("inspect the failing test");
    expect(focusComposer).toHaveBeenCalledOnce();
    expect(callbacks.sendAgentPrompt).toHaveBeenCalledWith("inspect the failing test");
  });

  it("follows growth at the bottom and preserves the reader anchor after manual scroll-up", () => {
    setSession([{ kind: "user", seq: 1, text: "earlier prompt" }]);
    const host = mountView();
    const region = host.querySelector<HTMLElement>('[role="region"]');
    if (!region) throw new Error("Transcript region missing");

    let contentHeight = 600;
    const geometry = setScrollGeometry(region, contentHeight);
    flushSync();
    expect(geometry.read()).toBe(500);

    contentHeight = 800;
    geometry.setHeight(contentHeight);
    TestResizeObserver.triggerLatest();
    flushSync();
    expect(geometry.read()).toBe(700);

    region.scrollTop = 60;
    region.dispatchEvent(new Event("scroll"));
    flushSync();
    contentHeight = 1000;
    geometry.setHeight(contentHeight);
    TestResizeObserver.triggerLatest();
    flushSync();
    expect(geometry.read()).toBe(60);
    expect(host.querySelector('[aria-label="Back to bottom"]')).not.toBeNull();
  });

  it("restores a session's non-pinned scroll position when its transcript is reopened", () => {
    const sessionId = `transcript-scroll-${crypto.randomUUID()}`;
    const otherSessionId = `transcript-scroll-other-${crypto.randomUUID()}`;
    setSession([{ kind: "user", seq: 1, text: "read this slowly" }], sessionId);
    const firstHost = mountView();
    const firstRegion = firstHost.querySelector<HTMLElement>('[role="region"]');
    if (!firstRegion) throw new Error("Transcript region missing");
    const firstGeometry = setScrollGeometry(firstRegion, 1000);
    flushSync();
    firstRegion.scrollTop = 300;
    firstRegion.dispatchEvent(new Event("scroll"));
    flushSync();
    expect(firstGeometry.read()).toBe(300);

    setSession([{ kind: "user", seq: 1, text: "another conversation" }], otherSessionId);
    flushSync();
    expect(firstGeometry.read()).toBe(900);

    setSession([{ kind: "user", seq: 1, text: "read this slowly" }], sessionId);
    flushSync();

    expect(firstGeometry.read()).toBe(300);
  });

  it("renders image and file attachments and makes long user text keyboard-scrollable", () => {
    setSession([
      {
        kind: "user",
        seq: 1,
        text: "long message ".repeat(100),
        images: ["data:image/png;base64,AA=="],
        files: ["diagram.png", "notes.txt"],
        imageChipNames: ["diagram.png"],
      },
    ]);
    const host = mountView();
    flushSync();

    const image = host.querySelector<HTMLImageElement>("img");
    expect(image?.src).toContain("data:image/png;base64,AA==");
    expect(host.textContent).toContain("diagram.png");
    expect(host.textContent).toContain("notes.txt");

    const message = host.querySelector<HTMLElement>(".bubble-user");
    expect(message?.tabIndex).toBe(0);
    message?.focus();
    expect(document.activeElement).toBe(message);
  });
});
