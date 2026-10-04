import { describe, expect, it, vi } from "vitest";

// workspace-page-polish V2：ws 作用域命令在执行时按激活 tab 解析目的地——
// tab-session 以可变 harness 替身注入（activeId 是被测派生的唯一输入）。
const tabs = vi.hoisted(() => ({ navigation: { activeId: "~" } }));

vi.mock("../tab-session.svelte.js", () => ({ tabSession: tabs }));

import {
  executeShellCommand,
  filterShellCommands,
  SHELL_COMMANDS,
  workspaceBlockPath,
} from "../commands.js";

function command(id: string) {
  const command = SHELL_COMMANDS.find((item) => item.id === id);
  if (!command) throw new Error(`expected shell command is missing: ${id}`);
  return command;
}

describe("shared shell commands", () => {
  it("provides one registry consumed by navigation and command search", () => {
    expect(SHELL_COMMANDS.map(({ id }) => id)).toEqual([
      "skills",
      "creator",
      "wiki",
      "evaluating",
      "agent",
      "settings",
      "search-config",
    ]);
    // 「Repository」一级导航已退役：palette/omnibox 不再注册该命令（V2 回归钉）。
    expect(filterShellCommands("repo")).toEqual([]);
    expect(filterShellCommands("preferences").map(({ id }) => id)).toEqual(["settings"]);
  });

  it("resolves ws-scoped commands against the active tab workspace, not Global", () => {
    const navigate = vi.fn();
    const handlers = { navigate, openSearchConfig: vi.fn() };

    // 激活 Alpha tab：四条 ws 作用域命令全部产出 /w/<alpha wsId>/…。
    tabs.navigation.activeId = "ws_alpha";
    for (const id of ["skills", "creator", "wiki", "evaluating"] as const) {
      executeShellCommand(command(id), handlers);
    }
    expect(navigate.mock.calls.map(([path]) => path)).toEqual([
      "/w/ws_alpha/skills",
      "/w/ws_alpha/creator",
      "/w/ws_alpha/wiki",
      "/w/ws_alpha/evaluating",
    ]);

    // 切回 Global tab（非 ws_ 标签）：同一命令解析为 /w/~/…。
    navigate.mockClear();
    tabs.navigation.activeId = "~";
    executeShellCommand(command("creator"), handlers);
    expect(navigate).toHaveBeenCalledWith("/w/~/creator");
  });

  it("executes through each surface's navigation and search-config adapters", () => {
    const navigate = vi.fn();
    const openSearchConfig = vi.fn();
    const handlers = { navigate, openSearchConfig };

    tabs.navigation.activeId = "~";
    executeShellCommand(command("agent"), handlers);
    executeShellCommand(command("search-config"), handlers);

    expect(navigate).toHaveBeenCalledWith("/agent");
    expect(openSearchConfig).toHaveBeenCalledTimes(1);
  });

  it("encodes the workspace segment in the resolved path", () => {
    expect(workspaceBlockPath("creator")).toBe("/w/~/creator");
    expect(workspaceBlockPath("wiki", "ws_alpha")).toBe("/w/ws_alpha/wiki");
  });
});
