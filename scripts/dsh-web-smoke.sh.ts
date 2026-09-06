/**
 * DSH web host smoke（openspec dsh-webui-composition task 1.1）。
 *
 * 用户原始需求 [2026-09-06]（tasks 1.1）：「在干净临时 home 启动一次真实 DSH web
 * host，记录 boot graph、plugin activation、session connection 和失败恢复证据。」
 * 执行：`pnpm exec tsx scripts/dsh-web-smoke.sh.ts`（house law：新脚本 .sh.ts；
 * cordis 组合在 tsx 下已验证）。
 *
 * 正交意图：
 *   [1] 真实启动证据：Loader rows 激活序、loopback 端口、token 握手（401→303+cookie
 *       →200 且注入 __DSH_BOOT__）、/api fence、boot graph 的 client 模块行。
 *   [2] 失败恢复证据：dispose 后二次 boot 达 ready；产物写入
 *       openspec/changes/dsh-webui-composition/artifacts/dsh-web-smoke.json。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-web-smoke-"));
process.env.SKILL_CREATOR_HOME = path.join(sandbox, "state");
process.env.DSH_HOME = path.join(sandbox, "dsh-home");
fs.mkdirSync(process.env.DSH_HOME, { recursive: true });

async function main(): Promise<void> {
  const { setHomeOverride } = await import("../src/shared/paths.js");
  setHomeOverride(process.env.SKILL_CREATOR_HOME!);
  const { bootMinimalDshWebHost } = await import("../src/daemon/steward/dsh-web-host.js");

  async function probeOnce(label: string) {
    const host = await bootMinimalDshWebHost();
    const base = `http://${host.record.host}:${host.record.port}`;
    const unauth = await fetch(`${base}/`, { redirect: "manual" });
    const handshake = await fetch(host.record.authenticatedUrl, { redirect: "manual" });
    const cookie = handshake.headers.get("set-cookie");
    const session = cookie ? cookie.split(";")[0] : null;
    const index = session
      ? await fetch(`${base}/`, { headers: { cookie: session }, redirect: "manual" })
      : null;
    const html = index ? await index.text() : "";
    const api = await fetch(`${base}/api/`, { redirect: "manual" });
    // boot graph：从注入的 __DSH_BOOT__ script 提取模块行数（client 模块图证据）。
    const bootScript = /<script[^>]*>([\s\S]*__DSH_BOOT__[\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
    const clientModuleRows = Math.max(
      0,
      (bootScript.match(/__ModuleLoader__|dsh-client-/g) ?? []).length,
    );
    return {
      label,
      host: host.record.host,
      port: host.record.port,
      entries: host.record.entries,
      activationOrder: host.record.activationOrder,
      http: {
        unauthenticatedStatus: unauth.status,
        tokenHandshakeStatus: handshake.status,
        sessionCookieMinted: cookie !== null,
        indexStatusWithSession: index?.status ?? null,
        indexBytes: html.length,
        bootManifestInjected: html.includes("__DSH_BOOT__"),
        clientModuleReferences: clientModuleRows,
        apiFencedStatus: api.status,
      },
      dispose: async () => host.dispose(),
    };
  }

  const first = await probeOnce("primary");
  await first.dispose();
  const second = await probeOnce("recovered");
  await second.dispose();

  const artifact = {
    artifactVersion: 1 as const,
    generatedAt: new Date().toISOString(),
    generator: "scripts/dsh-web-smoke.sh.ts",
    cleanHome: "mkdtemp sandbox (SKILL_CREATOR_HOME + DSH_HOME isolated)",
    primary: { ...first, dispose: undefined },
    recovery: { ...second, dispose: undefined },
    recoveryReachedReady: second.http.indexStatusWithSession === 200,
  };
  delete (artifact.primary as { dispose?: unknown }).dispose;
  delete (artifact.recovery as { dispose?: unknown }).dispose;

  if (!artifact.primary.http.bootManifestInjected) {
    throw new Error("primary boot did not inject __DSH_BOOT__ into the index");
  }
  if (!artifact.recoveryReachedReady) {
    throw new Error("recovered host did not reach ready");
  }

  const target = path.join(
    root,
    "openspec/changes/dsh-webui-composition/artifacts/dsh-web-smoke.json",
  );
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(`smoke written: ${path.relative(root, target)}`);
  console.log(
    `primary: entries=${artifact.primary.entries.length} index=${artifact.primary.http.indexStatusWithSession} boot=${artifact.primary.http.bootManifestInjected} api=${artifact.primary.http.apiFencedStatus} recoveryReady=${artifact.recoveryReachedReady}`,
  );
  setHomeOverride(null);
}

main()
  .then(() => {
    fs.rmSync(sandbox, { recursive: true, force: true });
    // cordis Context 的 keep-alive 句柄会阻止进程退出；成功路径显式收尾。
    process.exit(0);
  })
  .catch((error: unknown) => {
    fs.rmSync(sandbox, { recursive: true, force: true });
    console.error(error instanceof Error ? error.stack : String(error));
    process.exit(1);
  });
