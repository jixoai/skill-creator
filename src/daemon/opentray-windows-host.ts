/**
 * 原始需求 [2026-07-18]：「全面升级 skill-creator-v2 对于 opentray 的适配」。
 * 正交意图：
 *   [1] 在 win32 选择带原生侧/底 resize 内边距、仅顶边可见描边的 OpenTray 比较器。
 *   [2] 把这个私有 OpenTray 开关收敛到 skill-creator 自有的单一兼容边界。
 *   [3] 保留显式的 production topology 覆盖开关，用于回滚与视觉 A/B。
 * 妥协声明：等公开 production topology 直接提供可接受的原生 frameless resize
 * 框与顶边投影后，移除此桥。
 */

export const OPENTRAY_WINDOWS_NATIVE_MATERIAL_COMPARATOR_ENV =
  "OPENTRAY_WINDOWS_NATIVE_MATERIAL_COMPARATOR";
export const SKILL_CREATOR_OPENTRAY_WINDOWS_HOST_TOPOLOGY_ENV =
  "SKILL_CREATOR_OPENTRAY_WINDOWS_HOST_TOPOLOGY";

export type OpenTrayWindowsHostTopology = "production" | "native-material-comparator";

/**
 * 把 skill-creator 的 Windows host 策略投影到 OpenTray broker 继承的环境。
 * 仅 win32 生效；其它平台原样返回 "production" 且不改环境。
 */
export function configureOpenTrayWindowsHostTopology(
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): OpenTrayWindowsHostTopology {
  if (platform !== "win32") return "production";

  if (environment[SKILL_CREATOR_OPENTRAY_WINDOWS_HOST_TOPOLOGY_ENV] === "production") {
    delete environment[OPENTRAY_WINDOWS_NATIVE_MATERIAL_COMPARATOR_ENV];
    return "production";
  }

  environment[OPENTRAY_WINDOWS_NATIVE_MATERIAL_COMPARATOR_ENV] = "1";
  return "native-material-comparator";
}
