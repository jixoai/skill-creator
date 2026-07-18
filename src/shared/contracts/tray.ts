/**
 * 原始需求 [2026-07-18]：「全面升级 skill-creator-v2 对于 opentray 的适配」。
 * 正交意图：
 *   [1] 定义 daemon→WebUI 的 tray 窗口投影帧（pin frame）。
 *   [2] 定义 keep-onTop 偏好的单一读写契约。
 *   [3] 提供 tray/preferences RPC 复用的成功响应契约。
 * 妥协声明：技能工作台没有 pnpm-pub 的 npm 发布事件，hasActiveEvents 恒 false；
 * 保留该字段只为与投影帧形状保持稳定，便于未来扩展而不破坏窄客户端。
 */
import { z } from "zod";

/** tray 窗口可见性，与原生 isVisible()/visibleChange 对齐。 */
export const TrayVisibilitySchema = z.enum(["hidden", "shown"]);

/**
 * daemon 投影给每个已授权 WebUI 客户端的 tray 窗口状态帧。
 *
 * - `exitRequested`：blur 已触发页面拥有的退出动画；动画完成后 WebUI 回调
 *   `tray.completeAutoClose`，daemon 复核仍可关闭才真正 `hide()`。
 * - `visibility`：原生操作可见性真相（含最小化），不是客户端镜像猜测。
 * - `hasActiveEvents`：技能工作台当前没有需要保持窗口前台的事件源，恒 false。
 */
export const TrayPinFrameSchema = z.object({
  exitRequested: z.boolean(),
  visibility: TrayVisibilitySchema,
  hasActiveEvents: z.boolean(),
});
export type TrayPinFrame = z.infer<typeof TrayPinFrameSchema>;

/**
 * keep-onTop 偏好。
 *
 * 原生窗口始终 keepOnTop；此偏好只决定 blur 是否允许触发自动隐藏。
 * 它是 app 级单一读写源：WebUI 与 TrayHost 都订阅同一个偏好真相。
 */
export const PreferencesSchema = z.object({
  keepOnTop: z.boolean(),
});
export type Preferences = z.infer<typeof PreferencesSchema>;

export const DEFAULT_PREFERENCES: Preferences = { keepOnTop: false };

/** tray/preferences RPC 共用的成功响应。 */
export const OkResponseSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
});
