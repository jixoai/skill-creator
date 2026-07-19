/**
 * 用户原始需求 [2026-07-19]：「我们已经不做 keepOnTop:true 的模式了。而是走 appMode:true 模式。」
 * 用户原始需求 [2026-07-20]：「预构建基于 color-symbol 的 appIcon：背景白色+合理的留白边界。」
 * 正交意图：
 *   [1] 创建强类型 tray 与 retained WebView window，处理菜单、原生可见性事件与品牌图标
 *       （icon 是 createTray 的输入之一，与 menu/tooltip 同层；monochrome-mini 经
 *       resolveTrayIconPath 解析为跨平台 file Icon，macOS 走 template 自适应）。
 *   [2] 保留单一 WebView session：show() 仅 bootstrap 一次，之后用 toVisible()/close()
 *       复用 session；以 isVisible()/visibleChange 作为原生可见性真相（含最小化）。
 *   [3] 按屏幕与 tray 几何锚定窗口，并把原生失败隔离为可诊断的 headless 降级。
 *   [4] 以 app mode 交还窗口层级、焦点与关闭行为给原生窗口管理器。
 * 妥协声明：OpenTray 的 tray、retained window、placement 与可见性真相只能在同一
 * 原生 capability adapter 中协调；产品路由与 daemon 生命周期不放在本文件。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  CreateTrayHandle,
  CreateTrayMenu,
  CreateTrayOptions,
  EventfulTrayHandle,
  Icon,
  TrayIcon,
} from "opentray";
import type { WebviewTrayCapability, WebviewWindowHandle } from "@opentray/ext-webview";
export type { TrayIcon };
import {
  APP_ID,
  APP_TITLE,
  MENU_OPEN_ID,
  MENU_QUIT_ID,
  WINDOW_HEIGHT,
  WINDOW_WIDTH,
} from "../shared/index.js";
import { configureOpenTrayWindowsHostTopology } from "./opentray-windows-host.js";
import { log } from "./log.js";

/** 已扩展 WebView 能力的 OpenTray 句柄（保留 createTray 的易用 setMenu 输入）。 */
export type OpentrayTray = CreateTrayHandle & WebviewTrayCapability;
/** OpenTray 承载的 retained WebView 窗口句柄。 */
export type OpentrayWindow = WebviewWindowHandle;
/** tray 挂载失败的可诊断分类。 */
export interface TrayMountFailure {
  kind:
    | "unsupported-platform"
    | "missing-native-package"
    | "missing-webview-package"
    | "tray-mount-failed"
    | "window-show-failed";
  stage: TrayMountFailureStage;
  cause: unknown;
}
export type TrayMountFailureStage =
  | "runtime-binding"
  | "tray-extend"
  | "window-create"
  | "window-show";

/** tray 挂载结果；失败时携带可诊断分类并退化为空句柄。 */
export interface TrayMountResult {
  tray: OpentrayTray | null;
  window: OpentrayWindow | null;
  stopPlacement: () => void;
  failure?: TrayMountFailure;
}

/** tray 窗口的创建参数与退出回调。 */
export interface TrayHostOptions {
  /** 日志输出（dev/test 可观测）。 */
  log?: (line: string) => void;
  /** 打开窗口的菜单项 id（primaryEvent）。 */
  openItemId?: number;
  /** 退出菜单项 id。 */
  quitItemId?: number;
  /** 窗口隐藏时主菜单项文案。 */
  showLabel?: string;
  /** 窗口可见时主菜单项文案。 */
  hideLabel?: string;
  /** 退出菜单项文案。 */
  quitLabel?: string;
  /** 一次性 bootstrap show() 之后初始原生可见性。 */
  initialVisible?: boolean;
  /** 把退出意图委托给 daemon 拥有者做优雅关停。 */
  onQuit?: () => void;
}

type TrayHostTray = Pick<OpentrayTray, "destroy" | "onMenuClick" | "setMenu">;
type TrayHostWindow = Pick<
  OpentrayWindow,
  "destroy" | "show" | "toVisible" | "close" | "isVisible" | "listen"
>;

type Visibility = "hidden" | "shown";

/**
 * 创建 tray 与 retained window，并返回有状态的 `TrayHost` 管理器。
 *
 * 失败时返回 null handles（headless 降级），不抛错 —— tray mount 是 UX 加成，
 * 绝不致命；WebUI 始终可用浏览器访问。
 */
