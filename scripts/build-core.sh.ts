/**
 * 正交意图（2026-07-14）
 * 用户原始需求：「接手这个项目……进行大胆的开发」，交付必须是可安装、可运行的 CLI + WebUI。
 * 1. 将 CLI 与 daemon 分别打成 Node ESM bundle，第三方包由安装器提供。
 * 2. 写入经校验的 package identity，供 CLI/daemon 做版本握手。
 */
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "dist");

async function main(): Promise<void> {
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

  const rootPackage = readPackageIdentity(path.join(root, "package.json"));
  fs.writeFileSync(
    path.join(outDir, "package.json"),
    `${JSON.stringify({ ...rootPackage, type: "module" }, null, 2)}\n`,
  );

  console.log("✓ core built → dist/cli.js, dist/daemon.js");
}

function readPackageIdentity(file: string): { name: string; version: string } {
  const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("name" in parsed) ||
    typeof parsed.name !== "string" ||
    !("version" in parsed) ||
    typeof parsed.version !== "string"
  ) {
    throw new Error(`Invalid package identity in ${file}`);
  }
  return { name: parsed.name, version: parsed.version };
}

await main().catch((err) => {
  console.error(err);
  process.exit(1);
});
