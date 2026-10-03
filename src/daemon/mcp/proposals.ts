/**
 * MCP mutation proposal 链（dsh-kernel-rebase task 4.4；skill-wiki-maintainer
 * tasks 1.3/1.4 改写：admission 全事务 + 决定 CAS + reject seam）。
 *
 * 用户原始需求 [2026-09-08]：「Manager 永远拥有路径、文件、revision、启停、安装、
 * 更新、draft、approval 和 audit authority。」——MCP 面（内置/外部一致）的
 * mutation 一律产 proposal 待审批，不直接写盘。
 * 用户原始需求 [2026-09-25]（design I/N/Q/R/T）：「admitBatch 单一临界区事务：
 * terminal 回收与全批创建同事务，回收后仍不足 → 整批拒绝 typed，store 逐字节
 * 不变」「决定 CAS：单一串行决定点无 await 间隙，迟到结果只提交给 token」
 * 「reject(proposalId, cause?) → Promise（默认 human）；onRejected awaitable」。
 *
 * 正交意图：
 *   [1] proposal 存储：daemon 内存有界队列 + 完整审计链（创建/决定/执行结果）。
 *       admission 全事务（I）：MAX_PROPOSALS 全集 slot 模型，pending 永不淘汰、
 *       approved 瞬态占 slot 不可回收、terminal {executed,rejected,failed} 按
 *       decidedAt 升序可回收；admitBatch 单临界区（回收+创建或整批拒绝零变更，
 *       异常走回滚快照 → typed DISTILL_IO phase=admission）。
 *   [2] 决定 CAS（Q）：approve/reject 在无 await 间隙的临界点迁移 pending →
 *       唯一终态/瞬态并发放 decision token；registry 执行结果/队列直投只提交给
 *       token（settle 幂等守卫）；重复决定幂等返回现状；approved 后迟到 reject
 *       → typed PROPOSAL_STALE（detail.currentView = 决定时刻快照）；重复同
 *       cause reject 幂等返回 view。
 *   [3] 审批执行 + reject seam（N）：approve 经 capability registry 以 human-ui
 *       主体执行（enqueue-handler capability 的 registry 调用即队列投递并等待
 *       终态）；reject(awaitable) 决定后 await onRejected（ledger 迁移 IO 失败
 *       → typed DISTILL_IO 上抛，proposal 决定不可逆）。
 *   [4] 会话 target enforcement（skills-agent-page 1.1，Manager mutation 域）：
 *       admission 前验证写入目标落在调用会话 target 允许范围（无 target 只读 /
 *       Global 全拒 / 跨 ws·provider 越权 / 无 workspace 目标的配置域写入全部
 *       typed 拒绝，零落库 + 审计含会话 id 与目标三元组）；非会话调用不在管辖。
 * 妥协声明：存储为 daemon 生命周期内存（重启丢弃——未审批的 proposal 不是
 *   持久事实；已执行结果的 durable 真相归各域模块的审计面/ledger）。
 *   「持久化」在现实现 = 内存原子快照语义（单一同步临界区 + 回滚快照）。
 */
import { randomBytes } from "node:crypto";
import type { CapabilityRegistry } from "../capability/core.js";
import type {
  CapabilityCallResult,
  CapabilityFailureDetail,
  ProposalRejectCause,
} from "../../shared/contracts/wiki-distill.js";
import { ProposalDecisionSnapshotSchema } from "../../shared/contracts/wiki-distill.js";
import type { AgentSessionTarget } from "../../shared/contracts/agent.js";
import { GLOBAL_WORKSPACE_ID } from "../../shared/contracts/workspaces.js";
import { DomainError } from "../domain-error.js";

/** proposal 状态（闭合集合；McpProposalStatusSchema 同值）。 */
export type McpProposalStatus = "pending" | "approved" | "rejected" | "executed" | "failed";

