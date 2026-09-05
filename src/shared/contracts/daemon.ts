/**
 * 原始需求 [2026-07-14]：「参考 ../../pnpm-pub 这个项目的架构：cli+gui(webui+opentray)」。
 * 用户原始需求 [2026-07-27]：「Linux 默认 web 模式，不使用 ext-webview，菜单改成打开浏览器链接」。
 * 正交意图：[1] 定义 CLI 与 WebUI 共享的 daemon 状态；[2] 运行时校验 tray 降级与 web 模式信息。
 */
import { z } from "zod";

/** tray 挂载状态的有限集合。 */
export const TrayStatusSchema = z.enum(["starting", "mounted", "headless", "web"]);
/** tray 挂载状态：starting 过渡，mounted 原生窗口，headless 完全无 tray，web 纯 tray+浏览器。 */
export type TrayStatus = z.infer<typeof TrayStatusSchema>;

/** daemon 状态的运行时约束。 */
export const DaemonStatusSchema = z.object({
  active: z.boolean(),
  pid: z.number().int().positive(),
  version: z.string(),
  port: z.number().int().nonnegative(),
  startedAt: z.number().int().nonnegative(),
  tray: TrayStatusSchema,
  trayError: z.string().optional(),
  /** 浏览器可达的 WebUI 入口（web/headless/任何平台 dashboard 模式共用）。 */
  webUrl: z.string().optional(),
});
/** CLI 与 WebUI 共享的 daemon 状态快照。 */
export type DaemonStatus = z.infer<typeof DaemonStatusSchema>;
