/**
 * 用户原始需求 [2026-07-27]：「ChromeTabs 和路由做深度的绑定，参考 gaubee.com」。
 * 正交意图：
 *   [1] 定义声明式路由节点契约（RouteContract）。
 *   [2] 定义擦除泛型的路由节点（用于树遍历与注册表存储）。
 * 参考：gaubee.com/src/lib/router/contract.ts（精简版，去掉 codegen 相关）。
 */
import type { Component } from "svelte";
import type { ZodSchema } from "zod";

/**
 * 视图懒加载器类型。
 *
 * SvelteKit 的 `.svelte` 动态 import 返回 `{ default: Component }`，
 * 其中 Component 是 Svelte 5 runes-mode 组件（带具体泛型参数）。
 * 这里用宽泛类型避免泛型不兼容；AppShell 在渲染时做运行时处理。
 */
export type ViewLoader = () => Promise<{ readonly default: unknown }>;

/**
 * 一个路由节点的声明式契约。
 *
 * 字段全部 readonly，构造后不可变。`defineRoute` 是唯一构造入口。
 * 类型参数从 zod schema 自动推导，供 navigate API 和 hooks 消费。
 */
export interface RouteContract<
  P extends ZodSchema | undefined = ZodSchema | undefined,
  S extends ZodSchema | undefined = ZodSchema | undefined,
> {
  /** 全局唯一 id（如 `workspaces.provider`），点号分隔小写。 */
  readonly id: string;
  /** 相对 pattern（不含父级前缀），如 `repo/:owner/:repo` 或 ``（index route）。 */
  readonly pattern: string;
  /** pathname 参数 schema（zod）。undefined 表示无参数。 */
  readonly params?: P;
  /** search 参数 schema（zod）。undefined 表示无 query 参数。 */
  readonly search?: S;
  /** 视图懒加载器。 */
  readonly component: ViewLoader;
  /** 嵌套子路由。 */
  readonly children?: readonly RouteContract[];
}

/** 已擦除泛型的 RouteContract（用于树遍历、注册表存储等场景）。 */
export type ErasedRouteContract = RouteContract<ZodSchema | undefined, ZodSchema | undefined>;
