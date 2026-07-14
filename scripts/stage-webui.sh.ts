/**
 * 正交意图（2026-07-14）
 * 用户原始需求：「cli + gui (webui + opentray)」必须作为一个可安装产物交付。
 * 1. 将静态 SvelteKit SPA 原样装配进 daemon 的 `dist/webui` 服务目录。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const src = path.join(root, "webui", "build");
const dest = path.join(root, "dist", "webui");

function copyDir(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

if (!fs.existsSync(src)) {
  console.error(`webui build not found at ${src}. Run 'pnpm build:webui' first.`);
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
copyDir(src, dest);
console.log(`✓ webui staged → dist/webui (${fs.readdirSync(dest).length} entries)`);
