/**
 * vitest 的外置解析默认命中 svelte 包入口的 server 导出（index-server.js），
 * `mount` 在其中是 lifecycle_function_unavailable。组件交互测试直连 client
 * 入口（与组件经 svelte 插件 client 编译的运行时一致）。
 */
// @ts-expect-error -- 无类型声明的运行时直连；正确性由组件测试本身证明
export { flushSync, mount, unmount } from "../../../node_modules/svelte/src/index-client.js";
