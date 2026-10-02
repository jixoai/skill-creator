/**
 * 响应式 connection store stub（WS5 走查 B 回归测试）：真 store 是 runes 模块，
 * vi.mock 工厂里无法书写裸 $state——以本 runes stub 转发，组件对
 * connectionState.status 的 $effect 才能随测试翻转（connecting → connected）
 * 重跑，验证「连接转 ready 自动重发」类补救。
 */
import { vi } from "vitest";

export const connectionState = $state<{
  status: "idle" | "connecting" | "connected" | "disconnected";
  error: string | null;
}>({ status: "idle", error: null });

/** 当前 rpc client（测试直接装载/卸载）。 */
export const rpcHolder: { rpc: Record<string, unknown> | null } = { rpc: null };

let generation = 0;
let requireRpcError: string | null = null;

export function getRpc(): Record<string, unknown> | null {
  return rpcHolder.rpc;
}

export function requireRpc(): Record<string, unknown> {
  if (!rpcHolder.rpc || requireRpcError !== null) {
    throw new Error(requireRpcError ?? "The Skill Creator daemon is not connected.");
  }
  return rpcHolder.rpc;
}

export function getConnectionGeneration(): number {
  return generation;
}

export const connect = vi.fn();
export const disconnect = vi.fn();

/** 模拟「WS 握手完成」：装载 client、推进所有权世代并转 connected。 */
export function connectMockClient(rpc: Record<string, unknown> | null): void {
  rpcHolder.rpc = rpc;
  generation += 1;
  connectionState.status = rpc === null ? "disconnected" : "connected";
  connectionState.error = null;
}

/** 强制 requireRpc 抛错文案（默认复刻真 store 的断线错误）。 */
export function setRequireRpcError(message: string | null): void {
  requireRpcError = message;
}

/** 每用例复位到「深链首帧」：连接中、无 client、世代归零。 */
export function resetConnectionStub(): void {
  rpcHolder.rpc = null;
  requireRpcError = null;
  generation = 0;
  connectionState.status = "connecting";
  connectionState.error = null;
  connect.mockReset();
  disconnect.mockReset();
}
