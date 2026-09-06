/**
 * 最小真实 DSH web host（openspec dsh-webui-composition task 1.1）。
 *
 * 用户原始需求 [2026-09-06]（tasks 1.1）：「使用官方 web profile 的 AppWebEntry、
 * Cordis loader、client module graph 和 boot manifest；由当前 daemon 提供 loopback
 * RPC/remote namespace；不使用 iframe 或静态 demo。在干净临时 home 启动一次真实
 * DSH web host，记录 boot graph、plugin activation、session connection 和失败恢复证据。」
 * 事实源：docs/research/2026-09-06-dsh-integration.md「DSH Web composition 事实表」——
 * 官方组合是 Loader 驱动（client-modules 扫描 loader entries 组 window.__DSH_BOOT__），
 * 因此这里以真实 Cordis Loader + 最小 rows 启动，而不是手动 ctx.plugin 拼装。
 *
 * 正交意图：
 *   [1] Loader 驱动的最小宿主组合：webserver + credentials + client-connection +
 *       client-modules + web-app（web-app 自带官方 dist 的 frontend-static 覆盖与
 *       URL/token 通告）；boot 记录 entries 与激活顺序。
 *   [2] 进程内探针面：端口/带 token URL/entry 清单/boot graph 供 smoke 与测试消费。
 * 妥协声明：不在此文件做 daemon HTTP 反代或浏览器 roster 扩充（分别属 3.1a 与 2.x）；
 * cordis Context 无显式 dispose API（探测结论），宿主生命周期随进程或 dispose 回调收敛。
 */
import { Context } from "@deepseek-ai/cordis";
import { Loader } from "@deepseek-ai/cordis-plugin-loader";
import { createRequire } from "node:module";

const nodeRequire = createRequire(import.meta.url);
const nodePath = nodeRequire("node:path") as typeof import("node:path");

/** 最小 rows 的模块名（官方 patch 子集 + Skill Creator Manager client plugin，task 1.2）。 */
const MINIMAL_ROWS = [
  { name: "@deepseek-ai/dsh-host-webserver", config: { host: "127.0.0.1", port: 0 } },
  // dsh-credentials 是抽象 seam；官方组合用 file-backed local provider 满足
  // client-connection 的 ctx.credentials（modifyRecord 等具体面）。
  { name: "@deepseek-ai/dsh-credentials-local", config: {} },
  { name: "@deepseek-ai/dsh-client-connection", config: {} },
  { name: "@deepseek-ai/dsh-client-modules", config: {} },
  {
    name: "@deepseek-ai/dsh-web-app",
    config: { openBrowser: false, printUrl: false, surfaceContext: false },
  },
  // Manager client plugin（task 1.2）：node half 空 apply；browser half 是唯一
  // Manager RPC owner。activation 失败会让本次 boot reject（无假成功）。
  { name: "@skill-creator/dsh-client", config: {} },
] as const;

/** boot 记录（smoke 证据与测试断言的事实面）。 */
export interface DshWebHostBootRecord {
  /** loader entries（id/name/disabled）按激活顺序。 */
  entries: Array<{ id: string; name: string }>;
  /** loader/entry-init 事件序（plugin activation 证据）。 */
  activationOrder: string[];
  host: string;
  port: number;
  /** 带 process token 的干净 URL（浏览器首次认证用）。 */
  authenticatedUrl: string;
}

/** 运行中的最小 DSH web host。 */
export interface MinimalDshWebHost {
  ctx: Context;
  record: DshWebHostBootRecord;
  /** 进程内 http server（探针/反代用；生命周期归组合）。 */
  server(): import("node:http").Server | undefined;
  dispose(): Promise<void>;
}

/** 官方 dist 的 index.html 绝对路径（web-app 的 workspace knowledge，同一解析逻辑）。 */
export function resolveOfficialDistIndex(): string {
  const path = nodeRequire("node:path") as typeof import("node:path");
  const webFrontendPkg = nodeRequire.resolve(
    "@deepseek-ai/dsh-web-frontend/package.json",
  ) as string;
  return path.join(path.dirname(webFrontendPkg), "dist", "index.html");
}

/**
 * 启动最小真实 DSH web host：真实 Cordis Loader 按官方 rows 加载插件，
 * OS-assigned loopback 端口，官方 dist 由 web-app 自行覆盖挂载。
 * 任何 entry init 失败都会让 Promise reject（fail-fast，不静默降级）。
 */
export async function bootMinimalDshWebHost(): Promise<MinimalDshWebHost> {
  const ctx = new Context() as Context & { loader?: Loader };
  // baseUrl：client-modules 按它把裸包名 entry 解析到真实模块源（读 dsh.client manifest）。
  ctx.plugin(Loader, { baseUrl: new URL(".", import.meta.url).href });
  // Loader 自身按 fiber 调度 init；等待服务就绪（与 dsh-agent-runtime 相同的 settle 模式）。
  await new Promise((resolve) => setTimeout(resolve, 50));

  const activationOrder: string[] = [];
  let entryInitEvents = 0;
  const offInit = (
    ctx as unknown as {
      on: (event: string, listener: () => void) => () => void;
    }
  ).on("loader/entry-init", () => {
    entryInitEvents += 1;
  });

  const loader = ctx.loader;
  if (!loader) throw new Error("Cordis Loader service unavailable after plugin mount.");

  const entries: Array<{ id: string; name: string }> = [];
  for (const row of MINIMAL_ROWS) {
    // create resolve 即该 entry init 完成（plugin activation 事实）。
    const id = await loader.create({ name: row.name, config: row.config as never });
    entries.push({ id, name: row.name });
    activationOrder.push(row.name);
  }
  // 等待 entry tree 完全 settle（plugin activation + 注入解析）。
  await loader.await();

  const webServer = (ctx as Context & { webServer?: { host: string; port: number } }).webServer;
  if (!webServer) throw new Error("webServer service unavailable after loader settle.");
  const connection = (
    ctx as Context & { connection?: { authenticatedUrl: (url: string) => string } }
  ).connection;
  if (!connection) throw new Error("connection service unavailable after loader settle.");

  const baseUrl = `http://${webServer.host}:${webServer.port}`;
  if (entryInitEvents < entries.length) {
    throw new Error(
      `Expected at least ${entries.length} loader/entry-init events, observed ${entryInitEvents}.`,
    );
  }
  offInit();

  return {
    ctx,
    record: {
      entries,
      activationOrder,
      host: webServer.host,
      port: webServer.port,
      authenticatedUrl: connection.authenticatedUrl(baseUrl),
    },
    server: () =>
      (webServer as unknown as { server?: import("node:http").Server }).server ?? undefined,
    dispose: async () => {
      offInit();
      const server = (webServer as unknown as { server?: import("node:http").Server }).server;
      await new Promise<void>((resolve) => {
        if (!server || !server.listening) return resolve();
        server.close(() => resolve());
      });
      (ctx as unknown as { dispose?: () => void }).dispose?.();
    },
  };
}
