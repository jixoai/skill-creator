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
 *   [5] skill-wiki-maintainer 1.3/1.4：admission 全事务（I：整批拒绝字节级
 *       不变/terminal 临界区回收/全 terminal 满载可回收）、决定 CAS（Q：
 *       approve+approve 单执行、迟到 reject typed PROPOSAL_STALE + currentView、
 *       重复同 cause reject 幂等）、reject seam cause 二分与 settle 直投。
 * 妥协声明：无。
 */
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/client";
import { z } from "zod";
import { createCapabilityRegistry } from "../src/daemon/capability/core.js";
import { createSkillCreatorMcpServer } from "../src/daemon/mcp/skill-creator-mcp.js";
import { UiCardRegistry } from "../src/daemon/mcp/cards.js";
import { createMcpProposalStore, MAX_PROPOSALS } from "../src/daemon/mcp/proposals.js";
import { CapabilityFailureDetailSchema } from "../src/shared/contracts/wiki-distill.js";
import { DomainError } from "../src/daemon/domain-error.js";

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
    const rejected = await proposals.reject(created.proposalId);
    expect(rejected?.view.status).toBe("rejected");
    expect(rejected?.view.rejectedCause).toBe("human");
    expect(executions).toEqual([]);
    expect(await proposals.reject("mcp_missing")).toBeNull();
    // 拒绝后再审批：幂等返回 rejected 现状，不执行。
    const late = await proposals.approve(created.proposalId);
    expect(late.view.status).toBe("rejected");
    expect(executions).toEqual([]);
  });
});

/**
 * skill-wiki-maintainer tasks 1.3/1.4（design I/N/Q/R/T）：admission 全事务、
 * 决定 CAS、reject seam/cause 二分、迟到决定。
 */
