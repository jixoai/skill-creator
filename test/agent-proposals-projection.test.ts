/**
 * 统一 proposal 投影测试（intelligence-proposal-parity C′2；工作计划 Ch4 任务 3.2）。
 *
 * 用户原始需求 [2026-09-30]：「edit/disable/split/merge 均从实际 DSH tool calls
 * 形成方案」（GOAL 105）。
 *
 * 正交意图：
 *   [1] 双源映射：MCP 五态 + 执行结果保全；si 草稿 pending + 多源对齐；
 *       路由键解析（mcp:|si: 前缀，非法 id typed 拒绝）。
 */
import { describe, expect, it } from "vitest";
import {
  parseUnifiedProposalRef,
  projectIntelligenceDraft,
  projectMcpProposal,
} from "../src/daemon/agent-proposals-projection.js";
import type { McpProposalView } from "../src/daemon/mcp/proposals.js";
import type { ProposalDraft } from "../src/shared/contracts/skill-intelligence.js";

const mcpView = (overrides: Partial<McpProposalView> = {}): McpProposalView => ({
  proposalId: "prop_1",
  capability: "wiki.distill_apply",
  input: { runId: "run_1", ordinal: 0 },
  status: "pending",
  createdAt: "2026-09-30T00:00:00.000Z",
  ...overrides,
});

const draft = (overrides: Partial<ProposalDraft> = {}): ProposalDraft =>
  ({
    id: "pr_0123456789abcdef01234567",
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
    observedRevisions: [
      {
        workspaceId: "ws_0123456789abcdef01234567",
        providerId: "claude-code",
        skillId: "sk_0123456789abcdef01234567",
        revision: "sha256:" + "a".repeat(64),
      },
    ],
    findingIds: ["fnd_1"],
    rationale: "duplicate names confuse invocation",
    createdAt: "2026-09-30T00:00:00.000Z",
    ...overrides,
  }) as ProposalDraft;

describe("unified proposal projection (C′2)", () => {
  it("maps an mcp view with five-state status and execution result intact", () => {
    const view = projectMcpProposal(
      mcpView({
        status: "executed",
        result: { kind: "ok", value: { done: true } },
        decidedAt: "2026-09-30T00:01:00.000Z",
      }),
    );
    expect(view.id).toBe("mcp:prop_1");
    expect(view.source).toBe("mcp");
    expect(view.origin).toBe("agent-tool");
    expect(view.kind).toBe("wiki-distill-apply");
    expect(view.capability).toBe("wiki.distill_apply");
    expect(view.payload).toEqual({ runId: "run_1", ordinal: 0 });
    expect(view.status).toBe("executed");
    expect(view.result).toEqual({ applied: true });
  });

  it("maps a failed mcp execution with its error message", () => {
    const view = projectMcpProposal(
      mcpView({
        status: "failed",
        result: { kind: "failed", code: "CONFLICT", message: "revision moved" },
      }),
    );
    expect(view.status).toBe("failed");
    expect(view.result).toEqual({ applied: false, error: "revision moved" });
  });

  it("maps an intelligence draft as pending with target, finding, and revisions", () => {
    const view = projectIntelligenceDraft(draft());
    expect(view.id).toBe("si:pr_0123456789abcdef01234567");
    expect(view.source).toBe("skill-intelligence");
    expect(view.kind).toBe("disable");
    expect(view.status).toBe("pending");
    expect(view.target).toMatchObject({ skillId: "sk_0123456789abcdef01234567" });
    expect(view.observedRevision).toBe("sha256:" + "a".repeat(64));
    expect(view.finding).toMatchObject({ id: "fnd_1" });
  });

  it("routes unified ids by prefix and rejects unprefixed ids", () => {
    expect(parseUnifiedProposalRef("mcp:prop_1")).toEqual({ source: "mcp", id: "prop_1" });
    expect(parseUnifiedProposalRef("si:pr_0123456789abcdef01234567")).toEqual({
      source: "skill-intelligence",
      id: "pr_0123456789abcdef01234567",
    });
    expect(() => parseUnifiedProposalRef("prop_1")).toThrow(/prefix/);
  });
});

// ---- 3.2 路由级双源合并：真实 domain + 公共 router client 视角 ----

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterEach, beforeEach } from "vitest";
import { createDaemonDomain, type DaemonDomain } from "../src/daemon/domain.js";
import { createRpcRouter } from "../src/daemon/rpc-router.js";
import { setHomeOverride } from "../src/shared/paths.js";
import { deterministicSkillsCliProbe } from "./helpers/deterministic-probe.js";

