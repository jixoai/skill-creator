/**
 * DSH Web composition 锁定验证（openspec dsh-webui-composition task 0.1）。
 *
 * User input [2026-09-06] (tasks 0.1): "逐个读取锁定 commit 中候选 package 的
 * package.json、exports、types、peerDependencies……记录 browser entry 与实际可加载的
 * AppWebEntry。任何版本/缺包/exports/peer/build/安装失败都变成 typed unavailable 和
 * 恢复命令；不得猜测 dsh-acp 或高层嵌入 API。"
 * 事实源：docs/research/2026-09-06-dsh-integration.md「DSH Web composition 事实表」。
 *
 * Orthogonal intents:
 *   [1] 锁定安装面：DSH_WEB_LOCKED_PACKAGES 每项在 webui/根安装面可解析且版本精确匹配；
 *       隐藏 peer（react 系）存在且满足 19 系要求。
 *   [2] 浏览器构建事实：client-web 是 React 浏览器构建（css 模块 import、AppWebEntry
 *       导出）；/client 子入口是 window.__ModuleLoader__ 工厂模块——只能在 DSH web
 *       shell 内执行（Node 下不可加载是预期形态）。
 *   [3] 契约投影：DshWebRuntimeStatusSchema 的 typed unavailable 形状（含恢复命令）。
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DSH_WEB_HIDDEN_PEER_PACKAGES,
  DSH_WEB_LOCKED_PACKAGES,
  DshWebRuntimeStatusSchema,
} from "../src/shared/contracts/dsh-runtime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const requireFromWebui = createRequire(path.join(repoRoot, "webui", "package.json"));
const requireFromRoot = createRequire(path.join(repoRoot, "package.json"));

/** 读取已解析包的 package.json（版本真相）。 */
function resolvedVersion(req: NodeRequire, packageName: string): string | null {
  try {
    const pkgJson = req(`${packageName}/package.json`) as { version?: unknown };
    return typeof pkgJson.version === "string" ? pkgJson.version : null;
  } catch {
    return null;
  }
}

describe("dsh web composition lock (task 0.1)", () => {
  it("resolves every locked browser-face package from webui at the exact locked version", () => {
    for (const [packageName, lockedVersion] of Object.entries(DSH_WEB_LOCKED_PACKAGES)) {
      if (packageName === "@deepseek-ai/dsh-web-app") continue; // server host lives at the root
      const resolved = resolvedVersion(requireFromWebui, packageName);
      expect(resolved, packageName).toBe(lockedVersion);
    }
  });

  it("resolves the server host package and its startup seam from the root", () => {
    expect(resolvedVersion(requireFromRoot, "@deepseek-ai/dsh-web-app")).toBe(
      DSH_WEB_LOCKED_PACKAGES["@deepseek-ai/dsh-web-app"],
    );
    expect(() => requireFromRoot.resolve("@deepseek-ai/dsh-web-app/startup")).not.toThrow();
    const patchYml = path.join(
      path.dirname(requireFromRoot.resolve("@deepseek-ai/dsh-web-app/package.json")),
      "cordis.patch.yml",
    );
    expect(fs.existsSync(patchYml)).toBe(true);
  });

  it("installs the hidden react peers in the 19 line", () => {
    for (const [peer, major] of Object.entries(DSH_WEB_HIDDEN_PEER_PACKAGES)) {
      const resolved = resolvedVersion(requireFromWebui, peer);
      expect(resolved, peer).not.toBeNull();
      expect(resolved!.split(".")[0], peer).toBe(major.split(".")[0]);
    }
  });

  it("records the browser-build facts: css module import + AppWebEntry export in client-web", () => {
    const clientWebDir = path.dirname(
      requireFromWebui.resolve("@deepseek-ai/dsh-client-web/package.json"),
    );
    const indexJs = fs.readFileSync(path.join(clientWebDir, "lib", "index.js"), "utf8");
    // 浏览器构建事实（研究文档实测）：bundler-only css import + React 运行时。
    expect(indexJs).toContain("boot-page.module.css");
    expect(indexJs).toContain("react-dom/client");
    expect(indexJs).toContain("AppWebEntry");
  });

  it("records the client-plugin factory shape: /client entries register via window.__ModuleLoader__", () => {
    for (const name of ["@deepseek-ai/dsh-client-ui-session", "@deepseek-ai/dsh-client-ui-chat"]) {
      const dir = path.dirname(requireFromWebui.resolve(`${name}/package.json`));
      const clientJs = fs.readFileSync(path.join(dir, "lib", "client.js"), "utf8");
      expect(clientJs.startsWith("window.__ModuleLoader__.load("), name).toBe(true);
      expect(clientJs).toContain(`id: "${name}"`);
    }
  });

  it("validates typed unavailable projections with a recovery command", () => {
    const unavailable = {
      state: "unavailable" as const,
      code: "MISSING_PEER" as const,
      packageName: "react",
      detail: "dsh-client-web browser build imports react but it is not installed.",
      recoveryCommand: "pnpm --dir webui install",
    };
    expect(DshWebRuntimeStatusSchema.safeParse(unavailable).success).toBe(true);
    // 缺恢复命令的 unavailable 不合法：typed 失败必须带恢复路径。
    expect(
      DshWebRuntimeStatusSchema.safeParse({ ...unavailable, recoveryCommand: "" }).success,
    ).toBe(false);
    const available = {
      state: "available" as const,
      browserEntry: "AppWebEntry" as const,
      serverStartup: "@deepseek-ai/dsh-web-app/startup" as const,
      packages: Object.entries(DSH_WEB_LOCKED_PACKAGES).map(([packageName, lockedVersion]) => ({
        packageName,
        lockedVersion,
        resolvedVersion: lockedVersion,
      })),
    };
    expect(DshWebRuntimeStatusSchema.safeParse(available).success).toBe(true);
    // 未知 browser entry 不合法：不猜测高层嵌入 API。
    expect(
      DshWebRuntimeStatusSchema.safeParse({ ...available, browserEntry: "mountDshApp" }).success,
    ).toBe(false);
  });
});
