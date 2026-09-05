/**
 * 用户原始需求 [2026-07-27]：「参考 gaubee.com 的 GaubeeOS + AppShell 标准」。
 * 正交意图：
 *   [1] 定义应用 manifest（AppManifest）与屏幕场景（AppActivity）。
 *   [2] 定义应用入口（AppEntry）和入口路由派生。
 * 参考：gaubee.com/src/lib/apps/types.ts（精简版，去掉 VFS/widget/CLI/services 等）。
 */
import type { Component } from "svelte";
import type { ErasedRouteContract } from "./contract.js";

/** 应用的一个屏幕场景。每个场景有一个绝对 pattern + 一棵 RouteContract 树。 */
export interface AppActivity {
  /** 该场景的绝对 pattern（如 `/workspaces`、`/workspaces/:wsId/:providerId`）。 */
  readonly pattern: string;
  /** 场景的根 Route 树（root.pattern 通常为 ``，代表「Activity 入口」）。 */
  readonly root: ErasedRouteContract;
  /** 是否为应用入口场景。Dock 图标身份 = entry activity 的 pattern。 */
  readonly entry?: boolean;
}

/** 应用元数据（纯数据，不含运行时状态）。 */
export interface AppManifest {
  /** 唯一标识（如 `workspaces`、`creator`、`repository`）。 */
  readonly id: string;
  /** 显示名称。 */
  readonly name: string;
  /** Lucide 图标组件。 */
  readonly icon: Component;
  /** 应用拥有的全部屏幕场景。入口路由派生自 entry activity。 */
  readonly activities: readonly AppActivity[];
}

/** 应用注册项。 */
export interface AppEntry {
  readonly manifest: AppManifest;
}

/** 从 manifest 的 activities 派生入口路由（= entry activity 的 pattern）。 */
export function getEntryRoute(manifest: AppManifest): string {
  const entry = manifest.activities.find((a) => a.entry);
  return (entry ?? manifest.activities[0])?.pattern ?? "";
}

/** 从 manifest 派生入口 activity。 */
export function getEntryActivity(manifest: AppManifest): AppActivity | undefined {
  return manifest.activities.find((a) => a.entry) ?? manifest.activities[0];
}
