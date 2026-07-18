/**
 * 原始需求 [2026-07-18]：「全面升级 skill-creator-v2 对于 opentray 的适配」。
 * 正交意图：
 *   [1] 用屏幕外 div 作为 WAAPI 不透明度动画的影子源，驱动原生窗口逐帧镜像。
 *   [2] 根据 daemon 投影的 visibility/exitRequested 状态机跑进入/退出动画。
 *   [3] 在普通浏览器中（无 navigator.opentrayWindow）静默降级，不镜像原生。
 * 妥协声明：动画时间线由页面拥有；daemon 只决定 exitRequested 意图，页面完成动画
 * 后回调 completeAutoClose，daemon 复核仍可关闭才真正关窗。
 */
import { browser } from "$app/environment";
import {
  countdownFromExitTime,
  ENTER_DURATION_MS,
  EXIT_DURATION_MS,
  exitOpacityKeyframes,
  IOS_ENTER_EASING,
} from "./window-opacity-timeline.js";
import { WINDOW_ENTER_SEED_OPACITY } from "$shared/window-opacity.js";

const OPACITY_EPSILON = 0.002;

interface WindowVisibilityControllerDeps {
  /** 读取 daemon 投影的当前窗口可见性与退出意图。 */
  getState: () => { visibility: "hidden" | "shown"; exitRequested: boolean };
  /** 由倒计时驱动更新 UI 显示。 */
  setCountdown: (countdown: number | null) => void;
  /** 退出动画完成后回调 daemon 复核真正的关窗。 */
  completeAutoClose: () => void;
}

type Mode = "idle" | "entering" | "exiting";

class WindowVisibilityController {
  private source: HTMLDivElement;
  private animation: Animation | null = null;
  private raf: number | null = null;
  private mode: Mode = "idle";
  private lastVisibility: "hidden" | "shown" = "hidden";
  private currentOpacity = 1;
  private lastNativeOpacity = 1;
  private queuedExit = false;
  private stopStore: (() => void) | null = null;

  constructor(private readonly deps: WindowVisibilityControllerDeps) {
    this.source = document.createElement("div");
    this.source.setAttribute("aria-hidden", "true");
    Object.assign(this.source.style, {
      position: "fixed",
      left: "-9999px",
      top: "-9999px",
      width: "1px",
      height: "1px",
      pointerEvents: "none",
      opacity: "1",
    });
    document.body.appendChild(this.source);
  }

