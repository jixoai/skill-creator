/**
 * 原始需求 [2026-07-14]：「参考 ../../pnpm-pub 这个项目的架构：cli+gui(webui+opentray)」。
 * 正交意图：[1] 定义 CLI 与 WebUI 共享的 daemon 状态；[2] 运行时校验 tray 降级信息。
 */
import { z } from "zod";

/** daemon 状态的运行时约束。 */
export const DaemonStatusSchema = z.object({
  active: z.boolean(),
  pid: z.number().int().positive(),
  version: z.string(),
  port: z.number().int().nonnegative(),
  startedAt: z.number().int().nonnegative(),
  tray: z.enum(["starting", "mounted", "headless"]),
  trayError: z.string().optional(),
  /** 浏览器可达的 WebUI 入口（headless/任何平台 dashboard 模式共用）。 */
  webUrl: z.string().optional(),
});
/** CLI 与 WebUI 共享的 daemon 状态快照。 */
export type DaemonStatus = z.infer<typeof DaemonStatusSchema>;
