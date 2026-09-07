/**
 * 正交意图（2026-07-14）
 * 用户原始需求：「接手这个项目……进行大胆的开发」，交付必须是可安装、可运行的 CLI + WebUI。
 * 用户原始需求 [2026-07-21]：「任何外部输入都应该遵循这个规则：各种配置文件、数据库结构、网络返回等」。
 * 用户原始需求 [2026-09-07]（steward-product-workflow 4.8）：「pack 后在仓库外的空目录安装并启动」，
 * 产物不得依赖 link:/workspace 等未发布私有包。
 * 1. 将 CLI 与 daemon 分别打成 Node ESM bundle；`dependencies` 里的 registry 包保持 external
 *    由安装器提供，其余（ccski 及其 debug 依赖）打入产物。
 * 2. 写入经校验的 package identity，供 CLI/daemon 做版本握手。
 *    安装态（无 workspace 链接）把它接入 DSH profile。
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
const PackageIdentitySchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  dependencies: z.record(z.string(), z.string()).optional(),
});

interface RootPackageIdentity {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
}

/** devDependencies 里的本地链接：仅作构建期 bundling 源，不属于 runtime externals。 */
const BUNDLED_PACKAGES = new Set(["ccski"]);

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
    external: runtimeExternals(rootPackage),
    // 打入产物的 CJS 依赖（ccski→debug）在 ESM 输出里经 require 引用 node 内建
    // （tty 等）；提供 createRequire 让这些静态 require 走真实 Node 解析。
    banner: {
      js: "import { createRequire as __skillCreatorCreateRequire } from 'node:module'; const require = __skillCreatorCreateRequire(import.meta.url);",
    },
  });

  fs.writeFileSync(
    path.join(outDir, "package.json"),
    `${JSON.stringify({ name: rootPackage.name, version: rootPackage.version, type: "module" }, null, 2)}\n`,
  );

  console.log("✓ core built → dist/cli.js, dist/daemon.js");
}

/**
 * runtime externals = `dependencies` 里发布到 registry 的包（含子路径 import）。
 * workspace link 的 ccski 不在其中：esbuild 会把它（及其非 external 依赖）打入 bundle。
 */
function runtimeExternals(rootPackage: RootPackageIdentity): string[] {
  const dependencies = rootPackage.dependencies ?? {};
  return Object.keys(dependencies)
    .filter((name) => !BUNDLED_PACKAGES.has(name))
    .flatMap((name) => [name, `${name}/*`]);
}

function copyDir(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(source, target);
    else fs.copyFileSync(source, target);
  }
}

function readPackageIdentity(file: string): RootPackageIdentity {
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
