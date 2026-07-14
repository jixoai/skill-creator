/**
 * 原始需求 [2026-07-14]：「引入各种各样的功能（保持模块化、正交）」。
 * 正交意图：
 * 1. 合并条件 class 与 Tailwind 冲突。
 * 2. 提供组件 props 组合所需的结构类型。
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** 合并条件 class，并消解 Tailwind utility 冲突。 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 从组件 props 中移除单一 child。 */
export type WithoutChild<T> = T extends { child?: unknown } ? Omit<T, "child"> : T;
/** 从组件 props 中移除 children。 */
export type WithoutChildren<T> = T extends { children?: unknown } ? Omit<T, "children"> : T;
/** 从组件 props 中同时移除 child 与 children。 */
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
/** 为组件 props 附加可选 DOM element ref。 */
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
