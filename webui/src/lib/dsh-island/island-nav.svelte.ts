/**
 * DSH island 的导航状态（openspec dsh-webui-composition task 3.1a）。
 *
 * 用户原始需求 [2026-09-06]（integration-contract）：「先把 SvelteKit 专属
 * goto/page 依赖压到 navigation adapter；island 只能拥有分配给它的 DOM」。
 * island 不拥有页面 URL（外层路由 owner 是 DSH shell）：这里的 location 是
 * island 进程内状态，navigate 只改状态并触发重匹配，不动宿主 history。
 *
 * 正交意图：
 *   [1] island location：响应式 pathname+search（驱动 IslandShell 重匹配）。
 *   [2] NavControllerAdapter 实现：注入 $lib/shell/navigate（goById 等走此通道）。
 *   [3] $app/navigation goto shim 落点：WorkspacesHome 等直用 goto 的组件同走此通道。
 */
import { setNavControllerAdapter, type NavAction } from "$lib/shell/navigate";

/** island 进程内 location（mount 时初始化；unmount 后冻结）。 */
export const islandNav = $state({
  pathname: "/workspaces",
  search: "",
  active: false,
});

/** 解析目标 path（相对路径按当前 pathname 归一）。 */
function resolveTarget(path: string): { pathname: string; search: string } {
  const url = new URL(path, "http://island.local");
  return { pathname: url.pathname, search: url.search };
}

/** 应用一次 island 内部导航（无宿主 URL 副作用）。 */
export function islandNavigate(path: string, action: NavAction = "PUSH"): void {
  const { pathname, search } = resolveTarget(path);
  // PUSH/REPLACE 在 island 内等价：没有 history 栈，只有当前视图状态。
  void action;
  if (islandNav.pathname === pathname && islandNav.search === search) return;
  islandNav.pathname = pathname;
  islandNav.search = search;
}

/** mount 入口：初始化 location 并注入 shell navigation adapter。 */
export function activateIslandNav(initialPath: string): void {
  const { pathname, search } = resolveTarget(initialPath);
  islandNav.pathname = pathname;
  islandNav.search = search;
  islandNav.active = true;
  setNavControllerAdapter({
    navigate: (path: string, action?: NavAction) => islandNavigate(path, action),
  });
}

/** unmount 入口：冻结状态（宿主 dispose 语义）。 */
export function deactivateIslandNav(): void {
  islandNav.active = false;
}
