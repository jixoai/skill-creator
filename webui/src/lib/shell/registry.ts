/**
 * 用户原始需求 [2026-07-27]：「ChromeTabs 和路由做深度的绑定」。
 * 正交意图：
 *   [1] routeRegistry：按 route id 存储 RouteContract + absolutePattern。
 *   [2] appRegistry：按 app id 存储 AppManifest。
 * 参考：gaubee.com/src/lib/router/registry.ts + apps/registry.ts。
 */
import type { ErasedRouteContract } from "./contract.js";
import type { AppManifest } from "./types.js";

/** route 注册表条目。 */
export interface RouteRegistryEntry {
  readonly id: string;
  readonly route: ErasedRouteContract;
  readonly absolutePattern: string;
}

/** Route 注册表单例（id → entry）。 */
class RouteRegistry {
  private readonly entries = new Map<string, RouteRegistryEntry>();

  register(entry: RouteRegistryEntry): void {
    this.entries.set(entry.id, entry);
  }

  get(id: string): RouteRegistryEntry | undefined {
    return this.entries.get(id);
  }

  list(): readonly RouteRegistryEntry[] {
    return [...this.entries.values()];
  }

  /** 按 absolute pattern 前缀匹配，返回首个命中的 entry。 */
  findByPath(pathname: string): RouteRegistryEntry | undefined {
    for (const entry of this.entries.values()) {
      const patternWithoutParams = entry.absolutePattern.replace(/:[^/]+/g, "[^/]+");
      try {
        const re = new RegExp(`^${patternWithoutParams.replace(/\//g, "\\/")}\\/?$`);
        if (re.test(pathname)) return entry;
      } catch {
        // pattern 编译失败，跳过
      }
    }
    return undefined;
  }
}

/** App 注册表单例（id → manifest）。 */
class AppRegistry {
  private readonly apps = new Map<string, AppManifest>();

  register(manifest: AppManifest): void {
    this.apps.set(manifest.id, manifest);
  }

  get(id: string): AppManifest | undefined {
    return this.apps.get(id);
  }

  list(): readonly AppManifest[] {
    return [...this.apps.values()];
  }
}

/** 全局 route 注册表。 */
export const routeRegistry = new RouteRegistry();
/** 全局 app 注册表。 */
export const appRegistry = new AppRegistry();
