/**
 * Skill Creator Manager island 入口（openspec dsh-webui-composition task 3.1a）。
 *
 * 用户原始需求 [2026-09-06]（tasks 3.1a）：「一个可运行的 DSH host 同时显示一个
 * 原有 ProviderView 和一个 DSH session transcript；重连/卸载无第二 root、iframe
 * 或重复 RPC owner。」
 *
 * 构建产物（webui/vite.island.config.ts → dsh-island.js）由 daemon 在同源
 * /manager/dsh-island.js 服务；DSH client plugin 的 sidebar.footer.action 入口
 * 动态加载本 bundle 并调用 mount/unmount。
 *
 * 正交意图：
 *   [1] island 生命周期：mount（svelte mount + island nav 激活 + Manager 连接）、
 *       unmount（svelte unmount + 连接关闭 + 导航冻结）。
 *   [2] 单连接 owner：Manager RPC 经 stores/connection（generation-gated 单 WS）；
 *       island 是 DSH 页面内唯一 Manager 连接方。
 *   [3] 样式自包含：layout.css（Tailwind tokens + 基线）以 inline CSS 注入 island。
 */
import { mount, unmount as svelteUnmount, type Component } from "svelte";
// eslint-disable-next-line import/order -- CSS inline 必须在组件前引入以进入 bundle
import layoutCss from "$lib/../routes/layout.css?inline";
import IslandRoot from "./IslandRoot.svelte";
import { activateIslandNav, deactivateIslandNav } from "./island-nav.svelte";
import { registerApps } from "$lib/apps";
import { connect, disconnect, connectionState } from "$lib/store.svelte";

registerApps();

let mountedRoot: Record<string, unknown> | null = null;
let mountedHost: HTMLElement | null = null;
let styleEl: HTMLStyleElement | null = null;

export interface ManagerIslandApi {
  mount(el: HTMLElement, options?: { initialPath?: string }): void;
  unmount(el: HTMLElement): void;
}

const api: ManagerIslandApi = {
  mount(el, options) {
    if (mountedRoot) return; // 单 root：重复 mount 幂等跳过。
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.dataset.skillCreatorIsland = "true";
      styleEl.textContent = layoutCss;
      document.head.appendChild(styleEl);
      // 组件 scoped CSS（构建期资产，稳定名 /manager/dsh-island.css）。
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "/manager/dsh-island.css";
      link.dataset.skillCreatorIsland = "true";
      document.head.appendChild(link);
    }
    el.style.colorScheme = "dark";
    activateIslandNav(options?.initialPath ?? "/workspaces");
    connect();
    // 连接就绪后再挂载：WorkspacesHome 的首载 $effect 不重试，RPC 未就绪会
    // 空态一次。等 connected（有界；连不上也挂载，由 UI 状态面呈现断连）。
    const mountNow = (): void => {
      if (mountedRoot) return;
      mountedRoot = mount(IslandRoot as Component, { target: el });
      mountedHost = el;
    };
    if (connectionState.status === "connected") {
      mountNow();
      return;
    }
    let waited = 0;
    const timer = setInterval(() => {
      waited += 50;
      if (connectionState.status === "connected" || waited >= 5_000) {
        clearInterval(timer);
        mountNow();
      }
    }, 50);
  },
  unmount(el) {
    // 匹配 mount 时的目标，或包含它的容器（插件传 host/panel 均可）。
    if (!mountedRoot || (el !== mountedHost && !(el instanceof Node && el.contains(mountedHost)))) {
      return;
    }
    const root = mountedRoot;
    mountedRoot = null;
    mountedHost = null;
    svelteUnmount(root);
    disconnect();
    deactivateIslandNav();
  },
};

export { api };

// plugin 约定的全局挂点（packages/skill-creator-dsh-client/lib/client.js 消费）。
if (typeof window !== "undefined") {
  const global = window as unknown as {
    __skillCreatorManagerIsland?: ManagerIslandApi & { __debug?: unknown };
  };
  global.__skillCreatorManagerIsland = api;
  // 诊断面（连接状态快照；无凭据、无方法引用）。
  global.__skillCreatorManagerIsland.__debug = {
    getConnectionState: () => ({ status: connectionState.status, error: connectionState.error }),
  };
}
