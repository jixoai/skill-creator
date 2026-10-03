/**
 * 终端输入顺序写owner（复刻 jixoai-labs/openspecui packages/server/src/
 * pty-input-writer.ts——同日 owner 实报「启动终端冻结整个应用」的另一半修复）。
 *
 * 用户原始需求 [2026-10-03]（skills-agent-page design §4 同源教训）：反压的
 * Unix PTY 描述符若在事件循环线程直接 write，EAGAIN 自旋可独占共享事件循环。
 *
 * 正交意图：
 *   [1] PTY 输入不经事件循环线程直写：Unix 走 fs 线程池的 fd 写（顺序保持、
 *       EAGAIN 有界重试），win32 走原生 write。
 *   [2] 跨部分写保序；pending 输入有界（1MiB）。
 *   [3] 随会话退役：close 清队列与重试定时器。
 * 妥协声明：UnixTerminal 的 fd 是上游 IPty 未在类型面暴露的运行时访问器
 *   （number 校验后使用）；无 fd 时回退 target.write（保功能不保公平性）。
 */
import { write as writeFileDescriptor } from "node:fs";

const DEFAULT_MAX_PENDING_BYTES = 1024 * 1024;
const DEFAULT_RETRY_DELAY_MS = 10;

interface TerminalInputTarget {
  /** 运行时 UnixTerminal 访问器（上游类型面缺失；number 校验后消费）。 */
  readonly fd?: unknown;
  write(data: string): void;
}

export type FileDescriptorWrite = (
  fd: number,
  buffer: Buffer,
  offset: number,
  length: number,
  position: null,
  callback: (error: NodeJS.ErrnoException | null, bytesWritten: number, buffer: Buffer) => void,
) => void;

interface TerminalInputWriterOptions {
  platform: NodeJS.Platform;
  maxPendingBytes?: number;
  retryDelayMs?: number;
  writeFd?: FileDescriptorWrite;
  onError?: (error: Error) => void;
}

function isRetryableWriteError(error: NodeJS.ErrnoException): boolean {
  return error.code === "EAGAIN" || error.code === "EWOULDBLOCK" || error.code === "EINTR";
}

/** 有界顺序 PTY 输入 owner。 */
export class TerminalInputWriter {
  private readonly fd: number | null;
  private readonly useNativeWriter: boolean;
  private readonly maxPendingBytes: number;
  private readonly retryDelayMs: number;
  private readonly writeFd: FileDescriptorWrite;
  private readonly onError: (error: Error) => void;
  private readonly chunks: Buffer[] = [];
  private firstChunkOffset = 0;
  private writing = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private pending = 0;

  constructor(
    private readonly target: TerminalInputTarget,
    options: TerminalInputWriterOptions,
  ) {
    this.useNativeWriter = options.platform === "win32";
    this.fd =
      options.platform === "win32"
        ? null
        : typeof target.fd === "number" && Number.isInteger(target.fd) && target.fd >= 0
          ? target.fd
          : null;
    this.maxPendingBytes = options.maxPendingBytes ?? DEFAULT_MAX_PENDING_BYTES;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.writeFd = options.writeFd ?? writeFileDescriptor;
    this.onError = options.onError ?? (() => {});
  }

  /** 接受一段有序输入；false = owner 已关或越界。 */
  write(data: string): boolean {
    if (this.closed) return false;
    if (data.length === 0) return true;
    if (this.useNativeWriter || this.fd === null) {
      this.target.write(data);
      return true;
    }
    const buffer = Buffer.from(data);
    if (this.pending + buffer.byteLength > this.maxPendingBytes) return false;
    this.chunks.push(buffer);
    this.pending += buffer.byteLength;
    this.pump();
    return true;
  }

  /** 随会话退役排队输入与重试。 */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.chunks.length = 0;
    this.firstChunkOffset = 0;
    this.pending = 0;
  }

  private pump(): void {
    if (this.closed || this.writing || this.retryTimer) return;
    const chunk = this.chunks[0];
    if (!chunk || this.fd === null) return;
    this.writing = true;
    this.writeFd(
      this.fd,
      chunk,
      this.firstChunkOffset,
      chunk.byteLength - this.firstChunkOffset,
      null,
      (error, bytesWritten) => {
        this.writing = false;
        if (this.closed) return;
        if (error) {
          if (isRetryableWriteError(error)) {
            this.scheduleRetry();
            return;
          }
          this.onError(error);
          this.close();
          return;
        }
        if (bytesWritten <= 0) {
          this.scheduleRetry();
          return;
        }
        this.firstChunkOffset += bytesWritten;
        this.pending -= bytesWritten;
        if (this.firstChunkOffset >= chunk.byteLength) {
          this.chunks.shift();
          this.firstChunkOffset = 0;
        }
        setImmediate(() => this.pump());
      },
    );
  }

  private scheduleRetry(): void {
    if (this.closed || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.pump();
    }, this.retryDelayMs);
  }
}
