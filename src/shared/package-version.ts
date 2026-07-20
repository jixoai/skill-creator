/**
 * 原始需求 [2026-07-14]：「参考 ../../pnpm-pub 这个项目的架构：cli+gui(webui+opentray)」。
 * 用户原始需求 [2026-07-21]：「任何外部输入都应该遵循这个规则：各种配置文件、数据库结构、网络返回等」。
 * 正交意图：
 * 1. 从源码或 bundle 邻近的 package.json 读取进程版本。
 * 2. 在元数据缺失或损坏时返回可诊断的 `unknown`。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { safeParseJson } from "./external-input.js";

const PackageVersionSchema = z.object({ version: z.string().min(1) });

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
      const pkg = safeParseJson(fs.readFileSync(candidate, "utf8"), PackageVersionSchema);
      if (pkg) return pkg.version;
    } catch {
      // Continue toward the repository package boundary.
    }
  }
  return "unknown";
}
