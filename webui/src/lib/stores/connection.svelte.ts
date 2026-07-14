/**
 * 原始需求 [2026-07-14]：「参考 ../../pnpm-pub 这个项目的架构：cli+gui(webui+opentray)」。
 * 正交意图：
 * 1. 管理 WebSocket 与 oRPC client 生命周期。
 * 2. 投影连接状态并在非主动断开后重连。
 */
import { createRpcClient, createRpcWebSocket, type RpcClient } from "../rpc-client";

/** 全局 daemon 连接状态。 */
export const connectionState = $state<{
  status: "idle" | "connecting" | "connected" | "disconnected";
  error: string | null;
}>({ status: "idle", error: null });

let websocket: WebSocket | null = null;
let rpcClient: RpcClient | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let deliberateClose = false;

/** 建立 daemon RPC 连接；重复调用幂等。 */
export function connect(): void {
  if (websocket) return;
  deliberateClose = false;
  connectionState.status = "connecting";
  connectionState.error = null;
  const candidate = createRpcWebSocket();
  websocket = candidate;

  candidate.onopen = () => {
    if (websocket !== candidate) return;
    rpcClient = createRpcClient(candidate);
    connectionState.status = "connected";
    connectionState.error = null;
  };
  candidate.onclose = (event) => {
    if (websocket !== candidate) return;
    websocket = null;
    rpcClient = null;
    connectionState.status = "disconnected";
    connectionState.error =
      event.code === 1006
        ? "Cannot authenticate with the local daemon. Open Skill Creator from its tray icon."
        : "The local daemon connection closed.";
    if (!deliberateClose) reconnectTimer = setTimeout(connect, 1500);
  };
}

/** 主动断开 daemon RPC 并取消自动重连。 */
export function disconnect(): void {
  deliberateClose = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  websocket?.close();
  websocket = null;
  rpcClient = null;
  connectionState.status = "idle";
}

/** 返回当前 RPC client；未连接时返回 `null`。 */
export function getRpc(): RpcClient | null {
  return rpcClient;
}

/** 返回当前 RPC client；未连接时抛出用户可诊断错误。 */
export function requireRpc(): RpcClient {
  if (!rpcClient) throw new Error("The Skill Creator daemon is not connected.");
  return rpcClient;
}
