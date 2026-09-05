#!/usr/bin/env bun
/**
 * 用户原始需求 [2026-07-27]：「要支持 pnpm dev --web」。
 * 正交意图：
 *   [1] 从 `pnpm dev` argv 拦截 --web / --no-web，转成 SKILL_CREATOR_WEB env。
 *   [2] 把剩余参数原样透传给 webui 的 vite dev（vite 不容忍未知 flag）。
 *
 * 链路：pnpm dev --web → 本脚本 → vite dev（webui/）+ SKILL_CREATOR_WEB env
 *       → daemon-dev 插件 spawn dev.ts → webModeFromEnv() 读取 → bootDaemon(web:true)
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseWebModeFlag, SKILL_CREATOR_WEB_ENV } from "../src/shared/web-mode.js";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const webuiDir = path.join(root, "webui");
const rawArgs = process.argv.slice(2);

// 拆出 --web/--no-web，vite 不接受它们。
const webFlag = parseWebModeFlag(rawArgs);
const viteArgs = rawArgs.filter((arg) => arg !== "--web" && arg !== "--no-web");

const env = { ...process.env };
if (webFlag !== undefined) {
  env[SKILL_CREATOR_WEB_ENV] = webFlag ? "1" : "0";
}

// 解析 webui 本地 vite（pnpm workspace 已 link），避免 Finder PATH 缺裸 vite。
const viteEntry = path.join(webuiDir, "node_modules/vite/bin/vite.js");
const nodeExecutable = process.env.npm_node_execpath ?? process.execPath;

const code = await new Promise<number | null>((resolve, reject) => {
  const child = spawn(nodeExecutable, [viteEntry, "dev", ...viteArgs], {
    cwd: webuiDir,
    env,
    stdio: "inherit",
  });
  child.once("error", reject);
  child.once("exit", resolve);
});
process.exitCode = code ?? 1;
