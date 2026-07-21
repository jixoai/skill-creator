#!/usr/bin/env bun
/**
 * 用户原始需求 [2026-07-21]：「link 本地的 opentray；确保每次 pnpm dev 之前的所有准备工作。」
 * 正交意图：
 * 1. 只在 opentray 确实链接到源码工作区时执行 linked-consumer staging。
 * 2. 使用当前包管理器的绝对入口准备 TypeScript 与原生运行时产物。
 */
import { spawn } from "node:child_process";
import { realpath, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const WorkspacePackageSchema = z.object({
  name: z.literal("opentray-workspace"),
  scripts: z.object({
    "prepare:linked-consumer": z.string().min(1),
  }),
});

/** Return the linked OpenTray workspace root, or null for a registry installation. */
export async function resolveLinkedOpenTrayWorkspace(consumerRoot: string): Promise<string | null> {
  let opentrayPackage: string;
  try {
    opentrayPackage = await realpath(path.join(consumerRoot, "node_modules/opentray"));
  } catch {
    return null;
  }

  const workspaceRoot = path.resolve(opentrayPackage, "../..");
  try {
    const decoded: unknown = JSON.parse(
      await readFile(path.join(workspaceRoot, "package.json"), "utf8"),
    );
    return WorkspacePackageSchema.safeParse(decoded).success ? workspaceRoot : null;
  } catch {
    return null;
  }
}

/** Build and stage a linked OpenTray workspace; registry installations are a no-op. */
export async function prepareLinkedOpenTray(consumerRoot: string): Promise<void> {
  const workspaceRoot = await resolveLinkedOpenTrayWorkspace(consumerRoot);
  if (workspaceRoot === null) return;

  const packageManagerEntry = process.env.npm_execpath;
  const nodeExecutable = process.env.npm_node_execpath;
  if (!packageManagerEntry || !path.isAbsolute(packageManagerEntry)) {
    throw new Error("Linked OpenTray preparation requires an absolute npm_execpath.");
  }
  if (!nodeExecutable || !path.isAbsolute(nodeExecutable)) {
    throw new Error("Linked OpenTray preparation requires an absolute Node executable.");
  }

  console.log(`Preparing linked OpenTray workspace: ${workspaceRoot}`);
  const code = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(nodeExecutable, [packageManagerEntry, "run", "prepare:linked-consumer"], {
      cwd: workspaceRoot,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) throw new Error(`Linked OpenTray preparation failed with code ${code}.`);
}

if (import.meta.main) {
  await prepareLinkedOpenTray(path.resolve(fileURLToPath(new URL("..", import.meta.url))));
}
