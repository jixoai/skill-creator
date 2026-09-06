/**
 * $app/state 的 island shim：page.url 读 island location（无 SvelteKit store）。
 * 当前 workspaces 视图链不直接消费 $app/state；此 shim 保证任何后续组件
 * 引入时 island 构建仍可解析。
 */
import { islandNav } from "../island-nav.svelte";

export const page = {
  get url(): URL {
    return new URL(islandNav.pathname + islandNav.search, "http://island.local");
  },
};
