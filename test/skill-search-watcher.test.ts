/**
 * watcher 行为测试（search-robustness R4）。
 *
 * User input [2026-09-18]: 「合理使用高性能的方案监听 skill 文件夹的内容发生改变，
 * 并实时更新索引」。
 *
 * Orthogonal intents:
 *   [1] reconcile/isClean：watch 集合对齐；unwatched 目录令 isClean 恒 false。
 *   [2] dirty → 去抖 flush：≤20k 同步刷新；flush 失败保持 dirty。
 *   [3] dispose 关闭全部句柄（进程可退出）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSkillSearchWatcher } from "../src/daemon/skill-search/watcher.js";

let sandbox = "";

let useFake = false;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-search-watcher-"));
});

afterEach(() => {
  if (useFake) {
    vi.useRealTimers();
    useFake = false;
  }
  fs.rmSync(sandbox, { recursive: true, force: true });
});

/** fs.watch 事件经真实 libuv 轮次送达：事件用例用真实计时器与轮询等待（FSEvents 延迟可 >30ms）。 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(10);
  }
  return predicate();
}

function makeWatcher(onFlush: () => void, documentCount = () => 10) {
  return createSkillSearchWatcher({ onFlush, documentCount });
}

describe("skill search watcher (search-robustness R4)", () => {
  it("reconciles the watch set and reports clean only when every dir is watched", () => {
    const dir = path.join(sandbox, "skills");
    fs.mkdirSync(dir);
    const watcher = makeWatcher(() => {});
    expect(watcher.isClean([dir])).toBe(false);
    watcher.reconcile([dir]);
    expect(watcher.isClean([dir])).toBe(true);
    expect(watcher.watchedCount()).toBe(1);
    // 消失的目录被关闭；新目标建立。
    const other = path.join(sandbox, "other");
    fs.mkdirSync(other);
    watcher.reconcile([other]);
    expect(watcher.watchedCount()).toBe(1);
    expect(watcher.isClean([dir])).toBe(false);
    expect(watcher.isClean([other])).toBe(true);
    watcher.dispose();
  });

  it("never reports clean for nonexistent directories (fallback to scanning)", () => {
    const watcher = makeWatcher(() => {});
    watcher.reconcile([path.join(sandbox, "missing")]);
    expect(watcher.watchedCount()).toBe(0);
    expect(watcher.isClean([path.join(sandbox, "missing")])).toBe(false);
    watcher.dispose();
  });

  it("marks dirty on file events and flushes synchronously after the debounce window", async () => {
    const dir = path.join(sandbox, "skills", "alpha");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), "---\nname: alpha\n---\n");
    const onFlush = vi.fn();
    const watcher = makeWatcher(onFlush);
    watcher.reconcile([path.join(sandbox, "skills")]);
    expect(watcher.isClean([path.join(sandbox, "skills")])).toBe(true);

    fs.writeFileSync(path.join(dir, "SKILL.md"), "---\nname: alpha\n---\n edited");
    fs.writeFileSync(path.join(dir, "SKILL.md"), "---\nname: alpha\n---\n edited again");
    expect(await waitFor(() => !watcher.isClean([path.join(sandbox, "skills")]), 2_000)).toBe(true);
    expect(onFlush).not.toHaveBeenCalled();
    await sleep(200);
    expect(onFlush).not.toHaveBeenCalled();
    expect(await waitFor(() => onFlush.mock.calls.length === 1, 2_000)).toBe(true);
    // flush 成功 → 恢复 clean。
    expect(watcher.isClean([path.join(sandbox, "skills")])).toBe(true);
    watcher.dispose();
  });

  it("keeps dirty when the flush callback throws (next search self-heals)", async () => {
    const dir = path.join(sandbox, "skills");
    fs.mkdirSync(dir);
    const watcher = makeWatcher(() => {
      throw new Error("flush failed");
    });
    watcher.reconcile([dir]);
    fs.writeFileSync(path.join(dir, "note.md"), "x");
    await sleep(400);
    expect(watcher.isClean([dir])).toBe(false);
    watcher.dispose();
  });

  it("stays lazy above the synchronous flush document limit", async () => {
    const dir = path.join(sandbox, "skills");
    fs.mkdirSync(dir);
    const onFlush = vi.fn();
    const watcher = makeWatcher(onFlush, () => 20_001);
    watcher.reconcile([dir]);
    fs.writeFileSync(path.join(dir, "note.md"), "x");
    await sleep(500);
    expect(onFlush).not.toHaveBeenCalled();
    expect(watcher.isClean([dir])).toBe(false);
    watcher.dispose();
  });

  it("dispose closes watchers and stops flush scheduling (idempotent)", async () => {
    const dir = path.join(sandbox, "skills");
    fs.mkdirSync(dir);
    const onFlush = vi.fn();
    const watcher = makeWatcher(onFlush);
    watcher.reconcile([dir]);
    fs.writeFileSync(path.join(dir, "note.md"), "x");
    watcher.dispose();
    watcher.dispose();
    await sleep(400);
    expect(onFlush).not.toHaveBeenCalled();
    expect(watcher.watchedCount()).toBe(0);
  });
});