export async function mountTray(opts: {
  url: string;
  packageVersion: string;
  enableDevtools?: boolean;
  webuiDir?: string;
  onQuit: () => Promise<void>;
}): Promise<{ result: TrayMountResult; host: TrayHost }> {
  let baseTray: EventfulTrayHandle | null = null;
  let tray: OpentrayTray | null = null;
  let panel: OpentrayWindow | null = null;
  let stopPlacement: () => void = () => {};

  try {
    const windowsHostTopology = configureOpenTrayWindowsHostTopology(process.env, process.platform);
    if (process.platform === "win32") {
      log(`OpenTray Windows host topology: ${windowsHostTopology}`);
    }

    const opentray = await import("opentray");
    const ext = await import("@opentray/ext-webview");

    // tray 通知栏小图标（resources/README.md §4 Monochrome Mini）：极小容器专用。
    const iconPath = resolveTrayIconPath(opts.webuiDir);
    const appIconPath = resolveAppIconPath(opts.webuiDir);
    const icon: Icon | undefined = iconPath
      ? {
          // macOS template icon：透明背景单色图，系统按深浅色自适应反相。
          "darwin-icon-only": { type: "file", path: iconPath, isTemplate: true },
          "win32-icon-only": { type: "file", path: iconPath },
          "linux-icon-only": { type: "file", path: iconPath },
        }
      : undefined;

    const trayOptions: CreateTrayOptions = {
      id: APP_ID,
      tooltip: { title: APP_TITLE, description: "Skills workbench" },
      menu: {
        items: [
          { type: "item", id: MENU_OPEN_ID, title: "Open Skill Creator", primaryEvent: true },
          { type: "separator" },
          { type: "item", id: MENU_QUIT_ID, title: "Quit" },
        ],
      },
      ...(icon ? { icon } : {}),
    };

    baseTray = await opentray.createTray(trayOptions, {
      packageVersion: opts.packageVersion,
      appId: `com.${APP_ID}`,
      appName: APP_TITLE,
      ...(appIconPath === null
        ? {}
        : { appIcon: { "icon-only": { type: "file", path: appIconPath } } }),
    });
    tray = baseTray.extend(ext.WebviewExt);

    // macOS overlays its native controls in the WebUI titlebar; Windows keeps its native frame.
    const usesWindowControlsOverlay = process.platform !== "win32";
    panel = tray.createWebviewWindow({
      url: opts.url,
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
      title: APP_TITLE,
      nativeWindowApi: true,
      windowControlsOverlay: usesWindowControlsOverlay,
      ...(opts.enableDevtools ? { devtools: true } : {}),
      style: {
        // Application mode supplies normal taskbar/Dock discoverability and native z-order.
        appMode: true,
        frameless: false,
        resizable: true,
        // A normal application window must remain visible after focus moves elsewhere.
        autoHide: false,
      },
    });

    // 首次 show() 真正加载原生扩展并创建 native window session。
    await panel.show();
    log("tray window shown on mount");

    if (opts.enableDevtools) {
      await safeCall("panel.devtools.open", panel.devtools?.open?.());
    }

    stopPlacement = await startPlacement(tray, panel, ext);

    const host = new TrayHost(tray, panel, {
      openItemId: MENU_OPEN_ID,
      quitItemId: MENU_QUIT_ID,
      showLabel: "Open Skill Creator",
      hideLabel: "Hide window",
      quitLabel: "Quit",
      initialVisible: true,
      onQuit: () => void opts.onQuit(),
    });

    log("opentray webview window mounted");
    return {
      result: { tray, window: panel, stopPlacement },
      host,
    };
  } catch (err) {
    const failure = classifyTrayMountFailure(err, {
      baseTray,
      tray,
      panel,
      stage: inferTrayMountFailureStage({ baseTray, tray, panel }),
    });
    await destroyMounted({ baseTray, tray, panel, stopPlacement });
    log(`opentray mount failed (${formatTrayMountFailure(failure)}) — running headless`);
    const host = new TrayHost(null, null, {
      openItemId: MENU_OPEN_ID,
      quitItemId: MENU_QUIT_ID,
      initialVisible: false,
      onQuit: () => void opts.onQuit(),
    });
    return {
      result: { tray: null, window: null, stopPlacement: () => {}, failure },
      host,
    };
  }
}

