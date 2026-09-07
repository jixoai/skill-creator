/**
 * MCP mutation proposal 链（dsh-kernel-rebase task 4.4）。
 *
 * 用户原始需求 [2026-09-08]：「Manager 永远拥有路径、文件、revision、启停、安装、
 * 更新、draft、approval 和 audit authority。」——MCP 面（内置/外部一致）的
 * mutation 一律产 proposal 待审批，不直接写盘。
 *
 * 正交意图：
 *   [1] proposal 存储：daemon 内存有界队列 + 完整审计链（创建/决定/执行结果）。
 *   [2] 审批执行：approve 经 capability registry 以 human-ui 主体执行
 *       （approved-mutation 面对人类审批开放）；reject 只消费不执行。
 *   [3] 闭合决定面：pending/approved/rejected/executed 的状态机按 id 幂等。
 * 妥协声明：存储为 daemon 生命周期内存（重启丢弃——未审批的 proposal 不是
 *   持久事实；已执行结果的 durable 真相归各域模块的审计面）。
 */
import { randomBytes } from "node:crypto";
import type { CapabilityCallResult, CapabilityRegistry } from "../capability/core.js";

/** proposal 状态（闭合集合）。 */
export type McpProposalStatus = "pending" | "approved" | "rejected" | "executed" | "failed";

/** 面板/审计可见的 proposal 投影。 */
export interface McpProposalView {
  proposalId: string;
  capability: string;
  input: unknown;
  status: McpProposalStatus;
  createdAt: string;
  decidedAt?: string;
  /** 决定后的一次性执行结果（approve 路径；closed result 形状）。 */
  result?: CapabilityCallResult;
}

/** 审计行（append-only；与 proposal 状态分离）。 */
export interface McpProposalAuditEntry {
  at: string;
  proposalId: string;
  event: "created" | "approved" | "rejected" | "executed";
  detail?: string;
}

export interface McpProposalStore {
  /** 登记一个 mutation proposal（MCP 面调用）。 */
  create(capability: string, input: unknown): McpProposalView;
  list(): McpProposalView[];
  get(proposalId: string): McpProposalView | null;
  /** 审批并立即经 registry 执行（human-ui 主体）；重复决定幂等返回现状。 */
  approve(proposalId: string): Promise<{ view: McpProposalView }>;
  /** 拒绝（只消费，不执行）；未知 id 返回 null。 */
  reject(proposalId: string): { view: McpProposalView } | null;
  /** 审计链（时间序）。 */
  audit(): readonly McpProposalAuditEntry[];
}

const CAPACITY = 64;

/** 构造 proposal 存储；执行依赖注入 capability registry（审批链的执行面）。 */
export function createMcpProposalStore(registry: CapabilityRegistry): McpProposalStore {
  const proposals = new Map<string, McpProposalView>();
  const auditLog: McpProposalAuditEntry[] = [];

  function newId(): string {
    return `mcp_${randomBytes(8).toString("hex")}`;
  }

  function appendAudit(
    proposalId: string,
    event: McpProposalAuditEntry["event"],
    detail?: string,
  ): void {
    auditLog.push({ at: new Date().toISOString(), proposalId, event, detail });
    if (auditLog.length > CAPACITY * 4) {
      auditLog.splice(0, auditLog.length - CAPACITY * 4);
    }
  }

  return {
    create(capability, input) {
      const view: McpProposalView = {
        proposalId: newId(),
        capability,
        input,
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      proposals.set(view.proposalId, view);
      if (proposals.size > CAPACITY) {
        const oldest = proposals.keys().next().value;
        if (oldest !== undefined) proposals.delete(oldest);
      }
      appendAudit(view.proposalId, "created", capability);
      return view;
    },
    list: () => [...proposals.values()],
    get: (proposalId) => proposals.get(proposalId) ?? null,
    async approve(proposalId) {
      const view = proposals.get(proposalId);
      if (!view) throw new Error(`proposal not found: ${proposalId}`);
      if (view.status !== "pending") return { view };
      appendAudit(proposalId, "approved");
      // 审批执行：human-ui 主体（approved-mutation 的合法主体；authority 红线——
      // 执行永远经 Manager 进程内的 registry，不经 MCP 调用方）。
      const result = await registry.call(view.capability, view.input, "human-ui");
      const next: McpProposalView = {
        ...view,
        status: result.kind === "ok" ? "executed" : "failed",
        decidedAt: new Date().toISOString(),
        result,
      };
      proposals.set(proposalId, next);
      appendAudit(proposalId, "executed", result.kind);
      return { view: next };
    },
    reject(proposalId) {
      const view = proposals.get(proposalId);
      if (!view) return null;
      if (view.status !== "pending") return { view };
      const next: McpProposalView = {
        ...view,
        status: "rejected",
        decidedAt: new Date().toISOString(),
      };
      proposals.set(proposalId, next);
      appendAudit(proposalId, "rejected");
      return { view: next };
    },
    audit: () => [...auditLog],
  };
}
