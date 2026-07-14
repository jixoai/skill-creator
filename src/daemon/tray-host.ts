/**
 * 原始需求 [2026-07-14]：「opentray 的一些适配没做好，好好学习 pnpm-pub」。
 * 正交意图：
 * 1. 创建强类型 tray 与 WebView window，并处理菜单事件。
 * 2. 将所有打开入口收敛为同一窗口句柄上的幂等 show/focus。
 * 3. 根据屏幕和 tray 几何锚定窗口。
 * 4. 将原生能力失败隔离为可诊断的 headless 降级。
 * 妥协声明：OpenTray 的 tray、window 与 placement 能力只能在同一原生
 * capability adapter 中协调；产品路由和 daemon 生命周期不放在本文件。
 */
import type { EventfulTrayHandle, CreateTrayOptions, TrayIcon } from "opentray";
import type { WebviewTrayCapability, WebviewWindowHandle } from "@opentray/ext-webview";
import {
  APP_ID,
  APP_TITLE,
  MENU_OPEN_ID,
  MENU_QUIT_ID,
  WINDOW_HEIGHT,
  WINDOW_WIDTH,
} from "../shared/index.js";
import { log } from "./log.js";

/** 已扩展 WebView 能力的 OpenTray 句柄。 */
export type OpentrayTray = EventfulTrayHandle & WebviewTrayCapability;
/** OpenTray 承载的 WebView 窗口句柄。 */
export type OpentrayWindow = WebviewWindowHandle;

/** 窗口进入动画的 seed opacity（避免 restore 时闪一下 1.0）。 */
const WINDOW_ENTER_SEED_OPACITY = 0.92;

/** tray 挂载结果；失败时携带可诊断阶段并退化为空句柄。 */
export interface TrayMountResult {
  tray: OpentrayTray | null;
  window: OpentrayWindow | null;
  stopPlacement: () => void;
  failure?: { kind: string; stage: string; cause: unknown };
}

/** tray 窗口的创建参数与退出回调。 */
export interface TrayHostOptions {
  url: string;
  packageVersion: string;
  enableDevtools?: boolean;
  onQuit: () => Promise<void>;
}

type TrayHostTray = Pick<OpentrayTray, "destroy" | "onMenuClick">;
type TrayHostWindow = Pick<OpentrayWindow, "destroy" | "setStyle" | "show">;

/**
 * 创建 tray 与 window，并返回有状态的 `TrayHost` 管理器。
 *
 * 失败时返回 null handles（headless 降级），不抛错 —— tray mount 是 UX 加成，绝不致命。
 */
export async function mountTray(opts: TrayHostOptions): Promise<{
  result: TrayMountResult;
  host: TrayHost | null;
}> {
  let baseTray: EventfulTrayHandle | null = null;
  let tray: OpentrayTray | null = null;
  let panel: OpentrayWindow | null = null;
  let stopPlacement: () => void = () => {};

  try {
    const opentray = await import("opentray");
    const ext = await import("@opentray/ext-webview");

    const trayOptions: CreateTrayOptions = {
      id: APP_ID,
      tooltip: { title: APP_TITLE, description: "Skills manager" },
      menu: {
        items: [
          { type: "item", id: MENU_OPEN_ID, title: "Open Skill Creator", primaryEvent: true },
          { type: "separator" },
          { type: "item", id: MENU_QUIT_ID, title: "Quit" },
        ],
      },
    };

    baseTray = await opentray.createTray(trayOptions, {
      packageVersion: opts.packageVersion,
      appId: `com.${APP_ID}`,
      appName: APP_TITLE,
    });
    tray = baseTray.extend(ext.WebviewExt);

    panel = tray.createWebviewWindow({
      url: opts.url,
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
      title: APP_TITLE,
      nativeWindowApi: true,
      windowControlsOverlay: true,
      ...(opts.enableDevtools ? { devtools: true } : {}),
      style: {
        keepOnTop: true,
        opacity: WINDOW_ENTER_SEED_OPACITY,
        background: { kind: "semantic", token: "blur", state: "active" },
      },
    });

    await panel.show();
    log("tray window shown on mount");

    if (opts.enableDevtools) {
      await safeCall("panel.devtools.open", panel.devtools?.open?.());
    }

    stopPlacement = await startPlacement(tray, panel, ext);

    const host = new TrayHost({ tray, window: panel }, { onQuit: opts.onQuit });
    host.install();

    log("opentray webview window mounted");
    return {
      result: { tray, window: panel, stopPlacement },
      host,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stage = panel
      ? "window-show"
      : tray
        ? "window-create"
        : baseTray
          ? "tray-extend"
          : "runtime-binding";
    await destroyMounted({ baseTray, tray, panel, stopPlacement });
    log(`opentray mount failed (${message} @ ${stage}) — running headless`);
    return {
      result: {
        tray: null,
        window: null,
        stopPlacement: () => {},
        failure: { kind: "mount-failed", stage, cause: err },
      },
      host: null,
    };
  }
}

/**
 * 单窗口 tray 管理器。Open 动作始终恢复同一窗口，不维护无法从 OS 关闭按钮同步的镜像状态。
 */
export class TrayHost {
  private detachMenu: (() => void) | null = null;

  constructor(
    private readonly refs: { tray: TrayHostTray; window: TrayHostWindow },
    private readonly opts: { onQuit: () => Promise<void> },
  ) {}

  /** 安装 Open/Quit 菜单事件监听。 */
  install(): void {
    const off = this.refs.tray.onMenuClick(({ itemId }) => {
      if (itemId === MENU_OPEN_ID) {
        void this.show().catch((error: unknown) => {
          log(`tray show failed: ${error instanceof Error ? error.message : String(error)}`);
        });
      } else if (itemId === MENU_QUIT_ID) {
        void this.opts.onQuit().catch((e) => log(`onQuit failed: ${e}`));
      }
    });
    this.detachMenu = typeof off === "function" ? off : null;
  }

  /** 恢复并聚焦同一窗口；show 失败必须由 IPC open 调用方看见。 */
  async show(): Promise<void> {
    await safeCall(
      "setStyle(opacity)",
      this.refs.window.setStyle?.({ opacity: WINDOW_ENTER_SEED_OPACITY }),
    );
    await this.refs.window.show();
    await safeCall("setStyle(keepOnTop)", this.refs.window.setStyle?.({ keepOnTop: true }));
  }

  /** 清理菜单监听 + 销毁窗口/tray。 */
  async destroy(): Promise<void> {
    this.detachMenu?.();
    await safeCall("panel.destroy", this.refs.window.destroy?.());
    await safeCall("tray.destroy", this.refs.tray.destroy?.());
  }
}

// ---------------------------------------------------------------------------

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
        /* ignore */
      }
    };
  } catch {
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

/** 包裹 opentray promise，rejection 被 log 吞掉。 */
async function safeCall(
  label: string,
  operation: PromiseLike<unknown> | null | undefined,
): Promise<void> {
  if (!operation) return;
  try {
    await operation;
  } catch (e) {
    log(`tray ${label} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
