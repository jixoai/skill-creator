/**
 * 原始需求 [2026-07-14]：「参考 ../../pnpm-pub 这个项目的架构：cli+gui(webui+opentray)」。
 * 正交意图：
 * 1. 从源码或 bundle 邻近的 package.json 读取进程版本。
 * 2. 在元数据缺失或损坏时返回可诊断的 `unknown`。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Resolve the nearest valid package version for a source module or bundled entry. */
export function readNearestPackageVersion(moduleUrl: string): string {
  const here = path.dirname(fileURLToPath(moduleUrl));
  const candidates = [
    path.join(here, "package.json"),
    path.join(here, "..", "package.json"),
    path.join(here, "..", "..", "package.json"),
  ];
  for (const candidate of candidates) {
    try {
      const pkg: unknown = JSON.parse(fs.readFileSync(candidate, "utf8"));
      if (isRecord(pkg) && typeof pkg.version === "string") return pkg.version;
    } catch {
      // Continue toward the repository package boundary.
    }
  }
  return "unknown";
}