  start(): void {
    if (this.stopStore) return;
    const tick = (): void => this.onDaemonState(this.deps.getState());
    // 订阅 store：Svelte 5 runes 不在普通模块暴露 subscribe，由调用方轮询。
    // 这里用 rAF 驱动一个轻量观察循环，足以响应 daemon 投影变化。
    const loop = (): void => {
      tick();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    this.stopStore = () => {
      if (this.raf !== null) cancelAnimationFrame(this.raf);
      this.raf = null;
    };
  }

  stop(): void {
    this.stopStore?.();
    this.stopStore = null;
    this.stopAnimation();
    this.deps.setCountdown(null);
    this.source.remove();
  }

  private onDaemonState(state: { visibility: "hidden" | "shown"; exitRequested: boolean }): void {
    const becameShown = this.lastVisibility === "hidden" && state.visibility === "shown";
    this.lastVisibility = state.visibility;

    if (state.visibility === "hidden") {
      this.queuedExit = false;
      this.stopAnimation();
      this.mode = "idle";
      this.deps.setCountdown(null);
      return;
    }

    if (becameShown) {
      this.startEnter(WINDOW_ENTER_SEED_OPACITY);
      if (state.exitRequested) this.queuedExit = true;
      return;
    }

    if (state.exitRequested) {
      if (this.mode === "entering") {
        this.queuedExit = true;
        return;
      }
      if (this.mode !== "exiting") {
        if (this.currentOpacity < 1 - OPACITY_EPSILON) {
          this.queuedExit = true;
          this.startEnter(this.currentOpacity);
        } else {
          this.startExit();
        }
      }
      return;
    }

    this.queuedExit = false;
    if (this.mode === "exiting") {
      this.startEnter(this.readOpacity());
    } else if (this.mode === "idle" && this.currentOpacity < 1 - OPACITY_EPSILON) {
      this.startEnter(this.currentOpacity);
    }
  }

  private startEnter(fromOpacity: number): void {
    const from = clampOpacity(fromOpacity);
    this.stopAnimation();
    this.mode = "entering";
    this.deps.setCountdown(null);
    this.setSourceOpacity(from);
    this.applyNativeOpacity(from);
    const animation = this.source.animate([{ opacity: String(from) }, { opacity: "1" }], {
      duration: ENTER_DURATION_MS,
      easing: IOS_ENTER_EASING,
      fill: "forwards",
    });
    this.animation = animation;
    this.mirrorFrames();
    animation.finished.then(
      () => {
        if (this.animation !== animation) return;
        this.mode = "idle";
        this.setSourceOpacity(1);
        this.applyNativeOpacity(1);
        this.animation = null;
        if (this.queuedExit && this.deps.getState().exitRequested) {
          this.queuedExit = false;
          this.startExit();
        }
      },
      () => {
        /* 被更新的时间线取消 */
      },
    );
  }

  private startExit(): void {
    this.stopAnimation();
    this.mode = "exiting";
    this.queuedExit = false;
    const from = clampOpacity(this.currentOpacity);
    this.setSourceOpacity(from);
    this.applyNativeOpacity(from);
    this.deps.setCountdown(5);
    const animation = this.source.animate(exitOpacityKeyframes(from), {
      duration: EXIT_DURATION_MS,
      fill: "forwards",
    });
    this.animation = animation;
    this.mirrorFrames();
    animation.finished.then(
      () => {
        if (this.animation !== animation) return;
        this.mode = "idle";
        this.setSourceOpacity(0);
        this.applyNativeOpacity(0);
        this.animation = null;
        this.deps.setCountdown(null);
        if (this.deps.getState().exitRequested) this.deps.completeAutoClose();
      },
      () => {
        /* 被 focus / pin / active event 或新可见性帧取消 */
      },
    );
  }

  private mirrorFrames(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    const tick = (): void => {
      if (!this.animation) {
        this.raf = null;
        return;
      }
      const opacity = this.readOpacity();
      this.applyNativeOpacity(opacity);
      if (this.mode === "exiting") {
        const currentTime =
          typeof this.animation.currentTime === "number" ? this.animation.currentTime : 0;
        this.deps.setCountdown(countdownFromExitTime(currentTime));
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private stopAnimation(): void {
    if (this.raf !== null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
    if (this.animation) {
      try {
        this.animation.cancel();
      } catch {
        /* ignore */
      }
      this.animation = null;
    }
  }

  private readOpacity(): number {
    const computed = getComputedStyle(this.source).opacity;
    const value = Number.parseFloat(computed);
    return Number.isFinite(value) ? value : this.currentOpacity;
  }

  private setSourceOpacity(opacity: number): void {
    const next = clampOpacity(opacity);
    this.currentOpacity = next;
    this.source.style.opacity = String(next);
  }

  private applyNativeOpacity(opacity: number): void {
    const next = clampOpacity(opacity);
    if (Math.abs(next - this.lastNativeOpacity) < OPACITY_EPSILON) return;
    this.lastNativeOpacity = next;
    const win = bridge();
    try {
      void win?.setStyle?.({ opacity: next })?.catch?.(() => {});
    } catch {
      /* 原生 opacity 是宿主加成；浏览器降级保持可用 */
    }
  }
}

let activeController: WindowVisibilityController | null = null;

/** 安装单例的页面拥有原生窗口可见性控制器。 */
export function initWindowVisibility(deps: WindowVisibilityControllerDeps): () => void {
  if (!browser) return () => {};
  if (!activeController) {
    activeController = new WindowVisibilityController(deps);
    activeController.start();
  }
  return () => {
    activeController?.stop();
    activeController = null;
  };
}

function clampOpacity(opacity: number): number {
  if (!Number.isFinite(opacity)) return 1;
  return Math.max(0, Math.min(1, opacity));
}

function bridge(): Navigator["opentrayWindow"] {
  if (typeof navigator === "undefined") return undefined;
  return navigator.opentrayWindow ?? navigator.opentray?.window ?? undefined;
}
