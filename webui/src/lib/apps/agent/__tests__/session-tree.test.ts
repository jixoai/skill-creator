/**
 * Agent 页左栏树纯逻辑单测（skills-agent-page 1.3）。
 *
 * 用户原始需求 [2026-10-03]（design §2 list 投影）：按 target.workspaceId 分组
 * + 无 target 归「Unassigned（只读）」组；r2 裁决 subagent 不入树（list 已过滤，
 * 本模块消费 summary 直投影——无 subagent 语义面）。
 *
 * 正交意图：
 *   [1] 分组：registry 顺序 workspace 组（恒在）+ 未命中 registry 的归属组 +
 *       Unassigned 组（仅有会话时出现）；组内 createdAt 降序。
 *   [2] 过滤与判定：sessionsForWorkspace（attach 面板复用）；unassigned 判定。
 */
import { describe, expect, it } from "vitest";
import type { AgentSessionSummary } from "$shared/contracts/agent.js";
import type {
  ImportedWorkspaceId,
  ProviderId,
  Workspace,
  WorkspaceId,
} from "$shared/contracts/workspaces.js";
import {
  UNASSIGNED_GROUP_KEY,
  groupSessionsByTarget,
  sessionDisplayName,
  sessionIsUnassigned,
  sessionsForWorkspace,
} from "../session-tree.js";

/** 合法 ImportedWorkspaceId 形状（ws_ + 24 hex；brand 需断言）。 */
const importedId = "ws_0123456789abcdef01234567" as ImportedWorkspaceId;
const asWorkspaceId = (value: string): WorkspaceId => value as WorkspaceId;

function summary(overrides: Partial<AgentSessionSummary>): AgentSessionSummary {
  return {
    sessionId: "s",
    title: "",
    status: "idle",
    cwd: "/tmp",
    createdAt: "2026-10-03T00:00:00.000Z",
    mode: "free",
    seedSkill: null,
    ...overrides,
  };
}

const globalWs: Workspace = {
  kind: "global",
  id: "~",
  label: "Home",
  path: null,
  providers: [],
  active: true,
  available: true,
  skillCount: 0,
};

const importedWs: Workspace = {
  kind: "directory",
  id: importedId,
  label: "Project A",
  path: "/repo/a",
  providers: [],
  active: false,
  available: true,
  skillCount: 0,
};

describe("groupSessionsByTarget (1.3 分组投影)", () => {
  it("groups by target.workspaceId and always keeps registry workspace groups", () => {
    const groups = groupSessionsByTarget(
      [
        summary({ sessionId: "s1", target: { workspaceId: importedId } }),
        summary({ sessionId: "s2", target: { workspaceId: "~" } }),
      ],
      [globalWs, importedWs],
    );
    expect(groups.map((group) => group.key)).toEqual(["~", importedId]);
    // workspace 组恒在（新建入口），即使 0 会话。
    expect(groups[0]!.sessions.map((item) => item.sessionId)).toEqual(["s2"]);
    expect(groups[1]!.sessions.map((item) => item.sessionId)).toEqual(["s1"]);
    expect(groups[1]!.workspace).toBe(importedWs);
  });

  it("collects targetless legacy sessions into the trailing Unassigned group", () => {
    const groups = groupSessionsByTarget(
      [
        summary({ sessionId: "legacy" }),
        summary({ sessionId: "bound", target: { workspaceId: importedId } }),
      ],
      [importedWs],
    );
    const unassigned = groups.find((group) => group.key === UNASSIGNED_GROUP_KEY);
    expect(unassigned?.sessions.map((item) => item.sessionId)).toEqual(["legacy"]);
    expect(unassigned?.workspace).toBeNull();
    // 无 target 会话不混入 workspace 组。
    expect(groups[0]!.sessions.map((item) => item.sessionId)).toEqual(["bound"]);
  });

  it("omits the Unassigned group when no targetless sessions exist", () => {
    const groups = groupSessionsByTarget([], [globalWs]);
    expect(groups.some((group) => group.key === UNASSIGNED_GROUP_KEY)).toBe(false);
  });

  it("keeps sessions whose target workspace left the registry (resumable, no new-session entry)", () => {
    const gone = asWorkspaceId("ws_ffffffffffffffffffffffff");
    const groups = groupSessionsByTarget(
      [summary({ sessionId: "orphan", target: { workspaceId: gone } })],
      [globalWs],
    );
    const orphan = groups.find((group) => group.key === gone);
    expect(orphan).toBeDefined();
    expect(orphan!.workspace).toBeNull();
    expect(orphan!.sessions.map((item) => item.sessionId)).toEqual(["orphan"]);
  });

  it("sorts sessions newest-first within a group (invalid dates sink stably)", () => {
    const groups = groupSessionsByTarget(
      [
        summary({
          sessionId: "old",
          createdAt: "2026-10-01T00:00:00.000Z",
          target: { workspaceId: importedId },
        }),
        summary({
          sessionId: "new",
          createdAt: "2026-10-03T12:00:00.000Z",
          target: { workspaceId: importedId },
        }),
        summary({
          sessionId: "bad",
          createdAt: "not-a-date",
          target: { workspaceId: importedId },
        }),
      ],
      [importedWs],
    );
    expect(groups[0]!.sessions.map((item) => item.sessionId)).toEqual(["new", "old", "bad"]);
  });
});

describe("sessionsForWorkspace (1.7 attach 面板过滤)", () => {
  it("filters by target.workspaceId and ignores global/unassigned sessions", () => {
    const sessions = [
      summary({ sessionId: "a", target: { workspaceId: importedId } }),
      summary({ sessionId: "g", target: { workspaceId: "~" } }),
      summary({ sessionId: "u" }),
      summary({
        sessionId: "p",
        target: { workspaceId: importedId, providerId: "zcode" as ProviderId },
        createdAt: "2026-10-02T00:00:00.000Z",
      }),
    ];
    expect(sessionsForWorkspace(sessions, importedId).map((item) => item.sessionId)).toEqual([
      "a",
      "p",
    ]);
    expect(sessionsForWorkspace(sessions, "~").map((item) => item.sessionId)).toEqual(["g"]);
  });
});

describe("display helpers", () => {
  it("falls back to the sessionId prefix for untitled sessions", () => {
    expect(sessionDisplayName(summary({ sessionId: "abcdefghijk", title: "" }))).toBe(
      "abcdefghijk".slice(0, 14),
    );
    expect(sessionDisplayName(summary({ sessionId: "x", title: "Named" }))).toBe("Named");
  });

  it("marks only targetless sessions as unassigned (read-only)", () => {
    expect(sessionIsUnassigned(summary({ sessionId: "x" }))).toBe(true);
    expect(sessionIsUnassigned(summary({ sessionId: "x", target: { workspaceId: "~" } }))).toBe(
      false,
    );
  });
});
