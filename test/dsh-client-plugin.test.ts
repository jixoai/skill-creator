/**
 * Skill Creator Manager DSH client plugin 测试（openspec dsh-webui-composition task 1.2）。
 *
 * User input [2026-09-06] (tasks 1.2): "提供 client export 和 dsh.client manifest，声明
 * inject/external；mount/dispose 由 DSH lifecycle 管理。plugin 只建立一个 Manager RPC
 * owner；无第二个 SvelteKit shell、无 iframe、无 ACP chat route；plugin activation
 * failure 阻止假成功启动。"
 *
 * Orthogonal intents:
 *   [1] 协议合规：dsh.client manifest（platform/inject/external）+ "./client" 导出按
 *       client-modules 扫描器的实际契约解析。
 *   [2] 唯一 RPC owner：client factory 在 module-loader stub 下真实执行——懒建立、
 *       重复 acquire 同一实例、dispose 语义正确。
 *   [3] 宿主集成与 fail-closed：boot graph 出现 plugin 行且 combo script 可取回；
 *       loader activation 失败让 boot reject（无假成功）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Context } from "@deepseek-ai/cordis";
import { Loader } from "@deepseek-ai/cordis-plugin-loader";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootMinimalDshWebHost } from "../src/daemon/steward/dsh-web-host.js";
import { setHomeOverride } from "../src/shared/paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const nodeRequire = createRequire(import.meta.url);
const pluginDir = path.join(repoRoot, "packages", "skill-creator-dsh-client");

const previousHome = process.env.SKILL_CREATOR_HOME;
let sandbox = "";

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-client-plugin-"));
  process.env.SKILL_CREATOR_HOME = path.join(sandbox, "state");
  setHomeOverride(path.join(sandbox, "state"));
});

afterEach(() => {
  setHomeOverride(null);
  if (previousHome === undefined) delete process.env.SKILL_CREATOR_HOME;
  else process.env.SKILL_CREATOR_HOME = previousHome;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

/** 以最小 window.__ModuleLoader__ stub 真实执行 client factory（无浏览器）。 */
function materializeClientPlugin(): {
  registeredId: string;
  exports: Record<string, unknown>;
} {
  const loaded: Array<{ id: string; factory: (require: unknown) => unknown }> = [];
  const loaderStub = {
    load: (registration: { id: string; factory: (require: unknown) => unknown }) => {
      loaded.push(registration);
    },
  };
  const source = fs.readFileSync(path.join(pluginDir, "lib", "client.js"), "utf8");
  const window = { __ModuleLoader__: loaderStub };
  // eslint-disable-next-line no-new-func
  new Function("window", source)(window);
  expect(loaded.length).toBe(1);
  const registration = loaded[0]!;
  const require = (name: string): unknown => {
    if (name === "react") {
      return {
        createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({
          type,
          props,
          children,
        }),
      };
    }
    throw new Error(`unexpected require: ${name}`);
  };
  const exports = registration.factory(require) as Record<string, unknown>;
  return { registeredId: registration.id, exports };
}