/** 面板/审计可见的 proposal 投影（宽松形状；蒸馏面 wire 冻结 = McpProposalViewSchema）。 */
export interface McpProposalView {
  proposalId: string;
  capability: string;
  input: unknown;
  status: McpProposalStatus;
  createdAt: string;
  decidedAt?: string;
  /** 决定后的一次性执行结果（approve 路径；closed result 形状）。 */
  result?: CapabilityCallResult;
  /** rejected 分支的公开 cause（R 二分：human = 人工拒绝 / cancelled = 用户取消）。 */
  rejectedCause?: ProposalRejectCause;
  /** failed 分支的结构化失败详情（蒸馏面必带；legacy 失败可缺省）。 */
  failureDetail?: CapabilityFailureDetail;
}

/** 审计行（append-only；与 proposal 状态分离）。 */
export interface McpProposalAuditEntry {
  at: string;
  proposalId: string;
  event: "created" | "approved" | "rejected" | "executed" | "failed" | "target-rejected";
  detail?: string;
  /** target-rejected 行的调用会话（skills-agent-page：审计含会话 id）。 */
  sessionId?: string;
}

/** admitBatch 单项输入（capability 名即路由键，N）。 */
export interface McpProposalAdmissionItem {
  capability: string;
  input: unknown;
}

/** 队列终态直投（Q token 语义：仅 approved 瞬态可迁移；终态幂等 no-op）。 */
export interface McpProposalSettleOutcome {
  result: CapabilityCallResult;
  /** failed 投影的 failureDetail（缺省回退 result.detail）。 */
  failureDetail?: CapabilityFailureDetail;
}

export interface McpProposalStore {
  /**
   * 单次原子 admission（I 全事务；create = admitBatch 长度 1 的同一 primitive）：
   * free ≥ need → 同临界区全批创建；free < need → 先回收 terminal（decidedAt
   * 升序），回收后仍不足 → 整批拒绝（refused = items.length，store 逐字节
   * 不变，terminal 一个不删）。绝不部分创建、绝不让 pending/approved 被淘汰。
   */
  admitBatch(items: readonly McpProposalAdmissionItem[]): {
    created: McpProposalView[];
    refused: number;
  };
  /** (MAX_PROPOSALS - size) + |terminal|（I：乐观上限含可回收 terminal）。 */
  admissionCapacity(): number;
  /** 登记一个 mutation proposal（MCP 面调用）；满载拒绝 → typed DISTILL_LIMIT。 */
  create(capability: string, input: unknown): McpProposalView;
  list(): McpProposalView[];
  get(proposalId: string): McpProposalView | null;
  /**
   * 审批并经 registry 执行（human-ui 主体；CAS 后阻塞到执行完成——enqueue
   * capability 的 handler 自行等待队列终态）；重复决定幂等返回现状。
   */
  approve(proposalId: string): Promise<{ view: McpProposalView }>;
  /**
   * 拒绝（默认 cause=human；await onRejected）。未知 id → null；pending →
   * rejected + cause；approved（token 已发）→ typed PROPOSAL_STALE
   * （detail.currentView = 快照）；终态 → 幂等返回现状。
   */
  reject(
    proposalId: string,
    cause?: ProposalRejectCause,
  ): Promise<{ view: McpProposalView } | null>;
  /** 队列终态直投（仅迁移 approved 瞬态；终态幂等；pending/未知 → 现状/null）。 */
  settle(proposalId: string, outcome: McpProposalSettleOutcome): { view: McpProposalView } | null;
  /** 审计链（时间序）。 */
  audit(): readonly McpProposalAuditEntry[];
}

export interface McpProposalStoreOptions {
  /** reject 决定落定后的 awaitable 接缝（N：ledger 迁移；cause=cancelled 由接线方 no-op）。 */
  onRejected?: (view: McpProposalView, cause: ProposalRejectCause) => Promise<void>;
  /**
   * 会话 target enforcement 的归属解析 seam（skills-agent-page 1.1）：按 MCP
   * propose 工具名返回当前持有未闭合 tool/call 的会话（含各自 target）。
   * 未注入或返回空 = 非产品会话调用（外部 MCP client / 蒸馏链）——不在会话
   * target 管辖（人工审批照旧兜底）。注入方：domain 装配桥接 agentSessions。
   */
  attributeProposeCalls?: (toolName: string) => ReadonlyArray<ProposeCallSession>;
}

