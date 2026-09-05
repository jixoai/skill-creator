/**
 * 用户原始需求 [2026-07-27]：「前端 Storage 只能用来存储和设备有关的一些偏好，比如 Theme」。
 * 正交意图：
 *   [1] 定义设备偏好 schema（versioned + zod）。
 *   [2] 统一 localStorage 读写入口（safeParse 降级，incompatible → 默认值）。
 */

import { z } from "zod";

const STORAGE_KEY = "skill-creator:device-prefs";

/** 设备偏好 schema（当前 v1）。 */
export const DevicePrefsSchema = z.object({
  version: z.literal(1),
  theme: z.enum(["light", "dark", "system"]).default("system"),
  sidebarCollapsed: z.boolean().default(false),
});
/** 设备偏好。 */
export type DevicePrefs = z.infer<typeof DevicePrefsSchema>;

/** 默认设备偏好。 */
export const DEFAULT_DEVICE_PREFS: DevicePrefs = {
  version: 1,
  theme: "system",
  sidebarCollapsed: false,
};

/** 读取设备偏好。incompatible 旧数据 → 默认值（不迁移不报错）。 */
export function readDevicePrefs(): DevicePrefs {
  if (typeof localStorage === "undefined") return { ...DEFAULT_DEVICE_PREFS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_DEVICE_PREFS };
    const parsed = DevicePrefsSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return { ...DEFAULT_DEVICE_PREFS };
    return parsed.data;
  } catch {
    return { ...DEFAULT_DEVICE_PREFS };
  }
}

/** 写入设备偏好（完整覆盖）。 */
export function writeDevicePrefs(prefs: DevicePrefs): void {
  if (typeof localStorage === "undefined") return;
  try {
    const validated = DevicePrefsSchema.parse(prefs);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(validated));
  } catch {
    // safeParse 失败不写入，避免污染存储
  }
}

/** 局部更新设备偏好。 */
export function updateDevicePrefs(patch: Partial<Omit<DevicePrefs, "version">>): DevicePrefs {
  const current = readDevicePrefs();
  const next = { ...current, ...patch, version: 1 as const };
  writeDevicePrefs(next);
  return next;
}
