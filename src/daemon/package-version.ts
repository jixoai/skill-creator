/**
 * 原始需求 [2026-07-14]：「参考 ../../pnpm-pub 这个项目的架构：cli+gui(webui+opentray)」。
 * 正交意图：
 * 1. 为 daemon 提供语义明确的当前包版本入口。
 */
import { readNearestPackageVersion } from "../shared/package-version.js";

/** 返回当前 daemon 包版本，无法解析时返回 `unknown`。 */
export function readPackageVersion(): string {
  return readNearestPackageVersion(import.meta.url);
}
