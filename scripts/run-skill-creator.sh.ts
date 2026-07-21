#!/usr/bin/env bun
/**
 * 用户原始需求 [2026-07-21]：「pnpm skill-creator start 必须启动托盘。」
 * 正交意图：
 * 1. 仅在 start 前准备源码 link 的 OpenTray 原生产物。
 * 2. 将所有 CLI 参数原样交给已构建的 Node 入口。
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareLinkedOpenTray } from "./prepare-linked-opentray.sh.js";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);

if (args[0] === "start") {
  await prepareLinkedOpenTray(root);
}

const nodeExecutable = process.env.npm_node_execpath ?? "node";
const code = await new Promise<number | null>((resolve, reject) => {
  const child = spawn(nodeExecutable, [path.join(root, "dist/cli.js"), ...args], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  child.once("error", reject);
  child.once("exit", resolve);
});
process.exitCode = code ?? 1;
