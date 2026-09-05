/**
 * 原始需求 [2026-07-27]：「FULL 多 agent 支持……spawn agent CLI 子进程（stdio ACP）↔ 重新暴露成浏览器可连的 WebSocket ACP 端点。」
 * 正交意图：
 *   [1] 用带 `available` 标记的列表表达本机已安装的 ACP-capable agent。
 *   [2] 以不透明 sessionId 标识一个 daemon-owned 的 agent 子进程会话。
 *   [3] 用判别联合表达 session 异常退出事件（经 WS 推送，浏览器渲染不缓存历史到 memory）。
 */
import { z } from "zod";
import { WorkspaceProviderTargetSchema } from "./workspaces.js";

/** 本机已知 ACP-capable agent 二进制的稳定标识。 */
export const AcpAgentIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/)
  .brand<"AcpAgentId">();
/** 运行时校验后的 ACP agent ID。 */
export type AcpAgentId = z.infer<typeof AcpAgentIdSchema>;

/** 一个 ACP-capable agent 在本机的探测投影。 */
export const AcpAgentInfoSchema = z.object({
  /** 稳定 agent 标识（与 spawn 时解析的二进制一一对应）。 */
  id: AcpAgentIdSchema,
  /** 面向用户的展示名。 */
  label: z.string().min(1),
  /** 厂商标签（anthropic / openai / google 等），仅用于 UI 分组。 */
  vendor: z.string().min(1),
  /** 已解析的绝对二进制路径；未安装时为空字符串。 */
  binaryPath: z.string(),
  /** `which` 命中即为 true；未安装为 false。 */
  available: z.boolean(),
});
/** 一个 ACP-capable agent 在本机的探测投影。 */
export type AcpAgentInfo = z.infer<typeof AcpAgentInfoSchema>;

/** daemon 拥有的、不透明 ACP 会话 ID。 */
export const AcpSessionIdSchema = z
  .string()
  .regex(/^acp_[a-f0-9]{24}$/)
  .brand<"AcpSessionId">();
/** daemon 拥有的、不透明 ACP 会话 ID。 */
export type AcpSessionId = z.infer<typeof AcpSessionIdSchema>;

/** 打开一个 ACP 会话的入参；workspace target 决定 agent 子进程的 cwd。 */
export const AcpSessionOpenInputSchema = z.object({
  agentId: AcpAgentIdSchema,
  /** agent 子进程的 cwd 由该 Workspace Provider root 解析得到。 */
  target: WorkspaceProviderTargetSchema,
});
/** 打开一个 ACP 会话的入参。 */
export type AcpSessionOpenInput = z.infer<typeof AcpSessionOpenInputSchema>;

/** 成功打开 ACP 会话后返回的、不透明 sessionId（WebUI 用它连 WS）。 */
export const AcpSessionOpenResultSchema = z.object({
  sessionId: AcpSessionIdSchema,
  /** spawn 出的 agent 子进程 PID（诊断/UI 展示用）。 */
  pid: z.number().int().positive(),
});
/** 成功打开 ACP 会话的结果。 */
export type AcpSessionOpenResult = z.infer<typeof AcpSessionOpenResultSchema>;

/** 关闭 ACP 会话的入参。 */
export const AcpSessionCloseInputSchema = z.object({
  sessionId: AcpSessionIdSchema,
});
/** 关闭 ACP 会话的入参。 */
export type AcpSessionCloseInput = z.infer<typeof AcpSessionCloseInputSchema>;

/** agent 子进程异常退出时经 WS 推送的会话事件。 */
export const AcpSessionExitedEventSchema = z.object({
  type: z.literal("exited"),
  sessionId: AcpSessionIdSchema,
  /** agent 子进程退出码；被信号杀死时为 null。 */
  code: z.number().int().nullable(),
});
/** agent 子进程异常退出事件。 */
export type AcpSessionExitedEvent = z.infer<typeof AcpSessionExitedEventSchema>;
