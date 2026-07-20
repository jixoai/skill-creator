/**
 * 正交意图（2026-07-14）
 * 用户原始需求：「接手这个项目……进行大胆的开发」，交付必须是可安装、可运行的 CLI + WebUI。
 * 用户原始需求 [2026-07-21]：「任何外部输入都应该遵循这个规则：各种配置文件、数据库结构、网络返回等」。
 * 1. 将 CLI 与 daemon 分别打成 Node ESM bundle，第三方包由安装器提供。
 * 2. 写入经校验的 package identity，供 CLI/daemon 做版本握手。
 */
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { safeParseJson } from "../src/shared/external-input.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "dist");
const PackageIdentitySchema = z.object({ name: z.string().min(1), version: z.string().min(1) });

async function main(): Promise<void> {
  const rootPackage = readPackageIdentity(path.join(root, "package.json"));
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  await build({
    entryPoints: {
      cli: path.join(root, "src/cli/cli.ts"),
      daemon: path.join(root, "src/daemon/main.ts"),
    },
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    outdir: outDir,
    sourcemap: true,
    logLevel: "info",
    packages: "external",
  });

  fs.writeFileSync(
    path.join(outDir, "package.json"),
    `${JSON.stringify({ ...rootPackage, type: "module" }, null, 2)}\n`,
  );

  console.log("✓ core built → dist/cli.js, dist/daemon.js");
}

function readPackageIdentity(file: string): { name: string; version: string } {
  let source: string;
  try {
    source = fs.readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(`Cannot read package identity in ${file}: ${formatError(error)}`);
  }
  const parsed = safeParseJson(source, PackageIdentitySchema);
  if (!parsed) {
    throw new Error(`Invalid package identity in ${file}`);
  }
  return parsed;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

await main().catch((err) => {
  console.error(err);
  process.exit(1);
});
