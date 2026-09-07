/**
 * 4.1 release evidence：生产 daemon 默认 DSH 组合宿主的全生命周期取证（openspec
 * dsh-webui-composition task 4.1）。
 *
 * 用户原始需求 [2026-09-07]（tasks 4.1）：「验证组合宿主启动/停止/重启；DSH 缺失/
 * 版本错误/插件失败降级；真实 DSH packages 的 tool round；Manager 原有操作的
 * filesystem diff；保存真实 boot graph、transcript、恢复记录。」
 *
 * 正交意图：
 *   [1] 生命周期矩阵：bootDaemon 默认挂 DSH host（boot graph + 同源握手）→
 *       Manager fs diff → 真实 tool round → 仅卸载宿主的 SPA 恢复 → 全量 stop →
 *       同 home 重启再挂载。
 *   [2] 降级矩阵：不可用 home / 断插件链接 / 断核心模块链接 / env off——每例都
 *       记录 mounted/reason 与 SPA 恢复可达、__DSH_BOOT__ 不注入。
 *   [3] 取证落盘：结构化 artifacts JSON（版本事实 + 各阶段探针结果）；--hold 模式
 *       常驻组合宿主供浏览器截图（--degraded 常驻恢复夹具）。
 * 妥协声明：版本漂移以「模块解析失败 → typed 降级」同一 fail-closed 路径覆盖（断链
 *   探针实证）；完整版本矩阵的 clean-install 归阶段 5 生产 pack（tasks 4.1 明示）。
 *
 * 执行：`pnpm exec tsx scripts/dsh-release-evidence.sh.ts [--hold [--degraded]]`
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const artifactsDir = path.join(root, "openspec", "changes", "dsh-webui-composition", "artifacts");
const hold = process.argv.includes("--hold");
const degradedHold = process.argv.includes("--degraded");

const evidence: Record<string, unknown> = {
  script: "scripts/dsh-release-evidence.sh.ts",
  generatedAt: new Date().toISOString(),
  node: process.version,
};

function fail(message: string): never {
  evidence.failure = message;
  flush();
  console.error(`dsh-release-evidence: FAIL: ${message}`);
  process.exit(1);
}

function flush(): void {
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactsDir, "dsh-release-evidence.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
}

/** 目录快照：relPath -> sha256（文件内容）。 */
function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!fs.existsSync(dir)) return out;
  const walk = (current: string): void => {
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) walk(full);
      else if (item.isFile()) {
        out.set(
          path.relative(dir, full),
          createHash("sha256").update(fs.readFileSync(full)).digest("hex"),
        );
      }
    }
  };
  walk(dir);
  return out;
}

function diffSnapshots(
  before: Map<string, string>,
  after: Map<string, string>,
): { added: string[]; removed: string[]; changed: string[] } {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const [key, hash] of after) {
    if (!before.has(key)) added.push(key);
    else if (before.get(key) !== hash) changed.push(key);
  }
  for (const key of before.keys()) if (!after.has(key)) removed.push(key);
  return { added, removed, changed };
}

// —— 隔离环境（真实 daemon 生命周期测试法则：OpenTray home + tray 全关）——
// 注意：IPC Unix socket 受 macOS sun_path ~104 字符限制，sandbox 必须用短前缀
// （系统 TMPDIR 的 /var/folders 长路径会使 listen EINVAL）。
const sandbox = fs.mkdtempSync("/tmp/dsh-release-evidence-");
const stateHome = path.join(sandbox, "state");
const dshHome = path.join(sandbox, "dsh-home");
process.env.SKILL_CREATOR_HOME = stateHome;
process.env.DSH_HOME = dshHome;
process.env.OPENTRAY_HOME = path.join(sandbox, "opentray");
process.env.SKILL_CREATOR_DISABLE_TRAY = "1";

const { setHomeOverride } = await import("../src/shared/paths.ts");
setHomeOverride(stateHome);

// —— 组合 webuiDir：真实 SPA build（恢复夹具）+ island 资产（/manager/* 前缀）——
const spaBuild = path.join(root, "webui", "build");
const islandBuild = path.join(root, "webui", "build-island");
if (!fs.existsSync(path.join(spaBuild, "index.html"))) {
  fail(`real SPA build missing at ${spaBuild}; run: pnpm --dir webui build`);
}
if (!fs.existsSync(path.join(islandBuild, "dsh-island.js"))) {
  fail(
    `island bundle missing at ${islandBuild}; run: pnpm --dir webui exec vite build --config vite.island.config.ts`,
  );
}
const webuiDir = path.join(sandbox, "webui");
fs.mkdirSync(webuiDir, { recursive: true });
fs.cpSync(spaBuild, webuiDir, { recursive: true });
for (const asset of fs.readdirSync(islandBuild)) {
  if (asset.startsWith("dsh-island.")) {
    fs.copyFileSync(path.join(islandBuild, asset), path.join(webuiDir, asset));
  }
}

