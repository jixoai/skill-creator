/**
 * Intelligence 统一审批面接线测试（e2e 审批面缺口 2026-10-02）。
 *
 * 用户原始需求 [2026-10-02]（e2e 补测）：「经 /mcp 面（外部 client）造的 mcp:
 * proposal，IntelligenceView 的 Proposals 区 Refresh 后仍不显示——该区走
 * skillIntelligence.list（仅 si: 草稿）」。
 *
 * 正交意图：
 *   [1] 数据源钉死：loadProposals 消费统一面 agent.proposals.list（mcp: + si:
 *       双源同列，不再直连 skillIntelligence.list）。
 *   [2] 决定面前缀路由：approve/reject 走 agent.proposals.*，输入 id 携带
 *       mcp:|si: 前缀原样透传；latest-request-wins 失效结果投影为无结果。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const connection = vi.hoisted(() => ({
  generation: 0,
  rpc: null as unknown,
}));

vi.mock("../stores/connection.svelte", () => ({
  getConnectionGeneration: () => connection.generation,
  getRpc: () => connection.rpc ?? null,
  requireRpc: () => {
    if (!connection.rpc) throw new Error("not connected");
    return connection.rpc;
  },
}));

import { approveProposal, loadProposals, rejectProposal } from "../stores/intelligence.svelte";

/** 统一视图行（形状 = UnifiedProposalViewSchema 的输出；字段按投影构造）。 */
const mcpRow = {
  id: "mcp:mcp_0123456789abcdef",
  source: "mcp",
  capability: "wiki.distill_apply",
  payload: { runId: "wd_0123456789abcdef01234567", ordinal: 0 },
  origin: "agent-tool",
  kind: "wiki-distill-apply",
  target: null,
  observedRevision: null,
  before: null,
  after: null,
  finding: null,
  validation: null,
  status: "pending",
  createdAt: "2026-10-02T00:00:00.000Z",
};

const siRow = {
  id: "si:pr_0123456789abcdef01234567",
  source: "skill-intelligence",
  capability: null,
  payload: {
    kind: "disable",
    selections: [
      {
        workspaceId: "ws_0123456789abcdef01234567",
        providerId: "claude-code",
        skillId: "sk_0123456789abcdef01234567",
      },
    ],
    reason: "duplicate name",
  },
  origin: "agent-tool",
  kind: "disable",
  target: {
    workspaceId: "ws_0123456789abcdef01234567",
    providerId: "claude-code",
    skillId: "sk_0123456789abcdef01234567",
  },
  observedRevision: `sha256:${"a".repeat(64)}`,
  before: null,
  after: null,
  finding: { id: "fn_0123456789abcdef", summary: "duplicate names confuse invocation" },
  validation: null,
  status: "pending",
  createdAt: "2026-10-02T00:00:00.000Z",
};

let listCalls: number;
let approveCalls: Array<{ proposalId: string }>;
let rejectCalls: Array<{ proposalId: string }>;

beforeEach(() => {
  listCalls = 0;
  approveCalls = [];
  rejectCalls = [];
  connection.generation = 0;
  connection.rpc = {
    agent: {
      proposals: {
        list: vi.fn(async () => {
          listCalls += 1;
          return { proposals: [mcpRow, siRow] };
        }),
        approve: vi.fn(async ({ proposalId }: { proposalId: string }) => {
          approveCalls.push({ proposalId });
          return { proposal: { ...siRow, status: "executed", result: { applied: true } } };
        }),
        reject: vi.fn(async ({ proposalId }: { proposalId: string }) => {
          rejectCalls.push({ proposalId });
          return { proposal: { ...mcpRow, status: "rejected", rejectCause: "user" } };
        }),
      },
    },
    skillIntelligence: {
      list: vi.fn(async () => {
        throw new Error("skillIntelligence.list must not back the proposals view");
      }),
    },
  };
});

describe("intelligence proposals unified face (e2e approval-surface gap)", () => {
  it("lists both mcp: and si: proposals through agent.proposals.list", async () => {
    const result = await loadProposals();
    expect(listCalls).toBe(1);
    // 双源同列：外部 MCP client 造的 proposal 必须出现在浏览面。
    expect(result.error).toBeNull();
    expect(result.proposals?.map((entry) => entry.id)).toEqual([mcpRow.id, siRow.id]);
  });

  it("routes approve through the unified face with the si: prefix intact", async () => {
    const result = await approveProposal(siRow.id);
    expect(approveCalls).toEqual([{ proposalId: siRow.id }]);
    expect(result.error).toBeNull();
    expect(result.proposal).toMatchObject({ id: siRow.id, status: "executed" });
  });

  it("routes reject through the unified face with the mcp: prefix intact", async () => {
    const result = await rejectProposal(mcpRow.id);
    expect(rejectCalls).toEqual([{ proposalId: mcpRow.id }]);
    expect(result.rejected).toBe(true);
    expect(result.error).toBeNull();
  });

  it("projects superseded list results as no-result (latest-request-wins)", async () => {
    const stale = loadProposals();
    connection.generation += 1; // 连接 owner 更替：stale 响应失去提交资格。
    const staleOutcome = await stale;
    expect(staleOutcome.proposals).toBeNull();
    expect(staleOutcome.error).toBeNull();
    // 新 owner 的请求照常提交。
    const fresh = await loadProposals();
    expect(fresh.proposals).toHaveLength(2);
  });

  it("projects superseded approve results as no-result", async () => {
    const stale = approveProposal(siRow.id);
    connection.generation += 1;
    const outcome = await stale;
    expect(outcome.proposal).toBeNull();
    expect(outcome.error).toBeNull();
    // 前缀 id 已按统一面发出（拒绝路径不因取代而误报错误）。
    expect(approveCalls).toEqual([{ proposalId: siRow.id }]);
  });
});
