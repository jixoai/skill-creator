/**
 * 用户原始需求 [2026-07-27]：「参考 gaubee.com 的 GaubeeOS + AppShell 标准」。
 * 正交意图：
 *   [1] defineApp 工厂：聚合 manifest 配置，校验 entry activity，注册到 appRegistry。
 * 参考：gaubee.com/src/lib/app-scaffold/define-app.ts。
 */
import { appRegistry } from "./registry.js";
import type { AppEntry, AppManifest } from "./types.js";

/** 定义一个应用。校验 activities 非空且 entry activity 唯一，然后注册到 appRegistry。 */
export function defineApp(config: AppManifest): AppEntry {
  if (import.meta.env.DEV) {
    const entries = config.activities.filter((a) => a.entry);
    if (entries.length > 1) {
      console.warn(
        `[defineApp] 应用 ${config.id} 有多个 entry activity，将取第一个：${entries[0]?.pattern}`,
      );
    }
    if (config.activities.length === 0) {
      console.warn(`[defineApp] 应用 ${config.id} 没有 activity`);
    }
  }
  appRegistry.register(config);
  return { manifest: config };
}
