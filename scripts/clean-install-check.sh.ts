/**
 * 用户原始需求 [2026-09-07]（steward-product-workflow 4.8）：「pack 后在仓库外的空目录
 * 安装并启动。不要仅凭 build 或 pack --dry-run 宣称可安装。」
 * 正交意图：
 *   [1] 安装面验证：npm pack → 仓库外空目录 npm install tarball，产物不得携带
 *       link:/workspace 私有包或本地源码依赖。
 *   [2] 启动面验证：隔离 HOME 全黑盒驱动已安装 cli.js（start/status --json/stop +
 *       restart），DSH 组合宿主必须真实挂载且包含 vendored Manager plugin 行。
 *   [3] 取证：HTTP 探针（health/DSH 代理分区/island 资产）、license 清单、Node
 *       版本，全部落 artifacts/clean-install.json。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const artifactsDir = path.join(
  root,
  "openspec",
  "changes",
  "steward-product-workflow",
  "artifacts",
);

interface Evidence {
  artifactVersion: 1;
  generatedAt: string;
  generator: string;
  nodeVersion: string;
  npmVersion: string;
  pack: { tarball: string; fileCount: number };
  install: {
    sandbox: string;
    exitCode: number;
    installedRoot: string;
    ccskiAbsentFromInstall: boolean;
    daemonHasNoCcskiImport: boolean;
    dshBaseResolvable: boolean;
    bundledAssets: Record<string, boolean>;
  };
  licenses: Record<string, string>;
  lifecycle: {
    startExit: number;
    dshMounted: boolean;
    dshEntries: number;
    dshHasManagerPlugin: boolean;
    dshActivationHasPlugin: boolean;
    tray: string;
    http: {
      healthOk: boolean;
      spaFallbackNotServedAtRoot: boolean;
      rootStatus: number;
      dshPortAlive: boolean;
      islandAssetOk: boolean;
    };
    stopExit: number;
    endpointReleased: boolean;
    restartStartExit: number;
    restartDshMounted: boolean;
    finalStopExit: number;
  };
}

function fail(message: string): never {
  console.error(`[clean-install] FAIL: ${message}`);
  process.exit(1);
}

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** 黑盒驱动用真实 Node（本脚本在 Bun 下运行；Bun 的 node:module 缺 stripTypeScriptTypes，DSH code-runtime 需要）。 */
const nodeBin = "node";

function run(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): RunResult {
  const result = spawnSync(command, args, { ...options, encoding: "utf8" });
  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
  };
}

const npmVersion = run("npm", ["--version"], { cwd: root, env: process.env }).stdout.trim();
// 记录黑盒驱动实际使用的 node 版本（本脚本自身跑在 Bun 下，process.version 是 Bun
// 的 Node 兼容串，不能充当运行时证据）。
const nodeVersion = run(nodeBin, ["--version"], { cwd: root, env: process.env }).stdout.trim();
const sandbox = fs.mkdtempSync("/tmp/sc-clean-install-");
const evidence: Evidence = {
  artifactVersion: 1,
  generatedAt: new Date().toISOString(),
  generator: "scripts/clean-install-check.sh.ts",
  nodeVersion,
  npmVersion,
  pack: { tarball: "", fileCount: 0 },
  install: {
    sandbox,
    exitCode: -1,
    installedRoot: "",
    ccskiAbsentFromInstall: false,
    daemonHasNoCcskiImport: false,
    dshBaseResolvable: false,
    bundledAssets: {},
  },
  licenses: {},
  lifecycle: {
    startExit: -1,
    dshMounted: false,
    dshEntries: 0,
    dshHasManagerPlugin: false,
    dshActivationHasPlugin: false,
    tray: "",
    http: {
      healthOk: false,
      spaFallbackNotServedAtRoot: false,
      rootStatus: 0,
      dshPortAlive: false,
      islandAssetOk: false,
    },
    stopExit: -1,
    endpointReleased: false,
    restartStartExit: -1,
    restartDshMounted: false,
    finalStopExit: -1,
  },
};

