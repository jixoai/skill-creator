/**
 * DSH runtime adapter：锁定组合的 capability handshake（openspec dsh-runtime-integration
 * task 3.1）。
 *
 * 用户原始需求 [2026-09-06]（GOAL）：「DSH 是实际依赖和插件组合，不是 dsh-acp 命令
 * 别名。」本文件取代旧 dsh-acp JSON-RPC 方案：直接以官方 npm package 组合为事实源，
 * handshake 逐包校验（可解析、版本精确匹配、组合行导出存在），任何失败都是
 * typed unavailable，绝不 fallback 到其他 backend。
 * 事实源：docs/research/2026-09-06-dsh-integration.md（官方仓库 commit d347e703 源码
 * 审计）与 package.json 锁定的 @deepseek-ai/* 0.1.2-rc.1 精确版本。
 *
 * 正交意图：
 *   [1] handshake：锁定版本 + composition row + 能力矩阵（全部来自真实解析）。
 *   [2] 可注入 loader：测试注入假 package 表覆盖 missing/mismatch/row-missing。
 *   [3] 后续任务（3.2/3.3）在同一 adapter 上扩展 agent/session/tool 适配面。
 */
import { createRequire } from "node:module";
import {
  DSH_AUDITED_COMMIT,
  DSH_COMPOSITION_ROWS,
  DSH_LOCKED_PACKAGES,
  type DshLockedPackageName,
  type DshRuntimeStatus,
} from "../../shared/contracts/dsh-runtime.js";

/** 每个 composition row 依赖的具体导出成员（运行时逐个校验存在）。 */
const ROW_EXPORTS: Record<DshLockedPackageName, string> = {
  "@deepseek-ai/dsh-agent": "AgentRegistry",
  "@deepseek-ai/dsh-agent-loop": "AgentLoop",
  "@deepseek-ai/dsh-tools": "ToolRuntime",
  "@deepseek-ai/dsh-system-prompt": "SystemPrompt",
  "@deepseek-ai/dsh-session": "SessionStore",
};

/** 能力矩阵字段 ↔ package（能力由该 package 的 row 解析支撑）。 */
const CAPABILITY_PACKAGE: Record<string, DshLockedPackageName> = {
  agentRegistry: "@deepseek-ai/dsh-agent",
  agentLoop: "@deepseek-ai/dsh-agent-loop",
  toolRuntime: "@deepseek-ai/dsh-tools",
  systemPrompt: "@deepseek-ai/dsh-system-prompt",
  sessionStore: "@deepseek-ai/dsh-session",
};

/** 可注入的包解析结果（测试用）。 */
export interface DshPackageResolution {
  /** package.json 的 version。 */
  version: string;
  /** 模块导出表（仅判断成员存在）。 */
  hasExport(exportName: string): boolean;
}

/** 包解析器（默认走真实 require；测试注入假实现）。 */
export type DshPackageLoader = (packageName: string) => DshPackageResolution;

/** 默认 loader：createRequire 解析真实安装的 package。 */
const defaultLoader: DshPackageLoader = (packageName) => {
  const require = createRequire(import.meta.url);
  const pkgJson = require(`${packageName}/package.json`) as { version?: unknown };
  const mod = require(packageName) as Record<string, unknown>;
  const version = typeof pkgJson.version === "string" ? pkgJson.version : "";
  return {
    version,
    hasExport: (exportName) => exportName in mod,
  };
};

export interface DshRuntimeAdapterOptions {
  /** 测试注入假 loader（missing/mismatch/row-missing 场景）。 */
  loader?: DshPackageLoader;
}

/** 创建 DSH runtime adapter（handshake 面；3.2/3.3 扩展 stream/tool 面）。 */
export function createDshRuntimeAdapter(options: DshRuntimeAdapterOptions = {}) {
  const loader = options.loader ?? defaultLoader;

  /**
   * 锁定组合 handshake：逐包解析 → 版本精确匹配 → 组合行导出存在。
   * 任何一步失败返回 typed unavailable；不做任何 fallback。
   */
  function handshake(): DshRuntimeStatus {
    const rows: Array<{
      packageName: string;
      lockedVersion: string;
      resolvedVersion: string;
      exportName: string;
      seam: string;
    }> = [];
    for (const [packageName, lockedVersion] of Object.entries(DSH_LOCKED_PACKAGES) as Array<
      [DshLockedPackageName, string]
    >) {
      let resolution: DshPackageResolution;
      try {
        resolution = loader(packageName);
      } catch (error) {
        return {
          state: "unavailable",
          code: "MISSING_PACKAGE",
          packageName,
          detail: `Failed to resolve ${packageName}: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      if (resolution.version !== lockedVersion) {
        return {
          state: "unavailable",
          code: "VERSION_MISMATCH",
          packageName,
          detail: `${packageName} resolved to ${resolution.version || "<unknown>"} but the locked composition requires exactly ${lockedVersion}.`,
        };
      }
      const exportName = ROW_EXPORTS[packageName];
      if (!resolution.hasExport(exportName)) {
        return {
          state: "unavailable",
          code: "COMPOSITION_ROW_MISSING",
          packageName,
          detail: `${packageName} does not export "${exportName}" (${DSH_COMPOSITION_ROWS[packageName]}); the composition row is missing.`,
        };
      }
      rows.push({
        packageName,
        lockedVersion,
        resolvedVersion: resolution.version,
        exportName,
        seam: DSH_COMPOSITION_ROWS[packageName],
      });
    }
    // 能力矩阵不是硬编码：每项都必须有已解析 row 支撑。
    const capabilities = {
      agentRegistry: false,
      agentLoop: false,
      toolRuntime: false,
      systemPrompt: false,
      sessionStore: false,
    };
    for (const [capability, packageName] of Object.entries(CAPABILITY_PACKAGE)) {
      capabilities[capability as keyof typeof capabilities] = rows.some(
        (row) => row.packageName === packageName,
      );
    }
    return { state: "available", auditedCommit: DSH_AUDITED_COMMIT, rows, capabilities };
  }

  return { handshake };
}

/** DSH runtime adapter 实例接口。 */
export interface DshRuntimeAdapter extends ReturnType<typeof createDshRuntimeAdapter> {}