/**
 * 单 retained-session tray 管理器。
 *
 * - `show()` bootstrap 一次创建原生 session；之后所有激活用 `toVisible()`，隐藏用 `close()`，
 *   绝不重放 startup 宽高/style/native flags（OpenTray 0.16 session 法则）。
 * - `isVisible()` / `visibleChange` 是原生操作可见性的唯一真相（含最小化）。
 * - 操作经 `enqueueWindowOperation` 串行化，快速 tray 点击不会反转 stale 状态。
 */
export class TrayHost {
  private visibility: Visibility = "hidden";
  private unsubs: Array<() => void> = [];
  /** 串行化 query + transition 对，快速 tray 点击不得反转 stale 状态。 */
  private windowOperation: Promise<void> = Promise.resolve();

  constructor(
    private readonly tray: TrayHostTray | null,
    private readonly window: TrayHostWindow | null,
    private readonly opts: TrayHostOptions = {},
  ) {
    this.visibility = opts.initialVisible ? "shown" : "hidden";
    this.wireUp();
    this.pushMenu();
  }

  private logger(line: string): void {
    this.opts.log?.(line);
    log(`[tray] ${line}`);
  }

  /** 包裹原生 promise，rejection 被 log 吞掉，绝不连锁失败。 */
  private safeCall(label: string, operation: Promise<unknown> | undefined): void {
    if (!operation) return;
    operation.catch((error: unknown) =>
      this.logger(`${label} failed: ${errorToLogMessage(error)}`),
    );
  }

  /** 排队一个复合可见性操作并隔离所有原生失败。 */
  private enqueueWindowOperation(label: string, operation: () => Promise<void>): Promise<void> {
    const run = async (): Promise<void> => {
      try {
        await operation();
      } catch (error) {
        this.logger(`${label} failed: ${errorToLogMessage(error)}`);
      }
    };
    this.windowOperation = this.windowOperation.then(run, run);
    return this.windowOperation;
  }

  private wireUp(): void {
    const openId = this.opts.openItemId ?? MENU_OPEN_ID;
    const quitId = this.opts.quitItemId ?? MENU_QUIT_ID;

    if (this.tray) {
      const offMenu = this.tray.onMenuClick(({ itemId }) => {
        this.logger(`menu click received: itemId=${itemId}`);
        if (itemId === openId) {
          void this.toggle();
          return;
        }
        if (itemId === quitId) {
          this.logger("quit requested");
          try {
            this.opts.onQuit?.();
          } catch (error) {
            this.logger(`onQuit failed: ${errorToLogMessage(error)}`);
          }
        }
      });
      this.unsubs.push(offMenu);
    }

    if (!this.window) return;
    this.unsubs.push(
      this.window.listen("visibleChange", ({ payload }) => {
        this.applyNativeVisibility(payload.visible, "visibleChange");
      }),
    );
  }

  /** 切换原生 tray 图标投影（best-effort；技能工作台目前不使用动态图标）。 */
  setIcon(icon: TrayIcon | undefined): void {
    if (!icon || !this.tray) return;
    // CreateTrayHandle 暴露的 setIcon 接受易用 Icon 输入；此处保留接口便于将来扩展。
    this.safeCall(
      "setIcon",
      (this.tray as { setIcon?: (icon: TrayIcon) => Promise<void> }).setIcon?.(icon),
    );
  }

  /** 读原生操作可见性；缓存态仅作失败 fallback。 */
  private async queryNativeVisibility(fallback: boolean): Promise<boolean> {
    if (!this.window) return fallback;
    try {
      return await this.window.isVisible();
    } catch (error) {
      this.logger(`isVisible failed: ${errorToLogMessage(error)}`);
      return fallback;
    }
  }

  /** 把一条原生可见性事实应用到菜单状态。 */
  private applyNativeVisibility(visible: boolean, source: string): void {
    const next: Visibility = visible ? "shown" : "hidden";
    const changed = this.visibility !== next;
    this.visibility = next;
    if (changed) {
      this.pushMenu();
      this.logger(`${source}: ${next}`);
    }
  }

  /** bootstrap show() 之后，恢复或重新激活 retained session。 */
  private async revealRetainedWindow(): Promise<void> {
    if (!this.window) {
      this.applyNativeVisibility(true, "headless reveal");
      return;
    }
    await this.window.toVisible();
    this.applyNativeVisibility(await this.queryNativeVisibility(true), "toVisible");
  }

