// @vitest-environment node
/**
 * web 模式浏览器冒烟（2026-09-15 Owner 裁决 Q7-A：`--web` 是不依赖 ext-webview
 * 的可测面——标准无头浏览器驱动真 daemon 的 WebUI，macOS 本地与 Linux CI 同链路；
 * 兼作 Q6 的 Linux 行为探针——RPC 失败会以 console error / 数据缺失形态现形）。
 *
 * 用户原始需求 [2026-09-15]：「提供一种 --web 模式去测试，在这个模式下基本有
 * ext-webview 也不使用，直接走标准浏览器的能力去验证可用性。」
 *
 * 正交意图：
 *   [1] 生产产物 + 隔离环境：dist/daemon.js（源码态 daemon 不伺服 SPA——产品契约
 *       里源码态永远在 Vite 监督后面，曾因此拿到裸 404）+ /tmp 短基底隔离 home
 *       （macOS sun_path 104 上限，/var/folders 长基底触发 connect EINVAL）。
 *   [2] 无头 Chrome 直连 CDP（ws 为既有依赖，不引 playwright）：桌面视口（默认
 *       800x600 会落进窄屏形态）、页面加载、app 自身 oRPC 数据渲染（Global
 *       Workspace 段依赖 workspace.list 成功）、console 零 error。
 *   [3] 可移植性门：Chrome 或 dist 缺席时整体 skip（CHROME_PATH 可覆盖）；
 *       失败保留临时目录供诊断；子进程按 PID 显式回收。
 * 实证教训（2026-09-15）：产品 nav 是纯图标轨，标签在 aria-label 而 textContent
 * 恒空——断言必须走可访问名；CLI start 的 8s 产品就绪窗在测试负载下会假红，
 * 故直接拉 daemon + 宽窗轮询 status。
 */
import { execFile, spawn } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliEntry = path.join(root, "dist", "cli.js");
const daemonEntry = path.join(root, "dist", "daemon.js");

const temporaryDirectories: string[] = [];
const childPids: number[] = [];
let smokeFailed = false;

function findChrome(): string | null {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv) return fromEnv;
  const candidates =
    process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : [
          "/usr/bin/google-chrome",
          "/usr/bin/google-chrome-stable",
          "/usr/bin/chromium",
          "/usr/bin/chromium-browser",
        ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function isolatedEnv(home: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // vitest 注入 NODE_ENV=test：DSH 的 cordis 插件链在该值下 init 报错拖慢内核
    // 挂载——daemon 是独立产品进程，不吃测试进程的环境语义。
    NODE_ENV: "production",
    OPENTRAY_HOME: path.join(home, "opentray-runtime"),
    SKILL_CREATOR_DISABLE_TRAY: "1",
    SKILL_CREATOR_HOME: home,
  };
}

function runCli(home: string, args: string[]): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [cliEntry, ...args],
      {
        cwd: root,
        env: isolatedEnv(home),
        encoding: "utf8",
        timeout: 45_000,
      },
      (error, stdout) => {
        if (error) reject(error);
        else resolve({ stdout });
      },
    );
  });
}

async function waitFor<T>(
  probe: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T;
  for (;;) {
    last = await probe();
    if (predicate(last)) return last;
    if (Date.now() > deadline) throw new Error(`waitFor timed out; last: ${JSON.stringify(last)}`);
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

/** CDP 最小客户端：browser-level ws + 平铺 session；只实现本测试所需面。 */
class Cdp {
  private readonly pending = new Map<number, (value: unknown) => void>();
  private socket: WebSocket | null = null;
  private sessionId = "";
  private nextId = 0;
  readonly consoleErrors: string[] = [];

  async connect(wsUrl: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(wsUrl, { perMessageDeflate: false });
      socket.on("open", () => resolve());
      socket.on("error", reject);
      this.socket = socket;
    });
    this.socket!.on("message", (raw) => {
      const message = JSON.parse(String(raw)) as {
        id?: number;
        result?: unknown;
        error?: { message: string };
        method?: string;
        sessionId?: string;
        params?: { type?: string; args?: unknown[] };
      };
      if (message.id !== undefined) {
        const settle = this.pending.get(message.id);
        if (settle) {
          this.pending.delete(message.id);
          settle(message);
        }
        return;
      }
      if (
        message.sessionId === this.sessionId &&
        message.method === "Runtime.consoleAPICalled" &&
        message.params?.type === "error"
      ) {
        this.consoleErrors.push(JSON.stringify(message.params.args ?? []));
      }
    });
    const target = (await this.send("Target.createTarget", { url: "about:blank" })) as {
      targetId: string;
    };
    const attached = (await this.send("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: true,
    })) as { sessionId: string };
    this.sessionId = attached.sessionId;
    await this.send("Runtime.enable");
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = ++this.nextId;
    const payload = JSON.stringify({ id, method, params, sessionId: this.sessionId || undefined });
    return new Promise((resolve, reject) => {
      this.pending.set(id, (message: { result?: unknown; error?: { message: string } }) => {
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      });
      this.socket!.send(payload);
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 20_000).unref?.();
    });
  }

  async evaluate<T>(expression: string): Promise<T> {
    const result = (await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })) as { result?: { value?: T }; exceptionDetails?: { text?: string } };
    if (result.exceptionDetails) {
      throw new Error(`page eval failed: ${result.exceptionDetails.text}`);
    }
    return result.result?.value as T;
  }

  /** 桌面视口：无头默认 800x600 会落进 shell 的窄屏形态。 */
  setViewport(width: number, height: number): Promise<unknown> {
    return this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
  }

  close(): void {
    this.socket?.close();
  }
}

