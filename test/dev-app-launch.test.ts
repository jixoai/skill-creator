/**
 * 用户原始需求 [2026-07-21]：「开发模式下，配置启动命令成 pnpm dev。」
 * 正交意图：
 * 1. 证明 Dock 描述符直接恢复 WebUI 的 pnpm dev 监督器，而不是依赖根脚本二次查找 pnpm。
 * 2. 证明内部 JSON 必须通过当前 Zod schema。
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDevAppLaunch } from "../webui/config/daemon-dev.js";
import { parseDevAppLaunch, serializeDevAppLaunch } from "../src/shared/dev-app-launch.js";

describe("development app launch vector", () => {
  it("captures the absolute package-manager entry and repository cwd", () => {
    const command = path.resolve("/runtime/node");
    const packageManager = path.resolve("/runtime/pnpm.cjs");
    const cwd = path.resolve("/workspace/skill-creator-v2");

    expect(resolveDevAppLaunch({ npm_execpath: packageManager }, command, cwd)).toEqual({
      command,
      args: [packageManager, "--dir", path.join(cwd, "webui"), "dev"],
      cwd,
    });
  });

  it("round-trips only the current strict schema", () => {
    const launch = {
      command: "/runtime/node",
      args: ["/runtime/pnpm.cjs", "dev"],
      cwd: "/workspace/skill-creator-v2",
    };

    expect(parseDevAppLaunch(serializeDevAppLaunch(launch))).toEqual(launch);
    expect(() => parseDevAppLaunch(JSON.stringify({ ...launch, shell: true }))).toThrow(
      "Invalid development app launch vector",
    );
  });

  it("rejects a missing or relative package-manager entry", () => {
    expect(() => resolveDevAppLaunch({}, "/runtime/node", "/workspace")).toThrow(
      "absolute npm_execpath",
    );
    expect(() =>
      resolveDevAppLaunch({ npm_execpath: "pnpm.cjs" }, "/runtime/node", "/workspace"),
    ).toThrow("absolute npm_execpath");
  });
});
