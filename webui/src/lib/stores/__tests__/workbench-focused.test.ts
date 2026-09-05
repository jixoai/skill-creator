/**
 * 用户原始需求 [2026-09-05]：「断线、取消和 daemon stop 不留下假成功、悬挂任务或孤儿进程。」
 * 正交意图：[1] session 失效判定；[2] 代次失效（stale）响应不投影；[3] Global Workspace 写入过滤；[4] 草稿字段透传语义。
 * 说明：daemon 侧的 revision conflict 与 Global 写入拒绝由 test/creator-service.test.ts、
 * test/rpc-errors.test.ts、test/workspace-registry.test.ts 覆盖；本文件覆盖 WebUI store 层不变量。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORPCError } from "@orpc/client";

let connectionGeneration = 0;
let rpcClient: Record<string, unknown> | null = null;

vi.mock("../connection.svelte", () => ({
  connectionState: { status: "idle", error: null },
  connect: vi.fn(),
  disconnect: vi.fn(),
  getConnectionGeneration: () => connectionGeneration,
  getRpc: () => rpcClient,
  requireRpc: () => {
    if (!rpcClient) throw new Error("The Skill Creator daemon is not connected.");
    return rpcClient;
  },
}));

import {
  isSessionExpired,
  previewRemoteSkill,
  type RepositoryCallFailure,
} from "../repository.svelte";
import { draftToFrontmatter, emptyDraft } from "../creator-draft";
import { workspaceEntryPath, writableWorkspaceProviders } from "../workspace-targets";
import type { Workspace } from "$shared/contracts/workspaces.js";

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

beforeEach(() => {
  connectionGeneration = 0;
  rpcClient = null;
});

describe("isSessionExpired", () => {
  it("classifies the daemon session-expiry failure as expired", () => {
    const failure: RepositoryCallFailure = {
      message: "Repository session expired. Scan the repository again.",
      code: "UNAVAILABLE",
    };
    expect(isSessionExpired(failure)).toBe(true);
  });

  it("rejects other UNAVAILABLE failures and non-matching codes", () => {
    expect(isSessionExpired({ message: "git clone failed", code: "UNAVAILABLE" })).toBe(false);
    expect(
      isSessionExpired({
        message: "Repository session expired. Scan the repository again.",
        code: "NOT_FOUND",
      }),
    ).toBe(false);
    expect(isSessionExpired(null)).toBe(false);
  });
});

describe("repository store failure projection", () => {
  it("projects a session-expired preview failure with its oRPC code", async () => {
    rpcClient = {
      repository: {
        preview: vi.fn().mockRejectedValue(
          new ORPCError("UNAVAILABLE", {
            message: "Repository session expired. Scan the repository again.",
          }),
        ),
      },
    };
    const { preview, error } = await previewRemoteSkill("repo_test" as never, "rsk_x" as never);
    expect(preview).toBeNull();
    expect(error?.code).toBe("UNAVAILABLE");
    expect(isSessionExpired(error)).toBe(true);
  });

  it("drops the response when the connection generation changes mid-flight (stale)", async () => {
    const holder: { release: (value: { content: string }) => void } = {
      release: () => {},
    };
    rpcClient = {
      repository: {
        preview: vi.fn().mockImplementation(
          () =>
            new Promise((resolve) => {
              holder.release = resolve;
            }),
        ),
      },
    };
    const pending = previewRemoteSkill("repo_test" as never, "rsk_x" as never);
    connectionGeneration = 1; // 断线重连：owner generation 递增
    holder.release({ content: "# stale" });
    const { preview, error } = await pending;
    expect(preview).toBeNull();
    expect(error).toBeNull();
  });
});

describe("Global Workspace write rejection (webui projection)", () => {
  it("never lists global or unavailable workspaces as writable install targets", () => {
    const globalWs = makeWorkspace({
      id: "~",
      kind: "global",
      providers: [
        {
          id: "claude-code" as never,
          label: "Claude Code",
          path: "/home/.claude/skills",
          available: true,
          writable: true,
          skillCount: 1,
        },
      ],
    });
    const missingWs = makeWorkspace({
      id: "ws_ffffffffffffffff" as never,
      kind: "directory",
      available: false,
      path: "/tmp/gone",
      providers: [
        {
          id: "claude-code" as never,
          label: "Claude Code",
          path: "/tmp/gone/.claude/skills",
          available: true,
          writable: true,
          skillCount: 0,
        },
      ],
    });
    const writableWs = makeWorkspace({
      id: "ws_aaaaaaaaaaaaaaaa" as never,
      kind: "directory",
      path: "/tmp/ok",
      providers: [
        {
          id: "claude-code" as never,
          label: "Claude Code",
          path: "/tmp/ok/.claude/skills",
          available: true,
          writable: true,
          skillCount: 2,
        },
      ],
    });
    const targets = writableWorkspaceProviders([globalWs, missingWs, writableWs]);
    expect(targets).toHaveLength(1);
    expect(targets[0]?.target.workspaceId).toBe("ws_aaaaaaaaaaaaaaaa");
  });

  it("routes a provider-less workspace entry to the app home", () => {
    const ws = makeWorkspace({ id: "~", kind: "global" });
    expect(workspaceEntryPath(ws)).toBe("/workspaces");
  });
});

describe("creator draft frontmatter projection", () => {
  it("preserves passthrough frontmatter fields and overrides name/description", () => {
    const draft = emptyDraft(
      { workspaceId: "~" as never, providerId: "user" as never },
      "my-skill",
    );
    draft.name = "Updated";
    draft.description = "Updated description";
    draft.extraFrontmatter = { "allowed-tools": ["Bash"], version: 2 };
    const frontmatter = draftToFrontmatter(draft);
    expect(frontmatter.name).toBe("Updated");
    expect(frontmatter.description).toBe("Updated description");
    expect(frontmatter["allowed-tools"]).toEqual(["Bash"]);
    expect(frontmatter.version).toBe(2);
  });
});
