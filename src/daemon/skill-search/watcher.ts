/**
 * 用户原始需求 [2026-09-18]：「有没有合理使用高性能的方案监听 skill 文件夹的
 * 内容发生改变，并实时更新索引？」
 * 正交意图：
 * 1. 事件驱动新鲜度：去重 canonical roots 的 watch 集合与 reconcile（watch 经
 *    可注入 seam，生产绑定 fs.watch recursive；测试用确定性假实现）。
 * 2. dirty 语义与去抖 flush：无事件时 search 零扫描；事件后 ≤20k 文档同步刷新
 *    （实时），更大语料保持 dirty 到下次 search（lazy 降级）。
 * 妥协声明：flush 回调在事件循环内同步执行（≤20k 文档的增量 freshen 实测量级
 * <100ms）；更大语料的后台分片刷新与 >10k 文档 Tantivy 评估同属远期工程。
 */
import fs from "node:fs";

/** 事件去抖窗口（ms）：合并连续编辑/安装风暴为一次刷新。 */
export const FLUSH_DEBOUNCE_MS = 300;
/** 同步 flush 的文档量上限；更大语料降级 dirty-lazy（下次 search 刷新）。 */
export const SYNCHRONOUS_FLUSH_DOCUMENT_LIMIT = 20_000;

/** 单目录 watch 句柄（seam：生产为 fs.watch 包装；测试为可控假实现）。 */
export interface WatchHandle {
  close: () => void;
  /** 目录内任意变更事件（回调内不得抛出）。 */
  onEvent: (callback: () => void) => void;
  /** watch 通道故障（目录删除/权限回收）：句柄随之失效。 */
  onError: (callback: () => void) => void;
}

/** watch 工厂 seam：建立失败（平台不支持/EMFILE/目录不存在）直接抛错。 */
export type WatchFactory = (directory: string) => WatchHandle;

/** 生产工厂：fs.watch(recursive, persistent:false)。 */
export const fsWatchFactory: WatchFactory = (directory) => {
  const watcher = fs.watch(directory, { recursive: true, persistent: false });
  return {
    close: () => watcher.close(),
    onEvent: (callback) => watcher.on("change", callback),
    onError: (callback) => watcher.on("error", callback),
  };
};

/** watcher 的对外抽象（service 持有；测试可直接驱动）。 */
export interface SkillSearchWatcher {
  /** 把 watch 集合对齐到给定 canonical 目录（消失关闭、新增尝试建立）。 */
  reconcile(watchDirs: readonly string[]): void;
  /** 全部给定目录都有活跃 watch 且无未消化事件时为 true（search 可跳过扫描）。 */
  isClean(watchDirs: readonly string[]): boolean;
  /** 显式回收：关全部句柄与定时器（daemon stop coordinator 接线）。 */
  dispose(): void;
  /** 活跃 watch 目录数（诊断/测试）。 */
  watchedCount(): number;
}

/**
 * 创建 watcher。onFlush 在去抖窗口后同步调用（由 service 提供完整
 * scan→canonicalize→freshen→reconcile 闭包）；flush 抛错时保持 dirty，
 * 下一次 search 会重走完整路径自愈。watch seam 仅供测试注入确定性句柄。
 */
export function createSkillSearchWatcher(options: {
  onFlush: () => void;
  documentCount: () => number;
  watch?: WatchFactory;
}): SkillSearchWatcher {
  const watchFactory = options.watch ?? fsWatchFactory;
  const watched = new Map<string, { handle: WatchHandle; closed: boolean }>();
  let dirty = false;
  let disposed = false;
  let flushTimer: NodeJS.Timeout | null = null;

  function markDirty(): void {
    if (disposed) return;
    dirty = true;
    if (flushTimer !== null) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      if (disposed || !dirty) return;
      if (options.documentCount() > SYNCHRONOUS_FLUSH_DOCUMENT_LIMIT) return; // lazy 降级
      try {
        options.onFlush();
        dirty = false;
      } catch {
        // 保持 dirty：下一次 search 走完整路径（typed 错误由那次调用上抛）。
      }
    }, FLUSH_DEBOUNCE_MS);
    // 不阻止进程退出（persistent:false 的 watch 同理；dispose 仍是显式回收主路径）。
    flushTimer.unref?.();
  }

  return {
    reconcile(watchDirs: readonly string[]): void {
      if (disposed) return;
      const desired = new Set(watchDirs);
      for (const [dir, entry] of watched) {
        if (!desired.has(dir)) {
          watched.delete(dir);
          closeQuietly(entry);
        }
      }
      for (const dir of desired) {
        if (watched.has(dir)) continue;
        try {
          const handle = watchFactory(dir);
          handle.onEvent(() => markDirty());
          handle.onError(() => {
            // watch 通道故障：摘除该目录，search 回退扫描。
            const entry = watched.get(dir);
            if (entry) {
              watched.delete(dir);
              closeQuietly(entry);
            }
            markDirty();
          });
          watched.set(dir, { handle, closed: false });
        } catch {
          // 平台不支持 recursive / EMFILE / 目录不存在：该目录保持 unwatched，
          // isClean 恒 false，search 回退逐次扫描（行为与无 watcher 时代一致）。
        }
      }
    },
    isClean(watchDirs: readonly string[]): boolean {
      if (dirty) return false;
      return watchDirs.every((dir) => watched.has(dir));
    },
    dispose(): void {
      disposed = true;
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      for (const entry of watched.values()) closeQuietly(entry);
      watched.clear();
      dirty = false;
    },
    watchedCount(): number {
      return watched.size;
    },
  };
}

function closeQuietly(entry: { handle: WatchHandle; closed: boolean }): void {
  if (entry.closed) return;
  entry.closed = true;
  try {
    entry.handle.close();
  } catch {
    // 已失效句柄：关闭失败无需处理。
  }
}
