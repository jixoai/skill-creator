/**
 * $app/navigation 的 island shim（task 3.1a navigation adapter 面）。
 * goto → island 内部导航（无宿主 URL 副作用）；replaceState 仅清理 hash
 * （Manager token 卫生：从地址栏移除 #token=，不重写 DSH 宿主路径）。
 */
import { islandNavigate } from "../island-nav.svelte";

export function goto(path: string, _options?: unknown): void {
  void _options;
  islandNavigate(path);
}

export function replaceState(url: string, _state?: unknown): void {
  void _state;
  if (typeof history !== "undefined") history.replaceState(null, "", url);
}

export function invalidateAll(): void {
  // island 内无 SvelteKit load 管线；store 层自行刷新。
}

export function afterNavigate(_callback: unknown): void {
  // island 内无 SvelteKit 导航生命周期；静默不订阅。
  void _callback;
}