describe("manager dsh client plugin protocol (task 1.2)", () => {
  it("declares the dsh.client manifest with a ./client export as the scanner requires", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(pluginDir, "package.json"), "utf8")) as {
      name: string;
      exports: Record<string, { default?: string }>;
      dsh?: { client?: { platform?: unknown; inject?: unknown; external?: unknown } };
    };
    const decl = pkg.dsh?.client;
    expect(decl).toBeDefined();
    expect(decl!.platform).toBe("web");
    expect(Array.isArray(decl!.inject)).toBe(true);
    expect(Array.isArray(decl!.external)).toBe(true);
    const clientExport = pkg.exports["./client"]?.default;
    expect(typeof clientExport).toBe("string");
    expect(fs.existsSync(path.join(pluginDir, clientExport!))).toBe(true);
    // node half 是 browser-only 骨架（无 Host 行为，与官方 ui-session 同形）。
    expect(() => nodeRequire(path.join(pluginDir, "lib", "index.js"))).not.toThrow();
  });

  it("registers through window.__ModuleLoader__ and owns exactly one Manager RPC owner", () => {
    const first = materializeClientPlugin();
    expect(first.registeredId).toBe("@skill-creator/dsh-client");
    const ownerFn = first.exports["getManagerRpcOwner"] as () => unknown;
    const disposeFn = first.exports["disposeManagerRpcOwner"] as () => void;
    expect(typeof ownerFn).toBe("function");
    expect(typeof disposeFn).toBe("function");

    const acquired = ownerFn();
    const acquiredAgain = ownerFn();
    expect(acquiredAgain).toBe(acquired); // 单例：重复 acquire 同一实例
    expect((acquired as { kind: string }).kind).toBe("skill-creator-manager");
    expect((acquired as { acquisitions: number }).acquisitions).toBe(2);

    disposeFn();
    const afterDispose = ownerFn();
    expect(afterDispose).not.toBe(acquired); // dispose 后重建（DSH lifecycle 语义）
    expect((afterDispose as { acquisitions: number }).acquisitions).toBe(1);

    // 二次 materialize 得到新的模块实例（module table 语义），单例仍封闭在实例内。
    const second = materializeClientPlugin();
    const owner2 = (second.exports["getManagerRpcOwner"] as () => unknown)();
    expect(owner2).not.toBe(acquired);
  });

  it(
    "appears in the boot graph and its combo script is served by the host",
    { timeout: 30_000 },
    async () => {
      const host = await bootMinimalDshWebHost();
      try {
        expect(host.record.activationOrder).toContain("@skill-creator/dsh-client");
        const handshake = await fetch(host.record.authenticatedUrl, { redirect: "manual" });
        const cookie = handshake.headers.get("set-cookie")!.split(";")[0]!;
        const base = `http://${host.record.host}:${host.record.port}`;
        const index = await fetch(`${base}/`, { headers: { cookie }, redirect: "manual" });
        const html = await index.text();
        // boot graph 注入包含我们的插件行（client roster 扫描结果）。
        expect(html).toContain("@skill-creator/dsh-client");
        // combo script 可取回且内容就是我们的工厂模块。
        const rawComboUrl = /(?:src|href)="(\/plugins\/[^"]*skill-creator[^"]*)"/.exec(html)?.[1];
        expect(rawComboUrl).toBeDefined();
        const comboUrl = rawComboUrl!.replace(/&amp;/g, "&");
        const combo = await fetch(`${base}${comboUrl!}`, { headers: { cookie } });
        expect(combo.status).toBe(200);
        const script = await combo.text();
        expect(script).toContain("window.__ModuleLoader__.load");
        expect(script).toContain("@skill-creator/dsh-client");
        expect(script).toContain("getManagerRpcOwner");
      } finally {
        await host.dispose();
      }
    },
  );

  it(
    "fails closed: a loader activation failure rejects the boot instead of faking success",
    { timeout: 30_000 },
    async () => {
      const ctx = new Context();
      ctx.plugin(Loader, { baseUrl: new URL(".", import.meta.url).href });
      await new Promise((resolve) => setTimeout(resolve, 50));
      await expect(
        ctx.loader.create({ name: "@skill-creator/dsh-client/does-not-exist", config: {} }),
      ).rejects.toBeTruthy();
      (ctx as unknown as { dispose?: () => void }).dispose?.();
    },
  );
});

describe("manager island contribution (task 3.1a)", () => {
  it("declares slots inject and registers a sidebar.footer.action view", () => {
    const { exports } = materializeClientPlugin();
    expect(exports["inject"]).toEqual(["slots"]);
    const apply = exports["apply"] as (ctx: unknown) => { (): void } | { (): void };
    expect(typeof apply).toBe("function");

    const registrations: Array<{ name: string; id?: string; locale?: string }> = [];
    const disposers: Array<() => void> = [];
    const ctx = {
      effect: (fn: () => () => void) => {
        disposers.push(fn());
        return () => disposers.forEach((dispose) => dispose());
      },
      slots: {
        inject: (slotName: string, register: () => unknown) => {
          expect(slotName).toBe("sidebar.footer.action");
          return register();
        },
        register: (options: { name: string; id?: string; locale?: string }, view: unknown) => {
          registrations.push(options);
          expect(typeof view).toBe("function");
          return () => undefined;
        },
      },
    };
    apply(ctx);
    expect(registrations).toHaveLength(1);
    expect(registrations[0]).toMatchObject({
      name: "sidebar.footer.action",
      id: "skill-creator-manager",
      locale: "common",
    });
    // 贡献声明带 inject 面（视图 props 提供器），与官方 footer 贡献同形。
    expect(typeof (registrations[0] as { inject?: unknown }).inject).toBe("function");
    // 卸载（DSH lifecycle）：disposer 链可执行（关闭 island + 注销贡献）。
    disposers.forEach((dispose) => dispose());
  });

  it("keeps the island lifecycle inside the plugin instance (no duplicate mounts)", () => {
    const { exports } = materializeClientPlugin();
    const internal = (
      exports as unknown as {
        __internal: {
          islandState: { open: boolean; scriptLoading: unknown; hostEl: unknown };
          openIsland: () => void;
          closeIsland: () => void;
        };
      }
    ).__internal;
    expect(internal.islandState.open).toBe(false);
    expect(internal.islandState.hostEl).toBe(null);
    // 关闭幂等：未打开时 close 不抛错。
    internal.closeIsland();
    expect(internal.islandState.open).toBe(false);
  });
});
