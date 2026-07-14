/**
 * 原始需求 [2026-07-14]：「参考 ../../pnpm-pub 这个项目的架构：cli+gui(webui+opentray)」。
 * 正交意图：
 * 1. 编码并增量读取定长头 JSON frame。
 * 2. 定义并校验带版本的 CLI 请求信封。
 * 3. 定义并校验 daemon 响应。
 */

const HEADER_BYTES = 4;

/** CLI 与 daemon 共同支持的当前 wire protocol 版本。 */
export const IPC_PROTOCOL_VERSION = 1;

/** 本地 CLI 到 daemon 协议允许的最大 frame body。 */
export const MAX_IPC_FRAME_BYTES = 1024 * 1024;

/** 输入 frame 超限时抛出的可识别终止错误。 */
export class IpcFrameTooLargeError extends Error {
  override readonly name = "IpcFrameTooLargeError";

  constructor(
    readonly frameBytes: number,
    readonly maxFrameBytes: number,
  ) {
    super(`IPC frame body is ${frameBytes} bytes; maximum is ${maxFrameBytes} bytes.`);
  }
}

/** Concatenate an array of Uint8Array chunks into one. */
function concatU8(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** 将可 JSON 序列化的值编码为受大小限制的 frame。 */
export function encodeFrame(value: unknown): Buffer {
  const json = JSON.stringify(value);
  const body = Buffer.from(json, "utf8");
  if (body.length > MAX_IPC_FRAME_BYTES) {
    throw new IpcFrameTooLargeError(body.length, MAX_IPC_FRAME_BYTES);
  }
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

/**
 * 增量 frame reader；通过 {@link push} 输入字节，并由 {@link frames} 逐帧消费。
 *
 * Usage (server side, one reader per connection):
 *   const reader = new FrameReader();
 *   socket.on('data', (b) => reader.push(b));
 *   for await (const frame of reader.frames()) { ... }
 */
export class FrameReader {
  private buffer: Uint8Array = new Uint8Array(0);
  private pending: Uint8Array[] = [];
  private resolvers: Array<{
    resolve: (value: IteratorResult<Uint8Array>) => void;
    reject: (error: Error) => void;
  }> = [];
  private closed = false;
  private failure: Error | null = null;

  constructor(private readonly maxFrameBytes = MAX_IPC_FRAME_BYTES) {
    if (!Number.isSafeInteger(maxFrameBytes) || maxFrameBytes <= 0) {
      throw new RangeError("FrameReader maxFrameBytes must be a positive safe integer.");
    }
  }

  /** Append incoming bytes and wake any blocked consumer. */
  push(chunk: Uint8Array): void {
    if (this.closed || this.failure) return;
    this.buffer = this.buffer.length === 0 ? chunk : concatU8([this.buffer, chunk]);
    this.drain();
  }

  private drain(): void {
    while (this.buffer.length >= HEADER_BYTES) {
      const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
      const length = view.getUint32(0);
      if (length > this.maxFrameBytes) {
        this.fail(new IpcFrameTooLargeError(length, this.maxFrameBytes));
        return;
      }
      const total = HEADER_BYTES + length;
      if (this.buffer.length < total) return; // wait for more bytes
      const body = this.buffer.subarray(HEADER_BYTES, total);
      this.buffer = this.buffer.subarray(total);
      const copy = new Uint8Array(body);
      const resolver = this.resolvers.shift();
      if (resolver) {
        resolver.resolve({ value: copy, done: false });
      } else {
        this.pending.push(copy);
      }
    }
  }

  /** Signal end-of-stream so `frames()` resolves its final value. */
  close(): void {
    if (this.closed || this.failure) return;
    this.closed = true;
    this.buffer = new Uint8Array(0);
    for (const resolver of this.resolvers) {
      resolver.resolve({ value: undefined, done: true });
    }
    this.resolvers = [];
  }

  private fail(error: Error): void {
    if (this.closed || this.failure) return;
    this.failure = error;
    this.buffer = new Uint8Array(0);
    for (const resolver of this.resolvers) {
      resolver.reject(error);
    }
    this.resolvers = [];
  }

  /** Async iterator yielding one decoded frame body at a time. */
  async *frames(): AsyncIterable<Uint8Array> {
    while (true) {
      const next = this.pending.shift();
      if (next) {
        yield next;
        continue;
      }
      if (this.failure) throw this.failure;
      if (this.closed) return;
      const frame = await new Promise<IteratorResult<Uint8Array>>((resolve, reject) => {
        this.resolvers.push({ resolve, reject });
      });
      if (frame.done) return;
      yield frame.value;
    }
  }
}

/** 附加客户端元数据前的 CLI 命令。 */
export type IpcCommand = { type: "status" } | { type: "stop" } | { type: "open" };

/** 带强制兼容元数据的 CLI 到 daemon 请求。 */
export type IpcRequest = IpcCommand & {
  protocolVersion: number;
  cliVersion: string;
};

/** 稳定、机器可读的 daemon 拒绝类别。 */
export type IpcErrorCode = "frame-too-large" | "invalid-request" | "protocol-mismatch";

/** daemon 到 CLI 的响应联合。 */
export type IpcResponse =
  | { ok: true; data?: unknown }
  | { ok: false; error: string; code?: IpcErrorCode };

/** 为命令附加当前协议版本与 CLI 包版本。 */
export function createIpcRequest(command: IpcCommand, cliVersion: string): IpcRequest {
  if (cliVersion.length === 0) throw new Error("CLI version must not be empty.");
  return { ...command, protocolVersion: IPC_PROTOCOL_VERSION, cliVersion };
}

/** 将不可信 JSON 值解析为带版本 IPC 请求。 */
export function parseIpcRequest(value: unknown): IpcRequest | null {
  if (!isRecord(value)) return null;
  const protocolVersion = value.protocolVersion;
  const cliVersion = value.cliVersion;
  if (typeof protocolVersion !== "number" || !Number.isSafeInteger(protocolVersion)) return null;
  if (typeof cliVersion !== "string" || cliVersion.length === 0) return null;
  const metadata = { protocolVersion, cliVersion };
  switch (value.type) {
    case "status":
      return { ...metadata, type: "status" };
    case "stop":
      return { ...metadata, type: "stop" };
    case "open":
      return { ...metadata, type: "open" };
    default:
      return null;
  }
}

/** 将不可信 JSON 值解析为 daemon 响应。 */
export function parseIpcResponse(value: unknown): IpcResponse | null {
  if (!isRecord(value) || typeof value.ok !== "boolean") return null;
  if (value.ok) return "data" in value ? { ok: true, data: value.data } : { ok: true };
  if (typeof value.error !== "string") return null;
  if (value.code !== undefined && !isIpcErrorCode(value.code)) return null;
  return value.code === undefined
    ? { ok: false, error: value.error }
    : { ok: false, error: value.error, code: value.code };
}

function isIpcErrorCode(value: unknown): value is IpcErrorCode {
  return (
    value === "frame-too-large" || value === "invalid-request" || value === "protocol-mismatch"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