describe("mcp proposal admission transaction + decision CAS (tasks 1.3/1.4)", () => {
  function decidedStore() {
    const { registry } = stubRegistry();
    return createMcpProposalStore(registry);
  }

  /** 以指定状态填充 store（pending 直建；terminal 经决定迁移）。 */
  async function fill(
    proposals: ReturnType<typeof decidedStore>,
    pending: number,
    executed: number,
    rejected: number,
  ): Promise<void> {
    for (let index = 0; index < pending; index += 1) {
      proposals.create("skills.toggle", { skillIds: [`sk_p${index}`] });
    }
    for (let index = 0; index < executed; index += 1) {
      const created = proposals.create("skills.toggle", { skillIds: [`sk_e${index}`] });
      await proposals.approve(created.proposalId);
    }
    for (let index = 0; index < rejected; index += 1) {
      const created = proposals.create("skills.toggle", { skillIds: [`sk_r${index}`] });
      await proposals.reject(created.proposalId);
    }
  }

  const snapshotOf = (proposals: ReturnType<typeof decidedStore>): string =>
    JSON.stringify(proposals.list());

  it("refuses a whole batch when free + reclaimable terminal < need, leaving the store byte-identical", async () => {
    const proposals = decidedStore();
    await fill(proposals, 62, 2, 0); // free=0, terminal=2
    expect(proposals.admissionCapacity()).toBe(2);
    const before = snapshotOf(proposals);
    const batch = proposals.admitBatch([
      { capability: "skills.toggle", input: { skillIds: ["sk_a"] } },
      { capability: "skills.toggle", input: { skillIds: ["sk_b"] } },
      { capability: "skills.toggle", input: { skillIds: ["sk_c"] } },
    ]);
    expect(batch).toEqual({ created: [], refused: 3 });
    // 整批拒绝：terminal 一个不删（字节级不变）。
    expect(snapshotOf(proposals)).toBe(before);
  });

  it("mid-batch admission fault rolls back the proposals map and the audit tail (no ghost created events)", () => {
    const proposals = decidedStore();
    // getter 故障注入（复核 r1 P3 实证探针同款）：首项成功落 map+audit，
    // 第二项在临界区内爆炸 → 回滚必须同时还原 proposals 与 audit 尾部。
    let accesses = 0;
    const bomb = {
      get capability() {
        accesses += 1;
        if (accesses > 1) throw new Error("fault injection: second item explodes");
        return "skills.toggle";
      },
      input: { skillIds: ["sk_bomb"] },
    };
    try {
      proposals.admitBatch([{ capability: "skills.toggle", input: { skillIds: ["sk_a"] } }, bomb]);
      expect.unreachable("admitBatch must propagate the fault");
    } catch (error) {
      expect((error as DomainError).code).toBe("DISTILL_IO");
    }
    expect(proposals.list()).toEqual([]);
    expect(proposals.audit()).toEqual([]);
  });

  it("mid-batch fault at a saturated audit ring restores the full pre-admission audit log", async () => {
    const proposals = decidedStore();
    // 灌满环形缓冲（created+rejected 每对 2 事件；130 对 = 260 > 256 上限，
    // 最旧事件已被淘汰），使 createAll 的 appendAudit 在临界区内触发淘汰。
    for (let index = 0; index < 130; index += 1) {
      const created = proposals.create("skills.toggle", { skillIds: [`sk_r${index}`] });
      await proposals.reject(created.proposalId);
    }
    const auditBefore = JSON.stringify(proposals.audit());
    const listBefore = JSON.stringify(proposals.list());
    let accesses = 0;
    const bomb = {
      get capability() {
        accesses += 1;
        if (accesses > 1) throw new Error("fault injection: second item explodes");
        return "skills.toggle";
      },
      input: { skillIds: ["sk_bomb"] },
    };
    try {
      proposals.admitBatch([{ capability: "skills.toggle", input: { skillIds: ["sk_a"] } }, bomb]);
      expect.unreachable("admitBatch must propagate the fault");
    } catch (error) {
      expect((error as DomainError).code).toBe("DISTILL_IO");
    }
    // 满缓冲下截断无法还原被淘汰前驱——必须整表快照恢复（复核 r2 P3）。
    expect(JSON.stringify(proposals.audit())).toBe(auditBefore);
    expect(JSON.stringify(proposals.list())).toBe(listBefore);
  });

  it("reclaims oldest terminal inside the same critical section when the full batch fits", async () => {
    const proposals = decidedStore();
    await fill(proposals, 60, 4, 0); // free=0, terminal=4（decidedAt 升序 = 执行序）
    const batch = proposals.admitBatch([
      { capability: "skills.toggle", input: { skillIds: ["sk_a"] } },
      { capability: "skills.toggle", input: { skillIds: ["sk_b"] } },
    ]);
    expect(batch.created).toHaveLength(2);
    expect(batch.refused).toBe(0);
    // 60 pending + 2 存活 terminal + 2 新建 = 64（最旧 2 个 terminal 已回收）。
    expect(proposals.list()).toHaveLength(64);
    expect(proposals.list().filter((view) => view.status === "executed")).toHaveLength(2);
    // pending 永不淘汰：全部 60 个 pending 仍在 + 2 个新入批。
    expect(proposals.list().filter((view) => view.status === "pending")).toHaveLength(62);
  });

  it("admits against an all-terminal full store (capacity >= 1, reclaim works at MAX)", async () => {
    const proposals = decidedStore();
    await fill(proposals, 0, MAX_PROPOSALS, 0); // size=MAX 全 terminal
    expect(proposals.admissionCapacity()).toBe(MAX_PROPOSALS);
    const batch = proposals.admitBatch([
      { capability: "skills.toggle", input: { skillIds: ["sk_n"] } },
    ]);
    expect(batch.created).toHaveLength(1);
    expect(proposals.list().filter((view) => view.status === "executed")).toHaveLength(
      MAX_PROPOSALS - 1,
    );
  });

  it("create at a full-pending store throws typed DISTILL_LIMIT and changes nothing", () => {
    const proposals = decidedStore();
    for (let index = 0; index < MAX_PROPOSALS; index += 1) {
      proposals.create("skills.toggle", { skillIds: [`sk_f${index}`] });
    }
    expect(proposals.list()).toHaveLength(MAX_PROPOSALS);
    const before = snapshotOf(proposals);
    expect(() => proposals.create("skills.toggle", { skillIds: ["sk_over"] })).toThrowError(
      /capacity/,
    );
    try {
      proposals.create("skills.toggle", { skillIds: ["sk_over"] });
      expect.unreachable("create must refuse");
    } catch (error) {
      expect(error instanceof DomainError && error.code).toBe("DISTILL_LIMIT");
    }
    expect(snapshotOf(proposals)).toBe(before);
  });

  it("keeps a single serial decision point: concurrent approve+approve executes once", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const registry = createCapabilityRegistry([
      {
        name: "skills.toggle",
        description: "Toggle skills.",
        authority: "approved-mutation",
        input: z.object({ skillIds: z.array(z.string()) }),
        handler: async () => {
          calls += 1;
          await gate;
          return { kind: "ok", value: { toggled: true } };
        },
      },
    ]);
    const proposals = createMcpProposalStore(registry);
    const created = proposals.create("skills.toggle", { skillIds: ["sk_x"] });
    const first = proposals.approve(created.proposalId);
    // CAS 后、执行完成前：瞬态 approved（占 slot、不可回收）。
    await Promise.resolve();
    expect(proposals.get(created.proposalId)?.status).toBe("approved");
    const second = proposals.approve(created.proposalId); // 重复决定幂等返回现状
    expect((await second).view.status).toBe("approved");
    release?.();
    expect((await first).view.status).toBe("executed");
    expect(calls).toBe(1);
  });

  it("late reject after approve throws typed PROPOSAL_STALE with a currentView snapshot", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const registry = createCapabilityRegistry([
      {
        name: "skills.toggle",
        description: "Toggle skills.",
        authority: "approved-mutation",
        input: z.object({ skillIds: z.array(z.string()) }),
        handler: async () => {
          await gate;
          return { kind: "ok", value: { toggled: true } };
        },
      },
    ]);
    const proposals = createMcpProposalStore(registry);
    const created = proposals.create("skills.toggle", { skillIds: ["sk_x"] });
    const approval = proposals.approve(created.proposalId);
    await Promise.resolve();
    await expect(proposals.reject(created.proposalId)).rejects.toMatchObject({
      code: "PROPOSAL_STALE",
    });
    // detail.currentView = 决定时刻快照（同一 CapabilityFailureDetailSchema 解析）。
    try {
      await proposals.reject(created.proposalId);
      expect.unreachable("late reject must throw");
    } catch (error) {
      const detail = CapabilityFailureDetailSchema.parse((error as { detail?: unknown }).detail);
      expect(detail.code).toBe("PROPOSAL_STALE");
      expect(detail.code === "PROPOSAL_STALE" && detail.currentView.status).toBe("approved");
    }
    release?.();
    const settled = await approval;
    expect(settled.view.status).toBe("executed"); // token 不被迟到决定覆盖
  });

  it("repeated same-cause reject is idempotent and onRejected observes the cause split", async () => {
    const { registry } = stubRegistry();
    const observed: Array<{ id: string; cause: string }> = [];
    const proposals = createMcpProposalStore(registry, {
      onRejected: async (view, cause) => {
        observed.push({ id: view.proposalId, cause });
      },
    });
    const human = proposals.create("skills.toggle", { skillIds: ["sk_h"] });
    const first = await proposals.reject(human.proposalId);
    const second = await proposals.reject(human.proposalId, "human");
    expect(first?.view.status).toBe("rejected");
    expect(second?.view.status).toBe("rejected");
    expect(second?.view.rejectedCause).toBe("human");
    expect(observed).toEqual([{ id: human.proposalId, cause: "human" }]); // 幂等不重放接缝

    const cancelled = proposals.create("skills.toggle", { skillIds: ["sk_c"] });
    const outcome = await proposals.reject(cancelled.proposalId, "cancelled");
    expect(outcome?.view.rejectedCause).toBe("cancelled");
    expect(observed).toHaveLength(2);
    expect(observed[1]?.cause).toBe("cancelled");
  });

  it("settle commits only the approved transient (queue terminal projection, Q token)", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const registry = createCapabilityRegistry([
      {
        name: "skills.toggle",
        description: "Toggle skills.",
        authority: "approved-mutation",
        input: z.object({ skillIds: z.array(z.string()) }),
        handler: async () => {
          await gate;
          return { kind: "ok", value: { toggled: true } };
        },
      },
    ]);
    const proposals = createMcpProposalStore(registry);
    const created = proposals.create("skills.toggle", { skillIds: ["sk_s"] });
    // pending 上 settle 不迁移（无决定点）。
    const early = proposals.settle(created.proposalId, {
      result: { kind: "ok", value: {} },
    });
    expect(early?.view.status).toBe("pending");
    // 决定点（CAS 同步前缀）后瞬态 approved——队列直投在此迁移（①②③ 的 ②）。
    const approval = proposals.approve(created.proposalId);
    expect(proposals.get(created.proposalId)?.status).toBe("approved");
    const settled = proposals.settle(created.proposalId, {
      result: {
        kind: "failed",
        code: "UNAVAILABLE",
        message: "io budget exhausted",
        detail: { code: "DISTILL_IO", message: "io budget exhausted" },
      },
    });
    expect(settled?.view.status).toBe("failed");
    expect(CapabilityFailureDetailSchema.parse(settled?.view.failureDetail).code).toBe(
      "DISTILL_IO",
    );
    release?.();
    const resumed = await approval;
    expect(resumed.view.status).toBe("failed"); // 汇合兜底幂等（不覆盖 settle）
    // 终态幂等：再次 settle 不覆盖。
    const again = proposals.settle(created.proposalId, { result: { kind: "ok", value: {} } });
    expect(again?.view.status).toBe("failed");
  });
});

/** 把 proposal 推进到 approved 瞬态（决定点语义；执行在飞）。 */
async function driveToApproved(
  proposals: ReturnType<typeof createMcpProposalStore>,
  proposalId: string,
): Promise<string> {
  const approval = proposals.approve(proposalId);
  for (let spin = 0; spin < 20; spin += 1) {
    await Promise.resolve();
    if (proposals.get(proposalId)?.status === "approved") return "approved";
  }
  await approval;
  return proposals.get(proposalId)?.status ?? "unknown";
}
