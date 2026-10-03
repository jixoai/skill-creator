/**
 * 终端输出有界 batcher（复刻 jixoai-labs/openspecui packages/server/src/
 * pty-output-batcher.ts 的公平性法则，2026-07-21 owner 实报「终端输出饿死
 * Server」的修复件；条目化改写——每块保留自身 seq，协议 output 帧逐 seq 发出）。
 *
 * 用户原始需求 [2026-10-03]（skills-agent-page design §4）：「有 2026-07-21
 * 『终端输出饿死 Server』owner 实报——输出必须独立 batcher，本实现同款必抄。」
 *
 * 正交意图：
 *   [1] 把一个附着订阅的终端输出合并为有界批次（≤16KiB/批）投递：批内多块、
 *       每块保持 {seq, data} 原子边界（客户端缺口对账不因合并失真）。
 *   [2] 批间 setImmediate 让渡——繁忙终端不饿死 daemon 事件循环（无关 RPC
 *       流量持续被服务）。
 *   [3] 订阅被替换/关闭时退役排队输出；生命周期事件（exit）经 afterFlush
 *       排队在已接受输出之后投递。
 * 妥协声明：pending 上限 1MiB——慢客户端超限即溢出回调（调用方断开该订阅），
 *   PTY 会话本体（daemon-owned 环形缓冲）不受慢客户端拖累，重连可恢复。
 */
import type { TerminalBufferEntry } from "./protocol.js";

const MAX_OUTPUT_BATCH_BYTES = 16 * 1024;
const MAX_PENDING_OUTPUT_BYTES = 1024 * 1024;

function isUtf8ContinuationByte(value: number | undefined): boolean {
  return value !== undefined && (value & 0xc0) === 0x80;
}

/** 单块的字节视图（UTF-8 边界裁剪需要原始字节）。 */
interface PendingChunk {
  seq: number;
  buffer: Buffer;
}

/** 按序收集一个有界批次的输出块。 */
function collectBatch(
  chunks: PendingChunk[],
  cursor: { index: number; offset: number },
): { entries: TerminalBufferEntry[]; consumedBytes: number } {
  const entries: TerminalBufferEntry[] = [];
  let remaining = MAX_OUTPUT_BATCH_BYTES;
  let consumedBytes = 0;
  while (remaining > 0) {
    const chunk = chunks[cursor.index];
    if (chunk === undefined) break;
    const available = chunk.buffer.byteLength - cursor.offset;
    let count = available;
    if (count > remaining) {
      count = remaining;
      while (count > 0 && isUtf8ContinuationByte(chunk.buffer[cursor.offset + count])) {
        count -= 1;
      }
    }
    if (count <= 0) break;
    entries.push({
      seq: chunk.seq,
      data: chunk.buffer.subarray(cursor.offset, cursor.offset + count).toString("utf8"),
    });
    cursor.offset += count;
    consumedBytes += count;
    remaining -= count;
    if (cursor.offset >= chunk.buffer.byteLength) {
      cursor.index += 1;
      cursor.offset = 0;
    }
  }
  return { entries, consumedBytes };
}

/** 公平事件循环泵：输出已由 server-owned 会话缓冲持有，这里只管有界投递。 */
export class TerminalOutputBatcher {
  private chunks: PendingChunk[] = [];
  private cursor = { index: 0, offset: 0 };
  private pendingBytes = 0;
  private scheduledFlush: ReturnType<typeof setImmediate> | null = null;
  private idleCallbacks: Array<() => void> = [];
  private closed = false;

  constructor(
    private readonly flushBatch: (entries: TerminalBufferEntry[]) => void,
    private readonly overflow: () => void,
  ) {}

  enqueue(entry: TerminalBufferEntry): boolean {
    if (this.closed || entry.data.length === 0) return false;
    const buffer = Buffer.from(entry.data);
    if (this.pendingBytes + buffer.byteLength > MAX_PENDING_OUTPUT_BYTES) {
      this.close();
      this.overflow();
      return false;
    }
    this.chunks.push({ seq: entry.seq, buffer });
    this.pendingBytes += buffer.byteLength;
    this.scheduleFlush();
    return true;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.scheduledFlush) clearImmediate(this.scheduledFlush);
    this.scheduledFlush = null;
    this.chunks = [];
    this.cursor = { index: 0, offset: 0 };
    this.pendingBytes = 0;
    this.idleCallbacks = [];
  }

  /** 生命周期事件在已接受输出投递完毕后才发出（exit 不抢先于残余输出）。 */
  afterFlush(callback: () => void): void {
    if (this.closed) return;
    if (this.pendingBytes === 0 && this.scheduledFlush === null) {
      callback();
      return;
    }
    this.idleCallbacks.push(callback);
  }

  private scheduleFlush(): void {
    if (this.closed || this.scheduledFlush) return;
    this.scheduledFlush = setImmediate(() => {
      this.scheduledFlush = null;
      this.flushNextBatch();
    });
  }

  private flushNextBatch(): void {
    if (this.closed || this.pendingBytes === 0) return;
    const { entries, consumedBytes } = collectBatch(this.chunks, this.cursor);
    this.pendingBytes -= consumedBytes;
    if (this.chunks.length > 0 && this.cursor.index * 2 >= this.chunks.length) {
      this.chunks = this.chunks.slice(this.cursor.index);
      this.cursor = { index: 0, offset: this.cursor.offset };
    }
    if (entries.length > 0) this.flushBatch(entries);
    if (this.pendingBytes > 0) {
      this.scheduleFlush();
      return;
    }
    this.chunks = [];
    this.cursor = { index: 0, offset: 0 };
    const callbacks = this.idleCallbacks;
    this.idleCallbacks = [];
    for (const callback of callbacks) callback();
  }
}