  /** 隐藏 retained session，但保留其页面运行时（不销毁）。 */
  private async closeRetainedWindow(): Promise<void> {
    if (!this.window) {
      this.applyNativeVisibility(false, "headless close");
      return;
    }
    await this.window.close();
    this.applyNativeVisibility(await this.queryNativeVisibility(false), "close");
  }

  /** 恢复一个隐藏或最小化的 retained 窗口。 */
  show(): Promise<void> {
    return this.enqueueWindowOperation("toVisible", () => this.revealRetainedWindow());
  }

  /** 隐藏 retained 窗口但保留其 WebView session。 */
  hide(): Promise<void> {
    return this.enqueueWindowOperation("close", () => this.closeRetainedWindow());
  }

  /** 主 tray 动作：立即查询原生真相后再决定切换方向。 */
  toggle(): Promise<void> {
    return this.enqueueWindowOperation("toggle visibility", async () => {
      const visible = await this.queryNativeVisibility(this.visibility === "shown");
      this.applyNativeVisibility(visible, "isVisible");
      if (visible) await this.closeRetainedWindow();
      else await this.revealRetainedWindow();
    });
  }

  /** 暴露给诊断与聚焦的单元覆盖。 */
  getVisibility(): Visibility {
    return this.visibility;
  }

  private buildMenu(): CreateTrayMenu {
    const openId = this.opts.openItemId ?? MENU_OPEN_ID;
    const quitId = this.opts.quitItemId ?? MENU_QUIT_ID;
    const actionTitle =
      this.visibility === "shown"
        ? (this.opts.hideLabel ?? "Hide window")
        : (this.opts.showLabel ?? "Open Skill Creator");
    return {
      items: [
        { type: "item", id: openId, title: actionTitle, primaryEvent: true },
        { type: "separator" },
        { type: "item", id: quitId, title: this.opts.quitLabel ?? "Quit" },
      ],
    };
  }

  private pushMenu(): void {
    if (!this.tray?.setMenu) return;
    this.safeCall("setMenu", this.tray.setMenu(this.buildMenu()));
  }

  /** 解绑监听 → 等排队操作完成 → 销毁窗口/tray。 */
  async destroy(): Promise<void> {
    for (const off of this.unsubs) {
      try {
        off();
      } catch {
        /* 忽略监听器回收缺口。 */
      }
    }
    this.unsubs = [];
    await this.windowOperation;
    try {
      await this.window?.destroy();
    } catch {
      /* 忽略原生回收缺口。 */
    }
    try {
      await this.tray?.destroy();
    } catch {
      /* 忽略原生回收缺口。 */
    }
  }
}

// ---------------------------------------------------------------------------

/**
 * 解析 tray 通知栏图标的绝对文件路径。
 *
 * 候选覆盖：production（已解析的 webuiDir，即 dist/webui）、bundled（dist/webui 同目录）、
 * dev（repo 的 webui/static 与 webui/build）。找不到返回 null —— tray 是 UX 加成，
 * 图标缺失不致命，回落到 opentray 默认图标（headless 降级原则）。
 */
function resolveTrayIconPath(webuiDir: string | undefined): string | null {
  return resolvePackagedIconPath("monochrome-mini.png", webuiDir);
}

/** 解析应用级 Dock/taskbar 图标；使用 Vite 预构建的高可读性品牌图标。 */
function resolveAppIconPath(webuiDir: string | undefined): string | null {
  return resolvePackagedIconPath("app-icon.png", webuiDir);
}

function resolvePackagedIconPath(fileName: string, webuiDir: string | undefined): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    webuiDir ? path.join(webuiDir, "icons", fileName) : null,
    path.join(here, "webui", "icons", fileName),
    path.join(here, "..", "..", "webui", "build", "icons", fileName),
    path.join(here, "..", "..", "webui", "static", "icons", fileName),
    path.join(process.cwd(), "webui", "build", "icons", fileName),
    path.join(process.cwd(), "webui", "static", "icons", fileName),
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** 启动 tray placement 锚定（best-effort）。 */
async function startPlacement(
  tray: OpentrayTray,
  panel: OpentrayWindow,
  ext: typeof import("@opentray/ext-webview"),
): Promise<() => void> {
  if (typeof tray.getBounds !== "function" || typeof tray.getScreenDetails !== "function") {
    return () => {};
  }
  try {
    const kit = new ext.WebviewPlacementKit({ tray, screen: tray });
    const watch = await kit.watch(panel, {
      placement: "tray",
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
      placementMargin: 8,
    });
    return () => {
      try {
        watch.stop();
      } catch {
        /* placement 回收绝不能崩溃关停。 */
      }
    };
  } catch (err) {
    log(`placement watch failed (${errorToLogMessage(err)}) — window unanchored`);
    return () => {};
  }
}

