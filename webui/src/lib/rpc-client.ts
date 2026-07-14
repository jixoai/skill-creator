/**
 * 原始需求 [2026-07-14]：「opentray 的一些适配没做好，好好学习 pnpm-pub」。
 * 正交意图：
 * 1. 从 tray URL 捕获短生命周期 token，并在当前标签页内保存。
 * 2. 建立同源、强类型的 oRPC WebSocket client。
 * 3. 在 SvelteKit router 就绪后清理 URL hash，避免泄露或路由状态冲突。
 */
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/websocket";
import type { ContractRouterClient } from "@orpc/contract";
import { replaceState } from "$app/navigation";
import { rpcContract, type RpcContract } from "$shared/rpc-contract.js";

/** 强类型 RPC client，签名由契约推导。 */
export type RpcClient = ContractRouterClient<RpcContract>;
/** WebUI 使用的共享 RPC 契约。 */
export { rpcContract };

const SESSION_TOKEN_KEY = "skill-creator-token";

/** 从 URL hash capture token 到 sessionStorage，然后清掉 hash。幂等。 */
function captureTokenFromHash(): void {
  if (typeof window === "undefined") return;
  const hash = window.location.hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);
  const token = params.get("token");
  if (token) {
    sessionStorage.setItem(SESSION_TOKEN_KEY, token);
    const sanitizedUrl = window.location.pathname + window.location.search;
    // onMount 仍发生在 SvelteKit initialize() 返回前；下一事件循环才可安全调用导航 API。
    setTimeout(() => replaceState(sanitizedUrl, {}), 0);
  }
}

/** 读取当前 session 的 web token（优先 hash capture，回退 sessionStorage）。 */
export function readWebToken(): string {
  captureTokenFromHash();
  if (typeof window === "undefined") return "";
  return sessionStorage.getItem(SESSION_TOKEN_KEY) ?? "";
}

/** 推导 WS URL（同源：dev 靠 vite 代理，release webview 直连 daemon）。 */
function deriveWsUrl(token: string): string {
  if (typeof window === "undefined") return "";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const port = window.location.port || (window.location.protocol === "https:" ? "443" : "80");
  return `${proto}//${window.location.hostname}:${port}/ws/rpc?token=${encodeURIComponent(token)}`;
}

/** 建立带 token 的 WebSocket 连接。 */
export function createRpcWebSocket(): WebSocket {
  const token = readWebToken();
  return new WebSocket(deriveWsUrl(token));
}

/** 从一个已建立的 WebSocket 构造强类型 oRPC client。 */
export function createRpcClient(ws: WebSocket): RpcClient {
  const link = new RPCLink({ websocket: ws });
  return createORPCClient<RpcClient>(link);
}
