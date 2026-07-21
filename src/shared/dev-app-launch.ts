/**
 * 用户原始需求 [2026-07-21]：「开发模式下，配置启动命令成 pnpm dev；退出托盘后点击 Dock 图标必须重新启动。」
 * 正交意图：
 * 1. 定义 Vite 到 daemon 的私有开发启动向量传输格式。
 * 2. 用 Zod safeParse 拒绝不完整或被污染的内部环境数据。
 * 3. 保持该向量可直接交给 OpenTray，不存储 shell 或环境快照。
 */
import { z } from "zod";

export const SKILL_CREATOR_DEV_APP_LAUNCH_ENV = "SKILL_CREATOR_DEV_APP_LAUNCH";

export const DevAppLaunchSchema = z
  .object({
    command: z.string().min(1),
    args: z.array(z.string()),
    cwd: z.string().min(1),
  })
  .strict();

export type DevAppLaunch = z.infer<typeof DevAppLaunchSchema>;

/** Serialize one validated shell-free development launch vector. */
export function serializeDevAppLaunch(value: DevAppLaunch): string {
  const parsed = DevAppLaunchSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid development app launch vector: ${z.prettifyError(parsed.error)}`);
  }
  return JSON.stringify(parsed.data);
}

/** Parse the optional Vite-owned development launch vector. */
export function parseDevAppLaunch(value: string | undefined): DevAppLaunch | undefined {
  if (value === undefined) return undefined;
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch (error: unknown) {
    throw new Error("Invalid development app launch JSON.", { cause: error });
  }
  const parsed = DevAppLaunchSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new Error(`Invalid development app launch vector: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
