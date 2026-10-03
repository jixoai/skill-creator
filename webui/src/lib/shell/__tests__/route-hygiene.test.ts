import { describe, expect, it, vi } from "vitest";

const iconStub = vi.hoisted(() => ({ default: {} }));
vi.mock("@lucide/svelte/icons/boxes", () => iconStub);
vi.mock("@lucide/svelte/icons/book-open", () => iconStub);
vi.mock("@lucide/svelte/icons/settings", () => iconStub);
vi.mock("@lucide/svelte/icons/file-pen-line", () => iconStub);
vi.mock("@lucide/svelte/icons/chart-no-axes-column-increasing", () => iconStub);
vi.mock("@lucide/svelte/icons/message-square", () => iconStub);
vi.mock("$app/state", () => ({
  page: { url: { pathname: "/", search: "", searchParams: new URLSearchParams() } },
}));
vi.mock("$app/navigation", () => ({ goto: () => {} }));

import "../../apps/workspaces/manifest.js";
import "../../apps/creator/manifest.js";
import "../../apps/wiki/manifest.js";
import "../../apps/settings/manifest.js";
import "../../apps/agent/manifest.js";
import "../../apps/evaluating/manifest.js";
import {
  canonicalizeShellLocation,
  resolveShellRoute,
  sanitizeShellLocation,
  SHELL_HOME_PATH,
} from "../route-hygiene.js";

const workspaceId = "ws_0123456789abcdef01234567";
const skillId = "sk_0123456789abcdef01234567";

describe("legacy shell URL migrations", () => {
  it.each([
    ["/workspaces", "", "/w/~/skills"],
    [
      "/workspaces/intelligence/ws_0123456789abcdef01234567/claude-code",
      "?severity=warning",
      "/w/ws_0123456789abcdef01234567/skills/intelligence/claude-code?severity=warning",
    ],
    [
      "/workspaces/ws_0123456789abcdef01234567/claude-code",
      "?q=hello+world&skill=sk_0123456789abcdef01234567&view=detail",
      "/w/ws_0123456789abcdef01234567/skills?q=hello+world&provider=claude-code&skill=sk_0123456789abcdef01234567",
    ],
    [
      "/workspaces/ws_0123456789abcdef01234567/claude-code",
      "?view=list",
      "/w/ws_0123456789abcdef01234567/skills?provider=claude-code",
    ],
    ["/creator", "", "/w/~/creator"],
    [
      "/creator/edit/ws_0123456789abcdef01234567/claude-code/sk_0123456789abcdef01234567",
      "?subview=preview&template=basic",
      "/w/ws_0123456789abcdef01234567/creator/edit/claude-code/sk_0123456789abcdef01234567?subview=preview&template=basic",
    ],
    [
      "/creator/new/ws_0123456789abcdef01234567/claude-code",
      "?template=basic",
      "/w/ws_0123456789abcdef01234567/creator/new/claude-code?template=basic",
    ],
    ["/wiki", "", "/w/~/wiki"],
    ["/wiki/%7E", "", "/w/~/wiki"],
    ["/wiki/ws_0123456789abcdef01234567", "", "/w/ws_0123456789abcdef01234567/wiki"],
    ["/repository", "", "/w/~/skills?screen=repos"],
    [
      "/repository/scan/curated-source",
      "?selected=a&targets=b&skill=c",
      "/w/~/skills/repos/scan/curated-source?selected=a&targets=b&skill=c",
    ],
  ])("maps %s%s", (pathname, search, expected) => {
    expect(canonicalizeShellLocation(pathname, search)).toBe(expected);
  });

  it("does not rewrite the settings page URLs", () => {
    expect(canonicalizeShellLocation("/settings/model", "")).toBe("/settings/model");
    expect(sanitizeShellLocation("/settings/model", "")).toEqual({ kind: "ok" });
  });

  it("redirects invalid workspace identities before rendering", () => {
    expect(sanitizeShellLocation("/w/garbage/skills", "")).toEqual({
      kind: "redirect",
      path: "/w/~/skills",
    });
    expect(
      sanitizeShellLocation("/w/garbage/creator/edit/claude-code/sk_0123456789abcdef01234567", ""),
    ).toEqual({ kind: "redirect", path: "/w/~/creator" });
  });

  it("drops invalid search while preserving the matched route", () => {
    expect(sanitizeShellLocation("/w/~/skills", "?provider=INVALID")).toEqual({
      kind: "redirect",
      path: "/w/~/skills",
    });
  });

  it("resolves workspace, agent, and settings Page manifests", () => {
    expect(resolveShellRoute("/w/~/wiki", "")?.app.pageKind).toBe("workspace");
    expect(resolveShellRoute("/agent", "")?.app.pageKind).toBe("agent");
    expect(resolveShellRoute("/settings", "")?.app.pageKind).toBe("settings");
  });

  it("sends unknown and unmatched routes to Global Skills", () => {
    expect(sanitizeShellLocation("/missing/path", "")).toEqual({
      kind: "redirect",
      path: SHELL_HOME_PATH,
    });
    expect(sanitizeShellLocation("/agent/unmatched", "")).toEqual({
      kind: "redirect",
      path: "/agent",
    });
  });
});
