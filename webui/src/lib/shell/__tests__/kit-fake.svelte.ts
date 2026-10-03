/**
 * SvelteKit client 运行时最小仿真（page-outlet.dom 测试专用）。
 * 正交意图：
 *   [1] 响应式 page mock：$app/state page.url 的 pathname/search 读写（$state）。
 *   [2] goto 语义仿真：异步两段（resolve_intent + load_route 各一微任务），
 *       beforeNavigate 回调仅在 !is_navigating 时触发（kit client.js:1896），
 *       旧航次经 navigation token 废弃（kit client.js:2019）。
 *   [3] beforeNavigate 注册面（layout 的守卫回调经此注入）。
 */

let pathname = $state("/");
let search = $state("");
let isNavigating = false;
let navigationToken: object | null = null;
const beforeCallbacks = new Set<(navigation: FakeNavigation) => void>();

export interface FakeNavigation {
  to: { url: URL } | null;
  from: { url: URL } | null;
  willUnload: boolean;
  navigationType: string;
  cancel(): void;
  complete(): void;
}

function splitPath(path: string): { pathname: string; search: string } {
  const queryAt = path.indexOf("?");
  return queryAt < 0
    ? { pathname: path || "/", search: "" }
    : { pathname: path.slice(0, queryAt) || "/", search: path.slice(queryAt) };
}

/** 仿真运行时观测面。 */
export const kitFake = {
  get pathname(): string {
    return pathname;
  },
  get search(): string {
    return search;
  },
  get isNavigating(): boolean {
    return isNavigating;
  },
  get history(): readonly string[] {
    return historyStack;
  },
};

const historyStack: string[] = [];

export function resetKitFake(initialPath: string): void {
  const split = splitPath(initialPath);
  pathname = split.pathname;
  search = split.search;
  isNavigating = false;
  navigationToken = null;
  beforeCallbacks.clear();
  historyStack.length = 0;
  historyStack.push(initialPath);
}

/** $app/state page 替身（PageOutlet/AppShell 的响应式 URL 真相）。 */
export const mockPage = {
  get url(): { pathname: string; search: string } {
    return {
      get pathname(): string {
        return pathname;
      },
      get search(): string {
        return search;
      },
    };
  },
};

export function mockBeforeNavigate(callback: (navigation: FakeNavigation) => void): void {
  beforeCallbacks.add(callback);
}

export async function mockGoto(path: string, options: { replace?: boolean } = {}): Promise<void> {
  // resolve_intent await（kit goto 入口的第一段异步）。
  await Promise.resolve();
  const destination = new URL(path, "https://app.invalid");
  // _before_navigate：is_navigating 时跳过回调（“Don't run the event during redirects”）。
  let cancelled = false;
  if (!isNavigating) {
    for (const callback of beforeCallbacks) {
      callback({
        to: { url: destination },
        from: null,
        willUnload: false,
        navigationType: "goto",
        cancel: () => {
          cancelled = true;
        },
        complete: () => {},
      });
    }
  }
  if (cancelled) return;
  const token = {};
  navigationToken = token;
  isNavigating = true;
  // load_route await。
  await Promise.resolve();
  // 旧航次废弃（新 goto 抢走 navigation token）。
  if (navigationToken !== token) return;
  const split = splitPath(path);
  pathname = split.pathname;
  search = split.search;
  if (options.replace) historyStack[historyStack.length - 1] = path;
  else historyStack.push(path);
  isNavigating = false;
}
