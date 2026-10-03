// @vitest-environment jsdom
/**
 * 「Chat about this skill」入口两态测试（creator-agent-chat 1.4）。
 *
 * 用户原始需求 [2026-10-03]（design §1 r3 + specs/creator 两个 Scenario）：
 * 「同技能命中续聊 vs 不续上他技能的对话」——resume 查找键 = target
 * （workspaceId/providerId）+ seedSkill 精确匹配；无匹配新建（seed 记录该技能
 * 引用，首条消息携带技能上下文——`$` 芯片 token 配对）。
 *
 * 正交意图：
 *   [1] 命中态：selectAgentSession 续聊（sessionId 换轨 + 面板打开 + 无 seed）。
 *   [2] 无匹配态：beginNewAgentSession（回 New Session 空态）+ agentPanel.seed
 *       记录技能引用（token/三元组/引言含 $name）；面板打开；不自动发送。
 *   [3] 列表未载：入口先补拉一次（resume 键以 server 投影为准）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const connection = vi.hoisted(() => ({
  rpc: null as unknown,
}));

vi.mock("../stores/connection.svelte", () => ({
  getConnectionGeneration: () => 0,
  getRpc: () => connection.rpc ?? null,
  requireRpc: () => {
    if (!connection.rpc) throw new Error("not connected");
    return connection.rpc;
  },
  connectionState: { status: "connected", error: null },
}));
vi.mock("../toast.svelte", () => ({
  showToast: vi.fn(),
}));

import { startSkillChat } from "../apps/creator/skill-chat-action.svelte";
// 真 store（runes .svelte.ts）：resume/新建两态驱动的正是真实投影。
import { agentPanel, agentSession, agentSessionsList } from "../stores/agent.svelte";
import { resetAllComposerTracks } from "../stores/agent-composer.svelte";
import type { AgentSessionSummary } from "$shared/contracts/agent.js";
import type { SkillId } from "$shared/contracts/skills.js";
import type { ProviderId, WorkspaceId } from "$shared/contracts/workspaces.js";

const WS_A = "ws_aaaaaaaaaaaaaaaaaaaaaaaa" as WorkspaceId;
const PROVIDER = "zcode" as ProviderId;
const SK_BASH = `sk_${"b".repeat(24)}` as SkillId;
const SK_VUE = `sk_${"c".repeat(24)}` as SkillId;

function summary(input: {
  sessionId: string;
  seedSkill: SkillId | null;
  createdAt?: string;
}): AgentSessionSummary {
  return {
    sessionId: input.sessionId,
    title: input.sessionId,
    status: "idle",
    cwd: "/tmp",
    createdAt: input.createdAt ?? "2026-10-03T00:00:00.000Z",
    mode: "free",
    target: { workspaceId: WS_A, providerId: PROVIDER },
    seedSkill: input.seedSkill,
  };
}

const entry = {
  workspaceId: WS_A,
  providerId: PROVIDER,
  skillId: SK_BASH,
  skillName: "bash-utils",
};

function sessionsListRpc(sessions: AgentSessionSummary[]) {
  return {
    agent: {
      sessions: { list: vi.fn(async () => ({ sessions })) },
      session: {
        stream: vi.fn(async () => ({ frames: [], status: "idle" })),
        prompt: vi.fn(async () => ({})),
      },
      queue: { list: vi.fn(async () => ({ items: [] })) },
    },
  };
}

function resetProjection(sessions: AgentSessionSummary[], loaded: boolean): void {
  agentSessionsList.sessions = sessions;
  agentSessionsList.loaded = loaded;
  agentSessionsList.loading = false;
  agentSessionsList.error = null;
  agentSession.sessionId = null;
  agentSession.status = "idle";
  agentSession.error = null;
  agentPanel.seed = null;
  agentPanel.open = false;
  resetAllComposerTracks();
}

beforeEach(() => {
  document.documentElement.dataset.test = "skill-chat-entry";
});

describe("startSkillChat two states (specs/creator Scenarios)", () => {
  it("same-skill hit resumes the most recent seeded session (no new seed)", async () => {
    const sessions = [
      summary({ sessionId: "vue-session", seedSkill: SK_VUE }),
      summary({
        sessionId: "bash-older",
        seedSkill: SK_BASH,
        createdAt: "2026-10-01T00:00:00.000Z",
      }),
      summary({ sessionId: "bash-latest", seedSkill: SK_BASH }),
    ];
    const rpc = sessionsListRpc(sessions);
    connection.rpc = rpc;
    resetProjection(sessions, true);

    await startSkillChat(entry);

    // 命中最近一条 bash 会话：续聊（不新建），无 seed。
    expect(agentSession.sessionId).toBe("bash-latest");
    expect(agentPanel.open).toBe(true);
    expect(agentPanel.seed).toBeNull();
    // 已载列表不重拉。
    expect(rpc.agent.sessions.list).not.toHaveBeenCalled();
  });

  it("no seedSkill match starts a new session whose seed records the skill reference", async () => {
    // 最近会话 seedSkill=vue-helper：不续上他技能的对话（spec Scenario 2）。
    const rpc = sessionsListRpc([summary({ sessionId: "vue-session", seedSkill: SK_VUE })]);
    connection.rpc = rpc;
    resetProjection([], true);

    await startSkillChat(entry);

    expect(agentSession.sessionId).toBeNull();
    expect(agentPanel.open).toBe(true);
    const seed = agentPanel.seed;
    expect(seed).not.toBeNull();
    // 首条消息携带技能上下文：正文含 `$name` token（SessionFace 芯片配对前提）。
    expect(seed?.text).toContain("$bash-utils");
    expect(seed?.text).toContain("creator_save_propose");
    // seed 记录该技能引用（opaque 三元组）。
    expect(seed?.reference).toMatchObject({
      kind: "skill",
      token: "$bash-utils",
      label: "bash-utils",
      skill: { workspaceId: WS_A, providerId: PROVIDER, skillId: SK_BASH },
    });
    expect(agentSession.pendingMode).toBe("free");
  });

  it("pulls the session list once when not loaded (resume key from server truth)", async () => {
    const rpc = sessionsListRpc([summary({ sessionId: "bash-latest", seedSkill: SK_BASH })]);
    connection.rpc = rpc;
    resetProjection([], false);

    await startSkillChat(entry);

    expect(rpc.agent.sessions.list).toHaveBeenCalledTimes(1);
    expect(agentSession.sessionId).toBe("bash-latest");
  });

  it("falls back to the (possibly empty) current list when the pull fails", async () => {
    const rpc = {
      agent: {
        sessions: {
          list: vi.fn(async () => {
            throw new Error("rpc down");
          }),
        },
      },
    };
    connection.rpc = rpc;
    resetProjection([summary({ sessionId: "stale-bash", seedSkill: SK_BASH })], false);

    await startSkillChat(entry);

    // 拉取失败按当前（陈旧）列表降级查找——不阻塞入口。
    expect(agentSession.sessionId).toBe("stale-bash");
  });
});
