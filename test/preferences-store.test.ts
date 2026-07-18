/**
 * 用户原始需求 [2026-07-18]：「全面升级 skill-creator-v2 对于 opentray 的适配」。
 * 正交意图：
 *   [1] 证明默认偏好与持久化文件加载合并。
 *   [2] 证明 setPreferences 合并、no-op 短路与事件广播。
 *   [3] 证明 close 后不再持久化或广播。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreferencesStore } from "../src/daemon/preferences-store.js";
import { setHomeOverride } from "../src/shared/paths.js";

const previousHome = process.env.SKILL_CREATOR_HOME;
let sandbox = "";

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-prefs-test-"));
  setHomeOverride(sandbox);
  fs.mkdirSync(path.join(sandbox, ".skill-creator", "state"), { recursive: true });
});

afterEach(() => {
  setHomeOverride(null);
  if (previousHome === undefined) delete process.env.SKILL_CREATOR_HOME;
  else process.env.SKILL_CREATOR_HOME = previousHome;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("PreferencesStore", () => {
  it("defaults to keepOnTop=false when no persisted file exists", () => {
    const store = new PreferencesStore();
    expect(store.getPreferences()).toEqual({ keepOnTop: false });
  });

  it("merges a persisted file over defaults", () => {
    fs.mkdirSync(path.join(sandbox, ".skill-creator", "state"), { recursive: true });
    fs.writeFileSync(
      path.join(sandbox, ".skill-creator", "state", "preferences.json"),
      `${JSON.stringify({ keepOnTop: true })}\n`,
    );
    const store = new PreferencesStore();
    expect(store.getPreferences()).toEqual({ keepOnTop: true });
  });

  it("broadcasts and persists a real change, but no-ops an equal patch", () => {
    const store = new PreferencesStore();
    const listener = vi.fn();
    store.on("preferences", listener);

    store.setPreferences({ keepOnTop: true });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ keepOnTop: true });
    expect(store.getPreferences()).toEqual({ keepOnTop: true });
    expect(
      JSON.parse(
        fs.readFileSync(path.join(sandbox, ".skill-creator", "state", "preferences.json"), "utf8"),
      ),
    ).toEqual({ keepOnTop: true });

    // 同值 patch 不得再次广播。
    store.setPreferences({ keepOnTop: true });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stops persisting and broadcasting after close", () => {
    const store = new PreferencesStore();
    const listener = vi.fn();
    store.on("preferences", listener);
    store.close();
    store.setPreferences({ keepOnTop: true });
    expect(listener).not.toHaveBeenCalled();
    expect(store.getPreferences()).toEqual({ keepOnTop: false });
  });
});
