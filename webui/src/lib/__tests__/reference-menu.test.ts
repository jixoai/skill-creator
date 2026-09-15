// @vitest-environment jsdom
/**
 * ReferenceMenu 组件测试（composer-references C1）。
 *
 * 正交意图：
 *   [1] 钻取语法：Sessions 组仅在顶层前缀；目录行尾随 "/"（选中续览）；
 *       深层浏览恒有 `..` pinned 行；文件行 value = 完整前缀路径。
 *   [2] 选中路由：目录/pinned → onNavigate；文件 → onPick（绝对 target）；
 *       会话 → onPick（sessionId target，当前会话排除）。
 *   [3] 数据面：files.list 按 prefix 缓存（一次 RPC 一层目录）；未连接时退空。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const agentStore = vi.hoisted(() => ({
  agentSession: { sessionId: "agent-current" },
  agentSessionsList: {
    loaded: true,
    loading: false,
    error: null,
    sessions: [
      { sessionId: "agent-current", title: "current chat" },
      { sessionId: "agent-earlier", title: "earlier chat" },
    ],
  },
  loadAgentSessions: vi.fn(),
}));
const connection = vi.hoisted(() => ({
  list: vi.fn(),
}));

vi.mock("../stores/agent.svelte", () => agentStore);
vi.mock("../stores/connection.svelte", () => ({
  getRpc: () => ({ agent: { files: { list: connection.list } } }),
}));

import ReferenceMenu from "$lib/components/agent/ReferenceMenu.svelte";
import { flushSync, mount, unmount } from "./svelte-client";

function homeListing() {
  return {
    dir: "/home/tester",
    parent: null,
    entries: [
      { name: "Dev", kind: "dir" as const },
      { name: "notes.md", kind: "file" as const, size: 12 },
      { name: "logo.png", kind: "file" as const, size: 4096 },
    ],
  };
}

function mountMenu(text: string) {
  const onNavigate = vi.fn();
  const onPick = vi.fn();
  const target = document.createElement("div");
  document.body.appendChild(target);
  const instance = mount(ReferenceMenu, {
    target,
    props: { text, caretOnFirstLine: true, onNavigate, onPick },
  });
  flushSync();
  return {
    onNavigate,
    onPick,
    menu: () => document.querySelector<HTMLElement>('[data-slot="reference-menu"]'),
    rows: () => [
      ...document.querySelectorAll<HTMLButtonElement>('[data-slot="reference-menu"] li button'),
    ],
    pinned: () => document.querySelector<HTMLElement>('[data-menu-pinned="true"]'),
    cleanup: () => {
      unmount(instance);
      target.remove();
    },
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
  connection.list.mockReset().mockResolvedValue(homeListing());
});

describe("ReferenceMenu (C1)", () => {
  it("lists sessions (minus current) plus home files at the top-level prefix", async () => {
    const ctx = mountMenu("@");
    // 等文件组到场（会话组同步先现，弱条件会竞态通过）。
    await vi.waitFor(() =>
      expect(ctx.rows().some((row) => (row.textContent ?? "").includes("Dev/"))).toBe(true),
    );
    const labels = ctx.rows().map((row) => row.textContent ?? "");
    expect(labels.some((label) => label.includes("@earlier chat"))).toBe(true);
    expect(labels.some((label) => label.includes("current chat"))).toBe(false);
    expect(labels.some((label) => label.includes("Dev/"))).toBe(true);
    expect(labels.some((label) => label.includes("@notes.md"))).toBe(true);
    expect(ctx.pinned()).toBeNull();
    expect(connection.list).toHaveBeenCalledWith({});
    ctx.cleanup();
  });

  it("filters case-insensitively by the full prefix path", async () => {
    const ctx = mountMenu("@NO");
    await vi.waitFor(() =>
      expect(ctx.rows().some((row) => (row.textContent ?? "").includes("notes.md"))).toBe(true),
    );
    expect(
      ctx
        .rows()
        .map((row) => row.textContent ?? "")
        .join("\n"),
    ).toContain("@notes.md");
    ctx.cleanup();
  });

  it("drills into directories and shows the pinned .. row while browsing", async () => {
    connection.list.mockResolvedValueOnce(homeListing()).mockResolvedValueOnce({
      dir: "/home/tester/Dev",
      parent: "/home/tester",
      entries: [{ name: "spec.md", kind: "file" as const, size: 3 }],
    });
    const ctx = mountMenu("@Dev/");
    await vi.waitFor(() =>
      expect(ctx.rows().some((row) => (row.textContent ?? "").includes("spec.md"))).toBe(true),
    );
    expect(ctx.pinned()?.textContent).toContain("..");
    // 深层请求携带绝对目录。
    expect(connection.list).toHaveBeenLastCalledWith({ dir: "/home/tester/Dev" });
    ctx.cleanup();
  });

  it("routes a directory row to onNavigate (browse continues)", async () => {
    const ctx = mountMenu("@de");
    await vi.waitFor(() =>
      expect(ctx.rows().some((row) => (row.textContent ?? "").includes("Dev/"))).toBe(true),
    );
    const dirRow = ctx.rows().find((row) => (row.textContent ?? "").includes("Dev/"));
    dirRow?.click();
    expect(ctx.onNavigate).toHaveBeenCalledWith("@Dev/");
    expect(ctx.onPick).not.toHaveBeenCalled();
    ctx.cleanup();
  });

  it("routes a file row to onPick with the absolute path target", async () => {
    const ctx = mountMenu("@not");
    await vi.waitFor(() =>
      expect(ctx.rows().some((row) => (row.textContent ?? "").includes("notes.md"))).toBe(true),
    );
    const fileRow = ctx.rows().find((row) => (row.textContent ?? "").includes("notes.md"));
    fileRow?.click();
    expect(ctx.onPick).toHaveBeenCalledWith({
      token: "@notes.md",
      reference: {
        kind: "file",
        token: "@notes.md",
        target: "/home/tester/notes.md",
        label: "notes.md",
      },
    });
    ctx.cleanup();
  });

  it("routes a session row to onPick with the session id target", async () => {
    const ctx = mountMenu("@ear");
    await vi.waitFor(() =>
      expect(ctx.rows().some((row) => (row.textContent ?? "").includes("earlier chat"))).toBe(true),
    );
    const sessionRow = ctx.rows().find((row) => (row.textContent ?? "").includes("earlier chat"));
    sessionRow?.click();
    expect(ctx.onPick).toHaveBeenCalledWith({
      token: "@earlier chat",
      reference: {
        kind: "session",
        token: "@earlier chat",
        target: "agent-earlier",
        label: "earlier chat",
      },
    });
    ctx.cleanup();
  });

  it("stays hidden until the draft starts with @ on the first line", () => {
    const ctx = mountMenu("plain text");
    expect(ctx.menu()).toBeNull();
    ctx.cleanup();
  });
});
