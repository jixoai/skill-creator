/**
 * MCP mutation proposal 链测试（dsh-kernel-rebase task 4.4 验收：mutation 一律产
 * proposal 待审批、审计链完整、外部 client 冒烟的列表/调用/拒绝路径）。
 *
 * 用户原始需求 [2026-09-08]：「Manager 永远拥有路径、文件、revision、启停、安装、
 * 更新、draft、approval 和 audit authority。」
 *
 * 正交意图：
 *   [1] propose 工具：approved-mutation 能力在形态 A 注册 `_propose` 变体；
 *       调用产 pending proposal（不执行）。
 *   [2] 审批执行：approve 经 registry（human-ui 主体）真实执行；reject 只消费；
 *       幂等决定。
 *   [3] 拒绝路径：mutation 原名工具不注册（外部 client 无法直接调用）；stdio 面
 *       连 propose 也不注册。
 *   [4] 审计链：created/approved/executed/rejected 事件有序在场。
 * 妥协声明：无。
 */
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/client";
import { z } from "zod";
import { createCapabilityRegistry } from "../src/daemon/capability/core.js";
import { createSkillCreatorMcpServer } from "../src/daemon/mcp/skill-creator-mcp.js";
import { UiCardRegistry } from "../src/daemon/mcp/cards.js";
import { createMcpProposalStore } from "../src/daemon/mcp/proposals.js";

/** 可观测的 stub mutation 能力（执行即记录）。 */
function stubRegistry() {
  const executions: Array<{ input: unknown; principal: string }> = [];
  const registry = createCapabilityRegistry([
    {
      name: "skills.toggle",
      description: "Toggle skills.",
      authority: "approved-mutation",
      input: z.object({ skillIds: z.array(z.string()) }),
      handler: (input, principal) => {
        executions.push({ input, principal });
        return { kind: "ok", value: { toggled: true } };
      },
    },
    {
      name: "workspace.list",
      description: "List workspaces.",
      authority: "readonly",
      input: z.object({}),
      handler: () => ({ kind: "ok", value: { workspaces: [] } }),
    },
  ]);
  return { registry, executions };
}

async function connect(
  face: "in-process" | "stdio",
  proposals?: ReturnType<typeof createMcpProposalStore>,
) {
  const { registry } = stubRegistry();
  const server = createSkillCreatorMcpServer({
    capabilities: registry,
    face,
    cards: new UiCardRegistry(),
    proposals,
  });
  const client = new Client({ name: "authority-smoke", version: "0.0.1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, server };
}

describe("mcp mutation proposal authority (task 4.4)", () => {
  it("registers propose variants only on the in-process face; raw mutation names never register", async () => {
    const proposals = createMcpProposalStore(stubRegistry().registry);
    const inProcess = await connect("in-process", proposals);
    try {
      const tools = await inProcess.client.listTools();
      const names = tools.tools.map((tool) => tool.name);
      expect(names).toContain("skills_toggle_propose");
      expect(names).not.toContain("skills_toggle");
      expect(names).toContain("workspace_list");
    } finally {
      await inProcess.client.close();
      await inProcess.server.close();
    }
    const stdio = await connect("stdio", proposals);
    try {
      const tools = await stdio.client.listTools();
      const names = tools.tools.map((tool) => tool.name);
      expect(names).not.toContain("skills_toggle_propose");
      expect(names).not.toContain("skills_toggle");
    } finally {
      await stdio.client.close();
      await stdio.server.close();
    }
  });

  it("produces a pending proposal on call, executes only after approval, and audits the chain", async () => {
    const { registry, executions } = stubRegistry();
    const proposals = createMcpProposalStore(registry);
    const { client, server } = await connect("in-process", proposals);
    try {
      const result = await client.callTool({
        name: "skills_toggle_propose",
        arguments: { skillIds: ["sk_deadbeefdeadbeefdeadbeef"] },
      });
      const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
      const parsed = JSON.parse(text) as { kind: string; proposalId: string; status: string };
      expect(parsed.kind).toBe("proposed");
      expect(parsed.status).toBe("pending");

      // 未审批不执行。
      expect(executions).toEqual([]);

      // 审批执行（human-ui 主体）。
      const approved = await proposals.approve(parsed.proposalId);
      expect(approved.view.status).toBe("executed");
      expect(executions).toHaveLength(1);
      expect(executions[0]?.principal).toBe("human-ui");
      expect(executions[0]?.input).toEqual({ skillIds: ["sk_deadbeefdeadbeefdeadbeef"] });

      // 幂等：重复决定返回现状，不重复执行。
      const again = await proposals.approve(parsed.proposalId);
      expect(again.view.status).toBe("executed");
      expect(executions).toHaveLength(1);

      // 审计链完整有序。
      const events = proposals.audit().map((entry) => entry.event);
      expect(events).toEqual(["created", "approved", "executed"]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("reject consumes the proposal without executing", async () => {
    const { registry, executions } = stubRegistry();
    const proposals = createMcpProposalStore(registry);
    const created = proposals.create("skills.toggle", { skillIds: ["sk_x"] });
    const rejected = proposals.reject(created.proposalId);
    expect(rejected?.view.status).toBe("rejected");
    expect(executions).toEqual([]);
    expect(proposals.reject("mcp_missing")).toBeNull();
    // 拒绝后再审批：幂等返回 rejected 现状，不执行。
    const late = await proposals.approve(created.proposalId);
    expect(late.view.status).toBe("rejected");
    expect(executions).toEqual([]);
  });
});
