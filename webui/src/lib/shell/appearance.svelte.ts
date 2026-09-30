/**
 * 外观偏好 store（shell-settings-ui Ch6）。
 *
 * 用户原始需求 [2026-07-27]：「前端 Storage 只能用来存储与设备有关的一些偏好，
 * 比如 Theme」——DevicePrefs v1 首次获得消费者：theme 驱动 `.dark` 类，
 * sidebarCollapsed 驱动 AppSidebar 双态。
 *
 * 正交意图：
 *   [1] theme 生效：`.dark` 挂 document.documentElement（layout.css 的
 *       @custom-variant dark 目标）；system 模式跟随 matchMedia 变化重估。
 *   [2] 侧栏状态：折叠偏好读写 DevicePrefs（localStorage 单源）。
 */
import { readDevicePrefs, updateDevicePrefs, type DevicePrefs } from "./device-prefs";

type ThemePreference = DevicePrefs["theme"];

let theme = $state<ThemePreference>(readThemePreference());
let sidebarCollapsed = $state<boolean>(readDevicePrefs().sidebarCollapsed);

// system 模式下 dark 类由媒体查询决定；显式 light/dark 直接命中。
let systemDarkQuery: MediaQueryList | null = null;

function readThemePreference(): ThemePreference {
  if (typeof document === "undefined") return "system";
  return readDevicePrefs().theme;
}

function prefersDark(): boolean {
  return systemDarkQuery?.matches ?? false;
}

function applyThemeClass(): void {
  if (typeof document === "undefined") return;
  const dark = theme === "dark" || (theme === "system" && prefersDark());
  document.documentElement.classList.toggle("dark", dark);
}

function attachSystemQuery(): void {
  if (typeof matchMedia === "undefined" || systemDarkQuery !== null) return;
  systemDarkQuery = matchMedia("(prefers-color-scheme: dark)");
  systemDarkQuery.addEventListener("change", () => {
    if (theme === "system") applyThemeClass();
  });
}

attachSystemQuery();
applyThemeClass();

/** 当前主题偏好（响应式读取）。 */
export function appearanceTheme(): ThemePreference {
  return theme;
}

/** 当前侧栏折叠态（响应式读取）。 */
export function appearanceSidebarCollapsed(): boolean {
  return sidebarCollapsed;
}

/** 设置主题偏好（持久化 + 立即生效）。 */
export function setAppearanceTheme(next: ThemePreference): void {
  theme = next;
  updateDevicePrefs({ theme: next });
  applyThemeClass();
}

/** 切换侧栏折叠态（持久化）。 */
export function toggleAppearanceSidebar(): void {
  sidebarCollapsed = !sidebarCollapsed;
  updateDevicePrefs({ sidebarCollapsed });
}
