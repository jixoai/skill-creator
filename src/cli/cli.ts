#!/usr/bin/env node
/**
 * 原始需求 [2026-07-14]：「参考 ../../pnpm-pub 这个项目的架构：cli+gui(webui+opentray)，基于 ../ccski 这个 sdk 来快速搭建一个 “skills 管理器”。」
 * 用户原始需求 [2026-07-22]：「同意，但是改成 `skill-creator openinbrowser`。」
 * 用户原始需求 [2026-09-17]：「`skill-creator search <query...>` 进程内完成（不要求 daemon），
 * 支持 --json 与 --limit；空 query 或 flag 解析失败 exit 1。」
 * 修订 [2026-09-22]（wiki-directory-standard 2.3 spec）：`skill-creator wiki <子命令>`
 * 经 skill-wiki cli-kit 组装——--workspace 支持 registry label/ws_id 只读解析与
 * 路径直传；含 scopes 扩展命令；进程内执行（无 daemon 依赖）。
 * 修订 [2026-09-25]（skill-wiki-maintainer tasks 1.5）：`wiki distill` 扩展命令经
 * daemon RPC（wiki.distill.start/status）驱动——蒸馏是 daemon 编排，不本地起服务。
 * 正交意图：
 * 1. 解析并路由公开 CLI 命令。
 * 2. 通过带版本、运行时校验的 IPC 协议调用 daemon。
 * 3. 安全启动、替换或恢复 tray 已失联的分离运行 daemon。
 * 4. 向终端投影 daemon 与 tray 状态，并只由显式命令打开系统浏览器。
 * 5. 进程内子命令装配（不 import kernel/MCP/domain，动态 import 延迟加载）：
 *    search 的 query/flag 解析与结果投影；wiki 的 createWikiCli 宿主插槽注入
 *    （registry 只读 scope 解析 + scopes 全局视角命令 + distill 命令单元的
 *    source 解析与 daemon RPC 装配，实现物理隔离在 src/cli/wiki-distill.ts）
 *    与退出码透传。
 *
 * Routing:
 *   skill-creator start   -> spawn daemon + open tray window
 *   skill-creator open    -> show/focus the tray window of a running daemon
 *   skill-creator openinbrowser -> open the running daemon WebUI in the system browser
 *   skill-creator status  -> query daemon status
 *   skill-creator stop    -> graceful daemon shutdown
 *   skill-creator search  -> in-process BM25 skill search (no daemon)
 *   skill-creator wiki    -> in-process skill-wiki kit subcommands (no daemon),
 *                            except `wiki distill` which drives the daemon RPC
 *   skill-creator help    -> print command help
 *   skill-creator version -> print version
 *
 * 妥协声明：CLI 必须同时承载解析、IPC 生命周期与终端投影，拆成多个
 * 进程入口会破坏单一命令边界；daemon 业务逻辑已物理隔离到 src/daemon/。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CliIo, WikiCliCommand } from "skill-wiki";
import type { IpcCommand } from "../shared/frame.js";
import { DaemonStatusSchema, type DaemonStatus } from "../shared/contracts/daemon.js";
import type { WorkspaceRegistryStateSchema } from "../daemon/workspace-registry/state.js";
import { resolveDevHome } from "../shared/dev-runtime.js";
import { safeParseJson } from "../shared/external-input.js";
import { openUrlInBrowser as launchBrowser } from "../shared/browser-launch.js";
import { appDir, daemonLogPath, ensureAppDirs, socketPath } from "../shared/paths.js";
import { socketAcceptsConnections } from "../shared/socket-liveness.js";
import { parseWebModeFlag, SKILL_CREATOR_WEB_ENV, type WebModeFlag } from "../shared/web-mode.js";
import { DaemonConnectionError, DaemonResponseError, requestDaemon } from "./ipc-client.js";
import { readCliVersion } from "./package-version.js";

/** Process.argv minus node + script path (matches yargs/helpers hideBin). */
function hideBin(argv: string[]): string[] {
  return argv.slice(2);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_VERSION = readCliVersion();

/** Resolve the daemon entry to spawn. Bundled uses Node; source development uses Bun. */
function resolveDaemonEntry(): string {
  const override = process.env.SKILL_CREATOR_DAEMON_ENTRY;
  if (override) return override;
  const bundled = path.join(__dirname, "daemon.js");
  if (fs.existsSync(bundled)) return bundled;
  // Dev fallback: the TypeScript source runs directly through Bun.
  return path.join(__dirname, "..", "daemon", "main.ts");
}

/**
 * Spawn the daemon detached so it outlives the CLI process.
 *
 * `webFlag` 仅在用户显式传 `--web`/`--no-web` 时注入 `SKILL_CREATOR_WEB` env；
 * undefined 时 daemon 侧按平台默认（Linux=true）自行裁决。
 * 源码态 runtime（Windows 测试债 2026-09-25）：Windows 版 Bun（1.3.14）尚无
 * `node:sqlite` 内建（daemon 搜索索引后端依赖，Node 24 内置）——bun 直跑
 * main.ts 即刻死于 "No such built-in module"，daemon.log 都来不及写。win32 的
 * .ts entry 改经 Node + tsx loader（与开发 CLI 同一加载方式，tsx 自仓内
 * node_modules 解析）启动；POSIX 开发流维持 Bun 直跑不变。
 */
function spawnDaemon(webFlag: WebModeFlag = undefined): void {
  const entry = resolveDaemonEntry();
  const isTs = entry.endsWith(".ts");
  const baseEnv = { ...process.env };
  const env =
    webFlag === undefined ? baseEnv : { ...baseEnv, [SKILL_CREATOR_WEB_ENV]: webFlag ? "1" : "0" };
  const nodeTsx = isTs && process.platform === "win32";
  const command = isTs && !nodeTsx ? "bun" : process.execPath;
  const args = nodeTsx ? ["--import", "tsx", entry] : [entry];
  const child = spawn(command, args, { detached: true, stdio: "ignore", env });
  child.unref();
}

/** Send one versioned IPC request and validate its response. */
async function ipcRequest(
  command: IpcCommand,
  timeoutMs = 4000,
  endpoint = socketPath(),
): Promise<unknown> {
  try {
    return await requestDaemon({
      socket: endpoint,
      clientVersion: CLI_VERSION,
      command,
      timeoutMs,
    });
  } catch (error) {
    if (error instanceof DaemonConnectionError) {
      throw new DaemonConnectionError(`${error.message}. Run 'skill-creator start' first.`);
    }
    throw error;
  }
}

/** Query and runtime-validate the daemon status projection. */
async function requestStatus(timeoutMs = 4000): Promise<DaemonStatus> {
  const value = await ipcRequest({ type: "status" }, timeoutMs);
  const parsed = DaemonStatusSchema.safeParse(value);
  if (!parsed.success) throw new DaemonResponseError("Daemon returned an invalid status response.");
  return parsed.data;
}

/**
 * Wait for the current daemon to converge, then open its surface.
 *
 * - `mounted`：发 IPC open，让 daemon 显示原生窗口。
 * - `web`：CLI 直接打开系统浏览器（daemon 的 tray 菜单点击才走 daemon 端打开）。
 * - `headless`：不打开，交由调用方提示 `openinbrowser`。
 */
async function waitForCurrentDaemonToOpen(maxMs = 8000): Promise<DaemonStatus | null> {
  const deadline = Date.now() + maxMs;
  let lastOpenError: Error | null = null;
  while (Date.now() < deadline) {
    try {
      const status = await requestStatus(500);
      if (status.version !== CLI_VERSION) {
        throw new DaemonResponseError(
          `Daemon ${status.version} still owns the socket; expected ${CLI_VERSION}.`,
        );
      }
      if (isDaemonReady(status)) {
        if (status.tray === "mounted") {
          try {
            await ipcRequest({ type: "open" }, 500);
            return status;
          } catch (error) {
            if (!(error instanceof Error)) throw new Error(String(error));
            lastOpenError = error;
          }
        } else if (status.tray === "web") {
          await openUrlInBrowser(webUrl(status));
          return status;
        } else {
          return status;
        }
      }
    } catch (error) {
      if (!(error instanceof DaemonConnectionError)) throw error;
    }
    await sleep(100);
  }
  if (lastOpenError) {
    throw new DaemonResponseError(`Daemon mounted but could not open: ${lastOpenError.message}`);
  }
  return null;
}

function isDaemonReady(status: DaemonStatus): boolean {
  // `starting` 尚不能决定原生窗口或 headless 提示；等待 tray 收敛为终态。
  return status.active && status.port > 0 && status.tray !== "starting";
}

/** Return the authenticated daemon WebUI URL. */
function webUrl(status: DaemonStatus): string {
  return status.webUrl ?? `http://127.0.0.1:${status.port}/`;
}

/** 在系统默认浏览器中打开 URL，并向终端投影结果；返回 launcher 是否成功启动。 */
async function openUrlInBrowser(url: string): Promise<boolean> {
  const result = await launchBrowser(url);
  if (result.opened) {
    console.log(`Opening browser: ${url}`);
    return true;
  }
  console.log(`Open this URL in your browser: ${url}`);
  console.error(`Failed to launch browser: ${result.error ?? "unknown error"}`);
  return false;
}

/** Wait until graceful shutdown has removed the socket from the runtime namespace. */
async function waitForDaemonRelease(maxMs = 8000, endpoint = socketPath()): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const acceptsConnections = await socketAcceptsConnections(endpoint);
    const socketRemoved = process.platform === "win32" || !fs.existsSync(endpoint);
    if (!acceptsConnections && socketRemoved) return true;
    await sleep(100);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runStart(): Promise<number> {
  ensureAppDirs();
  const webFlag = parseWebModeFlag(hideBin(process.argv));
  let runningStatus: DaemonStatus | null = null;
  let spawned = false;
  try {
    runningStatus = await requestStatus(1500);
  } catch (error) {
    if (!(error instanceof DaemonConnectionError)) {
      console.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }

  if (runningStatus && runningStatus.version !== CLI_VERSION) {
    console.log(`replacing daemon ${runningStatus.version} with ${CLI_VERSION}...`);
    try {
      await ipcRequest({ type: "stop" });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
    if (!(await waitForDaemonRelease())) {
      console.error("Timed out waiting for the previous daemon socket to be released.");
      return 1;
    }
    runningStatus = null;
  }

  if (runningStatus?.tray === "mounted") {
    try {
      await ipcRequest({ type: "open" }, 750);
      console.log("skill-creator daemon is already running.");
      console.log("Opening the tray window…");
      return 0;
    } catch {
      console.log("restarting daemon because its tray runtime is unavailable...");
      try {
        await ipcRequest({ type: "stop" });
      } catch (stopError) {
        console.error(stopError instanceof Error ? stopError.message : String(stopError));
        return 1;
      }
      if (!(await waitForDaemonRelease())) {
        console.error("Timed out waiting for the unavailable daemon to release its socket.");
        return 1;
      }
      runningStatus = null;
    }
  }

  // 已运行的 web 模式 daemon：CLI 直接打开浏览器，不重开 daemon。
  if (runningStatus?.tray === "web") {
    await openUrlInBrowser(webUrl(runningStatus));
    console.log("skill-creator daemon is already running.");
    console.log("Opening the WebUI in your browser…");
    return 0;
  }

  if (!runningStatus) {
    spawnDaemon(webFlag);
    spawned = true;
  }

  let readyStatus: DaemonStatus | null = null;
  try {
    readyStatus = await waitForCurrentDaemonToOpen();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  if (!readyStatus) {
    console.error(
      spawned
        ? `Failed to start the daemon. Check ${daemonLogPath()}`
        : "Timed out waiting for the daemon to finish starting.",
    );
    return 1;
  }

  if (spawned) {
    console.log("skill-creator daemon started.");
  } else {
    console.log("skill-creator daemon is already running.");
  }
  if (readyStatus.tray === "mounted") {
    console.log("Opening the tray window…");
  } else if (readyStatus.tray === "web") {
    // waitForCurrentDaemonToOpen 已在 web 状态下打开浏览器；这里只投影终态。
    console.log("The WebUI is opening in your browser.");
  } else {
    console.log(
      "The daemon is running headlessly. Run 'skill-creator openinbrowser' to open the WebUI.",
    );
  }
  return 0;
}

async function runStatus(): Promise<number> {
  try {
    const status = await requestStatus();
    if (hideBin(process.argv).includes("--json")) {
      // 安装态取证（4.8）：完整 DaemonStatus JSON（含 DSH entries/activationOrder 诊断面）。
      console.log(JSON.stringify(status, null, 2));
      return 0;
    }
    const url = webUrl(status);
    const trayLabel =
      status.tray === "headless"
        ? "headless (browser mode)"
        : status.tray === "web"
          ? "web (tray + browser)"
          : status.tray;
    console.log("skill-creator daemon is running:");
    console.log(`  pid:     ${status.pid}`);
    console.log(`  version: ${status.version}`);
    console.log(`  port:    ${status.port}`);
    console.log(`  tray:    ${trayLabel}`);
    if (status.trayError) console.log(`  tray error: ${status.trayError}`);
    // DSH 宿主行（4.8）：安装态取证需要 black-box 可见的组合宿主健康面。
    if (status.dsh) {
      console.log(
        status.dsh.mounted
          ? `  dsh:     mounted (port ${status.dsh.port ?? "?"}, ${status.dsh.entries?.length ?? 0} entries)`
          : `  dsh:     unavailable (${status.dsh.reason ?? "unknown reason"})`,
      );
    }
    console.log(`  url:     ${url}`);
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

async function runStop(): Promise<number> {
  const productionEndpoint = socketPath();
  const developmentEndpoint = socketPath(resolveDevHome());
  const runtimes = [
    { kind: "production" as const, endpoint: productionEndpoint },
    ...(developmentEndpoint === productionEndpoint
      ? []
      : [{ kind: "development" as const, endpoint: developmentEndpoint }]),
  ];
  const stopped: Array<(typeof runtimes)[number]["kind"]> = [];

  for (const runtime of runtimes) {
    if (!(await socketAcceptsConnections(runtime.endpoint, 100))) continue;
    try {
      await ipcRequest({ type: "stop" }, 4_000, runtime.endpoint);
      if (!(await waitForDaemonRelease(8_000, runtime.endpoint))) {
        console.error(
          `${runtime.kind} daemon accepted the stop request but did not release ${runtime.endpoint}.`,
        );
        return 1;
      }
      stopped.push(runtime.kind);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      return 1;
    }
  }

  if (stopped.length === 0) {
    const endpoints = runtimes.map((runtime) => runtime.endpoint).join(", ");
    console.error(
      `cannot reach a Skill Creator daemon (${endpoints}). Run 'skill-creator start' first.`,
    );
    return 1;
  }

  for (const kind of stopped) {
    console.log(
      kind === "development"
        ? "skill-creator development daemon stopped."
        : "skill-creator daemon stopped.",
    );
  }
  return 0;
}

async function runOpen(): Promise<number> {
  try {
    const status = await requestStatus();
    if (status.tray === "mounted") {
      await ipcRequest({ type: "open" });
      console.log("Opening the tray window…");
      return 0;
    }
    if (status.tray === "web") {
      // web 模式无原生窗口；open 降级为打开浏览器（贴合用户「打开应用」的直觉）。
      return (await openUrlInBrowser(webUrl(status))) ? 0 : 1;
    }
    if (status.tray === "headless") {
      console.error(
        "The daemon is running headlessly. Run 'skill-creator openinbrowser' to open the WebUI.",
      );
      return 1;
    }
    console.error(
      "The native window is still starting. Run 'skill-creator open' again after it mounts.",
    );
    return 1;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

/** Open the running daemon WebUI in the system browser only on explicit request. */
async function runOpenInBrowser(): Promise<number> {
  try {
    const status = await requestStatus();
    if (!status.active || status.port === 0) {
      console.error(
        "The daemon WebUI is still starting. Run 'skill-creator openinbrowser' again shortly.",
      );
      return 1;
    }
    return (await openUrlInBrowser(webUrl(status))) ? 0 : 1;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

interface SearchArguments {
  json: boolean;
  limit: number;
  query: string;
}

/** 解析 `search` 之后的 token：非 flag 拼 query；--json；--limit N / --limit=N（1..50）。 */
function parseSearchArguments(rest: string[]): SearchArguments | null {
  let json = false;
  let limit: number | undefined;
  const queryParts: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === "--json") {
      json = true;
      continue;
    }
    const limitMatch = /^--limit(?:=(.*))?$/.exec(token);
    if (limitMatch) {
      const raw = limitMatch[1] ?? rest[++i];
      if (raw === undefined || !/^[1-9]\d*$/.test(raw)) return null;
      const parsed = Number(raw);
      if (parsed < 1 || parsed > 50) return null;
      limit = parsed;
      continue;
    }
    if (token.startsWith("-")) return null;
    queryParts.push(token);
  }
  const query = queryParts.join(" ").trim();
  if (query === "") return null;
  return { json, limit: limit ?? 10, query };
}

/**
 * `skill-creator search <query...> [--json] [--limit N]`：进程内完成扫描/索引/查询，
 * 不要求 daemon（动态 import 只装配 workspace registry 持久态 + search service）。
 * 退出码：查询成功（含 0 结果）0；空 query / flag 解析失败 / 索引 IO 故障 1。
 */
async function runSearch(): Promise<number> {
  const argv = hideBin(process.argv);
  const rest = argv.slice(argv.indexOf("search") + 1);
  const parsedArgs = parseSearchArguments(rest);
  if (!parsedArgs) {
    console.error(
      "Usage: skill-creator search <query...> [--json] [--limit N]  (limit: 1-50, default 10)",
    );
    return 1;
  }
  const startedAt = Date.now();
  try {
    const { createSkillSearchService } = await import("../daemon/skill-search/service.js");
    const service = createSkillSearchService();
    const results = await service.search(parsedArgs.query, { limit: parsedArgs.limit });
    if (parsedArgs.json) {
      // JSON 模式 stdout 仅含合法 JSON；人读诊断走 stderr。
      console.log(JSON.stringify({ results }));
    } else {
      printSearchResults(results, parsedArgs.limit);
    }
    console.error(
      `${results.length} result(s) for "${parsedArgs.query}" in ${Date.now() - startedAt}ms (limit ${parsedArgs.limit})`,
    );
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function printSearchResults(
  results: Array<{
    name: string;
    description: string;
    canonicalPath: string;
    score: number;
    installations: Array<{ path: string }>;
    duplicates: Array<{ canonicalPath: string }>;
  }>,
  limit: number,
): void {
  if (results.length === 0) {
    console.log(`No skills matched (limit ${limit}).`);
    return;
  }
  results.forEach((result, index) => {
    console.log(`${index + 1}. ${result.name}  (${result.score.toFixed(4)})`);
    if (result.description) console.log(`   ${result.description}`);
    console.log(`   ${result.canonicalPath}`);
    console.log(`   installations: ${result.installations.length}`);
    for (const duplicate of result.duplicates) {
      console.log(`   duplicate: ${duplicate.canonicalPath}`);
    }
  });
}

interface CommandDefinition {
  description: string;
  run: () => number | Promise<number>;
}

/** wiki 子命令的 registry 投影行（label 解析与 scopes 共用；进程内只读）。 */
interface WikiRegistryEntry {
  id: string;
  label: string;
  path: string;
}

/** wiki 子命令的 scope 行（scopes 输出形状）。 */
interface WikiScopeRow {
  id: string;
  label: string;
  workspacePath: string;
  exists: boolean;
  patternCount: number;
  lastUpdated: string | null;
}

/**
 * 路径形状判定（resolveScope 与 resolveDistillSource 共用口径）：`~`（global）、
 * 绝对路径、./ ../ . .. 前缀、或含任一平台分隔符（codex r1 P2：Windows 的
 * `.\foo`/`foo\bar` 曾落入 label 匹配）。
 */
function isPathShapedRef(trimmed: string): boolean {
  return (
    trimmed === "~" ||
    trimmed === "." ||
    trimmed === ".." ||
    path.isAbsolute(trimmed) ||
    trimmed.includes("/") ||
    trimmed.includes("\\")
  );
}

/**
 * 进程内只读读取 workspaces.json（appDir 受 SKILL_CREATOR_HOME 尊重）：
 * 文件缺失（仅 ENOENT）/ JSON 或 schema 不兼容 → 空注册面（label 解析退化
 * 为零匹配）；其它读取 IO 故障（EACCES/EIO 等）→ 上抛（非用法错误，不
 * 伪装成空 registry——codex r1 P2：existsSync 会吞权限/IO 故障，禁用）。
 */
function loadWikiRegistryEntries(
  stateSchema: typeof WorkspaceRegistryStateSchema,
): WikiRegistryEntry[] {
  const file = path.join(appDir(), "workspaces.json");
  let source: string;
  try {
    source = fs.readFileSync(file, "utf8");
  } catch (error) {
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
    if (code === "ENOENT") return [];
    throw new Error(
      `cannot read workspace registry ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const parsed = safeParseJson(source, stateSchema);
  return parsed ? parsed.workspaces : [];
}

/** skill-creator wiki 的进程 IO 适配（kit 纯函数面 ↔ process.*）。 */
function processWikiIo(): CliIo {
  return {
    readStdin: async (): Promise<string> => {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk as Buffer);
      }
      return Buffer.concat(chunks).toString("utf8");
    },
    stdout: (text: string): void => {
      process.stdout.write(text);
    },
    stderr: (text: string): void => {
      process.stderr.write(text);
    },
  };
}

/**
 * `skill-creator wiki <子命令>`（wiki-directory-standard 2.3）：argv 中 wiki 之后
 * 的部分交给 createWikiCli 组装实例。退出码透传 wiki 域（2/3/4/5）；scope 解析
 * 失败（label 歧义/零匹配）统一用法错误 exit 2。进程内执行，无 daemon 依赖；
 * 唯一例外 `wiki distill`（task 1.5）——蒸馏是 daemon 编排，经 wiki.distill RPC。
 */
async function runWiki(): Promise<number> {
  const [wikiKit, registryState, distillModule] = await Promise.all([
    import("skill-wiki"),
    import("../daemon/workspace-registry/state.js"),
    import("./wiki-distill.js"),
  ]);
  const {
    createWikiCli,
    globalWikiDirectory,
    resolveWikiDirectory,
    wikiPatternSummary,
    workspaceWikiDirectory,
    WikiUsageError,
  } = wikiKit;
  const argv = hideBin(process.argv);
  const rest = argv.slice(argv.indexOf("wiki") + 1);
  const stateSchema = registryState.WorkspaceRegistryStateSchema;

  /** wiki 目录 → 存在性 + 只读摘要（不创建 patterns/，codex r1 P1）。 */
  const wikiScopeFacts = (
    wikiDirectory: string,
  ): { exists: boolean } & ReturnType<typeof wikiPatternSummary> => ({
    exists: fs.existsSync(wikiDirectory),
    ...wikiPatternSummary(wikiDirectory),
  });

  /** resolveScope（registry 只读解析）：`~`/路径直传默认解析；裸 token = label 前缀或 ws_* id。 */
  const resolveScope = async ({ requested }: { requested?: string }): Promise<string> => {
    const trimmed = (requested ?? "./").trim();
    // 非法形状（空/纯空白/NUL）交默认解析收窄为 typed WIKI_INVALID_SCOPE（exit 3）。
    if (trimmed.length === 0 || trimmed.includes("\0")) return resolveWikiDirectory(trimmed);
    if (isPathShapedRef(trimmed)) {
      return resolveWikiDirectory(trimmed);
    }
    const entries = loadWikiRegistryEntries(stateSchema);
    const idMatches = entries.filter((entry) => entry.id === trimmed);
    const matches =
      idMatches.length > 0
        ? idMatches
        : entries.filter((entry) => entry.label.toLowerCase().startsWith(trimmed.toLowerCase()));
    if (matches.length === 1) return workspaceWikiDirectory(matches[0].path);
    if (matches.length > 1) {
      throw new WikiUsageError(
        `ambiguous workspace "${trimmed}": matches ${matches
          .map((entry) => `"${entry.label}" (${entry.id})`)
          .join(", ")}`,
      );
    }
    const known = entries.map((entry) => entry.id).join(", ");
    throw new WikiUsageError(
      `no workspace matches "${trimmed}" (${known ? `registered: ${known}` : "registry is empty"}; ` +
        'use a path, "~" for global, or "./" for the current directory)',
    );
  };

  /** scopes：global + registry 全部 workspace 的只读摘要（全局视角）。 */
  const scopes: WikiCliCommand = {
    usage: "[--json]",
    minPositionals: 0,
    maxPositionals: 0,
    run: (ctx) => {
      const rows: WikiScopeRow[] = [
        {
          id: "~",
          label: "global",
          workspacePath: "~",
          ...wikiScopeFacts(globalWikiDirectory()),
        },
        ...loadWikiRegistryEntries(stateSchema).map((entry) => ({
          id: entry.id,
          label: entry.label,
          workspacePath: entry.path,
          ...wikiScopeFacts(workspaceWikiDirectory(entry.path)),
        })),
      ];
      if (ctx.options.has("json")) {
        ctx.io.stdout(`${JSON.stringify({ scopes: rows }, null, 2)}\n`);
      } else {
        ctx.io.stdout(
          `${"scope".padEnd(28)}${"label".padEnd(18)}${"patterns".padStart(8)}  ${"last updated".padEnd(24)}workspace\n`,
        );
        for (const row of rows) {
          const missing = row.exists ? "" : "  (missing)";
          ctx.io.stdout(
            `${row.id.padEnd(28)}${row.label.padEnd(18)}${String(row.patternCount).padStart(8)}  ` +
              `${(row.lastUpdated ?? "—").padEnd(24)}${row.workspacePath}${missing}\n`,
          );
        }
      }
      return 0;
    },
  };

  /**
   * distill 的 source 解析（task 1.5）：裸 token = ws_* id 精确或 label 前缀
   * （与 resolveScope 同口径，但返回 WorkspaceId 而非 wiki 目录）；路径形状
   * （含缺省 `./`）→ realpath 反查 registry；`~`/未注册路径 → 用法错误
   * （start 只接受 Imported Workspace——global 无 source patterns）。
   */
  const resolveDistillSource = async (requested: string | undefined): Promise<string> => {
    const trimmed = (requested ?? "./").trim();
    if (trimmed.length > 0 && !trimmed.includes("\0") && !isPathShapedRef(trimmed)) {
      const entries = loadWikiRegistryEntries(stateSchema);
      const idMatches = entries.filter((entry) => entry.id === trimmed);
      const matches =
        idMatches.length > 0
          ? idMatches
          : entries.filter((entry) => entry.label.toLowerCase().startsWith(trimmed.toLowerCase()));
      if (matches.length === 1) return matches[0].id;
      if (matches.length > 1) {
        throw new WikiUsageError(
          `ambiguous workspace "${trimmed}": matches ${matches
            .map((entry) => `"${entry.label}" (${entry.id})`)
            .join(", ")}`,
        );
      }
      const known = entries.map((entry) => entry.id).join(", ");
      throw new WikiUsageError(
        `no workspace matches "${trimmed}" (${known ? `registered: ${known}` : "registry is empty"}; ` +
          "distill requires a registered imported workspace)",
      );
    }
    if (trimmed === "~") {
      throw new WikiUsageError(
        'distill source must be a registered imported workspace ("~" is the global scope and has no source patterns)',
      );
    }
    if (trimmed.length === 0 || trimmed.includes("\0")) {
      throw new WikiUsageError("distill requires a --workspace reference");
    }
    let resolved: string;
    try {
      resolved = fs.realpathSync(path.resolve(trimmed));
    } catch (error) {
      throw new WikiUsageError(
        `cannot resolve workspace path "${trimmed}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    for (const entry of loadWikiRegistryEntries(stateSchema)) {
      let registered: string | null = null;
      try {
        registered = fs.realpathSync(entry.path);
      } catch {
        continue; // 注册目录已消失：跳过（可用性由 workspace.list 投影呈现）
      }
      if (registered === resolved) return entry.id;
    }
    throw new WikiUsageError(
      `"${trimmed}" is not a registered imported workspace (register it in the Workspaces app, ` +
        "or address it by label/ws_* id)",
    );
  };

  const cli = createWikiCli({
    commandPrefix: "skill-creator wiki",
    resolveScope,
    extraCommands: {
      scopes,
      distill: distillModule.createWikiDistillCommand({
        requestStatus,
        resolveSource: resolveDistillSource,
        cliVersion: CLI_VERSION,
      }),
    },
  });
  return cli.run(rest, processWikiIo());
}

const COMMANDS = {
  start: { description: "Boot the daemon and open the tray window", run: runStart },
  open: { description: "Show/focus the tray window of a running daemon", run: runOpen },
  openinbrowser: {
    description: "Open the running WebUI in the system browser",
    run: runOpenInBrowser,
  },
  status: { description: "Check the running daemon", run: runStatus },
  stop: { description: "Gracefully stop the daemon", run: runStop },
  search: {
    description: "Search local skills (BM25 + skill tokenizer)",
    run: () => runSearch(),
  },
  wiki: {
    description:
      "Persistent agent-experience wiki (list/show/add/find/edit/remove/log/impact/scopes/distill)",
    run: () => runWiki(),
  },
  mcp: {
    description: "Run the skill-creator MCP server over stdio (readonly face)",
    run: () => {
      void runMcpStdio();
      return 0;
    },
  },
  version: {
    description: "Print the version",
    run: () => {
      console.log(CLI_VERSION);
      return 0;
    },
  },
  help: {
    description: "Show this help",
    run: () => {
      printHelp();
      return 0;
    },
  },
} as const satisfies Record<string, CommandDefinition>;

type CommandName = keyof typeof COMMANDS;

function isCommandName(value: string): value is CommandName {
  return Object.hasOwn(COMMANDS, value);
}

function printHelp(): void {
  const lines = Object.entries(COMMANDS)
    .map(([name, command]) => `  skill-creator ${name.padEnd(14)} ${command.description}`)
    .join("\n");
  console.log(`skill-creator — skills manager (CLI + tray WebUI)\n\nUsage:\n${lines}\n`);
}

async function main(): Promise<number> {
  const argv = hideBin(process.argv);
  const command = argv.find((a) => !a.startsWith("-"));

  if (!command || !isCommandName(command)) {
    if (argv.includes("-v") || argv.includes("--version")) {
      console.log(CLI_VERSION);
      return 0;
    }
    printHelp();
    return command ? 1 : 0;
  }

  return COMMANDS[command].run();
}

/**
 * `skill-creator mcp`（task 4.1 形态 B）：stdio transport，不依赖 daemon 常驻——
 * 进程内自建 domain（无 IPC/HTTP/tray）。面收窄为 readonly + propose-only：
 * mutation 仅经形态 A 的 daemon 审批链。
 * skill-refs-and-platform-fixes C3：SDK v2 的 serveStdio 入口（开场交换按连接
 * 选纪元——stdio 客户端单连接单纪元，与 HTTP 双纪元入口不同源）。
 */
async function runMcpStdio(): Promise<void> {
  const { serveStdio } = await import("@modelcontextprotocol/server/stdio");
  const { createDaemonDomain } = await import("../daemon/domain.js");
  const { createSkillCreatorMcpServer } = await import("../daemon/mcp/skill-creator-mcp.js");
  const domain = createDaemonDomain();
  console.error("skill-creator mcp: stdio server ready (readonly face)");
  await serveStdio(() =>
    // stdio 无 UI 宿主：不注入卡片注册表（wiki_read 等附卡能力降级纯文本，
    // 不发 client 无法解析的 ui:// 悬挂引用——codex r1 P2-1）。
    createSkillCreatorMcpServer({
      capabilities: domain.managerCapabilities,
      face: "stdio",
    }),
  );
}

void main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
