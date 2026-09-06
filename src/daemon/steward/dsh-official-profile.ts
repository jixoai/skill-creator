/**
 * 官方 DSH web profile 完整启动（openspec dsh-webui-composition task 2.1 step 1）。
 *
 * 用户原始需求 [2026-09-06]（tasks 2.1）：「复用 DSH 的 model/provider/profile、
 * session list/detail、stream transcript、permission 和 approval presentation。」
 * 事实源：dsh-webui-composition/artifacts/verification.md 1.2 注记——session/settings
 * controller 的 peer 链（26 包）证明只有完整官方 profile 才能供给这些 UI；本模块以
 * dsh-app-boot 的官方 profile 机制（initProfile → loadProfile → heal → boot）启动
 * base + web-app 两个官方 bundle，而不是手拼 rows。
 *
 * 正交意图：
 *   [1] 官方组合装载：profile 机制 + 官方 boot()（mountRootInclude + assertEntries
 *       Activated，失败 typed 抛错无假成功）。
 *   [2] 非嵌入式 server 配置：user patch 层固定 webserver/web-runtime 配置并
 *       disable web-startup（它 inject 的 cmdlineArgs 是 dsh CLI 进程专属服务）。
 * 妥协声明：完整 profile 含 agent/llm/session 全家桶（85+ base rows）；本模块只做
 * 宿主启动与探针面，浏览器交互验证与 Manager run↔DSH session 绑定在 2.1 后续步骤。
 *
 * preset 行闭包事实（2026-09-06 浏览器验证实测）：官方 agent-presets 的 standard/
 * minimal 预设行引用 @deepseek-ai/dsh-persona 与 @deepseek-ai/dsh-tool-ask-user，
 * ptc 额外引用 @deepseek-ai/dsh-agent-tool-presentation；这些包不在 dsh-base 依赖
 * 闭包内。heal 的 module fallback 只遍历根 manifest 的 dependencies/peerDependencies，
 * 因此三者必须作为本仓 dependencies 安装（发布包同规则），否则 session/create 以
 * agent-preset/invalid 拒绝（preset mount 时行无法解析）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  boot,
  healProfilesModuleFallback,
  initProfile,
  loadProfile,
  resolveProfileDir,
} from "@deepseek-ai/dsh-app-boot";
import type { Context } from "@deepseek-ai/cordis";
import type { DshWebHostBootRecord, MinimalDshWebHost } from "./dsh-web-host.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * user patch 层：非交互宿主只覆盖 web-runtime 的非 flag 语义（不打印 URL、不注册
 * web-surface 上下文）。webserver 配置走真实 webStartup 服务（见 prepare 的
 * cmdlineArgs 注入），不在这里伪造。
 */
const OFFICIAL_PROFILE_USER_PATCH = `# skill-creator 非交互宿主覆盖（server 值走真实 webStartup flags）
- id: web-runtime
  config:
    openBrowser: false
    printUrl: false
    surfaceContext: false
`;

export interface OfficialWebProfileOptions {
  /** DSH_HOME（调用方负责隔离；profile 与 module fallback 都写在这里）。 */
  home: string;
  /** 追加到 user patch 之上的补丁层（例如追加 Manager client plugin row）。 */
  extraPatches?: string;
}

/**
 * 以官方 profile 机制启动完整 web 组合（base + web-app bundles）。
 * 返回与最小宿主一致的探针面；任何 entry 激活失败都会 reject。
 */
export async function bootOfficialWebProfile(
  options: OfficialWebProfileOptions,
): Promise<MinimalDshWebHost> {
  // 存储隔离（2026-09-06 实测教训）：dsh-session-persistence/workspace 等 storage 单元
  // 经 resolveDshHome()（env DSH_HOME ?? ~/.dsh）定位 storages 目录，不看本函数的
  // home 参数——不设 env 时嵌入式组合会污染用户真实 ~/.dsh/storages。宿主在 boot
  // 前固定 env 到本次 home，dispose 恢复原值（含删除原值场景）。
  const previousDshHome = process.env.DSH_HOME;
  process.env.DSH_HOME = options.home;
  const profileDir = resolveProfileDir("web", options.home);
  initProfile(profileDir, ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"], "startup");
  fs.writeFileSync(
    path.join(profileDir, "cordis.patch.yml"),
    options.extraPatches
      ? `${OFFICIAL_PROFILE_USER_PATCH}\n${options.extraPatches}\n`
      : `${OFFICIAL_PROFILE_USER_PATCH}\n`,
    "utf8",
  );

  const installAnchor = path.join(repoRoot, "package.json");
  const profile = loadProfile("skill-creator", "web", installAnchor, options.home);
  // 把本安装（repo node_modules）的依赖闭包镜像到 $DSH_HOME/profiles/node_modules，
  // 使 profile rows 的裸包名经 Node parent-walk 可解析。
  await healProfilesModuleFallback({ installAnchor, profile, home: options.home });

  // base config：空 entry list——base/web 两个 bundle patch 的 insert 会组出全部 rows。
  const configPath = path.join(profileDir, "cordis.yml");
  fs.writeFileSync(configPath, "[]\n", "utf8");

  const patches = [...profile.layers.flatMap((layer) => layer.patches), ...profile.patches];
  // launcher seam：等价 dsh-cmdline 的 provideCmdline——在 tree mount 前提供
  // cmdlineArgs/appExit，让官方 web-startup 真实解析 flags 并 provide webStartup
  // （--port 0 → OS-assigned）。appExit 不能 process.exit（宿主进程内嵌），转为异常。
  const prepare = (ctx: Context): void => {
    ctx.provide("cmdlineArgs", { get: () => ["--no-open", "--port", "0"] as string[] });
    ctx.provide("appExit", (code?: number) => {
      throw new Error(`official profile requested app exit (${code ?? 0})`);
    });
  };
  const ctx = await boot(
    "skill-creator",
    configPath,
    patches,
    prepare,
    new URL(".", import.meta.url).href,
  );

  const webServer = (
    ctx as Context & {
      webServer?: { host: string; port: number; server?: import("node:http").Server };
    }
  ).webServer;
  const connection = (
    ctx as Context & { connection?: { authenticatedUrl: (url: string) => string } }
  ).connection;
  if (!webServer) throw new Error("official profile booted without a webServer service");
  if (!connection) throw new Error("official profile booted without a connection service");

  const baseUrl = `http://${webServer.host}:${webServer.port}`;
  const record: DshWebHostBootRecord = {
    entries: [],
    activationOrder: [],
    host: webServer.host,
    port: webServer.port,
    authenticatedUrl: connection.authenticatedUrl(baseUrl),
  };

  return {
    ctx,
    record,
    server: () => webServer.server,
    dispose: async () => {
      const server = webServer.server;
      await new Promise<void>((resolve) => {
        if (!server || !server.listening) return resolve();
        server.close(() => resolve());
      });
      await (ctx as unknown as { fiber?: { dispose: () => Promise<void> } }).fiber?.dispose();
      if (previousDshHome === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = previousDshHome;
    },
  };
}
