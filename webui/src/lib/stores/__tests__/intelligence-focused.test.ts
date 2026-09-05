/**
 * 用户原始需求 [2026-09-06]（openspec skill-intelligence）：
 * 「所有优化只产生 Manager-owned draft/patch，必须经过 validation、revision check 和显式 approval。」
 * 正交意图：[1] 分析与审批的 stale 响应不投影；[2] 请求失败按结构化 error 返回。
 * 说明：daemon 侧只读保证、revision stale、split/merge 路径安全由
 * test/skill-intelligence.test.ts 覆盖；本文件覆盖 WebUI store 层不变量。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { analyzeSkills, approveProposal } from "../intelligence.svelte";
import type { IntelligenceReport } from "$shared/contracts/skill-intelligence.js";

const emptyReport: IntelligenceReport = {
  createdAt: new Date().toISOString(),
  snapshots: [],
  findings: [],
  edges: [],
};

beforeEach(() => {
  connectionGeneration = 0;
  rpcClient = null;
});

describe("intelligence store stale projection", () => {
  it("drops an analyze report superseded by a newer request", async () => {
    const firstRelease: { run?: (value: unknown) => void } = {};
    const firstCall = new Promise<unknown>((resolve) => {
      firstRelease.run = resolve;
    });
    rpcClient = {
      skillIntelligence: {
        analyze: vi
          .fn()
          .mockImplementationOnce(() => firstCall)
          .mockResolvedValueOnce({ report: emptyReport, failures: [] }),
      },
    };
    const selection = {
      workspaceId: "~" as const,
      providerId: "claude-code" as unknown as never,
      skillId: "sk_111111111111111111111111" as unknown as never,
    };
    const first = analyzeSkills([selection]);
    const second = analyzeSkills([selection]);
    firstRelease.run?.({ report: emptyReport, failures: [] });
    const firstResult = await first;
    const secondResult = await second;
    // 旧请求虽已完成，但已被新请求取代：不投影。
    expect(firstResult.report).toBeNull();
    expect(secondResult.report).toEqual(emptyReport);
  });

  it("drops an approve result after the connection was replaced", async () => {
    const approveRelease: { run?: (value: unknown) => void } = {};
    const pending = new Promise<unknown>((resolve) => {
      approveRelease.run = resolve;
    });
    rpcClient = {
      skillIntelligence: {
        approve: vi.fn().mockImplementationOnce(() => pending),
      },
    };
    const inFlight = approveProposal("pr_111111111111111111111111" as never);
    connectionGeneration += 1; // 断线重连替换了 client 所有权。
    approveRelease.run?.({
      results: [],
      applied: 1,
      conflicts: 0,
      failed: 0,
      skipped: 0,
    });
    const result = await inFlight;
    expect(result.result).toBeNull();
    expect(result.error).toBeNull();
  });

  it("surfaces analyze failures as structured errors for the current request", async () => {
    rpcClient = {
      skillIntelligence: {
        analyze: vi.fn().mockRejectedValue(new Error("daemon unavailable")),
      },
    };
    const result = await analyzeSkills([
      {
        workspaceId: "~" as const,
        providerId: "claude-code" as unknown as never,
        skillId: "sk_222222222222222222222222" as unknown as never,
      },
    ]);
    expect(result.report).toBeNull();
    expect(result.error).toBe("daemon unavailable");
  });
});
