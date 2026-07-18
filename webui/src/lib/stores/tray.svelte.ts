/**
 * 原始需求 [2026-07-18]：「全面升级 skill-creator-v2 对于 opentray 的适配」。
 * 正交意图：
 *   [1] 投影 daemon 广播的 pin 帧与 keep-onTop 偏好。
 *   [2] 消费 state.subscribe 推送流，并在连接世代更替时撤销旧订阅。
 *   [3] 提供标题栏 pin、路由上报与自动关闭回调的单一 action 入口。
 */
import type { WsServerMessage } from "$shared/rpc-contract.js";
import type { Preferences } from "$shared/contracts/tray.js";
import { getConnectionGeneration, getRpc } from "./connection.svelte";

/** tray 窗口与 keep-open 偏好的全局投影。 */
export const trayState = $state<{
  pinned: boolean;
  exitRequested: boolean;
  windowVisibility: "hidden" | "shown";
  pinCountdown: number | null;
}>({
  pinned: false,
  exitRequested: false,
  windowVisibility: "hidden",
  pinCountdown: null,
});

let subscriptionGeneration = -1;
let activeSubscription: Promise<void> | null = null;

/** 应用一条 daemon 投影帧到本地状态。 */
export function applyServerMessage(msg: WsServerMessage): void {
  if (msg.type === "pin") {
    trayState.exitRequested = msg.exitRequested;
    trayState.windowVisibility = msg.visibility;
    if (!msg.exitRequested) trayState.pinCountdown = null;
  } else if (msg.type === "preferences") {
    trayState.pinned = msg.preferences.keepOnTop;
  }
}

/** 由 window-visibility 动画时间线驱动的本地倒计时投影。 */
export function setWindowAutoCloseCountdown(countdown: number | null): void {
  if (trayState.pinCountdown === countdown) return;
  trayState.pinCountdown = countdown;
}

/**
 * 订阅 daemon→WebUI 投影流；幂等，并在连接世代变化时自动重建订阅。
 *
 * 失效的旧订阅不得把帧提交到新状态：通过 connectionGeneration 比较守卫。
 */
export async function ensureTraySubscription(): Promise<void> {
  const generation = getConnectionGeneration();
  if (generation === subscriptionGeneration && activeSubscription) return;
  subscriptionGeneration = generation;
  activeSubscription = (async () => {
    const rpc = getRpc();
    if (!rpc) return;
    try {
      const stream = await rpc.state.subscribe({});
      for await (const frame of stream) {
        // 连接已更替：旧流不得继续提交。
        if (getConnectionGeneration() !== generation) break;
        applyServerMessage(frame);
      }
    } catch {
      /* 连接断开由 connection store 重连；这里静默退出，等下一次 ensure。 */
    }
  })();
  await activeSubscription;
}

/** 切换 keep-open 偏好（单一写入路径：daemon 广播回投驱动真实状态）。 */
export async function setPreferences(patch: Partial<Preferences>): Promise<void> {
  const rpc = getRpc();
  if (!rpc) return;
  try {
    await rpc.preferences.set({ patch });
  } catch {
    /* 偏好写入失败不阻断 UI；用户可重试。 */
  }
}

/** 退出动画完成后回调 daemon 复核真正关窗。 */
export async function completeAutoClose(): Promise<void> {
  const rpc = getRpc();
  if (!rpc) return;
  try {
    await rpc.tray.completeAutoClose({});
  } catch {
    /* 忽略；daemon 会在下一次可见性变化时重新评估。 */
  }
}

/** 上报当前拥有 tray 窗口表面的路由，用于可见性护栏（Creator 路由禁止自动隐藏）。 */
export async function setTrayRoute(pathname: string): Promise<void> {
  const rpc = getRpc();
  if (!rpc) return;
  try {
    await rpc.tray.routeChanged({ pathname });
  } catch {
    /* 路由上报失败不阻断导航。 */
  }
}

/** 标题栏 pin 按钮：toggle keep-onTop。 */
export function togglePin(): void {
  void setPreferences({ keepOnTop: !trayState.pinned });
}
