/**
 * 测试沙箱回收 helper（macOS tantivy 竞态加固，2026-09-21）。
 *
 * User input [2026-09-21]：「afterEach 清理加一个共享 helper：rmSync ENOTEMPTY 时
 * 短有界重试（≤3 次、50ms 退避、仅 ENOTEMPTY 重试、其他错误照抛）——macOS 下
 * tantivy 后台 merge rename 的竞态。不吞错、可观测（最后一次仍失败则抛）。」
 * （jixoai-search-core Phase 2 顺手修。）
 */
import fs from "node:fs";

/** 重试上限：首次 + 2 次重试（共 3 次）。 */
const MAX_ATTEMPTS = 3;
/** 重试间退避（ms；同步等待，afterEach 语义保持同步）。 */
const RETRY_BACKOFF_MS = 50;

/** 同步毫秒级等待（不占事件循环，不引入计时器句柄）。 */
function sleepSync(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/**
 * 递归删除测试沙箱；仅对 ENOTEMPTY（删除途中 tantivy merge 线程 rename 进新文件）
 * 做有界重试，其余错误（EACCES/EIO 等）原样上抛。最后一次重试仍 ENOTEMPTY 则抛出，
 * 不吞错。
 */
export function rmSandboxRetry(directory: string): void {
  for (let attempt = 1; ; attempt += 1) {
    try {
      fs.rmSync(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
      if (code !== "ENOTEMPTY" || attempt >= MAX_ATTEMPTS) throw error;
      sleepSync(RETRY_BACKOFF_MS);
    }
  }
}
