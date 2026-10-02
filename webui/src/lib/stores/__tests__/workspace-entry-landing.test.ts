/**
 * 用户原始需求 [2026-10-02]（ux-polish-walkthrough-residue #7）：
 * 「点 Workspace 卡默认落第一个 provider（可能 0 skills）——改为优先落第一个有技能的 provider。」
 * 正交意图：[1] workspaceEntryPath 落点选择不变量（首个非空 provider 优先、
 * 全空维持首个、无 provider 回 home、Global 永不深链）。
 */
import { describe, expect, it } from "vitest";
import { workspaceEntryPath } from "../workspace-targets.js";
import type { Workspace, WorkspaceProvider } from "$shared/contracts/workspaces.js";

function makeProvider(
  overrides: { id: string } & Partial<Omit<WorkspaceProvider, "id">>,
): WorkspaceProvider {
  return {
    label: `Provider ${overrides.id}`,
    path: `/tmp/ws/${overrides.id}`,
    available: true,
    writable: true,
    skillCount: 0,
    ...overrides,
    id: overrides.id as WorkspaceProvider["id"],
  } as WorkspaceProvider;
}

function makeWorkspace(overrides: Partial<Workspace> & Pick<Workspace, "id" | "kind">): Workspace {
  return {
    label: "Test",
    active: false,
    available: true,
    skillCount: 0,
    providers: [],
    path: overrides.kind === "directory" ? "/tmp/ws" : null,
    ...overrides,
  } as Workspace;
}

describe("workspaceEntryPath landing preference (walkthrough #7)", () => {
  it("lands on the first provider that has skills, skipping an empty first provider", () => {
    const ws = makeWorkspace({
      id: "ws_aaaaaaaaaaaaaaaa" as never,
      kind: "directory",
      providers: [
        makeProvider({ id: "empty-first", skillCount: 0 }),
        makeProvider({ id: "with-skills", skillCount: 3 }),
      ],
    });
    expect(workspaceEntryPath(ws)).toBe("/workspaces/ws_aaaaaaaaaaaaaaaa/with-skills");
  });

  it("keeps the first provider when every provider is empty", () => {
    const ws = makeWorkspace({
      id: "ws_bbbbbbbbbbbbbbbb" as never,
      kind: "directory",
      providers: [
        makeProvider({ id: "first-empty", skillCount: 0 }),
        makeProvider({ id: "also-empty", skillCount: 0 }),
      ],
    });
    expect(workspaceEntryPath(ws)).toBe("/workspaces/ws_bbbbbbbbbbbbbbbb/first-empty");
  });

  it("still lands on the first provider when it is the only one with skills at the tail", () => {
    const ws = makeWorkspace({
      id: "ws_cccccccccccccccc" as never,
      kind: "directory",
      providers: [
        makeProvider({ id: "has-skills", skillCount: 1 }),
        makeProvider({ id: "empty", skillCount: 0 }),
      ],
    });
    expect(workspaceEntryPath(ws)).toBe("/workspaces/ws_cccccccccccccccc/has-skills");
  });

  it("returns the app home for a provider-less workspace", () => {
    const ws = makeWorkspace({ id: "ws_dddddddddddddddd" as never, kind: "directory" });
    expect(workspaceEntryPath(ws)).toBe("/workspaces");
  });

  it("never deep-links the Global workspace regardless of provider counts", () => {
    const ws = makeWorkspace({
      id: "~" as const,
      kind: "global",
      providers: [makeProvider({ id: "user", skillCount: 5 })],
    });
    expect(workspaceEntryPath(ws)).toBe("/workspaces");
  });
});
