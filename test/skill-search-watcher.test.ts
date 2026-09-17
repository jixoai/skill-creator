/**
 * watcher 行为测试（search-robustness R4；codex R1 复审后重写）。
 *
 * User input [2026-09-18]: 「合理使用高性能的方案监听 skill 文件夹的内容发生改变，
 * 并实时更新索引」。
 *
 * 正交意图：
 *   [1] 确定性单测：注入 watch seam（同步事件 + 假计时器），不再依赖 FSEvents
 *       投递时序（复审实测三项时序抖动失败）。
 *   [2] 真实集成 ×1：生产 fs.watch 工厂 + 轮询等待（宽松 deadline）。
 *   [3] reconcile/isClean/dispose 语义。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSkillSearchWatcher,
  FLUSH_DEBOUNCE_MS,
  type WatchFactory,
  type WatchHandle,
} from "../src/daemon/skill-search/watcher.js";

let sandbox = "";

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-search-watcher-"));
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

/** 可控 watch seam：按目录记录句柄，测试直接触发事件/错误。 */
function scriptedWatchFactory() {
  const handles = new Map<string, { events: Array<() => void>; errors: Array<() => void> }>();
  const factory: WatchFactory = (directory) => {
    const entry = { events: [], errors: [] };
    handles.set(directory, entry);
    const handle: WatchHandle = {
      close: () => handles.delete(directory),
      onEvent: (callback) => entry.events.push(callback),
      onError: (callback) => entry.errors.push(callback),
    };
    return handle;
  };
  return {
    factory,
    emit: (directory: string) => {
      for (const callback of handles.get(directory)?.events ?? []) callback();
    },
    fail: (directory: string) => {
      for (const callback of handles.get(directory)?.errors ?? []) callback();
    },
    watched: () => [...handles.keys()],
  };
}

function makeWatcher(
  onFlush: () => void,
  seam: ReturnType<typeof scriptedWatchFactory>,
  documentCount = () => 10,
) {
  return createSkillSearchWatcher({
    onFlush,
    documentCount,
    watch: seam.factory,
  });
}

describe("skill search watcher (deterministic seam)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reconciles the watch set and reports clean only when every dir is watched", () => {
    const dir = path.join(sandbox, "skills");
    fs.mkdirSync(dir);
    const seam = scriptedWatchFactory();
    const watcher = makeWatcher(() => {}, seam);
    expect(watcher.isClean([dir])).toBe(false);
    watcher.reconcile([dir]);
    expect(watcher.isClean([dir])).toBe(true);
    expect(watcher.watchedCount()).toBe(1);
    const other = path.join(sandbox, "other");
    fs.mkdirSync(other);
    watcher.reconcile([other]);
    expect(watcher.watchedCount()).toBe(1);
    expect(watcher.isClean([dir])).toBe(false);
    expect(watcher.isClean([other])).toBe(true);
    watcher.dispose();
  });

  it("never reports clean for dirs the factory rejects (fallback to scanning)", () => {
    const missing = path.join(sandbox, "missing");
    const watcher = createSkillSearchWatcher({
      onFlush: () => {},
      documentCount: () => 10,
      watch: () => {
        throw new Error("watch unsupported");
      },
    });
    watcher.reconcile([missing]);
    expect(watcher.watchedCount()).toBe(0);
    expect(watcher.isClean([missing])).toBe(false);
    watcher.dispose();
  });

  it("marks dirty on events and flushes synchronously after the debounce window", async () => {
    const dir = path.join(sandbox, "skills");
    fs.mkdirSync(dir);
    const seam = scriptedWatchFactory();
    const onFlush = vi.fn();
    const watcher = makeWatcher(onFlush, seam);
    watcher.reconcile([dir]);
    expect(watcher.isClean([dir])).toBe(true);

    seam.emit(dir);
    seam.emit(dir);
    expect(watcher.isClean([dir])).toBe(false);
    expect(onFlush).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(FLUSH_DEBOUNCE_MS - 1);
    expect(onFlush).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(watcher.isClean([dir])).toBe(true);
    watcher.dispose();
  });

  it("keeps dirty when the flush callback throws (next search self-heals)", async () => {
    const dir = path.join(sandbox, "skills");
    fs.mkdirSync(dir);
    const seam = scriptedWatchFactory();
    const watcher = makeWatcher(() => {
      throw new Error("flush failed");
    }, seam);
    watcher.reconcile([dir]);
    seam.emit(dir);
    await vi.advanceTimersByTimeAsync(FLUSH_DEBOUNCE_MS + 50);
    expect(watcher.isClean([dir])).toBe(false);
    watcher.dispose();
  });

  it("stays lazy above the synchronous flush document limit", async () => {
    const dir = path.join(sandbox, "skills");
    fs.mkdirSync(dir);
    const seam = scriptedWatchFactory();
    const onFlush = vi.fn();
    const watcher = makeWatcher(onFlush, seam, () => 20_001);
    watcher.reconcile([dir]);
    seam.emit(dir);
    await vi.advanceTimersByTimeAsync(FLUSH_DEBOUNCE_MS * 4);
    expect(onFlush).not.toHaveBeenCalled();
    expect(watcher.isClean([dir])).toBe(false);
    watcher.dispose();
  });

  it("drops the handle and marks dirty when the watch channel errors", async () => {
    const dir = path.join(sandbox, "skills");
    fs.mkdirSync(dir);
    const seam = scriptedWatchFactory();
    const onFlush = vi.fn();
    const watcher = makeWatcher(onFlush, seam);
    watcher.reconcile([dir]);
    seam.fail(dir);
    expect(watcher.isClean([dir])).toBe(false);
    expect(watcher.watchedCount()).toBe(0);
    watcher.dispose();
  });

  it("dispose closes handles and stops flush scheduling (idempotent)", async () => {
    const dir = path.join(sandbox, "skills");
    fs.mkdirSync(dir);
    const seam = scriptedWatchFactory();
    const onFlush = vi.fn();
    const watcher = makeWatcher(onFlush, seam);
    watcher.reconcile([dir]);
    seam.emit(dir);
    watcher.dispose();
    watcher.dispose();
    await vi.advanceTimersByTimeAsync(FLUSH_DEBOUNCE_MS * 2);
    expect(onFlush).not.toHaveBeenCalled();
    expect(watcher.watchedCount()).toBe(0);
    expect(seam.watched()).toHaveLength(0);
  });
});

describe("skill search watcher (real fs.watch integration)", () => {
  it("marks dirty and flushes on a real file edit with a generous deadline", async () => {
    const dir = path.join(sandbox, "skills", "alpha");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), "x");
    const onFlush = vi.fn();
    const watcher = createSkillSearchWatcher({
      onFlush,
      documentCount: () => 10,
    });
    try {
      watcher.reconcile([path.join(sandbox, "skills")]);
      fs.writeFileSync(path.join(dir, "SKILL.md"), "edited");
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline && onFlush.mock.calls.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(onFlush.mock.calls.length).toBeGreaterThan(0);
    } finally {
      watcher.dispose();
    }
  });
});
