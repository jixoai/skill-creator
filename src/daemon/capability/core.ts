/**
 * 用户原始需求 [2026-09-08]（dsh-kernel-rebase tasks 1.1）：「建立能力定义层：
 * 名称 + Zod 输入输出 + handler + authority class（readonly/proposal/
 * approved-mutation），把 skillSteward 工具 registry 的既有能力逐项迁入，工具
 * registry 改为消费 capability-core 投影。」
 * 正交意图：
 *   [1] 能力定义：name + 描述 + Zod input/output + handler + authority class，
 *       模块不依赖 daemon 运行态（供独立 mcp-server 实例化，design D3）。
 *   [2] registry 分发：闭合工具面（未注册 → unsupported-capability）与
 *       principal 边界（approved-mutation 永不开放给 agent）的统一执行点。
 *   [3] 清单投影：describe() 供 MCP descriptors / agent 面投影 / 对照表。
 * 妥协声明：无——runtime 不持文件句柄；真实 mutation 由调用方注入的 handler
 * 背后的领域服务拥有。
 */
import type { ZodType } from "zod";

/** 能力权威等级（design D3）：读观察 / 产 proposal 待审批 / 已审批 mutation。 */
export type CapabilityAuthority = "readonly" | "proposal" | "approved-mutation";

/**
 * 调用主体。与 skill-steward 契约的 SkillToolPrincipal 值域一致；capability-core
 * 只依赖「agent」这一受拒主体，其余主体由调用方自带。
 */
export type CapabilityPrincipal = "agent" | "human-ui" | "manager-recovery";

/**
 * 能力调用的闭合结果 union。值形状与 skill-steward 的 SkillToolCallResult
 * 兼容（ok / denied / failed）；capability-core 独立声明以避免通用层反向依赖
 * 领域契约。
 */
export type CapabilityCallResult =
  | { kind: "ok"; value: unknown }
  | {
      kind: "denied";
      reason: "unsupported-capability" | "principal-forbidden";
      requestedOperation: string;
    }
  | {
      kind: "failed";
      code: "NOT_FOUND" | "CONFLICT" | "INVALID_OPERATION" | "UNAVAILABLE" | "STALE";
      message: string;
    };

/** 能力定义。handler 自行解析 unknown input 并产出领域错误消息（行为由调用方拥有）。 */
export interface CapabilityDefinition {
  /** 能力名（命名空间.动词，如 `skills.list_context`；全局唯一）。 */
  readonly name: string;
  /** 供 MCP descriptor / 提示词投影的一句描述。 */
  readonly description: string;
  /** 权威等级：approved-mutation 对 agent 主体一律 principal-forbidden。 */
  readonly authority: CapabilityAuthority;
  /** 输入 schema（handler 内 parse，供 MCP JSON schema 投影复用）。 */
  readonly input: ZodType;
  /** 输出 schema（可选；未提供时 MCP 面按宽松值投影）。 */
  readonly output?: ZodType;
  /** 执行体：返回闭合结果；抛出的异常由 registry 兜底为 UNAVAILABLE failed。 */
  readonly handler: (
    input: unknown,
    principal: CapabilityPrincipal,
  ) => CapabilityCallResult | Promise<CapabilityCallResult>;
}

/** registry 对外的只读描述投影。 */
export interface CapabilityDescriptor {
  name: string;
  description: string;
  authority: CapabilityAuthority;
}

export interface CapabilityRegistry {
  /** 执行一次调用（权威检查 + handler 兜底）；不吞审计——审计由调用方包装。 */
  call(name: string, input: unknown, principal: CapabilityPrincipal): Promise<CapabilityCallResult>;
  /** 全量能力清单（注册序）。 */
  describe(): CapabilityDescriptor[];
  /** 已注册能力名集合。 */
  names(): readonly string[];
  /** agent 主体可调用的能力名（authority !== approved-mutation）。 */
  agentToolNames(): readonly string[];
}

function denied(
  reason: "unsupported-capability" | "principal-forbidden",
  operation: string,
): CapabilityCallResult {
  return { kind: "denied", reason, requestedOperation: operation };
}

function failed(
  code: "NOT_FOUND" | "CONFLICT" | "INVALID_OPERATION" | "UNAVAILABLE" | "STALE",
  message: string,
): CapabilityCallResult {
  return { kind: "failed", code, message };
}

/** 构造能力 registry；重名注册视为编程错误（fail fast）。 */
export function createCapabilityRegistry(
  definitions: readonly CapabilityDefinition[],
): CapabilityRegistry {
  const byName = new Map<string, CapabilityDefinition>();
  for (const definition of definitions) {
    if (byName.has(definition.name)) {
      throw new Error(`duplicate capability registration: ${definition.name}`);
    }
    byName.set(definition.name, definition);
  }

  return {
    async call(name, input, principal) {
      const definition = byName.get(name);
      if (!definition) return denied("unsupported-capability", name);
      if (definition.authority === "approved-mutation" && principal === "agent") {
        return denied("principal-forbidden", name);
      }
      try {
        return await definition.handler(input, principal);
      } catch (error) {
        // handler 契约是返回闭合结果；异常兜底保证 registry 永不把裸异常漏给
        // 通用调用面（MCP stdio 一旦悬挂会拖死 client）。
        return failed(
          "UNAVAILABLE",
          error instanceof Error ? error.message : String(error),
        );
      }
    },
    describe: () =>
      [...byName.values()].map(({ name, description, authority }) => ({
        name,
        description,
        authority,
      })),
    names: () => [...byName.keys()],
    agentToolNames: () =>
      [...byName.values()]
        .filter((definition) => definition.authority !== "approved-mutation")
        .map((definition) => definition.name),
  };
}
