import { describe, expect, it, vi } from "vitest";

const iconStub = vi.hoisted(() => ({ default: {} }));
vi.mock("@lucide/svelte/icons/boxes", () => iconStub);
vi.mock("@lucide/svelte/icons/file-pen-line", () => iconStub);
vi.mock("@lucide/svelte/icons/book-open", () => iconStub);

import { creatorApp } from "$lib/apps/creator/manifest.js";
import { workspacesApp } from "$lib/apps/workspaces/manifest.js";
import { wikiApp } from "$lib/apps/wiki/manifest.js";
import { resolveShellRoute } from "../route-hygiene.js";

describe("existing Page blocks load through the shell route factories", () => {
  it.each([
    ["Skills dashboard", workspacesApp.manifest.id, "/w/~/skills", "workspaces.provider"],
    ["Wiki scope", wikiApp.manifest.id, "/w/~/wiki", "wiki.scope"],
    [
      "Creator editor",
      creatorApp.manifest.id,
      "/w/ws_0123456789abcdef01234567/creator/edit/claude/sk_0123456789abcdef01234567",
      "creator.workspace.skill",
    ],
  ])("routes the %s view through the registered Page factory", (_label, appId, path, routeId) => {
    const url = new URL(path, "https://shell.invalid");
    const route = resolveShellRoute(url.pathname, url.search);
    expect(route?.app.id).toBe(appId);
    expect(route?.result.kind).toBe("matched");
    if (route?.result.kind !== "matched") throw new Error(`Route ${routeId} did not match`);
    const leaf = route.result.chain.at(-1)?.route;
    expect(leaf?.id).toBe(routeId);
    expect(leaf?.component).toBeTypeOf("function");
  });
});
