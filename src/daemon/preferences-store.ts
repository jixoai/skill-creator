/**
 * 原始需求 [2026-07-18]：「全面升级 skill-creator-v2 对于 opentray 的适配」。
 * 正交意图：
 *   [1] 持有 keep-onTop 偏好的唯一内存真相并原子持久化。
 *   [2] 作为 EventEmitter 向 TrayHost 与 WebServer 广播偏好变更。
 * 妥协声明：技能工作台目前只有一个偏好字段；不引入 pnpm-pub 那个承载
 * events/profiles/credentials 的庞大 DaemonStore，保持单一职责。
 */
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { atomicWriteUtf8 } from "./path-safety.js";
import { preferencesPath } from "../shared/paths.js";
import {
  DEFAULT_PREFERENCES,
  PreferencesSchema,
  type Preferences,
} from "../shared/contracts/tray.js";

/** keep-onTop 偏好的唯一真相源：内存态 + 原子持久化 + 事件广播。 */
export class PreferencesStore extends EventEmitter {
  private preferences: Preferences = { ...DEFAULT_PREFERENCES };
  private closed = false;

  constructor() {
    super();
    this.setMaxListeners(50);
    this.preferences = { ...DEFAULT_PREFERENCES, ...loadPreferences() };
  }

  /** 返回当前偏好的防御性拷贝。 */
  getPreferences(): Preferences {
    return { ...this.preferences };
  }

  /**
   * 合并 patch、no-op 短路、原子持久化，再 emit 完整快照。
   *
   * 单一写入路径：WebUI 的 preferences.set 与 TrayHost 都通过这里或订阅事件
   * 访问偏好，禁止旁路。
   */
  setPreferences(patch: Partial<Preferences>): void {
    if (this.closed) return;
    const merged: Preferences = { ...this.preferences, ...patch };
    if (JSON.stringify(merged) === JSON.stringify(this.preferences)) return;
    this.preferences = merged;
    atomicWriteUtf8(preferencesPath(), `${JSON.stringify(merged, null, 2)}\n`);
    this.emit("preferences", this.getPreferences());
  }

  /** 释放资源；后续 setPreferences 不再持久化或广播。 */
  close(): void {
    this.closed = true;
    this.removeAllListeners();
  }
}

function loadPreferences(): Partial<Preferences> {
  const file = preferencesPath();
  if (!fs.existsSync(file)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
  const merged: unknown =
    parsed && typeof parsed === "object"
      ? { ...DEFAULT_PREFERENCES, ...parsed }
      : { ...DEFAULT_PREFERENCES };
  const result = PreferencesSchema.safeParse(merged);
  return result.success ? result.data : {};
}
