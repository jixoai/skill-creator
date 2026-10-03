import { describe, expect, it, vi } from "vitest";
import { executeShellCommand, filterShellCommands, SHELL_COMMANDS } from "../commands.js";

describe("shared shell commands", () => {
  it("provides one registry consumed by navigation and command search", () => {
    expect(SHELL_COMMANDS.map(({ id }) => id)).toEqual([
      "skills",
      "creator",
      "wiki",
      "evaluating",
      "repository",
      "agent",
      "settings",
      "search-config",
    ]);
    expect(filterShellCommands("repo").map(({ id }) => id)).toEqual(["repository"]);
    expect(filterShellCommands("preferences").map(({ id }) => id)).toEqual(["settings"]);
  });

  it("executes through each surface's navigation and search-config adapters", () => {
    const navigate = vi.fn();
    const openSearchConfig = vi.fn();
    const handlers = { navigate, openSearchConfig };

    const creator = SHELL_COMMANDS.find((command) => command.id === "creator");
    const searchConfig = SHELL_COMMANDS.find((command) => command.id === "search-config");
    if (!creator || !searchConfig) throw new Error("expected shell commands are missing");

    executeShellCommand(creator, handlers);
    executeShellCommand(searchConfig, handlers);

    expect(navigate).toHaveBeenCalledWith("/w/~/creator");
    expect(openSearchConfig).toHaveBeenCalledTimes(1);
  });
});
