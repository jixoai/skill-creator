/**
 * 用户原始需求 [2026-07-18]：「全面升级 skill-creator-v2 对于 opentray 的适配」。
 * 正交意图：[1] 证明 win32 投影 native-material-comparator；[2] 其它平台不污染环境；
 * [3] production 覆盖开关可回滚。
 */
import { describe, expect, it } from "vitest";
import {
  configureOpenTrayWindowsHostTopology,
  OPENTRAY_WINDOWS_NATIVE_MATERIAL_COMPARATOR_ENV,
  SKILL_CREATOR_OPENTRAY_WINDOWS_HOST_TOPOLOGY_ENV,
} from "../src/daemon/opentray-windows-host.js";

function freshEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  delete env[OPENTRAY_WINDOWS_NATIVE_MATERIAL_COMPARATOR_ENV];
  delete env[SKILL_CREATOR_OPENTRAY_WINDOWS_HOST_TOPOLOGY_ENV];
  return env;
}

describe("OpenTray Windows host topology bridge", () => {
  it("sets the native material comparator on win32", () => {
    const env = freshEnv();
    const topology = configureOpenTrayWindowsHostTopology(env, "win32");
    expect(topology).toBe("native-material-comparator");
    expect(env[OPENTRAY_WINDOWS_NATIVE_MATERIAL_COMPARATOR_ENV]).toBe("1");
  });

  it("leaves non-win32 platforms on production without touching the environment", () => {
    for (const platform of ["darwin", "linux"] as NodeJS.Platform[]) {
      const env = freshEnv();
      const topology = configureOpenTrayWindowsHostTopology(env, platform);
      expect(topology).toBe("production");
      expect(env[OPENTRAY_WINDOWS_NATIVE_MATERIAL_COMPARATOR_ENV]).toBeUndefined();
    }
  });

  it("honors the production override on win32 (rollback / A-B)", () => {
    const env = freshEnv();
    env[SKILL_CREATOR_OPENTRAY_WINDOWS_HOST_TOPOLOGY_ENV] = "production";
    env[OPENTRAY_WINDOWS_NATIVE_MATERIAL_COMPARATOR_ENV] = "1";
    const topology = configureOpenTrayWindowsHostTopology(env, "win32");
    expect(topology).toBe("production");
    expect(env[OPENTRAY_WINDOWS_NATIVE_MATERIAL_COMPARATOR_ENV]).toBeUndefined();
  });
});