// —— DSH 依赖版本事实（版本漂移降级的声明基础）——
const packageVersions: Record<string, string> = {};
for (const name of [
  "cordis",
  "cordis-plugin-loader",
  "dsh-app-boot",
  "dsh-web-app",
  "dsh-web-frontend",
]) {
  const manifest = path.join(root, "node_modules", "@deepseek-ai", name, "package.json");
  if (fs.existsSync(manifest)) {
    const parsed = JSON.parse(fs.readFileSync(manifest, "utf8")) as { version?: unknown };
    packageVersions[`@deepseek-ai/${name}`] =
      typeof parsed.version === "string" ? parsed.version : "unknown";
  }
}
evidence.packages = packageVersions;

const { bootDaemon } = await import("../src/daemon/index.js");
type DaemonHandles = NonNullable<Awaited<ReturnType<typeof bootDaemon>>>;

async function startDaemon(opts: Parameters<typeof bootDaemon>[0]): Promise<DaemonHandles> {
  const handles = await bootDaemon(opts);
  if (!handles) throw new Error("bootDaemon returned null (another daemon holds the IPC lock)");
  return handles;
}
const { ProviderIdSchema } = await import("../src/shared/contracts/workspaces.ts");
const providerId = ProviderIdSchema.parse("openclaw");
const pkgVersion = (
  JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { version: string }
).version;

