/**
 * 用户原始需求 [2026-07-14]：「引入各种各样的功能（保持模块化、正交）」。
 * 正交意图：
 * 1. 将可公开的 RPC 业务错误限制为可运行时校验的有限词汇。
 * 2. 为每个公开错误码绑定稳定的传输状态。
 */
import type { ErrorMap } from "@orpc/contract";
import { z } from "zod";

/**
 * daemon 可主动公开的有限业务错误码。
 * skill-wiki-maintainer（design U r10 终版闭集）扩入蒸馏六码：
 * DISTILL_RUN_NOT_FOUND/DISTILL_STALE/PROPOSAL_STALE/DISTILL_ACTIVE_RUN/
 * DISTILL_LIMIT/DISTILL_IO；DISTILL_TIMEOUT/DISTILL_CANCELLED/
 * WIKI_INVALID_PATTERN 为 kernel/daemon-local，不进本闭集。
 */
export const RpcErrorCodeSchema = z.enum([
  "NOT_FOUND",
  "CONFLICT",
  "INVALID_OPERATION",
  "UNAVAILABLE",
  "DISTILL_RUN_NOT_FOUND",
  "DISTILL_STALE",
  "PROPOSAL_STALE",
  "DISTILL_ACTIVE_RUN",
  "DISTILL_LIMIT",
  "DISTILL_IO",
]);
/** 可运行时校验、可供用户处理的 RPC 错误码。 */
export type RpcErrorCode = z.infer<typeof RpcErrorCodeSchema>;

/** WebUI 与 daemon 共享的 oRPC 定义型错误契约。 */
export const RpcErrorDefinitions = {
  NOT_FOUND: { status: 404, message: "The requested resource was not found." },
  CONFLICT: { status: 409, message: "The operation conflicts with current state." },
  INVALID_OPERATION: { status: 422, message: "The requested operation is not valid." },
  UNAVAILABLE: { status: 503, message: "The requested resource is unavailable." },
  DISTILL_RUN_NOT_FOUND: { status: 404, message: "The distill run was not found." },
  DISTILL_STALE: { status: 409, message: "The distill run state changed; retry a fresh run." },
  PROPOSAL_STALE: {
    status: 409,
    message: "The proposal already entered execution; the decision cannot overtake it.",
  },
  DISTILL_ACTIVE_RUN: {
    status: 409,
    message: "An active distill run exists for this source.",
  },
  DISTILL_LIMIT: {
    status: 422,
    message: "The distill budget was exceeded (try a smaller --limit).",
  },
  DISTILL_IO: { status: 503, message: "A distill registry IO operation failed." },
} as const satisfies ErrorMap;
