/**
 * External data parsing primitives.
 *
 * User input [2026-07-21]: "任何外部输入都应该遵循这个规则：各种配置文件、数据库结构、网络返回等"
 * Architecture decision [2026-07-21]: decode external values to `unknown`, then
 * use current Zod schemas to distinguish a compatible value from an empty one.
 *
 * Orthogonal intents:
 *   [1] Safely decode JSON snapshots from external bytes.
 *   [2] Safely narrow arbitrary external values with a current schema.
 */
import type { z } from "zod";

/** Return a current-schema external value, or `null` when its shape is incompatible. */
export function safeParseExternal<T>(schema: z.ZodType<T>, value: unknown): T | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Decode and narrow external JSON, returning `null` for syntax or schema incompatibility. */
export function safeParseJson<T>(source: string, schema: z.ZodType<T>): T | null {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return null;
  }
  return safeParseExternal(schema, value);
}
