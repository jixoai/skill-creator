/**
 * 原始需求 [2026-07-14]：「参考 ../../pnpm-pub 这个项目的架构：cli+gui(webui+opentray)」。
 * 正交意图：[1] 在固定期限内区分活跃 listener 与陈旧 socket 路径。
 */
import net from "node:net";

/** 判断本地 daemon socket 是否接受连接的默认期限。 */
export const DEFAULT_SOCKET_PROBE_TIMEOUT_MS = 250;

/** 返回 `socketPathname` 能否在 `timeoutMs` 内接受连接。 */
export function socketAcceptsConnections(
  socketPathname: string,
  timeoutMs = DEFAULT_SOCKET_PROBE_TIMEOUT_MS,
): Promise<boolean> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("Socket probe timeoutMs must be a positive safe integer.");
  }

  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ path: socketPathname });
    let settled = false;
    const finish = (acceptsConnections: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(acceptsConnections);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}
