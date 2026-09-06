/**
 * 官方 DSH web profile 常驻启动（openspec dsh-webui-composition task 2.1 step 2
 * 浏览器验证用 dev 工具）。
 *
 * 执行：`pnpm exec tsx scripts/dsh-web-live.sh.ts`。打印带 token 的 URL 后常驻；
 * SIGINT/SIGTERM 时 dispose 并清理临时 home。证据截图由内置浏览器验证流程产出。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

// DSH_WEB_LIVE_HOME 复用固定 home（含预置 workspace），便于会话流验证；
// 未设置时每次 mkdtemp 全新 home。
const home = process.env.DSH_WEB_LIVE_HOME
  ? (fs.mkdirSync(process.env.DSH_WEB_LIVE_HOME, { recursive: true }),
    process.env.DSH_WEB_LIVE_HOME)
  : fs.mkdtempSync(path.join(os.tmpdir(), "dsh-web-live-"));
process.env.DSH_HOME = path.join(home, "dsh-home");
process.env.SKILL_CREATOR_HOME = path.join(home, "state");
fs.writeFileSync(path.join(root, "dsh-web-live.url"), "", "utf8");

const { bootOfficialWebProfile } = await import("../src/daemon/steward/dsh-official-profile.ts");
const host = await bootOfficialWebProfile({ home: process.env.DSH_HOME! });
fs.writeFileSync(path.join(root, "dsh-web-live.url"), `${host.record.authenticatedUrl}\n`, "utf8");
console.log(`dsh web live: ${host.record.authenticatedUrl}`);
console.log(`home: ${home}`);

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  console.log("shutting down...");
  try {
    await host.dispose();
  } finally {
    if (!process.env.DSH_WEB_LIVE_HOME) {
      fs.rmSync(home, { recursive: true, force: true });
    }
    fs.rmSync(path.join(root, "dsh-web-live.url"), { force: true });
    process.exit(0);
  }
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
setInterval(() => undefined, 60_000);
