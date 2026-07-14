/**
 * 用户原始需求 [2026-07-14]：「引入各种各样的功能（保持模块化、正交）」。
 * 正交意图：
 * 1. 将用户可处理的领域失败与未知内部异常明确分离。
 * 2. 强制领域失败使用共享 RPC 契约中的有限错误码。
 */
import type { RpcErrorCode } from "../shared/contracts/errors.js";

/** 可安全通过 RPC 公开、且用户可采取行动处理的预期失败。 */
export class DomainError extends Error {
  readonly code: RpcErrorCode;

  constructor(code: RpcErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DomainError";
    this.code = code;
  }
}
