/**
 * 用户原始需求 [2026-10-03]（Owner 裁决）：「WebUI 做中英双语（i18n）」。
 * 正交意图：
 *   [1] 中文词典聚合层：Record<MessageKey, string>——任何域缺 zh 键即编译失败
 *       （齐全性门禁在聚合层保持）。
 */
import type { MessageKey } from "./en.js";
import { zhBase } from "./base/zh.js";
import { settingsZh, shellExtraZh, creatorExtraZh } from "./domains.js";

export const zh: Record<MessageKey, string> = {
  ...zhBase,
  ...settingsZh,
  ...shellExtraZh,
  ...creatorExtraZh,
};
