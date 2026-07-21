/**
 * 用户原始需求 [2026-07-21]：「开发模式下，配置启动命令成 pnpm dev。」
 * 正交意图：
 * 1. 证明 Dock 描述符用绝对 Node 直接恢复 WebUI 的 Vite 监督器。
 * 2. 证明内部 JSON 必须通过当前 Zod schema。
 * 3. 拒绝任何仍需 shell shim 或 PATH 查找的相对启动入口。
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDevAppLaunch } from "../webui/config/daemon-dev.js";
import { parseDevAppLaunch, serializeDevAppLaunch } from "../src/shared/dev-app-launch.js";

describe("development app launch vector", () => {
  it("captures the real Vite JavaScript entry and WebUI cwd", () => {
    const command = path.resolve("/runtime/node");
    const cwd = path.resolve("/workspace/skill-creator-v2");
    const viteEntry = path.join(cwd, "webui/node_modules/vite/bin/vite.js");

    expect(resolveDevAppLaunch(command, cwd)).toEqual({
      command,
      args: [viteEntry, "dev"],
      cwd: path.join(cwd, "webui"),
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

  it("rejects relative runtime and Vite entries", () => {
    expect(() => resolveDevAppLaunch("node", "/workspace", "/workspace/vite.js")).toThrow(
      "absolute Node executable",
    );
    expect(() => resolveDevAppLaunch("/runtime/node", "/workspace", "vite.js")).toThrow(
      "absolute Vite entry",
    );
  });
});
