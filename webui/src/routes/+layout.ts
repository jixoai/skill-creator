/**
 * 原始需求 [2026-07-14]：「skills manager 只是路由的一部分(`/workspace/~/`)；我们还需要支持导入 workspace」。
 * 正交意图：[1] 将应用固定为客户端 SPA；[2] 允许 daemon 通过 index fallback 承载动态 workspace 路由。
 */
/** 禁用服务端渲染，由本地 daemon 承载静态 SPA。 */
export const ssr = false;
/** 禁用动态 workspace 路由无法完成的构建期预渲染。 */
export const prerender = false;
/** 保持路由尾斜杠输入，不强制二次导航。 */
export const trailingSlash = "ignore";
