/**
 * DSH runtime integration focused tests（openspec dsh-runtime-integration task 3.1+）。
 *
 * 用户原始需求 [2026-09-06]：「missing packages, version mismatch and missing plugin
 * rows return typed unavailable; no implicit fallback. 使用实际 package composition。」
 *
 * 正交意图：
 *   [1] 真实锁定组合 handshake：本机安装的 @deepseek-ai/* 0.1.2-rc.1 全部解析可用。
 *   [2] 注入式负例：缺包 / 版本漂移 / 组合行缺失 → typed unavailable，零 fallback。
 */
import { describe, expect, it } from "vitest";
import {
  DSH_LOCKED_PACKAGES,
  DshRuntimeStatusSchema,
} from "../src/shared/contracts/dsh-runtime.js";
import {
  createDshRuntimeAdapter,
  type DshPackageLoader,
} from "../src/daemon/steward/dsh-adapter.js";

import { createRequire } from "node:module";

const nodeRequire = createRequire(import.meta.url);

/** 真实 loader（与 adapter 默认一致，显式注入便于断言语义）。 */
const realLoader: DshPackageLoader = (packageName) => {
  const pkgJson = nodeRequire(`${packageName}/package.json`) as { version: string };
  const mod = nodeRequire(packageName) as Record<string, unknown>;
  return { version: pkgJson.version, hasExport: (name) => name in mod };
};

describe("dsh runtime handshake (task 3.1)", () => {
  it("resolves the real locked composition with full capability matrix", () => {
    const adapter = createDshRuntimeAdapter({ loader: realLoader });
    const status = adapter.handshake();
    expect(status.state).toBe("available");
    if (status.state !== "available") return;
    expect(status.auditedCommit).toBe("d347e703908d0406b7a7ef80e3a0e594d86b2215");
    expect(status.rows).toHaveLength(Object.keys(DSH_LOCKED_PACKAGES).length);
    for (const row of status.rows) {
      expect(row.resolvedVersion).toBe(row.lockedVersion);
    }
    expect(status.capabilities).toEqual({
      agentRegistry: true,
      agentLoop: true,
      toolRuntime: true,
      systemPrompt: true,
      sessionStore: true,
    });
    // 状态通过契约 schema runtime 校验。
    expect(DshRuntimeStatusSchema.safeParse(status).success).toBe(true);
  });

  it("reports typed unavailable for a missing package without fallback", () => {
    const loader: DshPackageLoader = (packageName) => {
      if (packageName === "@deepseek-ai/dsh-session") {
        throw new Error("MODULE_NOT_FOUND");
      }
      return realLoader(packageName);
    };
    const status = createDshRuntimeAdapter({ loader }).handshake();
    expect(status).toMatchObject({
      state: "unavailable",
      code: "MISSING_PACKAGE",
      packageName: "@deepseek-ai/dsh-session",
    });
    expect(DshRuntimeStatusSchema.safeParse(status).success).toBe(true);
  });

  it("reports typed unavailable on version drift", () => {
    const loader: DshPackageLoader = (packageName) => {
      const base = realLoader(packageName);
      if (packageName === "@deepseek-ai/dsh-agent") {
        return { ...base, version: "0.1.3-alpha.1" };
      }
      return base;
    };
    const status = createDshRuntimeAdapter({ loader }).handshake();
    expect(status).toMatchObject({
      state: "unavailable",
      code: "VERSION_MISMATCH",
      packageName: "@deepseek-ai/dsh-agent",
    });
  });

  it("reports typed unavailable when a composition row export disappears", () => {
    const loader: DshPackageLoader = (packageName) => {
      const base = realLoader(packageName);
      if (packageName === "@deepseek-ai/dsh-tools") {
        return { ...base, hasExport: () => false };
      }
      return base;
    };
    const status = createDshRuntimeAdapter({ loader }).handshake();
    expect(status).toMatchObject({
      state: "unavailable",
      code: "COMPOSITION_ROW_MISSING",
      packageName: "@deepseek-ai/dsh-tools",
    });
    if (status.state === "unavailable") {
      expect(status.detail).toContain("ToolRuntime");
    }
  });
});