try {
  // —— 1. pack（prepack 触发完整 pnpm build）——
  const pack = run("npm", ["pack", "--pack-destination", sandbox], { cwd: root, env: process.env });
  if (pack.status !== 0) fail(`npm pack exit ${pack.status}\n${pack.stdout}\n${pack.stderr}`);
  const tarballName = (pack.stdout.trim().match(/skill-creator-\d+\.\d+\.\d+\.tgz$/) ?? [])[0];
  if (!tarballName) fail(`pack output has no tarball name:\n${pack.stdout}`);
  const tarball = path.join(sandbox, tarballName);
  const tarList = run("tar", ["-tzf", tarball], { cwd: sandbox, env: process.env });
  evidence.pack = {
    tarball: tarballName,
    fileCount: tarList.status === 0 ? tarList.stdout.trim().split("\n").length : 0,
  };

  // —— 2. 仓库外空目录安装（真实 npm，非 pnpm workspace 语义）——
  const installDir = path.join(sandbox, "app");
  fs.mkdirSync(installDir, { recursive: true });
  const install = run("npm", ["install", "--no-fund", "--no-audit", pathToFileURL(tarball).href], {
    cwd: installDir,
    env: process.env,
  });
  evidence.install.exitCode = install.status ?? -1;
  if (install.status !== 0) {
    fail(
      `npm install exit ${install.status} (silent link: failures exit here)\n${install.stdout}\n${install.stderr}`,
    );
  }
  const installedRoot = path.join(installDir, "node_modules", "skill-creator");
  evidence.install.installedRoot = installedRoot;
  if (!fs.existsSync(path.join(installedRoot, "dist", "daemon.js"))) {
    fail("installed package has no dist/daemon.js");
  }

  // —— 3. 安装面断言：无 link: 依赖、无 ccski 残留 import、DSH 官方包可解析 ——
  evidence.install.ccskiAbsentFromInstall = !fs.existsSync(
    path.join(installDir, "node_modules", "ccski"),
  );
  const daemonSource = fs.readFileSync(path.join(installedRoot, "dist", "daemon.js"), "utf8");
  evidence.install.daemonHasNoCcskiImport = !/from\s+"ccski"|require\("ccski"\)/.test(daemonSource);
  const resolveProbe = run(
    nodeBin,
    [
      "-e",
      `try{require.resolve('@deepseek-ai/dsh-base',{paths:[${JSON.stringify(installedRoot)}]});console.log('ok')}catch{console.log('no')}`,
    ],
    { cwd: installDir, env: process.env },
  );
  evidence.install.dshBaseResolvable = resolveProbe.stdout.trim() === "ok";
  for (const asset of [
    "dist/cli.js",
    "dist/webui/index.html",
    "dist/webui/dsh-island.js",
    "dist/dsh-client/lib/client.js",
    "dist/dsh-client/package.json",
  ]) {
    evidence.install.bundledAssets[asset] = fs.existsSync(path.join(installedRoot, asset));
  }
  if (!evidence.install.ccskiAbsentFromInstall) fail("ccski leaked into the install tree");
  if (!evidence.install.daemonHasNoCcskiImport) fail("dist/daemon.js still imports ccski");
  if (!evidence.install.dshBaseResolvable)
    fail("@deepseek-ai/dsh-base not resolvable from install");
  for (const [asset, present] of Object.entries(evidence.install.bundledAssets)) {
    if (!present) fail(`bundled asset missing: ${asset}`);
  }

  // —— 4. license 清单（bundled ccski 记录自仓库源）——
  const readLicense = (file: string): string => {
    try {
      return (JSON.parse(fs.readFileSync(file, "utf8")) as { license?: string }).license ?? "none";
    } catch {
      return "none";
    }
  };
  evidence.licenses = {
    "skill-creator": readLicense(path.join(installedRoot, "package.json")),
    "@deepseek-ai/dsh-base": readLicense(
      path.join(installDir, "node_modules", "@deepseek-ai", "dsh-base", "package.json"),
    ),
    "@deepseek-ai/cordis": readLicense(
      path.join(installDir, "node_modules", "@deepseek-ai", "cordis", "package.json"),
    ),
    "ccski (bundled into dist/daemon.js)": readLicense(
      path.join(root, "..", "ccski", "package.json"),
    ),
  };

  // —— 5. 黑盒生命周期：全部 state 在 sandbox 内，cwd 不在仓库 ——
  const cli = path.join(installedRoot, "dist", "cli.js");
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: path.join(sandbox, "home"),
    DSH_HOME: path.join(sandbox, "dsh-home"),
    OPENTRAY_HOME: path.join(sandbox, "opentray"),
    SKILL_CREATOR_HOME: path.join(sandbox, "state"),
    SKILL_CREATOR_DISABLE_TRAY: "1",
    SKILL_CREATOR_WEB: "1",
  };
  const start = run(nodeBin, [cli, "start"], { cwd: installDir, env: childEnv });
  evidence.lifecycle.startExit = start.status ?? -1;
  if (start.status !== 0)
    fail(`installed cli start exit ${start.status}\n${start.stdout}\n${start.stderr}`);

  const readStatus = (): {
    port: number;
    tray: string;
    dsh?: {
      mounted: boolean;
      entries?: string[];
      activationOrder?: string[];
      port?: number;
      reason?: string;
    };
  } => {
    const out = run(nodeBin, [cli, "status", "--json"], { cwd: installDir, env: childEnv });
    if (out.status !== 0)
      throw new Error(`status --json exit ${out.status}: ${out.stdout} ${out.stderr}`);
    return JSON.parse(out.stdout) as {
      port: number;
      tray: string;
      dsh?: {
        mounted: boolean;
        entries?: string[];
        activationOrder?: string[];
        port?: number;
        reason?: string;
      };
    };
  };
  let status = readStatus();
  const deadline = Date.now() + 90_000;
  while (status.dsh?.mounted !== true && Date.now() < deadline) {
    if (status.dsh && status.dsh.mounted === false) {
      fail(`DSH host degraded in clean install: ${status.dsh.reason}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    status = readStatus();
  }
  const dsh = status.dsh;
  evidence.lifecycle.dshMounted = dsh?.mounted === true;
  evidence.lifecycle.dshEntries = dsh?.entries?.length ?? 0;
  evidence.lifecycle.dshHasManagerPlugin = (dsh?.entries ?? []).includes(
    "@skill-creator/dsh-client",
  );
  evidence.lifecycle.dshActivationHasPlugin = (dsh?.activationOrder ?? []).includes(
    "@skill-creator/dsh-client",
  );
  evidence.lifecycle.tray = status.tray;
  if (!evidence.lifecycle.dshMounted) fail("DSH host never reached mounted in clean install");
  if (!evidence.lifecycle.dshHasManagerPlugin) {
    fail("vendored @skill-creator/dsh-client missing from DSH entries");
  }

  // —— 6. HTTP 探针：health / DSH 代理分区 / island 资产 / DSH 端口活性 ——
  const base = `http://127.0.0.1:${status.port}`;
  const health = await fetch(`${base}/api/health`);
  evidence.lifecycle.http.healthOk =
    health.status === 200 && ((await health.json()) as { ok?: boolean }).ok === true;
  const rootProbe = await fetch(base, { redirect: "manual" });
  evidence.lifecycle.http.rootStatus = rootProbe.status;
  const rootBody = await rootProbe.text();
  const spaHtml = fs.readFileSync(path.join(installedRoot, "dist", "webui", "index.html"), "utf8");
  // DSH 挂载时 / 由代理转发官方 host（登录/握手响应）；SPA 恢复面只允许出现在降级态。
  evidence.lifecycle.http.spaFallbackNotServedAtRoot = rootBody !== spaHtml;
  const island = await fetch(`${base}/manager/dsh-island.js`);
  evidence.lifecycle.http.islandAssetOk =
    island.status === 200 && (island.headers.get("content-type") ?? "").includes("javascript");
  if (dsh?.port) {
    try {
      const dshProbe = await fetch(`http://127.0.0.1:${dsh.port}/`, { redirect: "manual" });
      evidence.lifecycle.http.dshPortAlive = dshProbe.status > 0;
    } catch {
      evidence.lifecycle.http.dshPortAlive = false;
    }
  }
  if (!evidence.lifecycle.http.healthOk) fail("/api/health not ok in clean install");
  if (!evidence.lifecycle.http.spaFallbackNotServedAtRoot) {
    fail("root served the SPA recovery page while DSH host is mounted (proxy not engaged)");
  }
  if (!evidence.lifecycle.http.islandAssetOk)
    fail("/manager/dsh-island.js not served from install");

  // —— 7. stop → endpoint 释放 → restart → final stop ——
  const stop = run(nodeBin, [cli, "stop"], { cwd: installDir, env: childEnv });
  evidence.lifecycle.stopExit = stop.status ?? -1;
  await new Promise((resolve) => setTimeout(resolve, 1500));
  try {
    await fetch(`${base}/api/health`);
    evidence.lifecycle.endpointReleased = false;
  } catch {
    evidence.lifecycle.endpointReleased = true;
  }
  if (stop.status !== 0)
    fail(`installed cli stop exit ${stop.status}\n${stop.stdout}\n${stop.stderr}`);
  if (!evidence.lifecycle.endpointReleased) fail("endpoint still answering after stop");

  const restart = run(nodeBin, [cli, "start"], { cwd: installDir, env: childEnv });
  evidence.lifecycle.restartStartExit = restart.status ?? -1;
  let restartStatus = readStatus();
  const restartDeadline = Date.now() + 90_000;
  while (restartStatus.dsh?.mounted !== true && Date.now() < restartDeadline) {
    if (restartStatus.dsh?.mounted === false) {
      fail(`restart DSH degraded: ${restartStatus.dsh?.reason ?? "unknown"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    restartStatus = readStatus();
  }
  evidence.lifecycle.restartDshMounted = restartStatus.dsh?.mounted === true;
  if (!evidence.lifecycle.restartDshMounted) fail("DSH host did not remount after restart");
  const finalStop = run(nodeBin, [cli, "stop"], { cwd: installDir, env: childEnv });
  evidence.lifecycle.finalStopExit = finalStop.status ?? -1;
  if (finalStop.status !== 0) fail(`final stop exit ${finalStop.status}`);

  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactsDir, "clean-install.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  console.log(
    `[clean-install] PASS: install=${evidence.install.exitCode} dsh entries=${evidence.lifecycle.dshEntries} plugin=${
      evidence.lifecycle.dshHasManagerPlugin
    } health=${evidence.lifecycle.http.healthOk} island=${evidence.lifecycle.http.islandAssetOk} restart=${
      evidence.lifecycle.restartDshMounted
    }`,
  );
  console.log(`[clean-install] sandbox retained at ${sandbox}`);
  process.exit(0);
} catch (error) {
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactsDir, "clean-install.json"),
    `${JSON.stringify({ ...evidence, failure: error instanceof Error ? error.message : String(error) }, null, 2)}\n`,
  );
  fail(error instanceof Error ? error.message : String(error));
}