describe("web mode browser smoke (dist daemon + headless Chrome over CDP)", () => {
  let home = "";
  let chrome: ReturnType<typeof spawn> | null = null;
  let cdp: Cdp | null = null;
  const chromeExe = existsSync(daemonEntry) ? findChrome() : null;

  beforeAll(async () => {
    if (chromeExe === null) return;
    // /tmp 短基底：macOS unix socket 的 sun_path 上限 104 字符。
    home = await fs.mkdtemp("/tmp/sc-web-smoke-");
    temporaryDirectories.push(home);
    // 直接拉 daemon：CLI start 的 8s 产品就绪窗在测试负载下会假红（启动路径
    // 由 cli-lifecycle 套件覆盖；本测对象是 WebUI+浏览器链路）。
    const daemon = spawn(process.execPath, [daemonEntry], {
      cwd: root,
      env: { ...isolatedEnv(home), SKILL_CREATOR_WEB: "1" },
      stdio: "ignore",
      detached: true,
    });
    daemon.unref();
    childPids.push(daemon.pid!);
    const url = await waitFor(
      async () => {
        try {
          const { stdout } = await runCli(home, ["status"]);
          return stdout.match(/https?:\/\/\S+/)?.[0] ?? "";
        } catch {
          return "";
        }
      },
      (value) => value.length > 0,
      45_000,
    );
    expect(url).toBeDefined();

    chrome = spawn(chromeExe, [
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--remote-debugging-port=0",
      `--user-data-dir=${path.join(home, "chrome-profile")}`,
      "about:blank",
    ]);
    childPids.push(chrome.pid!);
    const wsUrl = await new Promise<string>((resolve, reject) => {
      let buffer = "";
      const timer = setTimeout(() => reject(new Error("chrome ws url not observed")), 15_000);
      chrome!.stderr!.on("data", (chunk) => {
        buffer += String(chunk);
        const match = buffer.match(/ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/\S+/);
        if (match) {
          clearTimeout(timer);
          resolve(match[0]);
        }
      });
    });
    cdp = new Cdp();
    await cdp.connect(wsUrl);
    await cdp.setViewport(1440, 900);
    await cdp.evaluate(`window.location.href = ${JSON.stringify(url)}`);
    await cdp.evaluate("document.readyState");
  }, 120_000);

  afterEach((context) => {
    if (context.task?.result?.state === "fail") smokeFailed = true;
  });

  it("boots the shell and renders RPC-driven workspace data", { timeout: 60_000 }, async () => {
    if (chromeExe === null || cdp === null) return;
    const nav = await waitFor(
      () =>
        cdp!.evaluate<string>(
          `(() => {
              const navLabels = [...document.querySelectorAll('nav button')]
                .map(b => b.getAttribute('aria-label'))
                .filter(Boolean);
              const hasNav = ['Workspaces', 'Creator', 'Repository'].every(t => navLabels.includes(t));
              // counts 卡本身即 workspace.list 的数据驱动渲染（数值可为 0——
              // 测试隔离环境下 provider 扫描可能返回空；非空机器数据不是断言面）。
              const text = document.body.innerText;
              const hasCounts = /skills across \\d+ agent locations/.test(text);
              return JSON.stringify({ hasNav, hasCounts, navLabels });
            })()`,
        ),
      (value) => {
        const parsed = JSON.parse(value) as { hasNav: boolean; hasCounts: boolean };
        return parsed.hasNav && parsed.hasCounts;
      },
      45_000,
    );
    const parsed = JSON.parse(nav) as {
      hasNav: boolean;
      hasCounts: boolean;
      navLabels: string[];
    };
    expect(parsed.hasNav).toBe(true);
    expect(parsed.hasCounts).toBe(true);
    expect(parsed.navLabels).toEqual(
      expect.arrayContaining([
        "Workspaces",
        "Creator",
        "Repository",
        "Import workspace",
        "Settings",
      ]),
    );
  });

  it("collects zero console errors from the booted app", { timeout: 30_000 }, async () => {
    if (chromeExe === null || cdp === null) return;
    // 给迟到的异步错误一个窗口。
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(cdp.consoleErrors).toEqual([]);
  });

  afterAll(async () => {
    cdp?.close();
    for (const pid of childPids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // 已退出。
      }
    }
    if (home) await runCli(home, ["stop"]).catch(() => undefined);
    if (!smokeFailed && process.env.VITEST_WEB_SMOKE_KEEP !== "1") {
      for (const directory of temporaryDirectories) {
        await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
      }
    } else {
      console.error("[web-smoke] kept temp dirs:", temporaryDirectories.join(", "));
    }
  });
});