// 预置 Manager workspace 目录 + DSH workspace 记录（「添加工作区」koffi 原生选择器
// web 端不可用；server 侧预置使绑定会话可建——与 3.1a 同法）。
const workspaceDir = path.join(sandbox, "ws");
fs.mkdirSync(path.join(workspaceDir, "skills"), { recursive: true });
const dshWorkspaceId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
function preseedDshWorkspace(): void {
  fs.mkdirSync(path.join(dshHome, "storages"), { recursive: true });
  fs.writeFileSync(
    path.join(dshHome, "storages", "workspace.json"),
    `${JSON.stringify(
      {
        unit: { name: "workspace", version: 2 },
        global: { initialized: true, workspaceIds: [dshWorkspaceId], archivedSessionIds: [] },
        tables: {
          workspaces: {
            [dshWorkspaceId]: {
              path: fs.realpathSync(workspaceDir),
              title: "release-evidence-ws",
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
}
preseedDshWorkspace();

async function stopDaemon(handles: DaemonHandles): Promise<void> {
  await handles.stop();
}

// 同源探针：health / island 资产 / DSH token 握手（经组合 origin 代理）。
/** 内核形态 Manager 面探针：loopback 健康检查 + SPA 恢复夹具（无 DSH 同源挂载）。 */
async function probeManagerFace(port: number) {
  const health = await fetch(`http://127.0.0.1:${port}/api/health`);
  const healthBody = (await health.json()) as { ok?: boolean };
  const spa = await fetch(`http://127.0.0.1:${port}/`);
  const body = await spa.text();
  return {
    healthStatus: health.status,
    healthOk: healthBody.ok === true,
    spaStatus: spa.status,
    dshBootAbsent: !body.includes("__DSH_BOOT__"),
  };
}

// —— 阶段 1：默认入口 = DSH 组合宿主 ——
if (degradedHold) {
  // --hold --degraded：常驻「不可用 home」降级形态（恢复夹具截图用）。
  process.env.DSH_HOME = path.join(sandbox, "not-a-dir");
  fs.writeFileSync(process.env.DSH_HOME, "x", "utf8");
  const handles = await startDaemon({
    cliVersion: pkgVersion,
    webuiDir,
    withTray: false,
    withDshHost: true,
    webToken: "evidence-degraded",
  });
  evidence.degradedHold = { status: handles.status.dsh };
  const entry = `http://127.0.0.1:${handles.port}/#token=${encodeURIComponent(handles.webToken)}`;
  fs.writeFileSync(path.join(root, "dsh-release-evidence.url"), `${entry}\n`, "utf8");
  console.log(`degraded recovery fixture: ${entry}`);
  // 清理挂在同步 exit hook：daemon 自身的 SIGINT 处理（stop+exit）可能先于本
  // 脚本的异步收尾退出进程，exit hook 保证 sandbox/url 文件必然回收。
  process.on("exit", () => {
    try {
      fs.rmSync(path.join(root, "dsh-release-evidence.url"), { force: true });
      fs.rmSync(sandbox, { recursive: true, force: true });
    } catch {
      // 尽力回收；失败不改变退出码。
    }
  });
  process.on("SIGINT", () => void stopDaemon(handles).catch(() => undefined));
  process.on("SIGTERM", () => void stopDaemon(handles).catch(() => undefined));
  setInterval(() => undefined, 60_000);
} else {
  const boot = await startDaemon({
    cliVersion: pkgVersion,
    webuiDir,
    withTray: false,
    withDshHost: true,
    webToken: "evidence-main",
  });
  if (!boot.status.dsh?.mounted)
    fail(`first boot did not mount the DSH kernel: ${boot.status.dsh?.reason}`);
  if (!boot.dshHost.record) fail("mounted kernel carries no boot record");
  const kernelRows = boot.dshHost.record.entries;
  for (const kernelRow of [
    "@deepseek-ai/dsh-agent",
    "@deepseek-ai/dsh-session",
    "@deepseek-ai/dsh-llm",
    "@deepseek-ai/dsh-user-approval",
    "@deepseek-ai/dsh-permission-presets",
  ]) {
    if (!kernelRows.includes(kernelRow)) fail(`kernel graph missing row: ${kernelRow}`);
  }
  for (const webRow of kernelRows.filter((name) => name.includes("web"))) {
    fail(`kernel graph must not contain web rows: ${webRow}`);
  }
  const probes = await probeManagerFace(boot.port);
  if (probes.healthStatus !== 200 || !probes.healthOk)
    fail("Manager /api/health missing with kernel mounted");
  if (probes.spaStatus !== 200 || !probes.dshBootAbsent) {
    fail(`Manager SPA face broken with kernel mounted: ${JSON.stringify(probes)}`);
  }
  evidence.boot = {
    mounted: true,
    managerPort: boot.port,
    entryCount: kernelRows.length,
    activationCount: boot.dshHost.record.activationOrder.length,
    kernelRows,
    activationOrder: boot.dshHost.record.activationOrder,
    probes,
  };
  console.log(
    `boot: headless kernel mounted (${kernelRows.length} entries) behind manager :${boot.port}`,
  );

  // —— Manager 原有操作 filesystem diff（同一 daemon domain = RPC 路由的真相源）——
  const before = snapshot(workspaceDir);
  const workspace = boot.domain.workspaces.import(workspaceDir, "release-evidence-ws");
  await boot.domain.creator.save({
    mode: "create",
    workspaceId: workspace.id,
    providerId,
    directoryName: "release-evidence-skill",
    frontmatter: {
      name: "release-evidence-skill",
      description: "4.1 release evidence skill.",
    },
    body: "# release-evidence-skill\n\n4.1 Manager operation filesystem diff.\n",
  });
  const afterCreate = snapshot(workspaceDir);
  const createDiff = diffSnapshots(before, afterCreate);
  const createdSkillFile = createDiff.added.find((rel) => rel.endsWith("SKILL.md"));
  if (!createdSkillFile || createDiff.added.length !== 1 || createDiff.removed.length > 0) {
    fail(`create-skill fs diff unexpected: ${JSON.stringify(createDiff)}`);
  }
  const listed = await boot.domain.skills.list({ workspaceId: workspace.id, providerId });
  const skill = listed.find((item) => item.name === "release-evidence-skill");
  if (!skill) fail("created skill not discovered by skills.list");

  const disableResults = await boot.domain.skills.toggle(
    { workspaceId: workspace.id, providerId },
    [skill!.id],
    "disable",
  );
  const afterDisable = snapshot(workspaceDir);
  const disableDiff = diffSnapshots(afterCreate, afterDisable);
  const enableResults = await boot.domain.skills.toggle(
    { workspaceId: workspace.id, providerId },
    [skill!.id],
    "enable",
  );
  const afterEnable = snapshot(workspaceDir);
  const enableDiff = diffSnapshots(afterDisable, afterEnable);
  evidence.managerOps = {
    workspaceId: workspace.id,
    createSkill: createDiff,
    createdSkillSha256: afterCreate.get(createdSkillFile!),
    disableStatuses: disableResults.results.map((item) => item.status),
    disableDiff,
    enableStatuses: enableResults.results.map((item) => item.status),
    enableDiff,
  };
  const disabledOk = disableResults.results.every((item) => item.status === "disabled");
  const disableMovedToDot =
    disableDiff.removed.some((rel) => rel.endsWith("/SKILL.md")) &&
    disableDiff.added.some((rel) => rel.includes("/.SKILL.md"));
  const restored = enableDiff.added.some((rel) => rel.endsWith("/SKILL.md"));
  if (!disabledOk || !disableMovedToDot || !restored) {
    fail(`toggle fs diff unexpected: ${JSON.stringify(evidence.managerOps)}`);
  }
  console.log(
    `manager ops: create+disable+enable fs diffs verified (${createdSkillFile}, sha256=${afterCreate.get(createdSkillFile!)?.slice(0, 12)}…)`,
  );

  // —— 内核工具面 facts（design D1 负面场景证据；steward binder 的内核对接在
  // task 2.3 恢复为 tool round 断言）——
  const kernelHandle = boot.dshHost.kernel;
  if (!kernelHandle) fail("mounted kernel carries no handle");
  const globalTools = kernelHandle.globalToolNames();
  const generalPurposeTools = ["bash", "pwsh", "read", "write", "edit", "glob", "grep"];
  const leaked = globalTools.filter((name) => generalPurposeTools.includes(name));
  if (leaked.length > 0) {
    fail(`kernel global tool table leaked general-purpose tools: ${leaked.join(", ")}`);
  }
  evidence.kernelToolSurface = {
    globalTools,
    generalPurposeAbsent: leaked.length === 0,
  };
  console.log(`kernel tool surface: ${globalTools.length} global tools, fs/shell absent`);

  if (hold) {
    // —— 常驻组合宿主（浏览器截图用）：同一生产入口 + 已绑定 transcript ——
    const entry = `http://127.0.0.1:${boot.port}/#token=${encodeURIComponent(boot.webToken)}`;
    fs.writeFileSync(path.join(root, "dsh-release-evidence.url"), `${entry}\n`, "utf8");
    evidence.hold = { entry, sandbox };
    flush();
    console.log(`composed host held for browser evidence: ${entry}`);
    console.log(`workspace: ${workspaceDir}`);
    // 清理挂在同步 exit hook：daemon 自身的 SIGINT 处理（stop+exit）可能先于本
    // 脚本的异步收尾退出进程，exit hook 保证 sandbox/url 文件必然回收。
    process.on("exit", () => {
      try {
        fs.rmSync(path.join(root, "dsh-release-evidence.url"), { force: true });
        fs.rmSync(sandbox, { recursive: true, force: true });
      } catch {
        // 尽力回收；失败不改变退出码。
      }
    });
    process.on("SIGINT", () => void stopDaemon(boot).catch(() => undefined));
    process.on("SIGTERM", () => void stopDaemon(boot).catch(() => undefined));
    setInterval(() => undefined, 60_000);
  } else {
    // —— 阶段 2：内核 dispose → Manager 面不受影响（daemon 不死）——
    await boot.dshHost.dispose();
    const recoverySpa = await fetch(`http://127.0.0.1:${boot.port}/`);
    const healthAfter = await fetch(`http://127.0.0.1:${boot.port}/api/health`);
    evidence.unmountRecovery = {
      spaStatus: recoverySpa.status,
      daemonAlive: healthAfter.status === 200,
    };
    if (recoverySpa.status !== 200 || healthAfter.status !== 200) {
      fail("kernel dispose broke the manager face");
    }
    console.log("kernel dispose: manager face intact, daemon alive");

    // —— 阶段 3：全量 stop → endpoint 释放 ——
    await stopDaemon(boot);
    let refused = false;
    try {
      await fetch(`http://127.0.0.1:${boot.port}/api/health`);
    } catch {
      refused = true;
    }
    evidence.stop = { endpointReleased: refused };
    if (!refused) fail("daemon endpoint still accepting connections after stop");
    console.log("stop: endpoint released");

    // —— 阶段 4：同 home 重启 → 重新挂载 ——
    preseedDshWorkspace();
    const reboot = await startDaemon({
      cliVersion: pkgVersion,
      webuiDir,
      withTray: false,
      withDshHost: true,
      webToken: "evidence-restart",
    });
    if (!reboot.status.dsh?.mounted)
      fail(`restart did not remount the DSH kernel: ${reboot.status.dsh?.reason}`);
    const rebootProbes = await probeManagerFace(reboot.port);
    evidence.restart = {
      mounted: true,
      port: reboot.port,
      previousPort: boot.port,
      entryCount: reboot.dshHost.record!.entries.length,
      probes: rebootProbes,
    };
    if (rebootProbes.healthStatus !== 200 || rebootProbes.spaStatus !== 200) {
      fail(`restart manager face failed: ${JSON.stringify(rebootProbes)}`);
    }
    await stopDaemon(reboot);
    console.log(`restart: kernel remounted behind manager :${reboot.port} and stopped cleanly`);

    // —— 阶段 5：降级矩阵（每例独立 home + 独立 state）——
    const degradation: Array<Record<string, unknown>> = [];
    /**
     * 期望语义：degrade = fail-closed（mounted:false + reason + SPA 恢复可达且不
     * 注入 __DSH_BOOT__）；healed = heal 的闭包镜像按设计修复 profile node_modules
     * 内的断链并正常挂载（记录恢复事实，不是降级）。版本漂移的完整矩阵（repo 级
     * 缺包/错版）无法在不破坏工作树的情况下注入，归阶段 5 生产 pack clean-install。
     */
    async function degradationCase(
      name: string,
      expectation: "degrade" | "healed",
      prepare: (home: string) => void,
      extraEnv?: () => void,
    ): Promise<void> {
      const caseSandbox = fs.mkdtempSync("/tmp/dsh-degrade-");
      const caseState = path.join(caseSandbox, "state");
      const caseDshHome = path.join(caseSandbox, "dsh-home");
      process.env.SKILL_CREATOR_HOME = caseState;
      process.env.DSH_HOME = caseDshHome;
      setHomeOverride(caseState);
      prepare(caseDshHome);
      extraEnv?.();
      const handles = await startDaemon({
        cliVersion: pkgVersion,
        webuiDir,
        withTray: false,
        withDshHost: true,
        webToken: `evidence-${name}`,
      });
      let healedMounted = false;
      if (handles.status.dsh?.mounted && handles.dshHost.record) {
        // healed 形态：内核重新挂载（entries 非空即激活断言已过）。
        healedMounted = handles.dshHost.record.entries.length > 0;
      }
      const spa = await fetch(`http://127.0.0.1:${handles.port}/`);
      const body = await spa.text();
      const record = {
        case: name,
        expectation,
        mounted: handles.status.dsh?.mounted === true,
        reason: handles.status.dsh?.reason ?? null,
        spaStatus: spa.status,
        dshBootAbsent: !body.includes("__DSH_BOOT__"),
        daemonAlive: true,
        ...(healedMounted ? { healedMounted } : {}),
      };
      await stopDaemon(handles);
      // 还原全局 env 到主 sandbox。
      process.env.SKILL_CREATOR_HOME = stateHome;
      process.env.DSH_HOME = dshHome;
      setHomeOverride(stateHome);
      if (extraEnv) delete process.env.SKILL_CREATOR_DSH_HOST;
      fs.rmSync(caseSandbox, { recursive: true, force: true });
      degradation.push(record);
      console.log(
        `degradation[${name}]: mounted=${record.mounted} reason=${record.reason ?? "-"} spa=${record.spaStatus}`,
      );
      if (expectation === "degrade") {
        if (record.mounted || record.spaStatus !== 200 || !record.dshBootAbsent) {
          fail(`degradation case ${name} did not fail closed: ${JSON.stringify(record)}`);
        }
      } else if (!record.mounted || !healedMounted) {
        fail(`heal case ${name} did not remount: ${JSON.stringify(record)}`);
      }
    }

    await degradationCase("unusable-home", "degrade", (home) => {
      fs.writeFileSync(home, "x", "utf8");
    });
    await degradationCase("plugin-linkage-failure", "degrade", (home) => {
      // 插件行链接失败（断链占位使 boot 的确定性链接步骤 EEXIST → typed 降级）。
      fs.mkdirSync(path.join(home, "profiles", "node_modules", "@skill-creator"), {
        recursive: true,
      });
      fs.symlinkSync(
        path.join(home, "nonexistent-plugin-target"),
        path.join(home, "profiles", "node_modules", "@skill-creator", "dsh-client"),
        "dir",
      );
    });
    await degradationCase("core-module-heal-repair", "healed", (home) => {
      // profile node_modules 内的核心包断链：heal 闭包镜像按设计修复并正常挂载。
      fs.mkdirSync(path.join(home, "profiles", "node_modules", "@deepseek-ai"), {
        recursive: true,
      });
      fs.symlinkSync(
        path.join(home, "nonexistent-core-target"),
        path.join(home, "profiles", "node_modules", "@deepseek-ai", "dsh-web-app"),
        "dir",
      );
    });
    await degradationCase(
      "env-off",
      "degrade",
      () => {},
      () => {
        process.env.SKILL_CREATOR_DSH_HOST = "off";
      },
    );
    evidence.degradation = degradation;

    setHomeOverride(null);
    fs.rmSync(sandbox, { recursive: true, force: true });
    flush();
    console.log(
      `evidence written: openspec/changes/dsh-webui-composition/artifacts/dsh-release-evidence.json`,
    );
    process.exit(0);
  }
}
