/**
 * User input [2026-07-21]: development startup must take over the single OpenTray session.
 * Orthogonal intents:
 * 1. Send one versioned command to an explicit daemon socket.
 * 2. Decode the framed response through the shared runtime contract.
 * 3. Preserve connection and daemon-response error categories for callers.
 */
import net from "node:net";
import {
  createIpcRequest,
  encodeFrame,
  FrameReader,
  parseIpcResponse,
  type IpcCommand,
  type IpcErrorCode,
} from "../shared/frame.js";

/** The target daemon socket could not complete a framed request. */
export class DaemonConnectionError extends Error {
  override readonly name = "DaemonConnectionError";
}

/** The daemon responded, but rejected the command or violated its response contract. */
export class DaemonResponseError extends Error {
  override readonly name = "DaemonResponseError";

  constructor(
    message: string,
    readonly code?: IpcErrorCode,
  ) {
    super(message);
  }
}

/** Send one command to a concrete Skill Creator daemon endpoint. */
export async function requestDaemon(options: {
  socket: string;
  clientVersion: string;
  command: IpcCommand;
  timeoutMs?: number;
}): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? 4_000;
  return new Promise<unknown>((resolve, reject) => {
    const sock = net.createConnection({ path: options.socket });
    const reader = new FrameReader();
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      sock.destroy();
      reject(new DaemonConnectionError("IPC request timed out - is the daemon running?"));
    }, timeoutMs);

    sock.on("connect", () => {
      sock.write(encodeFrame(createIpcRequest(options.command, options.clientVersion)));
    });
    sock.on("data", (chunk: Buffer) => reader.push(chunk));
    sock.on("error", (error: Error) => {
      reader.close();
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new DaemonConnectionError(`cannot reach daemon (${error.message})`));
    });
    sock.on("end", () => reader.close());
    sock.on("close", () => reader.close());

    void (async () => {
      try {
        for await (const body of reader.frames()) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const decoded: unknown = JSON.parse(Buffer.from(body).toString("utf8"));
          const response = parseIpcResponse(decoded);
          if (!response) {
            reject(new DaemonResponseError("Daemon returned an invalid IPC response."));
            return;
          }
          if (!response.ok) {
            reject(new DaemonResponseError(response.error, response.code));
            return;
          }
          resolve(response.data);
          sock.end();
          return;
        }
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new DaemonConnectionError("daemon closed the connection without responding"));
        }
      } catch (error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    })();
  });
}
