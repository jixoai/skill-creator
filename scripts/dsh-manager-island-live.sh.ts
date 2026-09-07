/**
 * 同源 Manager island 组合实证（openspec dsh-webui-composition task 3.1a
 * 浏览器验收用 dev 工具）。
 *
 * 执行：`pnpm exec tsx scripts/dsh-manager-island-live.sh.ts`。组合：daemon
 * WebServer（同源 /ws/rpc + /manager/* island 资产）+ 官方 DSH web host 挂载。
 * 打印双 token 入口 URL（?token=<dsh>#token=<manager>）后常驻；SIGINT/SIGTERM 清理。
 * 证据：同一页面内 sidebar 的 Manager footer 入口挂载 Svelte island（原有
 * ProviderView），与官方 session transcript 同屏。
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const home = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-manager-island-"));
process.env.DSH_HOME = path.join(home, "dsh-home");
process.env.SKILL_CREATOR_HOME = path.join(home, "state");
fs.writeFileSync(path.join(root, "dsh-manager-island.url"), "", "utf8");

const { bootOfficialWebProfile } = await import("../src/daemon/steward/dsh-official-profile.ts");
const { createDaemonDomain } = await import("../src/daemon/domain.js");
const { WebServer } = await import("../src/daemon/web-server.js");
const { ProviderIdSchema } = await import("../src/shared/contracts/workspaces.js");
const { setHomeOverride } = await import("../src/shared/paths.js");
const { randomBytes } = await import("node:crypto");

setHomeOverride(process.env.SKILL_CREATOR_HOME!);
// 3.1b 验收要求真实文件系统证据：不注入 deterministic probe（真实 skills 探测）。
const domain = createDaemonDomain();

// island 资产目录：构建产物存在则直接服务；否则报错退出（不接受假 island）。
const webuiDir = path.join(root, "webui", "build-island");
if (!fs.existsSync(path.join(webuiDir, "dsh-island.js"))) {
  console.error(
    `island bundle missing at ${webuiDir}; run: pnpm --dir webui exec vite build --config vite.island.config.ts`,
  );
  process.exit(1);
}

const webToken = randomBytes(24).toString("base64url");
const web = new WebServer({
  webToken,
  webuiDir,
  domain,
  status: () => ({
    active: true,
    pid: process.pid,
    version: "0.0.0-dev-island",
    port: 0,
    startedAt: Date.now(),
    tray: "headless" as const,
  }),
});
const port = await web.start(0);

// 预置一个 Workspace + 技能（island ProviderView 的数据面）。
const workspaceDir = path.join(home, "ws");
fs.mkdirSync(path.join(workspaceDir, "skills"), { recursive: true });
const workspace = domain.workspaces.import(workspaceDir, "island-ws");
await domain.creator.save({
  mode: "create",
  workspaceId: workspace.id,
  providerId: ProviderIdSchema.parse("openclaw"),
  directoryName: "island-probe-skill",
  frontmatter: { name: "island-probe-skill", description: "island probe skill." },
  body: "# island-probe-skill\n\nManager island 数据面验证。\n",
});

// 预置 DSH workspace 记录（「添加工作区」依赖 koffi 原生选择器，web 端不可用；
// server 侧预置使新会话可建——同屏验收需要 session transcript）。
const canonicalWs = fs.realpathSync(workspaceDir);
const dshWorkspaceId = "99999999-8888-7777-6666-555555555555";
fs.mkdirSync(path.join(home, "dsh-home", "storages"), { recursive: true });
fs.writeFileSync(
  path.join(home, "dsh-home", "storages", "workspace.json"),
  `${JSON.stringify(
    {
      unit: { name: "workspace", version: 2 },
      global: { initialized: true, workspaceIds: [dshWorkspaceId], archivedSessionIds: [] },
      tables: {
        workspaces: {
          [dshWorkspaceId]: {
            path: canonicalWs,
            title: "island-ws",
            sessionIds: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        },
      },
    },
    null,
    2,
  )}\n`,
  "utf8",
);

const dsh = await bootOfficialWebProfile({ home: process.env.DSH_HOME! });
const dshServer = dsh.server();
if (!dshServer) throw new Error("official profile booted without an HTTP server");
const authenticated = new URL(dsh.record.authenticatedUrl);
web.mountDsh({
  host: dsh.record.host,
  port: dsh.record.port,
  server: dshServer,
  entryLocation: `${authenticated.pathname}${authenticated.search}`,
  authCookieName: `dsh-auth-${createHash("sha256").update(`${dsh.record.host}:${dsh.record.port}`).digest("base64url")}`,
});

// 同屏验收素材：跑一次绑定 DSH session 的 steward run（transcript 含 tool rounds）。
const { createDshSessionBinder } = await import("../src/daemon/steward/dsh-session-binder.ts");
const { createSkillStewardPipelineService } =
  await import("../src/daemon/steward/pipeline-service.ts");
const binder = createDshSessionBinder({ host: () => dsh });
const pipeline = createSkillStewardPipelineService({
  workspaces: domain.workspaces,
  skills: domain.skills,
  creator: domain.creator,
  dshSessionBinder: binder,
});
const run = await pipeline.startRun({
  target: { workspaceId: workspace.id, providerId: ProviderIdSchema.parse("openclaw") },
  taskKind: "check",
});
console.log(`bound steward run: dshSession=${run.dshSessionId} toolCalls=${run.toolCalls}`);

const dshToken = new URL(dsh.record.authenticatedUrl).searchParams.get("token") ?? "";
const entry = `http://127.0.0.1:${port}/?token=${dshToken}#token=${encodeURIComponent(webToken)}`;
fs.writeFileSync(path.join(root, "dsh-manager-island.url"), `${entry}\n`, "utf8");
console.log(`manager island composition: ${entry}`);
console.log(`home: ${home}`);

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  console.log("shutting down...");
  try {
    await web.stop({ graceMs: 500 });
    await domain.steward.dispose();
    await domain.repository.dispose();
    await dsh.dispose();
  } finally {
    setHomeOverride(null);
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(path.join(root, "dsh-manager-island.url"), { force: true });
    process.exit(0);
  }
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
setInterval(() => undefined, 60_000);
