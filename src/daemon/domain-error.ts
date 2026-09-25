/**
 * 用户原始需求 [2026-07-14]：「引入各种各样的功能（保持模块化、正交）」。
 * 正交意图：
 * 1. 将用户可处理的领域失败与未知内部异常明确分离。
 * 2. 强制领域失败使用共享 RPC 契约中的有限错误码。
 * 修订 [2026-09-25]（skill-wiki-maintainer design U）：可选 `detail` 携带
 * CapabilityFailureDetail（如 PROPOSAL_STALE 的 currentView 快照），RPC 错误
 * 边界以其为 oRPC error data——同一 Zod schema 四面可解析。
 */
import type { RpcErrorCode } from "../shared/contracts/errors.js";
import type { CapabilityFailureDetail } from "../shared/contracts/wiki-distill.js";

/** 可安全通过 RPC 公开、且用户可采取行动处理的预期失败。 */
export class DomainError extends Error {
  readonly code: RpcErrorCode;
  /** 结构化失败详情（可选；PROPOSAL_STALE 等携带跨面投影的码使用）。 */
  readonly detail?: CapabilityFailureDetail;

  constructor(
    code: RpcErrorCode,
    message: string,
    options?: ErrorOptions & { detail?: CapabilityFailureDetail },
  ) {
    super(message, options);
    this.name = "DomainError";
    this.code = code;
    this.detail = options?.detail;
  }
}