let sandbox = "";
let domain: DaemonDomain;
let workspaceId = "";
let routerClient: ReturnType<typeof makeClient>;

function makeClient(daemonDomain: DaemonDomain) {
  return createRouterClient(
    createRpcRouter({
      status: () => ({
        active: true,
        pid: process.pid,
        version: "test",
        port: 0,
        startedAt: 0,
        tray: "headless",
      }),
      domain: daemonDomain,
    }),
  );
}

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "sc-unified-proposals-"));
  const isolatedHome = path.join(sandbox, "state");
  process.env.SKILL_CREATOR_HOME = isolatedHome;
  setHomeOverride(isolatedHome);
  const workspaceDir = path.join(sandbox, "ws");
  fs.mkdirSync(workspaceDir, { recursive: true });
  domain = createDaemonDomain(undefined, { skillsCliProbe: deterministicSkillsCliProbe() });
  const imported = domain.workspaces.import(workspaceDir, "unified-ws");
  workspaceId = imported.id;
  domain.creator.save({
    mode: "create",
    workspaceId: imported.id,
    providerId: "openclaw",
    directoryName: "demo-skill",
    frontmatter: { name: "demo-skill", description: "unified projection fixture" },
    body: "Body.\n",
  });
  routerClient = makeClient(domain);
});

afterEach(() => {
  void domain.repository.dispose();
  void domain.steward.dispose();
  setHomeOverride(null);
  delete process.env.SKILL_CREATOR_HOME;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("unified proposals RPC (3.2 dual-source merge + decision paths)", () => {
  it("merges both stores with routing prefixes and agent-tool origin, then decides without regressing either store", async () => {
    const target = { workspaceId, providerId: "openclaw" };
    const skill = (await domain.skills.list(target, true))[0]!;
    const skillInfo = await domain.skills.info(target, skill.id);

    // 双源各产一条：MCP 面（store.create）+ si 面（agent tool call 同名能力）。
    const mcpView = domain.mcpProposals.create("skills.toggle", {
      ...target,
      skillIds: [skill.id],
      mode: "disable",
    });
    const toolCall = await domain.managerCapabilities.call(
      "intelligence_propose_disable",
      {
        action: "disable",
        findingId: `fn_${"a".repeat(16)}`,
        observedRevision: skillInfo.revision,
        rationale: "duplicate names confuse invocation",
        payload: {
          kind: "disable",
          selections: [{ ...target, skillId: skill.id }],
          reason: "duplicate names confuse invocation",
        },
      },
      "agent",
    );
    if (toolCall.kind !== "ok") throw new Error(`propose capability denied: ${toolCall.reason}`);

    const merged = await routerClient.agent.proposals.list({});
    expect(merged.proposals).toHaveLength(2);
    const mcpEntry = merged.proposals.find((entry) => entry.id.startsWith("mcp:"));
    const siEntry = merged.proposals.find((entry) => entry.id.startsWith("si:"));
    expect(mcpEntry).toMatchObject({
      source: "mcp",
      origin: "agent-tool",
      status: "pending",
      kind: "skills-toggle",
      capability: "skills.toggle",
    });
    expect(siEntry).toMatchObject({
      source: "skill-intelligence",
      origin: "agent-tool",
      status: "pending",
      kind: "disable",
      target: { ...target, skillId: skill.id },
    });
    expect(siEntry?.observedRevision).toMatch(/^sha256:[a-f0-9]{64}$/);

    // 审批 si（经统一入口路由）：disable 落盘执行 → executed；草稿被消费。
    const approved = await routerClient.agent.proposals.approve({ proposalId: siEntry!.id });
    expect(approved.proposal.status).toBe("executed");
    expect(approved.proposal.result?.applied).toBe(true);

    // 拒绝 mcp（经统一入口路由）：store 五态保持 rejected + rejectCause。
    const rejected = await routerClient.agent.proposals.reject({ proposalId: mcpEntry!.id });
    expect(rejected.proposal).toMatchObject({ status: "rejected", rejectCause: "user" });

    // 终态再 list：si 草稿已消费消失；mcp 终态保留。
    const after = await routerClient.agent.proposals.list({});
    expect(after.proposals.map((entry) => entry.id)).toEqual([mcpEntry!.id]);
    expect(after.proposals[0]).toMatchObject({ status: "rejected" });
  });

  it("rejects unprefixed ids with a typed error instead of guessing a store", async () => {
    await expect(routerClient.agent.proposals.approve({ proposalId: "prop_1" })).rejects.toThrow();
  });
});
