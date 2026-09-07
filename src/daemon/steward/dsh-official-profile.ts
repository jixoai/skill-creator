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

const modulePath = fileURLToPath(import.meta.url);
const sourceMode = path.basename(modulePath) === "dsh-official-profile.ts";
/** 源码态 = 仓库根；bundle 态（dist/daemon.js）= 安装包根。 */
const repoRoot = sourceMode
  ? path.resolve(path.dirname(modulePath), "../../..")
  : path.resolve(path.dirname(modulePath), "..");

/**
 * user patch 层：非交互宿主只覆盖 web-runtime 的非 flag 语义（不打印 URL、不注册
 * web-surface 上下文）。webserver 配置走真实 webStartup 服务（见 prepare 的
 * cmdlineArgs 注入），不在这里伪造。skill-creator-manager 行把 Manager client
 * plugin（task 3.1a：sidebar footer island 入口）加入官方组合。
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
  // 把本安装（repo node_modules / 安装包 node_modules）的依赖闭包镜像到
  // $DSH_HOME/profiles/node_modules，使 profile rows 的裸包名经 Node parent-walk 可解析。
  await healProfilesModuleFallback({ installAnchor, profile, home: options.home });
  // Manager client plugin 行（task 3.1a）：dev 态插件是 root devDependency（workspace 链接），
  // 安装态由构建 vendor 到 dist/dsh-client（4.8：产物不得依赖 workspace 链接）。两个位置都
  // 接入：profile node_modules（heal 机制同构）+ bundle 态的 dist/node_modules（cordis
  // loader 以 boot baseUrl = dist/ 起步 parent-walk 解析 rows 的实测路径）。
  {
    const devPlugin = path.join(repoRoot, "node_modules", "@skill-creator", "dsh-client");
    const vendoredPlugin = path.join(repoRoot, "dist", "dsh-client");
    const pluginSource = fs.existsSync(devPlugin) ? devPlugin : vendoredPlugin;
    if (!fs.existsSync(pluginSource)) {
      throw new Error(
        `Manager DSH client plugin not found (looked for ${devPlugin} and ${vendoredPlugin})`,
      );
    }
    const target = fs.realpathSync(pluginSource);
    const profileLink = path.join(
      options.home,
      "profiles",
      "node_modules",
      "@skill-creator",
      "dsh-client",
    );
    ensureDirLink(profileLink, target);
    if (!sourceMode) {
      // npm 安装布局的 loader 解析路径（4.8 实测）：cordis loader 以自身模块位置
      // parent-walk 解析 row 包名——pnpm 虚拟 store 位于根 node_modules 内，天然
      // 命中 workspace 链接；npm 把依赖铺在消费者 app/node_modules，vendored
      // 插件必须出现在同一路径上才可被 import。链接目标始终是本安装包内的
      // dist/dsh-client（无本地源码/未发布包依赖）；符号链接不可用时退化为拷贝。
      const parentOfPackage = path.dirname(repoRoot);
      if (path.basename(parentOfPackage) === "node_modules") {
        const consumerLink = path.join(parentOfPackage, "@skill-creator", "dsh-client");
        try {
          ensureDirLink(consumerLink, target);
        } catch {
          fs.rmSync(consumerLink, { recursive: true, force: true });
          fs.cpSync(vendoredPlugin, consumerLink, { recursive: true });
        }
      }
    }
  }

  // base config：Manager client plugin 行（task 3.1a）——bundle patch 的 insert 会
  // 把官方 rows 组进来；user patch 层只能做 config 覆盖，新 entry 必须落在 entry list。
  const configPath = path.join(profileDir, "cordis.yml");
  fs.writeFileSync(
    configPath,
    "- id: skill-creator-manager\n  name: '@skill-creator/dsh-client'\n",
    "utf8",
  );

  const patches = [...profile.layers.flatMap((layer) => layer.patches), ...profile.patches];
  // launcher seam：等价 dsh-cmdline 的 provideCmdline——在 tree mount 前提供
  // cmdlineArgs/appExit，让官方 web-startup 真实解析 flags 并 provide webStartup
  // （--port 0 → OS-assigned）。appExit 不能 process.exit（宿主进程内嵌），转为异常。
  // boot graph：entry-init 在 Entry 构造器即触发（options/parent 尚未赋值，读取
  // getter 会抛错），事件期只收集对象引用；boot settle 后再读取 options.name 与
  // loader tree，得到真实构造序 + 组合 entry 清单。
  const constructed: Array<{ options: { id: string; name: string } }> = [];
  const prepare = (ctx: Context): void => {
    ctx.provide("cmdlineArgs", { get: () => ["--no-open", "--port", "0"] as string[] });
    ctx.provide("appExit", (code?: number) => {
      throw new Error(`official profile requested app exit (${code ?? 0})`);
    });
    (
      ctx as unknown as {
        on: (
          event: "loader/entry-init",
          listener: (entry: { options: { id: string; name: string } }) => void,
        ) => () => void;
      }
    ).on("loader/entry-init", (entry) => {
      constructed.push(entry);
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
  const treeEntries: Array<{ id: string; name: string }> = [];
  for (const entry of (
    ctx as Context & {
      loader?: { entries: () => Iterable<{ id: string; options: { name: string } }> };
    }
  ).loader?.entries() ?? []) {
    treeEntries.push({ id: entry.id, name: entry.options.name });
  }
  const record: DshWebHostBootRecord = {
    entries: treeEntries,
    activationOrder: constructed.map((entry) => entry.options.name),
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

/** 幂等目录符号链接：目标变化时替换，不变时保持（对 heal 已生成的镜像无副作用）。 */
function ensureDirLink(link: string, target: string): void {
  fs.mkdirSync(path.dirname(link), { recursive: true });
  if (fs.existsSync(link) && fs.realpathSync(link) === target) return;
  fs.rmSync(link, { recursive: true, force: true });
  fs.symlinkSync(target, link, "dir");
}