/** enforcement 归属条目（agentSessions.proposeCallSessions 的结构面）。 */
export interface ProposeCallSession {
  sessionId: string;
  /** undefined = 无 target 旧会话（只读降级——proposal 全拒）。 */
  target: AgentSessionTarget | undefined;
}

/**
 * capability → MCP propose 工具名（与 skill-creator-mcp 的 mcpToolName 同一投影：
 * `.` → `_` + `_propose` 后缀 + 内核 dsh-mcp-client 的 `mcp__skill-creator__` 前缀）。
 * enforcement（本文件）与归属表（agent-sessions）共用此映射。
 */
export function proposeToolNameOf(capability: string): string {
  return `mcp__skill-creator__${capability.replace(/\./g, "_")}_propose`;
}

/** proposal 输入里可提取的写入目标（workspace + 可选 provider）。 */
interface ProposalWriteTarget {
  workspaceId: string;
  providerId?: string;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * 从 capability 输入提取写入目标三元组的 ws/provider 面（unknown 防御读）：
 * - workspace.remove/setActive：`id` 即目标 workspace；
 * - repository.install：`targets` 数组逐项；
 * - wiki.append：`scope` 即目标 workspace（`~` = Global）；
 * - 其余平铺 `workspaceId`(+`providerId`) 面（skills.toggle / skills.update.apply /
 *   creator.save / creator.remove 等）；
 * - 无法提取（workspace.add / repository.preview / sources.* / wiki.distill_apply）：
 *   空数组 = 写入落在任何 workspace 之外（Manager 配置/会话态），对归属会话
 *   fail-closed 拒绝。
 */
function extractWriteTargets(capability: string, input: unknown): ProposalWriteTarget[] {
  if (typeof input !== "object" || input === null) return [];
  const record = input as Record<string, unknown>;
  if (capability === "workspace.remove" || capability === "workspace.setActive") {
    const id = asNonEmptyString(record.id);
    return id === undefined ? [] : [{ workspaceId: id }];
  }
  if (capability === "repository.install") {
    if (!Array.isArray(record.targets)) return [];
    const out: ProposalWriteTarget[] = [];
    for (const entry of record.targets) {
      if (typeof entry !== "object" || entry === null) continue;
      const target = entry as Record<string, unknown>;
      const workspaceId = asNonEmptyString(target.workspaceId);
      if (workspaceId === undefined) continue;
      const providerId = asNonEmptyString(target.providerId);
      out.push(providerId === undefined ? { workspaceId } : { workspaceId, providerId });
    }
    return out;
  }
  if (capability === "wiki.append") {
    const scope = asNonEmptyString(record.scope);
    return scope === undefined ? [] : [{ workspaceId: scope }];
  }
  const workspaceId = asNonEmptyString(record.workspaceId);
  if (workspaceId === undefined) return [];
  const providerId = asNonEmptyString(record.providerId);
  return providerId === undefined ? [{ workspaceId }] : [{ workspaceId, providerId }];
}

/** store 全集容量上限（T：冻结现 CAPACITY 常量值，导出常量化）。 */
export const MAX_PROPOSALS = 64;

/** terminal 闭合集（T：可回收、参与 admissionCapacity 与淘汰排序）。 */
const TERMINAL_STATUSES: ReadonlySet<McpProposalStatus> = new Set([
  "executed",
  "rejected",
  "failed",
]);

function isTerminal(view: McpProposalView): boolean {
  return TERMINAL_STATUSES.has(view.status);
}

/** terminal 回收候选序：decidedAt 升序（并列保持 Map 插入序——稳定）。 */
function byDecidedAtAsc(left: McpProposalView, right: McpProposalView): number {
  const a = left.decidedAt ?? "";
  const b = right.decidedAt ?? "";
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** 构造 proposal 存储；执行依赖注入 capability registry（审批链的执行面）。 */
export function createMcpProposalStore(
  registry: CapabilityRegistry,
  options: McpProposalStoreOptions = {},
): McpProposalStore {
  const proposals = new Map<string, McpProposalView>();
  const auditLog: McpProposalAuditEntry[] = [];
  /** 决定 token 登记表（Q：proposalId → 活动执行身份；迟到结果只提交给它）。 */
  const activeTokens = new Map<string, object>();

  function newId(): string {
    return `mcp_${randomBytes(8).toString("hex")}`;
  }

  function appendAudit(
    proposalId: string,
    event: McpProposalAuditEntry["event"],
    detail?: string,
    sessionId?: string,
  ): void {
    auditLog.push({
      at: new Date().toISOString(),
      proposalId,
      event,
      ...(detail === undefined ? {} : { detail }),
      ...(sessionId === undefined ? {} : { sessionId }),
    });
    if (auditLog.length > MAX_PROPOSALS * 4) {
      auditLog.splice(0, auditLog.length - MAX_PROPOSALS * 4);
    }
  }

  /**
   * 会话 target enforcement（skills-agent-page §2.4；Manager mutation 域）：
   * proposal 创建（admission 临界区前）验证写入目标落在调用会话 target 允许
   * 范围——无 target（无归属）/ Global target（只读分析）/ 跨 workspace /
   * provider 不匹配 / 写入面无法提取 workspace 目标（Manager 配置域），全部
   * typed 拒绝且不落 proposal（审计行携带会话 id 与目标三元组）。归属不确定
   * （同工具名多会话并发）时对全部候选 fail-closed。非会话调用（外部 MCP
   * client、蒸馏链）不在管辖——人工审批照旧兜底。错误消息以稳定前缀
   * SESSION_TARGET_* 区分「无归属」家族（code 闭集内取 INVALID_OPERATION）。
   */
  function enforceSessionTargetScope(capability: string, input: unknown): void {
    if (!options.attributeProposeCalls) return;
    const sessions = options.attributeProposeCalls(proposeToolNameOf(capability));
    for (const session of sessions) {
      const writeTargets = extractWriteTargets(capability, input);
      let violation: string;
      if (session.target === undefined) {
        violation = "SESSION_TARGET_UNASSIGNED";
      } else if (session.target.workspaceId === GLOBAL_WORKSPACE_ID) {
        violation = "SESSION_TARGET_GLOBAL_READONLY";
      } else if (writeTargets.length === 0) {
        violation = "SESSION_TARGET_UNSCOPED";
      } else {
        const outsideWorkspace = writeTargets.find(
          (target) => target.workspaceId !== session.target!.workspaceId,
        );
        const outsideProvider =
          session.target.providerId !== undefined
            ? writeTargets.find((target) => target.providerId !== session.target!.providerId)
            : undefined;
        if (outsideWorkspace !== undefined) {
          violation = "SESSION_TARGET_WORKSPACE_SCOPE";
        } else if (outsideProvider !== undefined) {
          violation = "SESSION_TARGET_PROVIDER_SCOPE";
        } else {
          continue;
        }
      }
      const detail = `capability=${capability} targets=[${writeTargets
        .map((target) => `${target.workspaceId}/${target.providerId ?? "*"}`)
        .join(",")}] sessionTarget=${
        session.target === undefined
          ? "(unassigned)"
          : `${session.target.workspaceId}/${session.target.providerId ?? "*"}`
      }`;
      appendAudit(newId(), "target-rejected", detail, session.sessionId);
      throw new DomainError(
        "INVALID_OPERATION",
        `${violation}: session ${session.sessionId} cannot propose ${capability} (${detail})`,
      );
    }
  }

  /** 同临界区创建全批（无 await 间隙；异常由 admitBatch 的回滚快照兜底）。 */
  function createAll(items: readonly McpProposalAdmissionItem[]): McpProposalView[] {
    const created: McpProposalView[] = [];
    for (const item of items) {
      const view: McpProposalView = {
        proposalId: newId(),
        capability: item.capability,
        input: item.input,
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      proposals.set(view.proposalId, view);
      appendAudit(view.proposalId, "created", item.capability);
      created.push(view);
    }
    return created;
  }

  /** approved 瞬态 → 唯一终态（settle/approve 汇合点；其余状态幂等现状）。 */
  function commitOutcome(
    proposalId: string,
    outcome: McpProposalSettleOutcome,
  ): { view: McpProposalView } | null {
    const view = proposals.get(proposalId);
    if (!view) return null;
    if (view.status !== "approved") return { view };
    let failureDetail: CapabilityFailureDetail | undefined;
    if (outcome.result.kind === "failed") {
      failureDetail = outcome.failureDetail ?? outcome.result.detail;
    }
    const next: McpProposalView = {
      ...view,
      status: outcome.result.kind === "failed" ? "failed" : "executed",
      result: outcome.result,
      ...(failureDetail === undefined ? {} : { failureDetail }),
    };
    proposals.set(proposalId, next);
    appendAudit(
      proposalId,
      outcome.result.kind === "failed" ? "failed" : "executed",
      outcome.result.kind,
    );
    return { view: next };
  }

  return {
    admitBatch(items) {
      if (items.length === 0) return { created: [], refused: 0 };
      // skills-agent-page 1.1：会话 target enforcement 先于容量事务（越权整批
      // typed 拒绝，store 零变更、无 proposal 落库）。
      for (const item of items) {
        enforceSessionTargetScope(item.capability, item.input);
      }
      const free = MAX_PROPOSALS - proposals.size;
      if (free < items.length) {
        const terminal = [...proposals.values()].filter(isTerminal).sort(byDecidedAtAsc);
        const deficit = items.length - free;
        if (terminal.length < deficit) {
          // 整批拒绝（I）：释放决策与容量计算同在提交临界区——拒绝路径零变更，
          // terminal 一个不删（先删后拒的中间态不存在）。
          return { created: [], refused: items.length };
        }
        // 回滚快照（I 的持久化失败语义；内存态 = 原子快照）：同一临界区
        // 回收最旧 deficit 个 terminal + 全批创建；异常恢复进入前快照。
        // audit 取全量拷贝而非长度截断——createAll 途中 appendAudit 可能把
        // 环形缓冲挤到淘汰最旧事件，截断无法还原被删前驱。
        const snapshot = new Map(proposals);
        const auditSnapshot = auditLog.slice();
        try {
          for (const victim of terminal.slice(0, deficit)) {
            proposals.delete(victim.proposalId);
          }
          return { created: createAll(items), refused: 0 };
        } catch (error) {
          proposals.clear();
          for (const [id, view] of snapshot) proposals.set(id, view);
          auditLog.length = 0;
          auditLog.push(...auditSnapshot);
          throw new DomainError(
            "DISTILL_IO",
            `proposal admission failed (phase=admission); store rolled back to the pre-admission snapshot`,
            { cause: error },
          );
        }
      }
      const snapshot = new Map(proposals);
      const auditSnapshot = auditLog.slice();
      try {
        return { created: createAll(items), refused: 0 };
      } catch (error) {
        proposals.clear();
        for (const [id, view] of snapshot) proposals.set(id, view);
        auditLog.length = 0;
        auditLog.push(...auditSnapshot);
        throw new DomainError(
          "DISTILL_IO",
          `proposal admission failed (phase=admission); store rolled back to the pre-admission snapshot`,
          { cause: error },
        );
      }
    },
    admissionCapacity() {
      let terminalCount = 0;
      for (const view of proposals.values()) {
        if (isTerminal(view)) terminalCount += 1;
      }
      return MAX_PROPOSALS - proposals.size + terminalCount;
    },
    create(capability, input) {
      // enforcement 在 admitBatch 临界区内统一执行（单条路径同样先验后建）。
      const batch = this.admitBatch([{ capability, input }]);
      const created = batch.created[0];
      if (created === undefined) {
        throw new DomainError(
          "DISTILL_LIMIT",
          `proposal store at capacity (${MAX_PROPOSALS}); no terminal slot reclaimable`,
        );
      }
      return created;
    },
    list: () => [...proposals.values()],
    get: (proposalId) => proposals.get(proposalId) ?? null,
    async approve(proposalId) {
      const view = proposals.get(proposalId);
      if (!view) throw new Error(`proposal not found: ${proposalId}`);
      if (view.status !== "pending") return { view };
      // 决定点（Q：无 await 间隙）——pending → approved 瞬态 + token。
      const token: object = {};
      activeTokens.set(proposalId, token);
      const approvedView: McpProposalView = {
        ...view,
        status: "approved",
        decidedAt: new Date().toISOString(),
      };
      proposals.set(proposalId, approvedView);
      appendAudit(proposalId, "approved");
      // 审批执行：human-ui 主体（authority 红线——执行永远经 Manager 进程内
      // registry，不经 MCP 调用方）。enqueue capability 的 handler 在此调用内
      // 投递 per-run 队列并等待终态（N）——approve 阻塞到 apply 完成。
      let result: CapabilityCallResult;
      try {
        result = await registry.call(view.capability, view.input, "human-ui");
      } catch (error) {
        result = {
          kind: "failed",
          code: "UNAVAILABLE",
          message: error instanceof Error ? error.message : String(error),
        };
      }
      if (activeTokens.get(proposalId) === token) {
        activeTokens.delete(proposalId);
        // settle（队列直投）通常已迁移；此处为汇合兜底（幂等守卫）。
        commitOutcome(proposalId, { result });
      } else {
        console.warn(
          `[mcp-proposals] late execution result discarded for ${proposalId} (decision token superseded)`,
        );
      }
      const settled = proposals.get(proposalId);
      if (!settled) throw new Error(`proposal not found: ${proposalId}`);
      return { view: settled };
    },
    async reject(proposalId, cause = "human") {
      const view = proposals.get(proposalId);
      if (!view) return null;
      if (view.status === "pending") {
        // 决定点（Q）：pending → rejected(cause)（R 二分），随后才 await 接缝。
        const next: McpProposalView = {
          ...view,
          status: "rejected",
          decidedAt: new Date().toISOString(),
          rejectedCause: cause,
        };
        proposals.set(proposalId, next);
        appendAudit(proposalId, "rejected", `cause=${cause}`);
        if (options.onRejected) {
          // N：ledger 迁移 IO 失败 → typed DISTILL_IO 上抛（proposal 决定
          // 不可逆；ledger 行保持 pending fail-closed）。
          await options.onRejected(next, cause);
        }
        return { view: next };
      }
      if (view.status === "approved") {
        // 迟到决定（R 胜者表）：token 已发，reject 统一 typed 抛错——不返回
        // view 也不静默；detail.currentView = 决定时刻快照（非递归）。
        const snapshot = ProposalDecisionSnapshotSchema.parse({
          proposalId: view.proposalId,
          capability: view.capability,
          input: view.input,
          status: view.status,
          decidedAt: view.decidedAt,
        });
        throw new DomainError(
          "PROPOSAL_STALE",
          `proposal ${proposalId} already approved and entered execution; a late reject cannot overtake the decision token`,
          {
            detail: {
              code: "PROPOSAL_STALE",
              message: "proposal already approved; execution in flight",
              currentView: snapshot,
            },
          },
        );
      }
      // 终态：重复（同/异 cause）reject 幂等返回现状（Q/R）。
      return { view };
    },
    settle(proposalId, outcome) {
      return commitOutcome(proposalId, outcome);
    },
    audit: () => [...auditLog],
  };
}
