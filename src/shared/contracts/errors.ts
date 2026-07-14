/**
 * 用户原始需求 [2026-07-14]：「引入各种各样的功能（保持模块化、正交）」。
 * 正交意图：
 * 1. 将可公开的 RPC 业务错误限制为可运行时校验的有限词汇。
 * 2. 为每个公开错误码绑定稳定的传输状态。
 */
import type { ErrorMap } from "@orpc/contract";
import { z } from "zod";

/** daemon 可主动公开的有限业务错误码。 */
export const RpcErrorCodeSchema = z.enum([
  "NOT_FOUND",
  "CONFLICT",
  "INVALID_OPERATION",
  "UNAVAILABLE",
]);
/** 可运行时校验、可供用户处理的 RPC 错误码。 */
export type RpcErrorCode = z.infer<typeof RpcErrorCodeSchema>;

/** WebUI 与 daemon 共享的 oRPC 定义型错误契约。 */
export const RpcErrorDefinitions = {
  NOT_FOUND: { status: 404, message: "The requested resource was not found." },
  CONFLICT: { status: 409, message: "The operation conflicts with current state." },
  INVALID_OPERATION: { status: 422, message: "The requested operation is not valid." },
  UNAVAILABLE: { status: 503, message: "The requested resource is unavailable." },
} as const satisfies ErrorMap;