/** 销毁已挂载的 tray 资源（每个 try/catch 独立，绝不连锁失败）。 */
async function destroyMounted(handles: {
  baseTray: EventfulTrayHandle | null;
  tray: OpentrayTray | null;
  panel: OpentrayWindow | null;
  stopPlacement: () => void;
}): Promise<void> {
  try {
    handles.stopPlacement?.();
  } catch {
    /* ignore */
  }
  await safeCall("panel.destroy", handles.panel?.destroy?.());
  await safeCall("tray.destroy", (handles.tray ?? handles.baseTray)?.destroy?.());
}

function inferTrayMountFailureStage({
  baseTray,
  tray,
  panel,
}: {
  baseTray: EventfulTrayHandle | null;
  tray: OpentrayTray | null;
  panel: OpentrayWindow | null;
}): TrayMountFailureStage {
  if (panel !== null) return "window-show";
  if (tray !== null) return "window-create";
  if (baseTray !== null) return "tray-extend";
  return "runtime-binding";
}

type TrayMountContext = {
  baseTray: EventfulTrayHandle | null;
  tray: OpentrayTray | null;
  panel: OpentrayWindow | null;
  stage: TrayMountFailureStage;
};

function classifyTrayMountFailure(error: unknown, context: TrayMountContext): TrayMountFailure {
  const stage = context.stage;
  if (isMissingPlatformRuntimeBindingError(error)) {
    return {
      kind: isUnsupportedPlatformMessage(error.message)
        ? "unsupported-platform"
        : "missing-native-package",
      stage,
      cause: error,
    };
  }
  if (isWebviewExtensionLoadError(error)) {
    return {
      kind: isUnsupportedPlatformMessage(error.message)
        ? "unsupported-platform"
        : "missing-webview-package",
      stage,
      cause: error,
    };
  }
  if (stage === "window-show") return { kind: "window-show-failed", stage, cause: error };
  if (stage === "window-create") return { kind: "missing-webview-package", stage, cause: error };
  if (stage === "tray-extend") return { kind: "tray-mount-failed", stage, cause: error };
  return { kind: "missing-native-package", stage, cause: error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingPlatformRuntimeBindingError(
  error: unknown,
): error is { message: string; code?: string } {
  return (
    isRecord(error) &&
    error.code === "OPENTRAY_MISSING_PLATFORM_RUNTIME_BINDING" &&
    typeof error.message === "string"
  );
}

function isWebviewExtensionLoadError(error: unknown): error is { message: string; code?: string } {
  return (
    isRecord(error) &&
    error.code === "webview_extension_load_failed" &&
    typeof error.message === "string"
  );
}

function isUnsupportedPlatformMessage(message: string): boolean {
  return (
    message.includes("unsupported OpenTray runtime platform") ||
    message.includes("unsupported OpenTray runtime architecture") ||
    message.includes("Linux is unsupported for this extension")
  );
}

function formatTrayMountFailure(failure: TrayMountFailure): string {
  return `[${failure.kind}@${failure.stage}] ${errorToLogMessage(failure.cause)}`;
}

function errorToLogMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  // opentray 会把原生解析错误（列出候选路径）层层包装，递归 cause 链展开。
  const parts: string[] = [error.message];
  let cause = error.cause;
  let guard = 0;
  while (cause instanceof Error && guard < 5) {
    parts.push(`↳ ${cause.message}`);
    cause = (cause as Error).cause;
    guard++;
  }
  return parts.join(" ");
}

/** 包裹 opentray promise，rejection 被 log 吞掉。 */
async function safeCall(
  label: string,
  operation: PromiseLike<unknown> | null | undefined,
): Promise<void> {
  if (!operation) return;
  try {
    await operation;
  } catch (e) {
    log(`tray ${label} failed: ${errorToLogMessage(e)}`);
  }
}
